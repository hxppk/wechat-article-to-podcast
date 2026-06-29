/**
 * 任务队列 (v2.0)
 * 使用用户隔离目录和 SQLite 存储
 */
const { v4: uuid } = require('uuid');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { extractArticle } = require('./articleExtractor');
const { calculateEta, formatEta } = require('./eta');
const { isDisplayableError } = require('./errors');
const podcasts = require('../db/podcasts');

/**
 * 使用 ffprobe 获取音频时长（毫秒）
 * @param {string} audioPath - 音频文件路径
 * @returns {Promise<number>} 时长（毫秒）
 */
async function getAudioDuration(audioPath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ]);
    const seconds = parseFloat(stdout.trim());
    return Math.round(seconds * 1000);
  } catch (err) {
    console.warn('获取音频时长失败:', err.message);
    return 0;
  }
}

const DATA_DIR = path.join(__dirname, '../../data');

/**
 * 根据错误类型解析用户展示消息（可展示错误透传 message，否则用通用文案）
 * @param {Error} error - 错误对象
 * @returns {string} 用户展示消息
 */
function resolveErrorMessage(error) {
  return isDisplayableError(error) ? error.message : '处理过程中发生错误，请重试';
}

/**
 * 获取用户的音频目录
 * @param {string} userId - 用户 ID
 * @returns {string} 目录路径
 */
function getUserAudioDir(userId) {
  const dir = path.join(DATA_DIR, 'users', userId, 'audio');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 获取用户的脚本目录
 * @param {string} userId - 用户 ID
 * @returns {string} 目录路径
 */
function getUserScriptsDir(userId) {
  const dir = path.join(DATA_DIR, 'users', userId, 'scripts');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 保存原始脚本到本地（用于人工优化）
 * @param {string} taskId - 任务 ID
 * @param {string} rawScript - 原始脚本文本
 * @param {string} prompt - 生成时使用的 prompt（可选）
 */
function saveRawScript(taskId, rawScript, prompt = null) {
  try {
    const rawScriptsDir = path.join(DATA_DIR, 'raw-scripts');
    if (!fs.existsSync(rawScriptsDir)) {
      fs.mkdirSync(rawScriptsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${taskId}_${timestamp}.txt`;
    const filePath = path.join(rawScriptsDir, fileName);

    let content = '';
    if (prompt) {
      content += '=== PROMPT ===\n';
      content += prompt + '\n\n';
    }
    content += '=== RAW SCRIPT ===\n';
    content += rawScript;

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`[${taskId}] 原始脚本已保存: ${fileName}`);
  } catch (err) {
    console.warn(`[${taskId}] 保存原始脚本失败:`, err.message);
  }
}

// 状态文本映射
const STATUS_TEXT = {
  pending: '等待处理',
  parsing: '正在解析文章',
  generating: '正在生成对话脚本',
  synthesizing: '正在合成语音',
  completed: '处理完成',
  failed: '处理失败'
};

class TaskQueue {
  constructor(maxConcurrent = 3) {
    this.tasks = new Map();
    this.running = 0;
    this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT_TASKS) || maxConcurrent;
    this.queue = [];

    // LLM 服务（延迟加载）；TTS 按任务动态选取，见 getTTSInstance()
    this.llm = null;
  }

  /**
   * 初始化服务（延迟加载避免循环依赖）
   */
  async initServices() {
    if (!this.llm) {
      const llmModule = require('./llm');
      this.llm = llmModule.default || llmModule;
    }
  }

  /**
   * 创建任务
   * @param {string} articleUrl - 微信文章 URL
   * @param {string} userId - 用户 ID（v1.5 新增）
   * @param {Object} options - 可选参数
   * @param {string} options.ttsProvider - TTS 供应商 (minimax | elevenlabs)
   */
  createTask(articleUrl, userId = 'public', options = {}) {
    const task = {
      id: uuid(),
      status: 'pending',
      articleUrl,
      userId,           // v1.5 新增
      ttsProvider: options.ttsProvider || 'minimax',
      title: null,
      accountName: null,
      createdAt: Date.now(),
      stageStartedAt: Date.now(),
      error: null
    };

    this.tasks.set(task.id, task);
    this.queue.push(task.id);
    this.processNext();

    return task.id;
  }

  /**
   * 获取任务状态（含 ETA）
   */
  getStatus(id) {
    const task = this.tasks.get(id);
    if (!task) return null;

    const etaSeconds = calculateEta(task);

    return {
      id: task.id,
      status: task.status,
      statusText: STATUS_TEXT[task.status] || task.status,
      title: task.title,
      accountName: task.accountName,
      etaSeconds,
      etaText: formatEta(etaSeconds),
      error: task.error
    };
  }

  /**
   * 处理下一个任务
   */
  async processNext() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) return;

    this.running++;
    const taskId = this.queue.shift();

    try {
      await this.processTask(taskId);
    } catch (error) {
      console.error(`任务 ${taskId} 失败:`, error);
      const errorMessage = resolveErrorMessage(error);
      this.updateStatus(taskId, 'failed', errorMessage);
    } finally {
      this.running--;
      this.processNext();
    }
  }

  /**
   * 处理单个任务
   */
  async processTask(taskId) {
    const task = this.tasks.get(taskId);
    await this.initServices();

    // Stage 1: 解析微信文章
    this.updateStatus(taskId, 'parsing');
    console.log(`[${taskId}] 开始解析微信文章...`);
    const articleData = await extractArticle(task.articleUrl);

    // 保存文章信息到任务
    task.title = articleData.title;
    task.accountName = articleData.accountName;

    // Stage 2: 生成对话脚本
    this.updateStatus(taskId, 'generating');
    console.log(`[${taskId}] 使用 ${this.llm.getName()} 生成脚本...`);
    const script = await this.llm.generateScript(articleData.text);

    // 保存原始脚本（用于人工优化）
    saveRawScript(taskId, script.raw);

    // v2.0: 使用用户目录
    const audioDir = getUserAudioDir(task.userId);
    const scriptsDir = getUserScriptsDir(task.userId);

    // 保存脚本
    const scriptPath = path.join(scriptsDir, `${taskId}.json`);
    fs.writeFileSync(scriptPath, JSON.stringify({
      raw: script.raw,
      dialogues: script.dialogues,
      generatedAt: Date.now()
    }, null, 2));

    // Stage 3: 合成语音
    this.updateStatus(taskId, 'synthesizing');
    const tts = this.getTTSInstance(task.ttsProvider);
    console.log(`[${taskId}] 使用 ${tts.getName()} 合成音频...`);
    const audioPath = path.join(audioDir, `${taskId}.mp3`);
    await tts.synthesize(script.dialogues, audioPath);

    // 获取文件大小和时长信息
    const stat = fs.statSync(audioPath);
    const durationMs = await getAudioDuration(audioPath);
    console.log(`[${taskId}] 音频时长: ${Math.round(durationMs / 1000)}秒`);

    // Stage 4: 保存到 SQLite
    podcasts.create({
      id: taskId,
      userId: task.userId,
      sourceUrl: task.articleUrl,
      title: articleData.title,
      accountName: articleData.accountName,
      durationMs,
      fileSizeBytes: stat.size,
      summary: script.summary || '',
      scriptPreview: script.raw.substring(0, 500),
      audioPath,
      scriptPath
    });

    // 完成
    this.updateStatus(taskId, 'completed');
    console.log(`[${taskId}] 处理完成`);
  }

  /**
   * 按名称创建 TTS Provider 实例
   * @param {string} name - Provider 名称 (minimax | elevenlabs)
   * @returns {TTSProvider}
   */
  getTTSInstance(name) {
    const MiniMaxTTS = require('./tts/MiniMaxTTS');
    const ElevenLabsTTS = require('./tts/ElevenLabsTTS');

    switch ((name || 'minimax').toLowerCase()) {
      case 'elevenlabs':
        return new ElevenLabsTTS();
      case 'minimax':
      default:
        return new MiniMaxTTS();
    }
  }

  updateStatus(taskId, status, error = null) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      task.stageStartedAt = Date.now();
      task.error = error;
    }
  }

  /**
   * 获取队列信息
   */
  getQueueInfo() {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent
    };
  }
}

module.exports = new TaskQueue();
module.exports.resolveErrorMessage = resolveErrorMessage;
