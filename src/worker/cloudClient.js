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
function createCloudClient({ baseUrl, token, fetchImpl } = {}) {
  const base = (baseUrl || process.env.CLOUD_API_BASE || '').replace(/\/+$/, '');
  const authToken = token || process.env.WORKER_API_TOKEN || '';
  const doFetch = fetchImpl || globalThis.fetch;

  if (!doFetch) {
    throw new Error('未找到 fetch 实现（Node 18+ 自带，或注入 fetchImpl）');
  }

  const url = (p) => `${base}${p}`;
  const authHeader = () => ({ Authorization: `Bearer ${authToken}` });

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
   * 上传结果（multipart：mp3 + 元数据）
   * @param {string} id
   * @param {string} leaseToken
   * @param {object} payload {audioPath, script, summary, durationMs, fileSizeBytes, title, accountName}
   * @returns {Promise<object>} 云端响应 JSON
   */
  async function result(id, leaseToken, payload) {
    const {
      audioPath, script, summary, durationMs, fileSizeBytes, title, accountName,
    } = payload;

    const buffer = fs.readFileSync(audioPath);
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

    const res = await doFetch(url(`/api/worker/tasks/${id}/result`), {
      method: 'POST',
      headers: { ...authHeader() }, // 不手动设 Content-Type，交给 FormData 生成 boundary
      body: form,
    });
    if (!res.ok) throw new Error(`result 上传失败: HTTP ${res.status}`);
    return res.json();
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
