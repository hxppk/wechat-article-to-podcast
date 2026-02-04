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

  // 2. 降级兼容：Authorization: Bearer <JWT> 或 <userId>
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();

    // 2.1 尝试按 JWT 解析
    if (bearer) {
      try {
        const decoded = jwt.verify(bearer, JWT_SECRET);
        if (decoded.userId) {
          const user = users.findById(decoded.userId);
          if (user) {
            req.userId = user.id;
            req.userTier = user.tier;
            return next();
          }
        }
      } catch (e) {
        // JWT 不可用则继续尝试 userId 降级
      }
    }

    // 2.2 降级兼容 v1.5：Authorization: Bearer <userId>
    if (bearer && /^[a-zA-Z0-9_-]+$/.test(bearer)) {
      const user = users.findById(bearer);
      if (user) {
        req.userId = user.id;
        req.userTier = user.tier;
      } else if (bearer === 'public') {
        req.userId = 'public';
        req.userTier = 'guest';
      } else {
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
