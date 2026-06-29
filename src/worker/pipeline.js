/**
 * 本地 worker 流水线
 *
 * 从旧 queue.js 的 processTask 搬来主体：抽取文章 → 生成脚本 → 合成音频。
 * 复用现有 ClaudeCliLLM / MiniMaxTTS / ElevenLabsTTS / articleExtractor（不改它们）。
 * 产出临时 mp3 + 元数据，由 worker.js 上传回云端后删除。
 *
 * 依赖可通过 deps 注入以便离线测试（mock extractArticle/llm/tts/ffprobe）。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuid } = require('uuid');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

/**
 * 用 ffprobe 获取音频时长（毫秒）
 * @param {string} audioPath
 * @returns {Promise<number>}
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

/**
 * 按名称创建 TTS Provider 实例（minimax | elevenlabs）
 * @param {string} name
 * @returns {object}
 */
function getTTSInstance(name) {
  const MiniMaxTTS = require('../services/tts/MiniMaxTTS');
  const ElevenLabsTTS = require('../services/tts/ElevenLabsTTS');

  switch ((name || 'minimax').toLowerCase()) {
    case 'elevenlabs':
      return new ElevenLabsTTS();
    case 'minimax':
    default:
      return new MiniMaxTTS();
  }
}

/**
 * 执行完整流水线
 * @param {object} task {sourceUrl, ttsProvider}
 * @param {object} opts
 * @param {(stage:string)=>any} [opts.onStage] - 阶段回调（parsing|generating|synthesizing）
 * @param {object} [opts.deps] - 可注入依赖（测试用）
 * @returns {Promise<{audioPath,script,summary,durationMs,fileSizeBytes,title,accountName}>}
 */
async function runPipeline({ sourceUrl, ttsProvider }, { onStage, deps } = {}) {
  const d = deps || {};
  const extractArticle = d.extractArticle
    || require('../services/articleExtractor').extractArticle;
  const llm = d.llm || require('../services/llm');
  const getTTS = d.getTTSInstance || getTTSInstance;
  const getDuration = d.getAudioDuration || getAudioDuration;
  const workDir = d.workDir || path.join(os.tmpdir(), 'wechat-podcast-worker');

  const report = async (stage) => {
    if (typeof onStage === 'function') await onStage(stage);
  };

  // Stage 1: 解析微信文章
  await report('parsing');
  const article = await extractArticle(sourceUrl);

  // Stage 2: 生成对话脚本
  await report('generating');
  const script = await llm.generateScript(article.text);

  // Stage 3: 合成语音（写临时 mp3）
  await report('synthesizing');
  if (!fs.existsSync(workDir)) {
    fs.mkdirSync(workDir, { recursive: true });
  }
  const audioPath = path.join(workDir, `${uuid()}.mp3`);
  const tts = getTTS(ttsProvider);
  await tts.synthesize(script.dialogues, audioPath);

  const durationMs = await getDuration(audioPath);
  const fileSizeBytes = fs.statSync(audioPath).size;

  return {
    audioPath,
    script,
    summary: script.summary || '',
    durationMs,
    fileSizeBytes,
    title: article.title,
    accountName: article.accountName,
  };
}

module.exports = { runPipeline, getTTSInstance, getAudioDuration };
