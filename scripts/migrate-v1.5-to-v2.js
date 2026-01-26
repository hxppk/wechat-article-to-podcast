#!/usr/bin/env node
/**
 * v2.0 迁移脚本
 * 将 podcasts.json 导入 SQLite
 * 旧数据归属 public 用户
 */
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/podcasts.json');
const BACKUP_FILE = path.join(__dirname, '../data/podcasts.v1.5.backup.json');

// 延迟加载数据库模块（确保目录已创建）
let db, podcasts;

function initDb() {
  // 确保数据目录存在
  const dbDir = path.join(__dirname, '../data/db');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = require('../src/db/index');
  podcasts = require('../src/db/podcasts');
}

function migrate() {
  console.log('=== v2.0 数据迁移脚本 ===\n');

  // 检查数据文件是否存在
  if (!fs.existsSync(DATA_FILE)) {
    console.log('podcasts.json 不存在，无需迁移');
    console.log('数据库已初始化');
    return;
  }

  // 初始化数据库
  initDb();

  // 读取 JSON 数据
  let jsonPodcasts;
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    jsonPodcasts = JSON.parse(data);
  } catch (error) {
    console.error('读取数据文件失败:', error.message);
    process.exit(1);
  }

  if (!Array.isArray(jsonPodcasts)) {
    console.error('数据格式错误，期望数组');
    process.exit(1);
  }

  console.log(`发现 ${jsonPodcasts.length} 条播客记录`);

  // 检查是否已有数据（避免重复导入）
  const existingCount = db.prepare('SELECT COUNT(*) as count FROM podcasts').get().count;
  if (existingCount > 0) {
    console.log(`SQLite 已有 ${existingCount} 条记录`);
    console.log('跳过迁移，避免重复导入');
    console.log('如需重新迁移，请先删除 data/db/wechat-podcast.db');
    return;
  }

  // 备份原数据
  try {
    fs.copyFileSync(DATA_FILE, BACKUP_FILE);
    console.log(`已备份至: ${BACKUP_FILE}`);
  } catch (error) {
    console.error('备份失败:', error.message);
    process.exit(1);
  }

  // 执行迁移
  let successCount = 0;
  let failCount = 0;

  for (const item of jsonPodcasts) {
    try {
      // 映射字段
      const userId = item.userId || 'public';
      const audioPath = item.audioPath || path.join(__dirname, '../data/audio', `${item.id}.mp3`);
      const scriptPath = item.scriptPath || path.join(__dirname, '../data/scripts', `${item.id}.json`);

      // 检查音频文件是否存在，如果在旧目录则移动到用户目录
      let finalAudioPath = audioPath;
      let finalScriptPath = scriptPath;

      // 创建用户目录
      const userAudioDir = path.join(__dirname, '../data/users', userId, 'audio');
      const userScriptsDir = path.join(__dirname, '../data/users', userId, 'scripts');

      if (!fs.existsSync(userAudioDir)) {
        fs.mkdirSync(userAudioDir, { recursive: true });
      }
      if (!fs.existsSync(userScriptsDir)) {
        fs.mkdirSync(userScriptsDir, { recursive: true });
      }

      // 移动音频文件
      if (fs.existsSync(audioPath)) {
        finalAudioPath = path.join(userAudioDir, `${item.id}.mp3`);
        if (audioPath !== finalAudioPath) {
          fs.copyFileSync(audioPath, finalAudioPath);
          console.log(`  移动音频: ${item.id}.mp3`);
        }
      }

      // 移动脚本文件
      if (fs.existsSync(scriptPath)) {
        finalScriptPath = path.join(userScriptsDir, `${item.id}.json`);
        if (scriptPath !== finalScriptPath) {
          fs.copyFileSync(scriptPath, finalScriptPath);
          console.log(`  移动脚本: ${item.id}.json`);
        }
      }

      // 获取文件大小
      let fileSizeBytes = 0;
      if (fs.existsSync(finalAudioPath)) {
        fileSizeBytes = fs.statSync(finalAudioPath).size;
      }

      // 创建播客记录
      podcasts.create({
        id: item.id,
        userId,
        sourceUrl: item.sourceUrl || item.articleUrl || '',
        title: item.title || item.sourceFileName || '',
        accountName: item.accountName || '',
        durationMs: item.durationMs || 0,
        fileSizeBytes,
        summary: item.summary || '',
        scriptPreview: item.scriptPreview || (item.script ? item.script.substring(0, 500) : ''),
        audioPath: finalAudioPath,
        scriptPath: finalScriptPath
      });

      successCount++;
      console.log(`[${successCount}/${jsonPodcasts.length}] 导入: ${item.title || item.id}`);
    } catch (error) {
      failCount++;
      console.error(`导入失败 ${item.id}:`, error.message);
    }
  }

  console.log(`\n迁移完成！`);
  console.log(`成功: ${successCount} 条`);
  console.log(`失败: ${failCount} 条`);

  // 可选：删除旧的 JSON 文件
  if (failCount === 0 && successCount > 0) {
    console.log(`\n旧数据已保留在: ${DATA_FILE}`);
    console.log('确认迁移无误后可手动删除');
  }
}

// 执行迁移
migrate();
