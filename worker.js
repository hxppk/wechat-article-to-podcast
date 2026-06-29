/**
 * 本地 worker 入口（pm2 常驻）
 *
 * 拉模式：轮询云端认领任务 → 本地全程生成 mp3 → 上传回云端。
 * 纯出站，无需暴露端口。所有 AI key（MiniMax/ElevenLabs/Claude CLI 登录态）在本地。
 *
 * 运行：node worker.js  （或 npm run worker / pm2 start worker.js）
 */

// fetch 兜底（Node 18+ 原生自带；旧版本回退 node-fetch）
if (!globalThis.fetch) {
  const nf = require('node-fetch');
  globalThis.fetch = nf;
  globalThis.Headers = nf.Headers;
  globalThis.Request = nf.Request;
  globalThis.Response = nf.Response;
}

const fs = require('fs');
const path = require('path');

// 加载 worker 环境变量：优先 .env.worker，回退 .env
const envFile = process.env.WORKER_ENV_FILE
  || (fs.existsSync(path.join(__dirname, '.env.worker')) ? '.env.worker' : '.env');
require('dotenv').config({ path: path.join(__dirname, envFile) });

// 代理（用于访问 ElevenLabs / MiniMax，与云端一致）
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  const { bootstrap } = require('global-agent');
  bootstrap();
  console.log('代理已启用:', process.env.HTTPS_PROXY || process.env.HTTP_PROXY);
}

const os = require('os');
const { runPipeline } = require('./src/worker/pipeline');
const { createCloudClient } = require('./src/worker/cloudClient');
const { resolveErrorMessage } = require('./src/services/errors');

const CLOUD_API_BASE = process.env.CLOUD_API_BASE || 'http://localhost:3000';
const WORKER_API_TOKEN = process.env.WORKER_API_TOKEN || '';
const WORKER_ID = process.env.WORKER_ID || `worker-${os.hostname()}`;
const POLL_MS = parseInt(process.env.WORKER_POLL_MS, 10) || 5000;
const LEASE_MS = parseInt(process.env.LEASE_MS, 10) || 120000;
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY, 10) || 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cloud = createCloudClient({ baseUrl: CLOUD_API_BASE, token: WORKER_API_TOKEN });

let stopping = false;
const inFlight = new Set();

/**
 * 处理单个任务：起心跳 → 跑流水线 → 上传结果；失败上报 fail；清理临时文件。
 */
async function processOne(task, leaseMs) {
  const { id, sourceUrl, ttsProvider, leaseToken } = task;
  console.log(`[${id}] 认领任务 ${sourceUrl} (tts=${ttsProvider})`);

  const hbEvery = Math.max(1000, Math.floor(leaseMs / 3));
  const heartbeatTimer = setInterval(() => {
    cloud.heartbeat(id, leaseToken).then((ok) => {
      if (!ok) console.warn(`[${id}] 心跳被拒：lease 可能已被回收`);
    }).catch((e) => console.warn(`[${id}] 心跳异常:`, e.message));
  }, hbEvery);

  let result;
  try {
    result = await runPipeline({ sourceUrl, ttsProvider }, {
      onStage: (stage) => {
        console.log(`[${id}] 阶段: ${stage}`);
        return cloud.setStage(id, leaseToken, stage).catch((e) =>
          console.warn(`[${id}] 阶段上报失败:`, e.message));
      },
    });
    await cloud.result(id, leaseToken, result);
    console.log(`[${id}] 完成并已上传`);
  } catch (err) {
    const message = resolveErrorMessage(err);
    console.error(`[${id}] 失败:`, err.message);
    try {
      await cloud.fail(id, leaseToken, message);
    } catch (e) {
      console.error(`[${id}] fail 上报失败:`, e.message);
    }
  } finally {
    clearInterval(heartbeatTimer);
    if (result && result.audioPath) {
      try { fs.unlinkSync(result.audioPath); } catch { /* 忽略 */ }
    }
  }
}

/**
 * 主循环：受并发与停止标志控制地认领并处理任务。
 */
async function mainLoop() {
  console.log(`worker 启动: id=${WORKER_ID} base=${CLOUD_API_BASE} poll=${POLL_MS}ms lease=${LEASE_MS}ms concurrency=${CONCURRENCY}`);
  while (!stopping) {
    if (inFlight.size >= CONCURRENCY) {
      await sleep(200);
      continue;
    }

    let claimed;
    try {
      claimed = await cloud.claim(WORKER_ID);
    } catch (e) {
      console.error('claim 失败（云端不可达？）:', e.message);
      await sleep(POLL_MS);
      continue;
    }

    if (!claimed || !claimed.task) {
      await sleep(POLL_MS);
      continue;
    }

    const leaseMs = claimed.leaseMs || LEASE_MS;
    const p = processOne(claimed.task, leaseMs).finally(() => inFlight.delete(p));
    inFlight.add(p);
  }

  // 优雅退出：等待在途任务结束
  if (inFlight.size > 0) {
    console.log(`等待 ${inFlight.size} 个在途任务结束...`);
    await Promise.allSettled([...inFlight]);
  }
  console.log('worker 已退出');
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`收到 ${signal}，准备优雅退出...`);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  mainLoop().catch((err) => {
    console.error('worker 主循环崩溃:', err);
    process.exit(1);
  });
}

module.exports = { processOne, mainLoop };
