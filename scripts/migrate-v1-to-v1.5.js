#!/usr/bin/env node
/**
 * v1.5 迁移脚本
 * 为所有旧播客记录补充 userId: 'public' 字段
 */
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/podcasts.json');
const BACKUP_FILE = path.join(__dirname, '../data/podcasts.backup.json');

function migrate() {
  console.log('=== v1.5 数据迁移脚本 ===\n');

  // 检查数据文件是否存在
  if (!fs.existsSync(DATA_FILE)) {
    console.log('数据文件不存在，无需迁移');
    return;
  }

  // 读取数据
  let podcasts;
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    podcasts = JSON.parse(data);
  } catch (error) {
    console.error('读取数据文件失败:', error.message);
    process.exit(1);
  }

  if (!Array.isArray(podcasts)) {
    console.error('数据格式错误，期望数组');
    process.exit(1);
  }

  // 统计需要迁移的记录
  const needsMigration = podcasts.filter(p => !p.userId);

  if (needsMigration.length === 0) {
    console.log(`共 ${podcasts.length} 条记录，全部已有 userId，无需迁移`);
    return;
  }

  console.log(`共 ${podcasts.length} 条记录，其中 ${needsMigration.length} 条需要迁移`);

  // 备份原数据
  try {
    fs.copyFileSync(DATA_FILE, BACKUP_FILE);
    console.log(`已备份至: ${BACKUP_FILE}`);
  } catch (error) {
    console.error('备份失败:', error.message);
    process.exit(1);
  }

  // 执行迁移
  let migratedCount = 0;
  for (const podcast of podcasts) {
    if (!podcast.userId) {
      podcast.userId = 'public';
      migratedCount++;
    }
  }

  // 保存迁移后的数据
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(podcasts, null, 2));
    console.log(`\n迁移完成！已为 ${migratedCount} 条记录补充 userId: 'public'`);
  } catch (error) {
    console.error('保存数据失败:', error.message);
    process.exit(1);
  }
}

// 执行迁移
migrate();
