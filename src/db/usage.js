/**
 * 配额使用量数据访问层 (v2.0)
 */
const db = require('./index');

/**
 * 获取北京时间日期字符串 (YYYY-MM-DD)
 * @param {Date} date - 日期对象
 * @returns {string} 北京时间日期字符串
 */
function getBeijingDateString(date = new Date()) {
  // 北京时间 = UTC + 8
  const beijingOffset = 8 * 60 * 60 * 1000;
  const beijingTime = new Date(date.getTime() + beijingOffset);
  return beijingTime.toISOString().split('T')[0];
}

/**
 * 获取下次重置时间（北京时间次日 00:00）
 * @returns {number} 时间戳
 */
function getNextResetTime() {
  const now = new Date();
  const beijingOffset = 8 * 60 * 60 * 1000;
  const beijingTime = new Date(now.getTime() + beijingOffset);

  // 计算北京时间次日 00:00
  const tomorrow = new Date(beijingTime);
  tomorrow.setUTCHours(0, 0, 0, 0);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  // 转回 UTC 时间戳
  return tomorrow.getTime() - beijingOffset;
}

/**
 * 获取当日使用量
 * @param {string} userId - 用户 ID
 * @returns {number} 使用量
 */
function getUsageToday(userId) {
  const date = getBeijingDateString();
  const row = db.prepare(
    'SELECT count FROM usage WHERE user_id = ? AND date = ?'
  ).get(userId, date);
  return row ? row.count : 0;
}

/**
 * 增加使用量
 * @param {string} userId - 用户 ID
 * @returns {number} 新的使用量
 */
function incrementUsage(userId) {
  const date = getBeijingDateString();

  // 使用 UPSERT 语法
  db.prepare(`
    INSERT INTO usage (user_id, date, count)
    VALUES (?, ?, 1)
    ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1
  `).run(userId, date);

  return getUsageToday(userId);
}

/**
 * 获取配额限制
 * @param {string} tier - 用户等级
 * @returns {number} 每日配额
 */
function getQuotaLimit(tier) {
  const limits = {
    guest: 1,   // 访客：每日 1 次
    free: 2,    // 免费：每日 2 次
    paid: 20    // 付费：每日 20 次
  };
  return limits[tier] || limits.guest;
}

/**
 * 检查是否超出配额
 * @param {string} userId - 用户 ID
 * @param {string} tier - 用户等级
 * @returns {object} { allowed, usage, limit, resetAt }
 */
function checkQuota(userId, tier) {
  const usage = getUsageToday(userId);
  const limit = getQuotaLimit(tier);
  const resetAt = getNextResetTime();

  return {
    allowed: usage < limit,
    usage,
    limit,
    resetAt
  };
}

module.exports = {
  getBeijingDateString,
  getNextResetTime,
  getUsageToday,
  incrementUsage,
  getQuotaLimit,
  checkQuota
};
