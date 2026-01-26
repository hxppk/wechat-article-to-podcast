/**
 * 任务队列 (v2.0)
 * 使用用户隔离目录和 SQLite 存储
 */
const { v4: uuid } = require('uuid');
const path = require('path');
const fs = require('fs');
const { extractArticle, ValidationError } = require('./articleExtractor');
const { calculateEta, formatEta } = require('./eta');
const podcasts = require('../db/podcasts');

const DATA_DIR = path.join(__dirname, '../../data');

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

    // LLM 和 TTS 服务（延迟加载）
    this.llm = null;
    this.tts = null;
  }

  /**
   * 初始化服务（延迟加载避免循环依赖）
   */
  async initServices() {
    if (!this.llm) {
      const llmModule = require('./llm');
      this.llm = llmModule.default || llmModule;
    }
    if (!this.tts) {
      const ttsModule = require('./tts');
      this.tts = ttsModule.default || ttsModule;
    }
  }

  /**
   * 创建任务
   * @param {string} articleUrl - 微信文章 URL
   * @param {string} userId - 用户 ID（v1.5 新增）
   */
  createTask(articleUrl, userId = 'public') {
    const task = {
      id: uuid(),
      status: 'pending',
      articleUrl,
      userId,           // v1.5 新增
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
      const errorMessage = error instanceof ValidationError
        ? error.message
        : '处理过程中发生错误，请重试';
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
    console.log(`[${taskId}] 使用 ${this.tts.getName()} 合成音频...`);
    const audioPath = path.join(audioDir, `${taskId}.mp3`);
    await this.tts.synthesize(script.dialogues, audioPath);

    // 获取文件大小和时长信息
    const stat = fs.statSync(audioPath);

    // Stage 4: 保存到 SQLite
    podcasts.create({
      id: taskId,
      userId: task.userId,
      sourceUrl: task.articleUrl,
      title: articleData.title,
      accountName: articleData.accountName,
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
