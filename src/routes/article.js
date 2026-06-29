/**
 * 文章路由 (分布式拉模式)
 * 云端只建任务（pending），AI 流水线由本地 worker 认领执行。
 */
const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const tasks = require('../db/tasks');
const { validateUrl, ValidationError } = require('../services/articleExtractor');
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
    ttsProvider: (ttsProvider || 'minimax')
  });

  res.json({
    success: true,
    taskId,
    message: '开始处理文章'
  });
});

module.exports = router;
