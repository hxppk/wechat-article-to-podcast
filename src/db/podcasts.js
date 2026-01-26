/**
 * 播客数据访问层 (v2.0)
 */
const db = require('./index');
const { v4: uuid } = require('uuid');
const path = require('path');
const fs = require('fs');

/**
 * 生成短 shareId（8位随机字符）
 */
function generateShareId() {
  return uuid().replace(/-/g, '').substring(0, 8);
}

/**
 * 创建播客记录
 * @param {object} data - 播客数据
 * @returns {object} 播客记录
 */
function create(data) {
  const now = Date.now();
  const maxRetries = 3;

  // shareId 冲突重试
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const shareId = generateShareId();
    try {
      db.prepare(`
        INSERT INTO podcasts (
          id, user_id, share_id, source_url, title, account_name,
          duration_ms, file_size_bytes, summary, script_preview,
          audio_path, script_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.id,
        data.userId,
        shareId,
        data.sourceUrl || '',
        data.title || '',
        data.accountName || '',
        data.durationMs || 0,
        data.fileSizeBytes || 0,
        data.summary || '',
        data.scriptPreview || '',
        data.audioPath || '',
        data.scriptPath || '',
        now
      );

      return {
        ...data,
        shareId,
        createdAt: now
      };
    } catch (err) {
      // 仅在 shareId 冲突时重试
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' && err.message.includes('share_id')) {
        console.warn(`[podcasts] shareId 冲突，重试 ${attempt + 1}/${maxRetries}`);
        continue;
      }
      throw err;
    }
  }

  throw new Error('无法生成唯一 shareId，请重试');
}

/**
 * 根据 ID 获取播客
 * @param {string} id - 播客 ID
 * @param {string} userId - 用户 ID（可选，用于权限校验）
 * @returns {object|null} 播客记录
 */
function findById(id, userId = null) {
  const podcast = db.prepare('SELECT * FROM podcasts WHERE id = ?').get(id);
  if (!podcast) return null;

  // 权限校验
  if (userId !== null && podcast.user_id !== userId) {
    return null;
  }

  return formatPodcast(podcast);
}

/**
 * 根据 shareId 获取播客（用于分享访问）
 * @param {string} shareId - 分享 ID
 * @returns {object|null} 播客记录
 */
function findByShareId(shareId) {
  const podcast = db.prepare('SELECT * FROM podcasts WHERE share_id = ?').get(shareId);
  return podcast ? formatPodcast(podcast) : null;
}

/**
 * 获取用户的所有播客
 * @param {string} userId - 用户 ID
 * @returns {array} 播客列表
 */
function findByUserId(userId) {
  const podcasts = db.prepare(
    'SELECT * FROM podcasts WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId);
  return podcasts.map(formatPodcast);
}

/**
 * 删除播客
 * @param {string} id - 播客 ID
 * @param {string} userId - 用户 ID（用于权限校验）
 * @returns {boolean} 是否成功
 */
function remove(id, userId = null) {
  const podcast = db.prepare('SELECT * FROM podcasts WHERE id = ?').get(id);
  if (!podcast) return false;

  // 权限校验
  if (userId !== null && podcast.user_id !== userId) {
    return false;
  }

  // 删除数据库记录
  db.prepare('DELETE FROM podcasts WHERE id = ?').run(id);

  // 删除关联文件
  try {
    if (podcast.audio_path && fs.existsSync(podcast.audio_path)) {
      fs.unlinkSync(podcast.audio_path);
    }
    if (podcast.script_path && fs.existsSync(podcast.script_path)) {
      fs.unlinkSync(podcast.script_path);
    }
  } catch (e) {
    console.error('删除文件失败:', e.message);
  }

  return true;
}

/**
 * 批量删除过期播客
 * @param {string} userId - 用户 ID
 * @param {number} beforeTimestamp - 时间戳阈值
 * @returns {number} 删除数量
 */
function removeExpired(userId, beforeTimestamp) {
  const podcasts = db.prepare(
    'SELECT * FROM podcasts WHERE user_id = ? AND created_at < ?'
  ).all(userId, beforeTimestamp);

  for (const podcast of podcasts) {
    remove(podcast.id);
  }

  return podcasts.length;
}

/**
 * 格式化播客记录（snake_case -> camelCase）
 */
function formatPodcast(row) {
  return {
    id: row.id,
    userId: row.user_id,
    shareId: row.share_id,
    sourceUrl: row.source_url,
    title: row.title,
    accountName: row.account_name,
    durationMs: row.duration_ms,
    fileSizeBytes: row.file_size_bytes,
    summary: row.summary,
    scriptPreview: row.script_preview,
    audioPath: row.audio_path,
    scriptPath: row.script_path,
    createdAt: row.created_at,
    // 兼容旧字段
    sourceFileName: row.title,
    generatedAt: row.created_at
  };
}

module.exports = {
  create,
  findById,
  findByShareId,
  findByUserId,
  remove,
  removeExpired,
  generateShareId
};
