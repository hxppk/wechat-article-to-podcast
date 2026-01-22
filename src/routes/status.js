const express = require('express');
const router = express.Router();
const queue = require('../services/queue');

/**
 * GET /api/status/:id
 * 查询任务处理状态
 */
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const status = queue.getStatus(id);

  if (!status) {
    return res.status(404).json({
      error: '任务不存在',
      code: 'TASK_NOT_FOUND'
    });
  }

  res.json(status);
});

/**
 * GET /api/queue
 * 获取队列信息
 */
router.get('/', (req, res) => {
  res.json(queue.getQueueInfo());
});

module.exports = router;
