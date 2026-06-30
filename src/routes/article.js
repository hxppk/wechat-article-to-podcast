/**
 * 文章路由 (分布式拉模式)
 * 云端只建任务（pending），AI 流水线由本地 worker 认领执行。
 */
const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const tasks = require('../db/tasks');
// 云端只做纯字符串 URL 校验（零依赖），不加载 articleExtractor / puppeteer。
const { validateUrl, ValidationError } = require('../utils/validateWechatUrl');
const usage = require('../db/usage');
const quotaMiddleware = require('../middleware/quota');
const { requireAuth } = require('../middleware/auth');

// v2.0: authMiddleware 已在 server.js 全局应用

/**
 * POST /api/article
 * 提交微信文章 URL，创建 pending 任务（不在云端跑 AI）
 * v2.0: 需要登录 + 检查配额
 */
router.post('/', requireAuth, quotaMiddleware, async (req, res) => {
  const { url, ttsProvider } = req.body;

  // 验证 URL
  try {
    validateUrl(url);
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({
        error: error.message,
        code: 'INVALID_URL'
      });
    }
    throw error;
  }

  // 创建任务（pending），等待本地 worker 认领
  const taskId = uuid();
  tasks.create({
    id: taskId,
    userId: req.userId,
    sourceUrl: url,
    ttsProvider: (ttsProvider || 'elevenlabs')
  });

  // 配额扣减：仅在 URL 校验通过 + 任务创建成功之后扣，
  // 无效 URL(400) 不扣；worker 失败时由 /api/worker/.../fail 退还。
  usage.incrementUsage(req.userId);

  res.json({
    success: true,
    taskId,
    message: '开始处理文章'
  });
});

module.exports = router;
