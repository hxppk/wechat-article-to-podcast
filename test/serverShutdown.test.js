/**
 * server.js 优雅退出测试：以子进程方式启动真实 server.js，
 * 发送 SIGTERM/SIGINT 后应正常退出（exit code 0），而非被信号直接杀死。
 * 防回归：npm/无信号处理时进程被 SIGKILL/SIGTERM 硬杀，容器假活（2026-07 线上 502 事故）。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** 启动 server.js 子进程并等待“服务已启动”日志 */
async function startServer(port) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DISABLE_CLEANUP: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  child.stderr.on('data', (d) => { stderrBuf += d.toString(); });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`服务启动超时。stderr: ${stderrBuf}`));
    }, 15000);
    const onEarlyExit = (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`服务提前退出 code=${code} signal=${signal}。stderr: ${stderrBuf}`));
    };
    child.once('exit', onEarlyExit);
    child.stdout.on('data', (d) => {
      if (d.toString().includes('服务已启动')) {
        clearTimeout(timer);
        child.removeListener('exit', onEarlyExit);
        resolve();
      }
    });
  });

  return child;
}

/** 等待子进程退出，返回 {code, signal} */
function waitExit(child) {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  test(`${sig} 触发优雅退出：exit code 0，非信号硬杀`, async () => {
    const child = await startServer(sig === 'SIGTERM' ? 39871 : 39872);
    child.kill(sig);
    const { code, signal } = await waitExit(child);
    assert.strictEqual(signal, null, `进程被 ${signal} 硬杀，说明没有信号处理`);
    assert.strictEqual(code, 0, `优雅退出应返回 0，实际 ${code}`);
  });
}
