const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');

// 隔离数据库：每个测试进程用独立临时 sqlite（必须在 require db 之前设置）
const TMP_DB = path.join(os.tmpdir(), `tasks-test-${uuid()}.db`);
process.env.APP_DB_PATH = TMP_DB;

const tasks = require('../src/db/tasks');
const db = require('../src/db/index');

function reset() {
  db.prepare('DELETE FROM tasks').run();
}

function newTask() {
  const id = uuid();
  tasks.create({ id, userId: 'u1', sourceUrl: `https://mp.weixin.qq.com/${id}`, ttsProvider: 'minimax' });
  return id;
}

test('create 插入 pending 任务，getStatus 可读回', () => {
  reset();
  const id = newTask();
  const s = tasks.getStatus(id);
  assert.equal(s.status, 'pending');
  assert.equal(s.stage, null);
  assert.equal(s.podcastId, null);
});

test('claim 认领后状态变 leased 并返回 leaseToken', () => {
  reset();
  const id = newTask();
  const claimed = tasks.claim({ workerId: 'w1', leaseMs: 120000 });
  assert.equal(claimed.id, id);
  assert.equal(claimed.ttsProvider, 'minimax');
  assert.ok(claimed.leaseToken);
  assert.equal(tasks.getStatus(id).status, 'leased');
});

test('claim 原子性：N 个任务被 N 次认领且互不重复，第 N+1 次返回 null', () => {
  reset();
  const ids = new Set([newTask(), newTask(), newTask()]);
  const claimedIds = new Set();
  for (let i = 0; i < 3; i++) {
    const c = tasks.claim({ workerId: 'w', leaseMs: 120000 });
    assert.ok(c, '应认领到任务');
    assert.ok(!claimedIds.has(c.id), '同一任务不应被重复认领');
    claimedIds.add(c.id);
  }
  assert.deepEqual([...claimedIds].sort(), [...ids].sort());
  assert.equal(tasks.claim({ workerId: 'w', leaseMs: 120000 }), null);
});

test('未过期的 lease 不可被重新认领', () => {
  reset();
  newTask();
  const first = tasks.claim({ workerId: 'w1', leaseMs: 120000 });
  assert.ok(first);
  assert.equal(tasks.claim({ workerId: 'w2', leaseMs: 120000 }), null);
});

test('lease 过期后任务可被重新认领（新 token）', () => {
  reset();
  const id = newTask();
  // leaseMs 取负数：leased_until = now-1，立即过期，等价于"租约到期"
  const first = tasks.claim({ workerId: 'w1', leaseMs: -1000 });
  assert.equal(first.id, id);
  const second = tasks.claim({ workerId: 'w2', leaseMs: 120000 });
  assert.equal(second.id, id, '过期任务应被重新认领');
  assert.notEqual(second.leaseToken, first.leaseToken, '应签发新的 leaseToken');
});

test('heartbeat 续约：正确 token 返回 true 并阻止他人认领', () => {
  reset();
  newTask();
  const c = tasks.claim({ workerId: 'w1', leaseMs: 120000 });
  assert.equal(tasks.heartbeat(c.id, c.leaseToken, 120000), true);
  // 续约后仍不可被他人认领
  assert.equal(tasks.claim({ workerId: 'w2', leaseMs: 120000 }), null);
});

test('错误 leaseToken 被拒绝（heartbeat/setStage/complete/fail 全部 false）', () => {
  reset();
  newTask();
  const c = tasks.claim({ workerId: 'w1', leaseMs: 120000 });
  const bad = 'wrong-token';
  assert.equal(tasks.heartbeat(c.id, bad, 120000), false);
  assert.equal(tasks.setStage(c.id, bad, 'parsing'), false);
  assert.equal(tasks.complete(c.id, bad, { podcastId: c.id }), false);
  assert.equal(tasks.fail(c.id, bad, 'boom'), false);
  // 正确 token 仍可用
  assert.equal(tasks.setStage(c.id, c.leaseToken, 'parsing'), true);
  assert.equal(tasks.getStatus(c.id).stage, 'parsing');
});

test('complete 标记完成并写入 podcastId', () => {
  reset();
  const id = newTask();
  const c = tasks.claim({ workerId: 'w1', leaseMs: 120000 });
  assert.equal(tasks.complete(c.id, c.leaseToken, { podcastId: id, title: 'T', accountName: 'A' }), true);
  const s = tasks.getStatus(id);
  assert.equal(s.status, 'completed');
  assert.equal(s.podcastId, id);
  assert.equal(s.title, 'T');
  assert.equal(s.accountName, 'A');
});

test('fail 标记失败并写入 error', () => {
  reset();
  const id = newTask();
  const c = tasks.claim({ workerId: 'w1', leaseMs: 120000 });
  assert.equal(tasks.fail(c.id, c.leaseToken, '解析失败'), true);
  const s = tasks.getStatus(id);
  assert.equal(s.status, 'failed');
  assert.equal(s.error, '解析失败');
});

test.after(() => {
  try { db.close(); } catch { /* ignore */ }
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
});
