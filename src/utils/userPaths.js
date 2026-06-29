/**
 * 用户数据目录工具
 * 沿用旧 queue.js 的目录约定：data/users/<userId>/{audio,scripts}
 */
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');

/**
 * 获取用户音频目录（不存在则创建）
 * @param {string} userId
 * @returns {string}
 */
function getUserAudioDir(userId) {
  const dir = path.join(DATA_DIR, 'users', userId, 'audio');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 获取用户脚本目录（不存在则创建）
 * @param {string} userId
 * @returns {string}
 */
function getUserScriptsDir(userId) {
  const dir = path.join(DATA_DIR, 'users', userId, 'scripts');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

module.exports = { DATA_DIR, getUserAudioDir, getUserScriptsDir };
