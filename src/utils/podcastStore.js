const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const DATA_DIR = path.join(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'podcasts.json');

// 确保数据目录存在
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * 读取播客列表
 */
function readPodcasts() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('读取播客列表失败:', error.message);
    return [];
  }
}

/**
 * 保存播客列表
 */
function savePodcasts(podcasts) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(podcasts, null, 2));
}

/**
 * 获取音频时长（毫秒）
 * 使用 ffprobe 读取
 */
async function getAudioDuration(audioPath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`
    );
    const seconds = parseFloat(stdout.trim());
    return Math.round(seconds * 1000);
  } catch (error) {
    console.error('获取音频时长失败:', error.message);
    return 0;
  }
}

/**
 * 获取文件大小（字节）
 */
function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (error) {
    return 0;
  }
}

/**
 * 生成脚本摘要（前 150-200 字）
 * 去除 Markdown 代码块、说话人标签，提取纯文本简介
 */
function generateScriptPreview(scriptText) {
  if (!scriptText || typeof scriptText !== 'string') {
    return '';
  }

  let text = scriptText;

  // 1. 去除 Markdown 代码块包裹 (```json ... ``` 或 ``` ... ```)
  text = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();

  // 2. 尝试解析 JSON 数组格式的对话
  if (text.startsWith('[')) {
    try {
      const dialogues = JSON.parse(text);
      if (Array.isArray(dialogues) && dialogues.length > 0) {
        // 提取前几条对话的文本内容
        const previewTexts = dialogues
          .slice(0, 5) // 取前 5 条对话
          .map(d => d.text || '')
          .filter(t => t.length > 0);
        text = previewTexts.join(' ');
      }
    } catch (e) {
      // JSON 解析失败，继续使用原始文本
    }
  }

  // 3. 清理文本
  return text
    .replace(/老王[:：]|小李[:：]|小墨[:：]|小夏[:：]|小明[:：]|小红[:：]|A[:：]|B[:：]/gi, '')
    .replace(/Speaker_[AB][:：]/gi, '')                // 去除 Speaker_A/B 标签
    .replace(/\[.*?\]/g, '')                           // 去除非语言标记如 [笑]
    .replace(/["「」'']/g, '')                          // 去除引号
    .replace(/\s+/g, ' ')                              // 压缩空白
    .trim()
    .substring(0, 180);                                // 取前 180 字
}

/**
 * 添加播客记录
 * @param {string} id - 任务 ID
 * @param {string} sourceFileName - 文章标题
 * @param {string} scriptText - 脚本内容
 * @param {string} audioPath - 音频文件路径
 * @param {string} scriptPath - 脚本文件路径
 * @param {string} sourceUrl - 原始文章 URL
 * @param {string} accountName - 公众号名称
 * @param {string} summary - LLM 生成的简介
 * @param {string} userId - 用户 ID（v1.5 新增）
 */
async function addPodcast(id, sourceFileName, scriptText, audioPath, scriptPath, sourceUrl = '', accountName = '', summary = '', userId = 'public') {
  const podcasts = readPodcasts();

  // 生成元数据字段
  const durationMs = await getAudioDuration(audioPath);
  const fileSizeBytes = getFileSize(audioPath);
  const scriptPreview = generateScriptPreview(scriptText);

  const metadata = {
    id,
    userId,                           // v1.5 新增
    sourceUrl,
    sourceFileName,
    accountName,
    title: `${sourceFileName} 的音频概览`,
    generatedAt: Date.now(),
    status: 'completed',
    durationMs,
    fileSizeBytes,
    summary: summary || '',           // LLM 生成的简介
    scriptPreview,                    // 兜底简介（从脚本提取）
    audioPath: `data/audio/${id}.mp3`,
    scriptPath: `data/scripts/${id}.json`
  };

  podcasts.unshift(metadata); // 新的在前
  savePodcasts(podcasts);

  console.log(`播客元数据已保存: ${id}, 用户${userId}, 时长${Math.round(durationMs/1000)}秒, 大小${Math.round(fileSizeBytes/1024)}KB`);

  return metadata;
}

/**
 * 获取单个播客
 * @param {string} id - 播客 ID
 * @param {string} userId - 用户 ID（v1.5 新增，可选）
 */
function getPodcast(id, userId = null) {
  const podcasts = readPodcasts();
  const podcast = podcasts.find(p => p.id === id);

  if (!podcast) return null;

  // v1.5: 如果提供了 userId，校验归属
  if (userId !== null && podcast.userId !== userId) {
    return null;
  }

  return podcast;
}

/**
 * 获取所有播客
 */
function getAllPodcasts() {
  return readPodcasts();
}

/**
 * 获取指定用户的播客列表（v1.5 新增）
 * @param {string} userId - 用户 ID
 */
function getByUserId(userId) {
  const podcasts = readPodcasts();
  return podcasts.filter(p => p.userId === userId);
}

/**
 * 删除播客
 * @param {string} id - 播客 ID
 * @param {string} userId - 用户 ID（v1.5 新增，可选）
 */
function deletePodcast(id, userId = null) {
  const podcasts = readPodcasts();
  const index = podcasts.findIndex(p => p.id === id);

  if (index === -1) return false;

  const podcast = podcasts[index];

  // v1.5: 如果提供了 userId，校验归属
  if (userId !== null && podcast.userId !== userId) {
    return false;
  }

  podcasts.splice(index, 1);
  savePodcasts(podcasts);

  // 删除关联文件
  try {
    const audioFile = path.join(__dirname, '../../', podcast.audioPath);
    const scriptFile = path.join(__dirname, '../../', podcast.scriptPath);
    if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);
    if (fs.existsSync(scriptFile)) fs.unlinkSync(scriptFile);
  } catch (e) {
    console.error('删除文件失败:', e.message);
  }

  return true;
}

module.exports = {
  addPodcast,
  getPodcast,
  getAllPodcasts,
  getByUserId,      // v1.5 新增
  deletePodcast,
  getAudioDuration,
  generateScriptPreview
};
