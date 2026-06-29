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

const tasks = require('../db/tasks');
const podcasts = require('../db/podcasts');
const { getUserAudioDir, getUserScriptsDir } = require('../utils/userPaths');

const LEASE_MS = parseInt(process.env.LEASE_MS, 10) || 120000;

// 100MB 上限的内存上传（mp3 一般几 MB）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
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
 * 200 | 409
 */
router.post('/tasks/:id/stage', express.json(), (req, res) => {
  const { id } = req.params;
  const { leaseToken, stage } = req.body || {};
  const ok = tasks.setStage(id, leaseToken, stage);
  if (!ok) {
    return res.status(409).json({ error: 'lease 失效', code: 'LEASE_INVALID' });
  }
  res.json({ ok: true });
});

/**
 * POST /api/worker/tasks/:id/result
 * multipart: file `audio`(mp3) + body {script(JSON), summary, durationMs, fileSizeBytes, title, accountName}
 * 校验 lease → 落盘音频/脚本 → podcasts.create → tasks.complete
 * 200 | 409 | 404
 */
router.post('/tasks/:id/result', upload.single('audio'), (req, res) => {
  const { id } = req.params;
  const { leaseToken, summary, durationMs, title, accountName } = req.body || {};

  // 先取任务（需要 userId/sourceUrl），并校验 lease
  const task = tasks.get(id);
  if (!task) {
    return res.status(404).json({ error: '任务不存在', code: 'TASK_NOT_FOUND' });
  }
  if (task.status !== 'leased' || task.leaseToken !== leaseToken) {
    return res.status(409).json({ error: 'lease 失效', code: 'LEASE_INVALID' });
  }
  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    return res.status(400).json({ error: '缺少音频文件', code: 'MISSING_AUDIO' });
  }

  const userId = task.userId || 'public';

  // 解析脚本（JSON 字符串）
  let script = {};
  try {
    script = req.body.script ? JSON.parse(req.body.script) : {};
  } catch (e) {
    script = {};
  }

  // 落盘音频与脚本
  const audioDir = getUserAudioDir(userId);
  const scriptsDir = getUserScriptsDir(userId);
  const audioPath = path.join(audioDir, `${id}.mp3`);
  const scriptPath = path.join(scriptsDir, `${id}.json`);

  fs.writeFileSync(audioPath, req.file.buffer);
  fs.writeFileSync(scriptPath, JSON.stringify({
    raw: script.raw || '',
    dialogues: script.dialogues || [],
    generatedAt: Date.now()
  }, null, 2));

  const fileSizeBytes = req.file.buffer.length;
  const scriptPreview = (script.raw || '').substring(0, 500);

  // 落库 podcast（id 复用 taskId）
  podcasts.create({
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
    scriptPath
  });

  // 标记任务完成（再次校验 lease，原子）
  const ok = tasks.complete(id, leaseToken, {
    podcastId: id,
    title: title || task.title,
    accountName: accountName || task.accountName
  });
  if (!ok) {
    return res.status(409).json({ error: 'lease 失效', code: 'LEASE_INVALID' });
  }

  res.json({ ok: true, podcastId: id });
});

/**
 * POST /api/worker/tasks/:id/fail
 * body: {leaseToken, error}
 * 200 | 409
 */
router.post('/tasks/:id/fail', express.json(), (req, res) => {
  const { id } = req.params;
  const { leaseToken, error } = req.body || {};
  const ok = tasks.fail(id, leaseToken, error);
  if (!ok) {
    return res.status(409).json({ error: 'lease 失效', code: 'LEASE_INVALID' });
  }
  res.json({ ok: true });
});

module.exports = router;
