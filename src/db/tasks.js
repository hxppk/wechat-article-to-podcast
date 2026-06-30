/**
 * 任务数据访问层 (分布式拉模式)
 *
 * 云端持久化任务队列。本地 worker 通过 API 认领(lease)、心跳续约、
 * 上报阶段、提交结果或失败。所有写操作均更新 updated_at。
 *
 * lease 机制：
 *  - claim() 用单条原子 UPDATE...RETURNING 选最老的可认领任务（pending 或
 *    lease 过期且重试未耗尽的 leased），置为 leased 并生成新的 lease_token +
 *    leased_until，attempts+1，保证多 worker 并发下同一任务只会被一个 worker 认领。
 *  - heartbeat/setStage/complete/fail 均为单条条件 UPDATE，要求
 *    lease_token 匹配、status='leased' 且 leased_until>=now，返回 changes===1；
 *    否则视为 lease lost（false）。
 *  - lease 过期（leased_until < now）后任务可被重新认领，实现崩溃 worker 的回收；
 *    超过 MAX_ATTEMPTS 次的过期任务标 failed 不再重领，并退还配额。
 */
const db = require('./index');
const usage = require('./usage');
const { v4: uuid } = require('uuid');

const MAX_ATTEMPTS = parseInt(process.env.MAX_ATTEMPTS, 10) || 3;

/**
 * 创建任务（pending）
 * @param {object} data
 * @param {string} data.id - 任务 ID（同时作为最终 podcast ID）
 * @param {string} data.userId - 用户 ID
 * @param {string} data.sourceUrl - 微信文章 URL
 * @param {string} [data.ttsProvider] - TTS 供应商，默认 elevenlabs
 * @returns {{id: string}}
 */
function create({ id, userId, sourceUrl, ttsProvider }) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO tasks (
      id, user_id, status, source_url, tts_provider, attempts, created_at, updated_at
    ) VALUES (?, ?, 'pending', ?, ?, 0, ?, ?)
  `).run(id, userId, sourceUrl, ttsProvider || 'elevenlabs', now, now);

  return { id };
}

/**
 * 获取任务状态（供前端轮询）。归属校验：仅当 user_id 匹配时返回。
 * @param {string} id
 * @param {string} userId - 调用方用户 ID（含匿名 'public'）
 * @returns {object|null} {id,status,stage,title,accountName,error,podcastId} 或 null
 */
function getStatus(id, userId) {
  const row = db.prepare(
    'SELECT * FROM tasks WHERE id = ? AND user_id = ?'
  ).get(id, userId);
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
    attempts: row.attempts,
    title: row.title,
    accountName: row.account_name,
    error: row.error,
    podcastId: row.podcast_id,
  };
}

// 原子认领事务：
//  1) 回收：过期且重试耗尽（attempts>=MAX）的 leased 任务标 failed，并退还其配额。
//  2) 单条 UPDATE...RETURNING 选最老的可认领任务（pending 或过期未耗尽的 leased），
//     attempts+1 并置 leased，返回认领到的任务（或无）。
const claimTxn = db.transaction((workerId, leaseToken, now, leasedUntil) => {
  // 1) 回收耗尽任务
  const exhausted = db.prepare(`
    SELECT id, user_id FROM tasks
    WHERE status = 'leased' AND leased_until < ? AND attempts >= ?
  `).all(now, MAX_ATTEMPTS);

  if (exhausted.length > 0) {
    db.prepare(`
      UPDATE tasks
      SET status = 'failed', stage = NULL, error = ?, updated_at = ?
      WHERE status = 'leased' AND leased_until < ? AND attempts >= ?
    `).run('超过最大重试次数', now, now, MAX_ATTEMPTS);

    // 退还配额（耗尽任务不会再产出播客）
    for (const t of exhausted) {
      if (t.user_id) usage.refund(t.user_id);
    }
  }

  // 2) 原子认领
  const row = db.prepare(`
    UPDATE tasks
    SET status = 'leased',
        lease_token = ?,
        leased_until = ?,
        worker_id = ?,
        attempts = attempts + 1,
        updated_at = ?
    WHERE id = (
      SELECT id FROM tasks
      WHERE status = 'pending'
         OR (status = 'leased' AND leased_until < ? AND attempts < ?)
      ORDER BY created_at ASC
      LIMIT 1
    )
    RETURNING id,
              source_url   AS sourceUrl,
              tts_provider AS ttsProvider,
              lease_token  AS leaseToken
  `).get(leaseToken, leasedUntil, workerId, now, now, MAX_ATTEMPTS);

  return row || null;
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
 * 心跳续约（单条条件 UPDATE，校验 token + 未过期）
 * @returns {boolean} lease 是否有效（true=已续约）
 */
function heartbeat(id, leaseToken, leaseMs) {
  const now = Date.now();
  const info = db.prepare(`
    UPDATE tasks SET leased_until = ?, updated_at = ?
    WHERE id = ? AND lease_token = ? AND status = 'leased' AND leased_until >= ?
  `).run(now + leaseMs, now, id, leaseToken, now);
  return info.changes === 1;
}

/**
 * 上报当前阶段（parsing|generating|synthesizing）
 * @returns {boolean}
 */
function setStage(id, leaseToken, stage) {
  const now = Date.now();
  const info = db.prepare(`
    UPDATE tasks SET stage = ?, updated_at = ?
    WHERE id = ? AND lease_token = ? AND status = 'leased' AND leased_until >= ?
  `).run(stage, now, id, leaseToken, now);
  return info.changes === 1;
}

/**
 * 标记完成（单条条件 UPDATE，原子；调用方应在事务内配合 podcasts.create）
 * @param {string} id
 * @param {string} leaseToken
 * @param {object} meta {podcastId,title,accountName}
 * @returns {boolean} changes===1
 */
function complete(id, leaseToken, { podcastId, title, accountName } = {}) {
  const now = Date.now();
  const info = db.prepare(`
    UPDATE tasks
    SET status = 'completed',
        stage = NULL,
        podcast_id = ?,
        title = ?,
        account_name = ?,
        error = NULL,
        updated_at = ?
    WHERE id = ? AND lease_token = ? AND status = 'leased' AND leased_until >= ?
  `).run(podcastId || id, title || null, accountName || null, now, id, leaseToken, now);
  return info.changes === 1;
}

/**
 * 标记失败（单条条件 UPDATE）
 * @returns {boolean} changes===1
 */
function fail(id, leaseToken, error) {
  const now = Date.now();
  const info = db.prepare(`
    UPDATE tasks
    SET status = 'failed',
        stage = NULL,
        error = ?,
        updated_at = ?
    WHERE id = ? AND lease_token = ? AND status = 'leased' AND leased_until >= ?
  `).run(error || '处理失败', now, id, leaseToken, now);
  return info.changes === 1;
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
  MAX_ATTEMPTS,
};
