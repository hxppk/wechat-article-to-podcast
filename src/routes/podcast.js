const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const podcastStore = require('../utils/podcastStore');

const AUDIO_DIR = path.join(__dirname, '../../data/audio');

/**
 * GET /api/podcasts
 * 获取所有播客列表
 */
router.get('/', (req, res) => {
  const podcasts = podcastStore.getAllPodcasts();
  res.json({
    success: true,
    count: podcasts.length,
    podcasts
  });
});

/**
 * GET /api/podcast/:id
 * 获取单个播客详情
 */
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const podcast = podcastStore.getPodcast(id);

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
 * DELETE /api/podcast/:id
 * 删除播客
 */
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const deleted = podcastStore.deletePodcast(id);

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

/**
 * GET /audio/:id
 * 获取音频文件流
 */
router.get('/audio/:id', (req, res) => {
  const { id } = req.params;
  const audioPath = path.join(AUDIO_DIR, `${id}.mp3`);

  if (!fs.existsSync(audioPath)) {
    return res.status(404).json({
      error: '音频文件不存在',
      code: 'AUDIO_NOT_FOUND'
    });
  }

  const stat = fs.statSync(audioPath);
  const podcast = podcastStore.getPodcast(id);
  const fileName = podcast ? `${podcast.sourceFileName.replace('.pdf', '')}.mp3` : `${id}.mp3`;

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
