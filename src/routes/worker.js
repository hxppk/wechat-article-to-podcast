/**
 * Worker 路由 (分布式拉模式 / 云端侧)
 *
 * 本地 worker 纯出站调用这些端点：认领任务、心跳续约、上报阶段、
 * 上传结果(mp3 + 元数据)、上报失败。所有端点需 Bearer WORKER_API_TOKEN。
 * 云端零 AI key。
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const db = require('../db/index');
const tasks = require('../db/tasks');
const podcasts = require('../db/podcasts');
const usage = require('../db/usage');
const { getUserAudioDir, getUserScriptsDir } = require('../utils/userPaths');

const LEASE_MS = parseInt(process.env.LEASE_MS, 10) || 120000;
const MAX_UPLOAD_BYTES = (parseInt(process.env.MAX_AUDIO_UPLOAD_MB, 10) || 100) * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STAGES = new Set(['parsing', 'generating', 'synthesizing']);

// 可配上限的内存上传（mp3 一般几 MB），fileFilter 先做 MIME 校验。
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'audio/mpeg') {
      const err = new Error('仅支持 audio/mpeg');
      err.code = 'INVALID_MIME';
      return cb(err);
    }
    cb(null, true);
  },
});

/**
 * 包装 multer，捕获 MulterError（如 LIMIT_FILE_SIZE→413）与 MIME 拒绝（400）。
 */
function uploadAudio(req, res, next) {
  upload.single('audio')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: '音频文件过大', code: 'FILE_TOO_LARGE' });
      }
      if (err.code === 'INVALID_MIME') {
        return res.status(400).json({ error: '仅支持 audio/mpeg', code: 'INVALID_AUDIO_TYPE' });
      }
      return res.status(400).json({ error: '上传失败', code: 'UPLOAD_ERROR' });
    }
    next();
  });
}

/**
 * 嗅探 MP3/ID3 magic：ID3v2 头("ID3") 或 MPEG 帧同步(0xFF 0xEx/0xFx)。
 */
function looksLikeMp3(buf) {
  if (!buf || buf.length < 3) return false;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true; // "ID3"
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true; // frame sync
  return false;
}

/**
 * 删除临时文件（忽略错误，避免留孤儿）
 */
function cleanupTmp(...paths) {
  for (const p of paths) {
    try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
  }
}

/**
 * 一致性边界：在单个事务内 tasks.complete + podcasts.create。
 * complete 校验 lease（changes===1），失败抛 LEASE_LOST 回滚整笔（含 podcast 插入）。
 */
const persistResult = db.transaction((id, leaseToken, meta, podcastData) => {
  const ok = tasks.complete(id, leaseToken, meta);
  if (!ok) {
    const e = new Error('lease lost');
    e.code = 'LEASE_LOST';
    throw e;
  }
  podcasts.create(podcastData);
});

/**
 * Bearer 认证中间件：校验 Authorization: Bearer <WORKER_API_TOKEN>
 */
function workerAuth(req, res, next) {
  const expected = process.env.WORKER_API_TOKEN;
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!expected || !token || token !== expected) {
    return res.status(401).json({ error: 'unauthorized', code: 'WORKER_UNAUTHORIZED' });
  }
  next();
}

router.use(workerAuth);

// 所有带 :id 的端点都要求合法 UUID（防注入/路径穿越）
router.param('id', (req, res, next, id) => {
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: '无效任务 ID', code: 'INVALID_TASK_ID' });
  }
  next();
});

/**
 * POST /api/worker/claim
 * body: {workerId}
 * 200 {task} | 204（无任务）
 */
router.post('/claim', express.json(), (req, res) => {
  const { workerId } = req.body || {};
  const task = tasks.claim({ workerId: workerId || 'unknown', leaseMs: LEASE_MS });
  if (!task) {
    return res.status(204).end();
  }
  res.json({ task, leaseMs: LEASE_MS });
});

/**
 * POST /api/worker/tasks/:id/heartbeat
 * body: {leaseToken}
 * 200 | 409（lease 失效）
 */
router.post('/tasks/:id/heartbeat', express.json(), (req, res) => {
  const { id } = req.params;
  const { leaseToken } = req.body || {};
  const ok = tasks.heartbeat(id, leaseToken, LEASE_MS);
  if (!ok) {
    return res.status(409).json({ error: 'lease 失效', code: 'LEASE_INVALID' });
  }
  res.json({ ok: true, leaseMs: LEASE_MS });
});

/**
 * POST /api/worker/tasks/:id/stage
 * body: {leaseToken, stage}
 * 200 | 400（非法 stage）| 409
 */
router.post('/tasks/:id/stage', express.json(), (req, res) => {
  const { id } = req.params;
  const { leaseToken, stage } = req.body || {};
  if (!VALID_STAGES.has(stage)) {
    return res.status(400).json({ error: '无效阶段', code: 'INVALID_STAGE' });
  }
  const ok = tasks.setStage(id, leaseToken, stage);
  if (!ok) {
    return res.status(409).json({ error: 'lease 失效', code: 'LEASE_INVALID' });
  }
  res.json({ ok: true });
});

/**
 * POST /api/worker/tasks/:id/result
 * multipart: file `audio`(mp3) + body {script(JSON), summary, durationMs, fileSizeBytes, title, accountName}
 *
 * 流程：幂等检查 → MIME/magic 校验 → 写临时文件 → 事务(complete+create) → rename 落最终路径。
 * 失败不留孤儿临时文件；lease 失效返回 409 且不建 podcast。
 * 200 | 400 | 409 | 404 | 413
 */
router.post('/tasks/:id/result', uploadAudio, (req, res) => {
  const { id } = req.params;
  const { leaseToken, summary, durationMs, title, accountName } = req.body || {};

  const task = tasks.get(id);
  if (!task) {
    return res.status(404).json({ error: '任务不存在', code: 'TASK_NOT_FOUND' });
  }

  const userId = task.userId || 'public';

  // 幂等：已完成且 podcast 已存在 → 直接 200（不覆盖、不重复建）
  if (task.status === 'completed' && podcasts.findById(id)) {
    return res.status(200).json({ ok: true, podcastId: id, idempotent: true });
  }

  // 早期 lease 校验（权威校验在事务内 tasks.complete 的条件 UPDATE）
  if (task.status !== 'leased' || task.leaseToken !== leaseToken) {
    return res.status(409).json({ error: 'lease 失效', code: 'LEASE_INVALID' });
  }

  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    return res.status(400).json({ error: '缺少音频文件', code: 'MISSING_AUDIO' });
  }

  // MIME + magic 双校验
  if (req.file.mimetype !== 'audio/mpeg' || !looksLikeMp3(req.file.buffer)) {
    return res.status(400).json({ error: '音频格式无效', code: 'INVALID_AUDIO' });
  }

  // 解析脚本（JSON 字符串）
  let script = {};
  try {
    script = req.body.script ? JSON.parse(req.body.script) : {};
  } catch (e) {
    script = {};
  }

  const audioDir = getUserAudioDir(userId);
  const scriptsDir = getUserScriptsDir(userId);
  const audioPath = path.join(audioDir, `${id}.mp3`);
  const scriptPath = path.join(scriptsDir, `${id}.json`);

  // 路径穿越防护：最终落盘路径必须仍在该用户目录下
  const resolvedAudio = path.resolve(audioPath);
  const resolvedScript = path.resolve(scriptPath);
  if (!resolvedAudio.startsWith(path.resolve(audioDir) + path.sep) ||
      !resolvedScript.startsWith(path.resolve(scriptsDir) + path.sep)) {
    return res.status(400).json({ error: '非法路径', code: 'BAD_PATH' });
  }

  const fileSizeBytes = req.file.buffer.length;
  const scriptPreview = (script.raw || '').substring(0, 500);

  // 1) 先写临时文件（与最终路径同目录，保证同盘 rename）
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const tmpAudio = path.join(audioDir, `.${id}.${suffix}.mp3.tmp`);
  const tmpScript = path.join(scriptsDir, `.${id}.${suffix}.json.tmp`);
  try {
    fs.writeFileSync(tmpAudio, req.file.buffer);
    fs.writeFileSync(tmpScript, JSON.stringify({
      raw: script.raw || '',
      dialogues: script.dialogues || [],
      generatedAt: Date.now()
    }, null, 2));
  } catch (e) {
    cleanupTmp(tmpAudio, tmpScript);
    console.error(`[worker/result] 写临时文件失败 ${id}:`, e.message);
    return res.status(500).json({ error: '落盘失败', code: 'WRITE_FAILED' });
  }

  // 2) 事务：tasks.complete + podcasts.create 同一致性边界（原子）
  try {
    persistResult(
      id,
      leaseToken,
      {
        podcastId: id,
        title: title || task.title,
        accountName: accountName || task.accountName,
      },
      {
        id,
        userId,
        sourceUrl: task.sourceUrl,
        title: title || task.title || '',
        accountName: accountName || task.accountName || '',
        durationMs: parseInt(durationMs, 10) || 0,
        fileSizeBytes,
        summary: summary || script.summary || '',
        scriptPreview,
        audioPath,
        scriptPath,
      }
    );
  } catch (e) {
    cleanupTmp(tmpAudio, tmpScript);
    if (e && e.code === 'LEASE_LOST') {
      return res.status(409).json({ error: 'lease 失效', code: 'LEASE_INVALID' });
    }
    console.error(`[worker/result] 持久化失败 ${id}:`, e.message);
    return res.status(500).json({ error: '保存失败', code: 'PERSIST_FAILED' });
  }

  // 3) 事务成功后再 rename 临时文件 → 最终路径；失败则删临时不留孤儿
  try {
    fs.renameSync(tmpAudio, audioPath);
    fs.renameSync(tmpScript, scriptPath);
  } catch (e) {
    cleanupTmp(tmpAudio, tmpScript);
    console.error(`[worker/result] rename 失败 ${id}:`, e.message);
    return res.status(500).json({ error: '文件保存失败', code: 'RENAME_FAILED' });
  }

  res.json({ ok: true, podcastId: id });
});

/**
 * POST /api/worker/tasks/:id/fail
 * body: {leaseToken, error}
 * 失败补偿：fail 生效时退还该用户配额。
 * 200 | 409
 */
router.post('/tasks/:id/fail', express.json(), (req, res) => {
  const { id } = req.params;
  const { leaseToken, error } = req.body || {};
  const task = tasks.get(id);
  const ok = tasks.fail(id, leaseToken, error);
  if (!ok) {
    return res.status(409).json({ error: 'lease 失效', code: 'LEASE_INVALID' });
  }
  // 失败补偿退还配额（仅在 fail 真正生效时）
  if (task && task.userId) {
    usage.refund(task.userId);
  }
  res.json({ ok: true });
});

module.exports = router;
