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
const usage = require('../src/db/usage');
const db = require('../src/db/index');

function reset() {
  db.prepare('DELETE FROM tasks').run();
  db.prepare('DELETE FROM usage').run();
}

function newTask() {
  const id = uuid();
  tasks.create({ id, userId: 'u1', sourceUrl: `https://mp.weixin.qq.com/${id}`, ttsProvider: 'minimax' });
  return id;
}

test('create 插入 pending 任务，getStatus 可读回', () => {
  reset();
  const id = newTask();
  const s = tasks.getStatus(id, 'u1');
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
  assert.equal(tasks.getStatus(id, 'u1').status, 'leased');
});

test('S2 归属：getStatus 仅本人可读，错误 userId 返回 null', () => {
  reset();
  const id = newTask(); // userId = 'u1'
  assert.ok(tasks.getStatus(id, 'u1'), '本人应可读');
  assert.equal(tasks.getStatus(id, 'u2'), null, '他人知道 UUID 也读不到');
  assert.equal(tasks.getStatus(id, 'public'), null, '匿名读不到他人任务');
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
  assert.equal(tasks.getStatus(c.id, 'u1').stage, 'parsing');
});

test('I6 过期 lease：心跳/阶段/完成/失败均被拒（即便 token 正确）', () => {
  reset();
  newTask();
  // leaseMs 负数：认领即过期（leased_until < now）
  const c = tasks.claim({ workerId: 'w1', leaseMs: -1000 });
  assert.ok(c);
  assert.equal(tasks.heartbeat(c.id, c.leaseToken, 120000), false, '过期不可续约');
  assert.equal(tasks.setStage(c.id, c.leaseToken, 'parsing'), false, '过期不可上报阶段');
  assert.equal(tasks.complete(c.id, c.leaseToken, { podcastId: c.id }), false, '过期不可完成');
  assert.equal(tasks.fail(c.id, c.leaseToken, 'boom'), false, '过期不可失败');
});

test('complete 标记完成并写入 podcastId', () => {
  reset();
  const id = newTask();
  const c = tasks.claim({ workerId: 'w1', leaseMs: 120000 });
  assert.equal(tasks.complete(c.id, c.leaseToken, { podcastId: id, title: 'T', accountName: 'A' }), true);
  const s = tasks.getStatus(id, 'u1');
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
  const s = tasks.getStatus(id, 'u1');
  assert.equal(s.status, 'failed');
  assert.equal(s.error, '解析失败');
});

test('N13/S3 超过 MAX_ATTEMPTS 的过期任务被标 failed、不再重领并退还配额', () => {
  reset();
  const id = newTask(); // userId 'u1'
  usage.incrementUsage('u1'); // 模拟提交时扣减
  assert.equal(usage.getUsageToday('u1'), 1);

  // 连续 MAX_ATTEMPTS 次"认领即过期"，attempts 累加到上限
  for (let i = 0; i < tasks.MAX_ATTEMPTS; i++) {
    const c = tasks.claim({ workerId: 'w', leaseMs: -1 });
    assert.equal(c.id, id, `第 ${i + 1} 次应仍可认领`);
  }

  // 下一次认领触发回收：标 failed、不再返回任务、退还配额
  const next = tasks.claim({ workerId: 'w', leaseMs: 120000 });
  assert.equal(next, null, '耗尽后不再重领');
  assert.equal(tasks.getStatus(id, 'u1').status, 'failed');
  assert.equal(usage.getUsageToday('u1'), 0, '失败应退还配额');
});

test.after(() => {
  try { db.close(); } catch { /* ignore */ }
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
});
