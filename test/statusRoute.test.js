/**
 * 状态路由集成测试（离线）：验证 S2 归属（知道 UUID 也无法越权）与 N11 旧契约字段。
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');

const TMP_DB = path.join(os.tmpdir(), `status-route-${uuid()}.db`);
process.env.APP_DB_PATH = TMP_DB;

const express = require('express');
const statusRouter = require('../src/routes/status');
const tasks = require('../src/db/tasks');
const db = require('../src/db/index');

let server;
let base;

async function getStatus(id, userId) {
  const headers = {};
  if (userId) headers['x-test-user'] = userId;
  return fetch(`${base}/api/status/${id}`, { headers });
}

before(async () => {
  const app = express();
  // 模拟全局 auth：从 header 注入 userId（默认匿名 public）
  app.use((req, res, next) => {
    req.userId = req.headers['x-test-user'] || 'public';
    next();
  });
  app.use('/api/status', statusRouter);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  try { db.close(); } catch { /* ignore */ }
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
});

test('S2 归属：本人可见，他人/匿名拿到 UUID 也被拒(404)', async () => {
  const id = uuid();
  tasks.create({ id, userId: 'userA', sourceUrl: 'https://mp.weixin.qq.com/s/x', ttsProvider: 'minimax' });

  const own = await getStatus(id, 'userA');
  assert.equal(own.status, 200);
  const body = await own.json();
  assert.equal(body.id, id);
  assert.equal(body.status, 'pending');
  // N11 旧契约：保留 etaSeconds / etaText 字段
  assert.equal(body.etaSeconds, null);
  assert.equal(body.etaText, null);

  const other = await getStatus(id, 'userB');
  assert.equal(other.status, 404, '他人知道 UUID 也越权不了');

  const anon = await getStatus(id, null);
  assert.equal(anon.status, 404, '匿名也读不到他人任务');
});
