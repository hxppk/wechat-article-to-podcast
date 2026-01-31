/**
 * 认证路由 (v2.0)
 */
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const users = require('../db/users');
const usage = require('../db/usage');

const JWT_SECRET = process.env.JWT_SECRET || 'wechat-podcast-secret-key-v2';
const JWT_EXPIRES_IN = '7d';
const COOKIE_NAME = 'token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 天
};

// 登录失败限制（内存计数）
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW = 10 * 60 * 1000; // 10 分钟

/**
 * 检查登录失败限制
 */
function checkLoginLimit(phone) {
  const now = Date.now();
  const record = loginAttempts.get(phone);

  if (!record) return true;

  // 清理过期记录
  if (now - record.firstAttempt > ATTEMPT_WINDOW) {
    loginAttempts.delete(phone);
    return true;
  }

  return record.count < MAX_ATTEMPTS;
}

/**
 * 记录登录失败
 */
function recordLoginFailure(phone) {
  const now = Date.now();
  const record = loginAttempts.get(phone);

  if (!record || now - record.firstAttempt > ATTEMPT_WINDOW) {
    loginAttempts.set(phone, { count: 1, firstAttempt: now });
  } else {
    record.count++;
  }
}

/**
 * 清除登录失败记录
 */
function clearLoginFailure(phone) {
  loginAttempts.delete(phone);
}

/**
 * 验证手机号格式
 */
function validatePhone(phone) {
  return /^1[3-9]\d{9}$/.test(phone);
}

/**
 * 验证密码格式（至少 6 位）
 */
function validatePassword(password) {
  return password && password.length >= 6;
}

/**
 * POST /api/auth/register
 * 手机号注册
 */
router.post('/register', async (req, res) => {
  const { phone, password } = req.body;

  // 验证参数
  if (!validatePhone(phone)) {
    return res.status(400).json({
      error: '请输入有效的手机号',
      code: 'INVALID_PHONE'
    });
  }

  if (!validatePassword(password)) {
    return res.status(400).json({
      error: '密码至少 6 位',
      code: 'INVALID_PASSWORD'
    });
  }

  // 检查手机号是否已注册
  const existing = users.findByPhone(phone);
  if (existing) {
    return res.status(409).json({
      error: '该手机号已注册',
      code: 'PHONE_EXISTS'
    });
  }

  try {
    // 创建用户
    const user = await users.createUser(phone, password);

    // 签发 JWT
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    // 设置 Cookie
    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        phone: user.phone,
        tier: user.tier
      }
    });
  } catch (error) {
    console.error('注册失败:', error);
    res.status(500).json({
      error: '注册失败，请稍后重试',
      code: 'REGISTER_ERROR'
    });
  }
});

/**
 * POST /api/auth/login
 * 手机号登录
 */
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;

  // 验证参数
  if (!phone || !password) {
    return res.status(400).json({
      error: '请输入手机号和密码',
      code: 'MISSING_CREDENTIALS'
    });
  }

  // 检查登录限制
  if (!checkLoginLimit(phone)) {
    return res.status(429).json({
      error: '登录失败次数过多，请 10 分钟后重试',
      code: 'TOO_MANY_ATTEMPTS'
    });
  }

  // 查找用户
  const user = users.findByPhone(phone);
  if (!user) {
    recordLoginFailure(phone);
    return res.status(401).json({
      error: '手机号或密码错误',
      code: 'INVALID_CREDENTIALS'
    });
  }

  // 验证密码
  const valid = await users.verifyPassword(password, user.password_hash);
  if (!valid) {
    recordLoginFailure(phone);
    return res.status(401).json({
      error: '手机号或密码错误',
      code: 'INVALID_CREDENTIALS'
    });
  }

  // 清除登录失败记录
  clearLoginFailure(phone);

  // 更新最后登录时间
  users.updateLastLogin(user.id);

  // 签发 JWT
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  // 设置 Cookie
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      phone: user.phone,
      tier: user.tier
    }
  });
});

/**
 * POST /api/auth/logout
 * 登出
 */
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({
    success: true,
    message: '已登出'
  });
});

/**
 * GET /api/auth/me
 * 获取当前用户信息
 */
router.get('/me', (req, res) => {
  // 需要 authMiddleware 先解析 req.userId
  if (!req.userId || req.userId === 'public') {
    return res.status(401).json({
      error: '未登录',
      code: 'UNAUTHORIZED'
    });
  }

  const user = users.findById(req.userId);
  if (!user) {
    return res.status(401).json({
      error: '用户不存在',
      code: 'USER_NOT_FOUND'
    });
  }

  // 获取配额信息
  const quotaInfo = usage.checkQuota(user.id, user.tier);

  res.json({
    success: true,
    user: {
      id: user.id,
      phone: user.phone,
      tier: user.tier
    },
    quota: {
      usage: quotaInfo.usage,
      limit: quotaInfo.limit,
      resetAt: quotaInfo.resetAt
    }
  });
});

module.exports = router;
