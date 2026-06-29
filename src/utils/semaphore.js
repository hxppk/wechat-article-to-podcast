/**
 * 计数信号量。释放时若有等待者，直接把槽位“转交”给它（active 不变），
 * 避免 release-then-acquire 之间出现 `active < max` 的窗口让新的 acquire 插队，
 * 从而保证 max=1 时并发峰值绝不超过 1。
 * @param {number} max 最大并发，必须是 >= 1 的整数
 * @returns {{acquire: () => Promise<void>, release: () => void}}
 */
function createSemaphore(max) {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`createSemaphore: max 必须是 >= 1 的整数，收到 ${max}`);
  }
  let active = 0;
  const waiters = [];
  return {
    acquire() {
      if (active < max) {
        active++;
        return Promise.resolve();
      }
      // 槽位已满：登记等待者，但不在此处 active++。
      // 槽位会在 release 时直接转交（active 保持不变）。
      return new Promise((resolve) => waiters.push(resolve));
    },
    release() {
      if (active <= 0) {
        throw new Error('semaphore.release: 释放次数超过获取次数（下溢）');
      }
      const next = waiters.shift();
      if (next) {
        // 槽位直接转交给等待者，active 保持不变，不暴露 active<max 的插队窗口。
        next();
      } else {
        active--;
      }
    },
  };
}

module.exports = { createSemaphore };
