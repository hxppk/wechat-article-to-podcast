/**
 * v2.0 用户身份识别中间件
 * 1. 优先从 JWT Cookie 解析用户
 * 2. 降级兼容 v1.5 的 Authorization: Bearer <userId>
 * 3. 未登录设为 req.userId = 'public'
 */
const jwt = require('jsonwebtoken');
const users = require('../db/users');

const JWT_SECRET = process.env.JWT_SECRET || 'wechat-podcast-secret-key-v2';
const COOKIE_NAME = 'token';

/**
 * 主认证中间件
 * 解析用户身份，设置 req.userId 和 req.userTier
 */
function authMiddleware(req, res, next) {
  req.userId = 'public';
  req.userTier = 'guest';

  // 1. 尝试从 Cookie 解析 JWT
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.userId) {
        const user = users.findById(decoded.userId);
        if (user) {
          req.userId = user.id;
          req.userTier = user.tier;
          return next();
        }
      }
    } catch (e) {
      // Token 无效或过期，继续降级
    }
  }

  // 2. 降级兼容 v1.5：Authorization: Bearer <userId>
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const userId = authHeader.slice(7).trim();
    if (userId && /^[a-zA-Z0-9_-]+$/.test(userId)) {
      // 如果是已注册用户，获取其 tier
      const user = users.findById(userId);
      if (user) {
        req.userId = user.id;
        req.userTier = user.tier;
      } else if (userId === 'public') {
        req.userId = 'public';
        req.userTier = 'guest';
      } else {
        // 未知用户按 public 处理
        req.userId = 'public';
        req.userTier = 'guest';
      }
    }
  }

  next();
}

/**
 * 需要登录的中间件
 * 用于需要登录才能访问的接口
 */
function requireAuth(req, res, next) {
  if (!req.userId || req.userId === 'public') {
    return res.status(401).json({
      error: '请先登录',
      code: 'UNAUTHORIZED'
    });
  }
  next();
}

module.exports = authMiddleware;
module.exports.authMiddleware = authMiddleware;
module.exports.requireAuth = requireAuth;
