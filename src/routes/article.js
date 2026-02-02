/**
 * 文章路由 (v2.0)
 */
const express = require('express');
const router = express.Router();
const taskQueue = require('../services/queue');
const { validateUrl, ValidationError } = require('../services/articleExtractor');
const quotaMiddleware = require('../middleware/quota');
const { requireAuth } = require('../middleware/auth');

// v2.0: authMiddleware 已在 server.js 全局应用

/**
 * POST /api/article
 * 提交微信文章 URL，启动转换任务
 * v2.0: 需要登录 + 检查配额
 */
router.post('/', requireAuth, quotaMiddleware, async (req, res) => {
  const { url } = req.body;

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

  // 创建任务（v1.5: 传入 userId）
  const taskId = taskQueue.createTask(url, req.userId);

  res.json({
    success: true,
    taskId,
    message: '开始处理文章'
  });
});

module.exports = router;
