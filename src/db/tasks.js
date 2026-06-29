/**
 * 任务数据访问层 (分布式拉模式)
 *
 * 云端持久化任务队列。本地 worker 通过 API 认领(lease)、心跳续约、
 * 上报阶段、提交结果或失败。所有写操作均更新 updated_at。
 *
 * lease 机制：
 *  - claim() 在一个事务内选最老的可认领任务（pending 或 lease 过期的 leased），
 *    置为 leased 并生成新的 lease_token + leased_until，保证多 worker 并发下
 *    同一任务只会被一个 worker 认领。
 *  - heartbeat/setStage/complete/fail 均需携带正确 lease_token，否则拒绝（false）。
 *  - lease 过期（leased_until < now）后任务可被重新认领，实现崩溃 worker 的回收。
 */
const db = require('./index');
const { v4: uuid } = require('uuid');

/**
 * 创建任务（pending）
 * @param {object} data
 * @param {string} data.id - 任务 ID（同时作为最终 podcast ID）
 * @param {string} data.userId - 用户 ID
 * @param {string} data.sourceUrl - 微信文章 URL
 * @param {string} [data.ttsProvider] - TTS 供应商，默认 minimax
 * @returns {{id: string}}
 */
function create({ id, userId, sourceUrl, ttsProvider }) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO tasks (
      id, user_id, status, source_url, tts_provider, created_at, updated_at
    ) VALUES (?, ?, 'pending', ?, ?, ?, ?)
  `).run(id, userId, sourceUrl, ttsProvider || 'minimax', now, now);

  return { id };
}

/**
 * 获取任务状态（供前端轮询）
 * @param {string} id
 * @returns {object|null} {id,status,stage,title,accountName,error,podcastId} 或 null
 */
function getStatus(id) {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    title: row.title,
    accountName: row.account_name,
    error: row.error,
    podcastId: row.podcast_id,
  };
}

/**
 * 获取任务完整信息（内部使用，例如结果上传时取 userId/sourceUrl）
 * @param {string} id
 * @returns {object|null}
 */
function get(id) {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    sourceUrl: row.source_url,
    ttsProvider: row.tts_provider,
    stage: row.stage,
    leaseToken: row.lease_token,
    leasedUntil: row.leased_until,
    workerId: row.worker_id,
    title: row.title,
    accountName: row.account_name,
    error: row.error,
    podcastId: row.podcast_id,
  };
}

// 原子认领事务：选一条 pending 或 lease 过期的 leased 任务（最老优先），置 leased。
const claimTxn = db.transaction((workerId, leaseToken, now, leasedUntil) => {
  const row = db.prepare(`
    SELECT * FROM tasks
    WHERE status = 'pending'
       OR (status = 'leased' AND leased_until < ?)
    ORDER BY created_at ASC
    LIMIT 1
  `).get(now);

  if (!row) return null;

  db.prepare(`
    UPDATE tasks
    SET status = 'leased',
        lease_token = ?,
        leased_until = ?,
        worker_id = ?,
        updated_at = ?
    WHERE id = ?
  `).run(leaseToken, leasedUntil, workerId, now, row.id);

  return {
    id: row.id,
    sourceUrl: row.source_url,
    ttsProvider: row.tts_provider,
    leaseToken,
  };
});

/**
 * 认领一条任务（原子）
 * @param {object} opts
 * @param {string} opts.workerId
 * @param {number} opts.leaseMs - 租约时长（毫秒）
 * @returns {{id,sourceUrl,ttsProvider,leaseToken}|null}
 */
function claim({ workerId, leaseMs }) {
  const now = Date.now();
  const leaseToken = uuid();
  const leasedUntil = now + leaseMs;
  return claimTxn(workerId, leaseToken, now, leasedUntil);
}

/**
 * 校验 lease_token 是否匹配且任务处于 leased 状态
 * @returns {object|null} 命中行或 null
 */
function verifyLease(id, leaseToken) {
  const row = db.prepare(
    "SELECT * FROM tasks WHERE id = ? AND lease_token = ? AND status = 'leased'"
  ).get(id, leaseToken);
  return row || null;
}

/**
 * 心跳续约
 * @returns {boolean} lease 是否有效（true=已续约）
 */
function heartbeat(id, leaseToken, leaseMs) {
  if (!verifyLease(id, leaseToken)) return false;
  const now = Date.now();
  db.prepare(
    'UPDATE tasks SET leased_until = ?, updated_at = ? WHERE id = ? AND lease_token = ?'
  ).run(now + leaseMs, now, id, leaseToken);
  return true;
}

/**
 * 上报当前阶段（parsing|generating|synthesizing）
 * @returns {boolean}
 */
function setStage(id, leaseToken, stage) {
  if (!verifyLease(id, leaseToken)) return false;
  const now = Date.now();
  db.prepare(
    'UPDATE tasks SET stage = ?, updated_at = ? WHERE id = ? AND lease_token = ?'
  ).run(stage, now, id, leaseToken);
  return true;
}

/**
 * 标记完成
 * @param {string} id
 * @param {string} leaseToken
 * @param {object} meta {podcastId,title,accountName}
 * @returns {boolean}
 */
function complete(id, leaseToken, { podcastId, title, accountName } = {}) {
  if (!verifyLease(id, leaseToken)) return false;
  const now = Date.now();
  db.prepare(`
    UPDATE tasks
    SET status = 'completed',
        stage = NULL,
        podcast_id = ?,
        title = ?,
        account_name = ?,
        error = NULL,
        updated_at = ?
    WHERE id = ? AND lease_token = ?
  `).run(podcastId || id, title || null, accountName || null, now, id, leaseToken);
  return true;
}

/**
 * 标记失败
 * @returns {boolean}
 */
function fail(id, leaseToken, error) {
  if (!verifyLease(id, leaseToken)) return false;
  const now = Date.now();
  db.prepare(`
    UPDATE tasks
    SET status = 'failed',
        error = ?,
        updated_at = ?
    WHERE id = ? AND lease_token = ?
  `).run(error || '处理失败', now, id, leaseToken);
  return true;
}

module.exports = {
  create,
  getStatus,
  get,
  claim,
  heartbeat,
  setStage,
  complete,
  fail,
};
