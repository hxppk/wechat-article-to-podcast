const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSemaphore } = require('../src/utils/semaphore');

test('createSemaphore 限制并发为 1，串行放行', async () => {
  const sem = createSemaphore(1);
  const order = [];
  async function job(id) {
    await sem.acquire();
    order.push(`start-${id}`);
    await new Promise(r => setTimeout(r, 10));
    order.push(`end-${id}`);
    sem.release();
  }
  await Promise.all([job(1), job(2)]);
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
});

test('createSemaphore(0) 抛错（非法 max）', () => {
  assert.throws(() => createSemaphore(0), /max/);
  assert.throws(() => createSemaphore(-1), /max/);
  assert.throws(() => createSemaphore(1.5), /max/);
});

test('max=1 在 release-then-immediate-acquire 交错下并发峰值不超过 1', async () => {
  const sem = createSemaphore(1);
  let active = 0;
  let peak = 0;
  // 多个任务同时竞争；release 后立刻有新的 acquire 抢占槽位。
  async function job() {
    await sem.acquire();
    active++;
    peak = Math.max(peak, active);
    // 让出事件循环，给“release-then-acquire”制造交错窗口。
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 1));
    active--;
    sem.release();
  }
  await Promise.all([job(), job(), job(), job(), job()]);
  assert.equal(peak, 1, `并发峰值应为 1，实际 ${peak}`);
  assert.equal(active, 0);
});

test('release 下溢（释放多于获取）抛错', async () => {
  const sem = createSemaphore(2);
  await sem.acquire();
  sem.release();
  assert.throws(() => sem.release(), /下溢|release/);
});
