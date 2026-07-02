/**
 * 分享路由 (v2.0)
 * 匿名可访问播客播放
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const podcasts = require('../db/podcasts');

/**
 * GET /api/share/:shareId
 * 获取分享播客信息（无需登录）
 */
router.get('/:shareId', (req, res) => {
  const { shareId } = req.params;
  const podcast = podcasts.findByShareId(shareId);

  if (!podcast) {
    return res.status(404).json({
      error: '播客不存在或已过期',
      code: 'PODCAST_NOT_FOUND'
    });
  }

  // 返回公开信息（不含敏感数据）
  res.json({
    success: true,
    podcast: {
      id: podcast.id,
      shareId: podcast.shareId,
      title: podcast.title,
      accountName: podcast.accountName,
      durationMs: podcast.durationMs,
      summary: podcast.summary,
      coverUrl: podcast.coverUrl || '',
      createdAt: podcast.createdAt
    }
  });
});

/**
 * GET /api/share/:shareId/audio
 * 获取分享播客音频流（无需登录）
 */
router.get('/:shareId/audio', (req, res) => {
  const { shareId } = req.params;
  const podcast = podcasts.findByShareId(shareId);

  if (!podcast) {
    return res.status(404).json({
      error: '播客不存在或已过期',
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
  const fileName = podcast.title ? `${podcast.title}.mp3` : `${podcast.id}.mp3`;

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

module.exports = router;
