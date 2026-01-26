#!/usr/bin/env node
/**
 * 更新现有播客的音频时长
 * 使用 ffprobe 从音频文件提取时长
 */
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs');

// 确保数据库目录存在
const dbDir = path.join(__dirname, '../data/db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = require('../src/db/index');

async function getAudioDuration(audioPath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
    );
    const seconds = parseFloat(stdout.trim());
    return Math.round(seconds * 1000);
  } catch (err) {
    return 0;
  }
}

async function updateDurations() {
  console.log('=== 更新播客时长 ===\n');

  const podcasts = db.prepare('SELECT id, title, audio_path, duration_ms FROM podcasts WHERE duration_ms = 0 OR duration_ms IS NULL').all();

  if (podcasts.length === 0) {
    console.log('没有需要更新的播客');
    return;
  }

  console.log(`发现 ${podcasts.length} 个播客需要更新时长\n`);

  let updated = 0;
  let failed = 0;

  for (const podcast of podcasts) {
    const audioPath = podcast.audio_path;

    if (!audioPath || !fs.existsSync(audioPath)) {
      console.log(`[跳过] ${podcast.title || podcast.id} - 音频文件不存在`);
      failed++;
      continue;
    }

    const durationMs = await getAudioDuration(audioPath);

    if (durationMs > 0) {
      db.prepare('UPDATE podcasts SET duration_ms = ? WHERE id = ?').run(durationMs, podcast.id);
      const minutes = Math.floor(durationMs / 60000);
      const seconds = Math.floor((durationMs % 60000) / 1000);
      console.log(`[更新] ${podcast.title || podcast.id} - ${minutes}:${seconds.toString().padStart(2, '0')}`);
      updated++;
    } else {
      console.log(`[失败] ${podcast.title || podcast.id} - 无法获取时长`);
      failed++;
    }
  }

  console.log(`\n完成！更新: ${updated}, 失败: ${failed}`);
}

updateDurations().catch(console.error);
