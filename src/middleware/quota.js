/**
 * 配额中间件 (v2.0)
 * 检查用户配额并在提交时计数
 */
const usage = require('../db/usage');

/**
 * 检查配额中间件（只校验，不扣减）
 * 用于需要消耗配额的接口（如提交文章）。
 * 实际扣减移到路由内 URL 校验通过 + 任务创建成功之后，避免无效请求/无效 URL 也被计数。
 */
function quotaMiddleware(req, res, next) {
  const { userId, userTier } = req;

  // 检查配额
  const quotaInfo = usage.checkQuota(userId, userTier);

  if (!quotaInfo.allowed) {
    return res.status(429).json({
      error: '今日配额已用完',
      code: 'QUOTA_EXCEEDED',
      quota: {
        usage: quotaInfo.usage,
        limit: quotaInfo.limit,
        resetAt: quotaInfo.resetAt
      }
    });
  }

  // 将配额信息附加到请求，供后续使用（扣减由路由负责）
  req.quotaInfo = quotaInfo;

  next();
}

/**
 * 获取配额信息（不消耗配额）
 */
function getQuotaInfo(req, res, next) {
  const { userId, userTier } = req;
  const quotaInfo = usage.checkQuota(userId, userTier);
  req.quotaInfo = quotaInfo;
  next();
}

module.exports = quotaMiddleware;
module.exports.quotaMiddleware = quotaMiddleware;
module.exports.getQuotaInfo = getQuotaInfo;
