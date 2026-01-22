const express = require('express');
const router = express.Router();
const taskQueue = require('../services/queue');
const { validateUrl, ValidationError } = require('../services/articleExtractor');

/**
 * POST /api/article
 * 提交微信文章 URL，启动转换任务
 */
router.post('/', async (req, res) => {
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

  // 创建任务
  const taskId = taskQueue.createTask(url);

  res.json({
    success: true,
    taskId,
    message: '开始处理文章'
  });
});

module.exports = router;
