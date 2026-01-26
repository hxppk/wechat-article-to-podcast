/**
 * 数据清理服务 (v2.0)
 * 按用户等级清理过期播客
 */
const podcasts = require('../db/podcasts');
const users = require('../db/users');
const db = require('../db/index');

// 留存时间（毫秒）
const RETENTION = {
  guest: 30 * 60 * 1000,        // 访客：30 分钟
  free: 7 * 24 * 60 * 60 * 1000, // 免费：7 天
  paid: Infinity                 // 付费：永久
};

/**
 * 获取用户的留存时间
 * @param {string} tier - 用户等级
 * @returns {number} 留存毫秒数
 */
function getRetention(tier) {
  return RETENTION[tier] || RETENTION.guest;
}

/**
 * 清理单个用户的过期播客
 * @param {string} userId - 用户 ID
 * @param {string} tier - 用户等级
 * @returns {number} 清理数量
 */
function cleanupUserPodcasts(userId, tier) {
  const retention = getRetention(tier);

  // 付费用户不清理
  if (retention === Infinity) {
    return 0;
  }

  const threshold = Date.now() - retention;
  return podcasts.removeExpired(userId, threshold);
}

/**
 * 清理所有用户的过期播客
 * @returns {object} { total, users }
 */
function cleanupAllPodcasts() {
  let total = 0;
  const userStats = [];

  // 获取所有有播客的用户
  const rows = db.prepare(`
    SELECT DISTINCT user_id FROM podcasts
  `).all();

  for (const row of rows) {
    const userId = row.user_id;
    const tier = users.getTier(userId);
    const count = cleanupUserPodcasts(userId, tier);

    if (count > 0) {
      console.log(`[cleanup] 清理用户 ${userId} (${tier}) 的 ${count} 个过期播客`);
      userStats.push({ userId, tier, count });
      total += count;
    }
  }

  return { total, users: userStats };
}

/**
 * 启动定时清理任务
 * @param {number} intervalMs - 检查间隔（毫秒）
 */
function startCleanupTask(intervalMs = 5 * 60 * 1000) {
  console.log(`[cleanup] 清理任务已启动，间隔 ${intervalMs / 1000} 秒`);
  console.log('[cleanup] 留存规则: 访客 30 分钟, 免费 7 天, 付费永久');

  // 立即执行一次
  const result = cleanupAllPodcasts();
  if (result.total > 0) {
    console.log(`[cleanup] 初始清理完成，共清理 ${result.total} 个播客`);
  }

  // 定时执行
  setInterval(() => {
    const result = cleanupAllPodcasts();
    if (result.total > 0) {
      console.log(`[cleanup] 定时清理完成，共清理 ${result.total} 个播客`);
    }
  }, intervalMs);
}

module.exports = {
  getRetention,
  cleanupUserPodcasts,
  cleanupAllPodcasts,
  startCleanupTask
};
