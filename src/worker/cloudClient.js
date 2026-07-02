/**
 * 云端 API 客户端（本地 worker 侧，纯出站）
 *
 * 统一带 Bearer WORKER_API_TOKEN，base = CLOUD_API_BASE。
 * claim/heartbeat/stage/fail 走 JSON；result 走 multipart 上传 mp3 + 元数据。
 *
 * 用工厂函数创建以便注入 fetch 做离线测试；require 本模块不读环境、不发请求。
 */
const fs = require('fs');

/**
 * @param {object} opts
 * @param {string} [opts.baseUrl] - 默认取 CLOUD_API_BASE
 * @param {string} [opts.token]   - 默认取 WORKER_API_TOKEN
 * @param {Function} [opts.fetchImpl] - 默认 globalThis.fetch（测试可注入）
 */
function createCloudClient({ baseUrl, token, fetchImpl, resultTimeoutMs, resultRetries } = {}) {
  const base = (baseUrl || process.env.CLOUD_API_BASE || '').replace(/\/+$/, '');
  const authToken = token || process.env.WORKER_API_TOKEN || '';
  const doFetch = fetchImpl || globalThis.fetch;

  if (!doFetch) {
    throw new Error('未找到 fetch 实现（Node 18+ 自带，或注入 fetchImpl）');
  }

  // result 上传超时与重试（仅对网络错误/超时/5xx 重试；4xx/409 不重试）
  const RESULT_TIMEOUT_MS = resultTimeoutMs
    || parseInt(process.env.WORKER_RESULT_TIMEOUT_MS, 10) || 120000;
  const RESULT_RETRIES = (resultRetries != null ? resultRetries
    : parseInt(process.env.WORKER_RESULT_RETRIES, 10));
  const retries = Number.isFinite(RESULT_RETRIES) ? RESULT_RETRIES : 2;

  const url = (p) => `${base}${p}`;
  const authHeader = () => ({ Authorization: `Bearer ${authToken}` });
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // 带超时的 fetch（AbortController；旧实现忽略 signal 也无妨）
  async function fetchWithTimeout(u, options, timeoutMs) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      return await doFetch(u, { ...options, signal: ac.signal });
    } finally {
      clearTimeout(t);
    }
  }

  async function postJson(p, body) {
    return doFetch(url(p), {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }

  /**
   * 认领一条任务
   * @param {string} workerId
   * @returns {Promise<{task,leaseMs}|null>} 无任务返回 null
   */
  async function claim(workerId) {
    const res = await postJson('/api/worker/claim', { workerId });
    if (res.status === 204) return null;
    if (!res.ok) {
      throw new Error(`claim 失败: HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * 心跳续约
   * @returns {Promise<boolean>} lease 是否有效
   */
  async function heartbeat(id, leaseToken) {
    const res = await postJson(`/api/worker/tasks/${id}/heartbeat`, { leaseToken });
    if (res.status === 409) return false;
    if (!res.ok) throw new Error(`heartbeat 失败: HTTP ${res.status}`);
    return true;
  }

  /**
   * 上报阶段
   * @returns {Promise<boolean>}
   */
  async function setStage(id, leaseToken, stage) {
    const res = await postJson(`/api/worker/tasks/${id}/stage`, { leaseToken, stage });
    if (res.status === 409) return false;
    if (!res.ok) throw new Error(`stage 失败: HTTP ${res.status}`);
    return true;
  }

  /**
   * 上传结果（multipart：mp3 + 元数据）。带超时与有限重试；
   * 409 视为 lease 丢失，返回 {leaseLost:true}（调用方不再 fail）。
   * @param {string} id
   * @param {string} leaseToken
   * @param {object} payload {audioPath, script, summary, durationMs, fileSizeBytes, title, accountName, coverUrl}
   * @returns {Promise<object>} 云端响应 JSON 或 {leaseLost:true}
   */
  async function result(id, leaseToken, payload) {
    const {
      audioPath, script, summary, durationMs, fileSizeBytes, title, accountName, coverUrl,
    } = payload;

    const buffer = fs.readFileSync(audioPath);
    let lastErr;

    for (let attempt = 0; attempt <= retries; attempt++) {
      // FormData/Blob 不可跨请求复用，每次重试都重建
      const blob = new Blob([buffer], { type: 'audio/mpeg' });
      const form = new FormData();
      form.append('audio', blob, `${id}.mp3`);
      form.append('leaseToken', leaseToken || '');
      form.append('script', JSON.stringify(script || {}));
      form.append('summary', summary || '');
      form.append('durationMs', String(durationMs || 0));
      form.append('fileSizeBytes', String(fileSizeBytes || buffer.length));
      form.append('title', title || '');
      form.append('accountName', accountName || '');
      form.append('coverUrl', coverUrl || '');

      try {
        const res = await fetchWithTimeout(url(`/api/worker/tasks/${id}/result`), {
          method: 'POST',
          headers: { ...authHeader() }, // 不手动设 Content-Type，交给 FormData 生成 boundary
          body: form,
        }, RESULT_TIMEOUT_MS);

        // 409：lease 丢失，不重试、不当作失败上报
        if (res.status === 409) return { leaseLost: true };
        if (res.ok) return res.json();

        // 5xx 可重试；其它 4xx 直接抛
        lastErr = new Error(`result 上传失败: HTTP ${res.status}`);
        if (res.status >= 500 && attempt < retries) {
          await delay(500 * (attempt + 1));
          continue;
        }
        throw lastErr;
      } catch (err) {
        // 网络错误/超时：重试
        lastErr = err;
        if (attempt < retries) {
          await delay(500 * (attempt + 1));
          continue;
        }
        throw err;
      }
    }
    throw lastErr || new Error('result 上传失败');
  }

  /**
   * 上报失败
   * @returns {Promise<boolean>}
   */
  async function fail(id, leaseToken, error) {
    const res = await postJson(`/api/worker/tasks/${id}/fail`, { leaseToken, error });
    if (res.status === 409) return false;
    if (!res.ok) throw new Error(`fail 上报失败: HTTP ${res.status}`);
    return true;
  }

  return { claim, heartbeat, setStage, result, fail, baseUrl: base };
}

module.exports = { createCloudClient };
