/**
 * Worker 路由集成测试（离线：本地 express + 临时 sqlite，无外网）。
 * 覆盖 S1 幂等/原子、I8 multer 安全 + UUID 校验、N14 阶段校验、S3 失败退还配额。
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');

// 必须在 require db 之前设置隔离环境
const TMP_DB = path.join(os.tmpdir(), `worker-routes-${uuid()}.db`);
process.env.APP_DB_PATH = TMP_DB;
process.env.WORKER_API_TOKEN = 'test-token';
process.env.LEASE_MS = '120000';

const express = require('express');
const workerRouter = require('../src/routes/worker');
const tasks = require('../src/db/tasks');
const usage = require('../src/db/usage');
const podcasts = require('../src/db/podcasts');
const db = require('../src/db/index');

const DATA_DIR = path.join(__dirname, '../data');
const createdUsers = new Set();

let server;
let base;

function reset() {
  db.prepare('DELETE FROM tasks').run();
  db.prepare('DELETE FROM podcasts').run();
  db.prepare('DELETE FROM usage').run();
}

function createAndClaim(userId) {
  const id = uuid();
  tasks.create({ id, userId, sourceUrl: 'https://mp.weixin.qq.com/s/x', ttsProvider: 'minimax' });
  const c = tasks.claim({ workerId: 'w', leaseMs: 120000 });
  return { id, leaseToken: c.leaseToken };
}

function mp3Buf() {
  // ID3v2 头部 magic，模拟合法 mp3
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0, 0, 0, 0, 0]), Buffer.from('AUDIODATA')]);
}

async function postJson(p, body) {
  return fetch(`${base}${p}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}

async function postResult(id, leaseToken, opts = {}) {
  const { mime = 'audio/mpeg', buf = mp3Buf() } = opts;
  const form = new FormData();
  form.append('audio', new Blob([buf], { type: mime }), `${id}.mp3`);
  form.append('leaseToken', leaseToken);
  form.append('script', JSON.stringify({ raw: 'R', dialogues: [{ speaker: 'A', text: 'hi' }], summary: 'S' }));
  form.append('summary', 'S');
  form.append('durationMs', '1234');
  form.append('title', 'T');
  form.append('accountName', 'Acct');
  return fetch(`${base}/api/worker/tasks/${id}/result`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token' },
    body: form,
  });
}

before(async () => {
  const app = express();
  app.use('/api/worker', workerRouter);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  try { db.close(); } catch { /* ignore */ }
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
  for (const u of createdUsers) {
    try { fs.rmSync(path.join(DATA_DIR, 'users', u), { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('S1 result 落库+落盘成功；重复 result 幂等(200, 不重复建 podcast)', async () => {
  reset();
  const userId = `test-${uuid()}`;
  createdUsers.add(userId);
  const { id, leaseToken } = createAndClaim(userId);

  const r1 = await postResult(id, leaseToken);
  assert.equal(r1.status, 200);
  const j1 = await r1.json();
  assert.equal(j1.podcastId, id);

  assert.equal(tasks.getStatus(id, userId).status, 'completed');
  assert.ok(podcasts.findById(id), '应创建 podcast');
  const audioFile = path.join(DATA_DIR, 'users', userId, 'audio', `${id}.mp3`);
  const scriptFile = path.join(DATA_DIR, 'users', userId, 'scripts', `${id}.json`);
  assert.ok(fs.existsSync(audioFile), '最终音频应落盘');
  assert.ok(fs.existsSync(scriptFile), '脚本应落盘');

  // 幂等：重复上传不覆盖、不重复建
  const r2 = await postResult(id, leaseToken);
  assert.equal(r2.status, 200);
  const j2 = await r2.json();
  assert.equal(j2.idempotent, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM podcasts WHERE id=?').get(id).n, 1);

  // 临时文件不留孤儿
  const leftovers = fs.readdirSync(path.join(DATA_DIR, 'users', userId, 'audio')).filter((f) => f.endsWith('.tmp'));
  assert.equal(leftovers.length, 0, '不应残留临时文件');
});

test('S1 错误 leaseToken：409 且不建 podcast、不改任务状态', async () => {
  reset();
  const userId = `test-${uuid()}`;
  createdUsers.add(userId);
  const { id } = createAndClaim(userId);

  const r = await postResult(id, 'wrong-token');
  assert.equal(r.status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM podcasts WHERE id=?').get(id).n, 0);
  assert.equal(tasks.getStatus(id, userId).status, 'leased', '任务状态不应改变');
});

test('I8 非 audio/mpeg MIME 被拒（400）', async () => {
  reset();
  const userId = `test-${uuid()}`;
  createdUsers.add(userId);
  const { id, leaseToken } = createAndClaim(userId);

  const r = await postResult(id, leaseToken, { mime: 'application/octet-stream' });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.code, 'INVALID_AUDIO_TYPE');
});

test('I8 MIME 合法但 magic 非 mp3 被拒（400 INVALID_AUDIO）', async () => {
  reset();
  const userId = `test-${uuid()}`;
  createdUsers.add(userId);
  const { id, leaseToken } = createAndClaim(userId);

  const r = await postResult(id, leaseToken, { buf: Buffer.from('NOT-AN-MP3-FILE') });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.code, 'INVALID_AUDIO');
});

test('I8 非法 UUID 的 :id 被拒（400 INVALID_TASK_ID，防穿越）', async () => {
  // 非 UUID 的任意 id（含可疑穿越字符）一律 400，绝不进入落盘逻辑
  for (const badId of ['not-a-uuid', 'foo.mp3', 'abc123', '12345']) {
    const r = await postJson(`/api/worker/tasks/${badId}/heartbeat`, { leaseToken: 'x' });
    assert.equal(r.status, 400, `id=${badId} 应被拒`);
    assert.equal((await r.json()).code, 'INVALID_TASK_ID');
  }
});

test('N14 非法 stage 被拒（400），合法 stage 通过', async () => {
  reset();
  const userId = `test-${uuid()}`;
  createdUsers.add(userId);
  const { id, leaseToken } = createAndClaim(userId);

  const bad = await postJson(`/api/worker/tasks/${id}/stage`, { leaseToken, stage: 'bogus' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'INVALID_STAGE');

  const ok = await postJson(`/api/worker/tasks/${id}/stage`, { leaseToken, stage: 'parsing' });
  assert.equal(ok.status, 200);
});

test('S3 fail 退还配额（usage -1），任务标 failed', async () => {
  reset();
  const userId = `test-${uuid()}`;
  createdUsers.add(userId);
  usage.incrementUsage(userId);
  assert.equal(usage.getUsageToday(userId), 1);

  const { id, leaseToken } = createAndClaim(userId);
  const r = await postJson(`/api/worker/tasks/${id}/fail`, { leaseToken, error: 'boom' });
  assert.equal(r.status, 200);

  assert.equal(usage.getUsageToday(userId), 0, '失败应退还配额');
  assert.equal(tasks.getStatus(id, userId).status, 'failed');
});

test('鉴权：缺 Bearer 返回 401', async () => {
  const r = await fetch(`${base}/api/worker/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(r.status, 401);
});
