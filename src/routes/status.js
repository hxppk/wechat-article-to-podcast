const express = require('express');
const router = express.Router();
const tasks = require('../db/tasks');

// 状态文本映射（沿用前端进度条所依赖的状态名）
const STATUS_TEXT = {
  pending: '等待本地引擎认领',
  parsing: '正在解析文章',
  generating: '正在生成对话脚本',
  synthesizing: '正在合成语音',
  completed: '处理完成',
  failed: '处理失败'
};

/**
 * 将 DB 的 status + stage 映射为前端可识别的展示状态。
 * - completed/failed 原样透传
 * - leased：用 stage（parsing/generating/synthesizing）表示进度，无 stage 时回退 pending
 * - pending：等待 worker 认领
 */
function toDisplayStatus(task) {
  if (task.status === 'completed') return 'completed';
  if (task.status === 'failed') return 'failed';
  if (task.status === 'leased') {
    return task.stage || 'pending';
  }
  return 'pending';
}

/**
 * GET /api/status/:id
 * 查询任务处理状态
 */
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const task = tasks.getStatus(id);

  if (!task) {
    return res.status(404).json({
      error: '任务不存在',
      code: 'TASK_NOT_FOUND'
    });
  }

  const status = toDisplayStatus(task);

  res.json({
    id: task.id,
    status,
    statusText: STATUS_TEXT[status] || status,
    title: task.title,
    accountName: task.accountName,
    podcastId: task.podcastId,
    error: task.error
  });
});

module.exports = router;
