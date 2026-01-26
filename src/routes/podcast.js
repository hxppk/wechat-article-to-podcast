/**
 * 播客路由 (v2.0)
 * 使用 SQLite 存储
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const podcasts = require('../db/podcasts');

// v2.0: authMiddleware 已在 server.js 全局应用

/**
 * GET /api/podcasts
 * 获取当前用户的播客列表
 */
router.get('/', (req, res) => {
  const list = podcasts.findByUserId(req.userId);
  res.json({
    success: true,
    count: list.length,
    podcasts: list
  });
});

/**
 * GET /api/podcasts/audio/:id
 * 获取音频文件流（需要权限校验）
 * 注意：此路由必须在 /:id 之前，否则会被误匹配
 */
router.get('/audio/:id', (req, res) => {
  const { id } = req.params;
  const podcast = podcasts.findById(id, req.userId);

  if (!podcast) {
    return res.status(404).json({
      error: '播客不存在',
      code: 'PODCAST_NOT_FOUND'
    });
  }

  const audioPath = podcast.audioPath;
  if (!audioPath || !fs.existsSync(audioPath)) {
    return res.status(404).json({
      error: '音频文件不存在',
      code: 'AUDIO_NOT_FOUND'
    });
  }

  const stat = fs.statSync(audioPath);
  const fileName = podcast.title ? `${podcast.title}.mp3` : `${id}.mp3`;

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
  res.setHeader('Accept-Ranges', 'bytes');

  // 支持 Range 请求（音频进度拖动）
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', chunkSize);

    const stream = fs.createReadStream(audioPath, { start, end });
    stream.pipe(res);
  } else {
    const stream = fs.createReadStream(audioPath);
    stream.pipe(res);
  }
});

/**
 * GET /api/podcasts/:id
 * 获取单个播客详情（按 userId 校验）
 */
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const podcast = podcasts.findById(id, req.userId);

  if (!podcast) {
    return res.status(404).json({
      error: '播客不存在',
      code: 'PODCAST_NOT_FOUND'
    });
  }

  res.json({
    success: true,
    podcast
  });
});

/**
 * DELETE /api/podcasts/:id
 * 删除播客（按 userId 校验归属）
 */
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const deleted = podcasts.remove(id, req.userId);

  if (!deleted) {
    return res.status(404).json({
      error: '播客不存在',
      code: 'PODCAST_NOT_FOUND'
    });
  }

  res.json({
    success: true,
    message: '播客已删除'
  });
});

module.exports = router;
