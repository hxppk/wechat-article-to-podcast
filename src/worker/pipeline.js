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
 * @param {(stage:string)=>any} [opts.onStage] - 阶段回调（parsing|generating|synthesizing）；
 *   返回 false 视为 lease 丢失，立即抛 LeaseLostError 中止后续阶段与上传。
 * @param {()=>boolean} [opts.isCancelled] - 取消标志（如心跳被拒）；为真则抛 LeaseLostError。
 * @param {object} [opts.deps] - 可注入依赖（测试用）
 * @returns {Promise<{audioPath,script,summary,durationMs,fileSizeBytes,title,accountName}>}
 */
async function runPipeline({ sourceUrl, ttsProvider }, { onStage, isCancelled, deps } = {}) {
  const { LeaseLostError } = require('../services/errors');
  const d = deps || {};
  const extractArticle = d.extractArticle
    || require('../services/articleExtractor').extractArticle;
  const llm = d.llm || require('../services/llm');
  const getTTS = d.getTTSInstance || getTTSInstance;
  const getDuration = d.getAudioDuration || getAudioDuration;
  const workDir = d.workDir || path.join(os.tmpdir(), 'wechat-podcast-worker');

  // 取消检查：心跳被拒等情况下尽快停止，不再烧 Claude/TTS。
  const ensureAlive = () => {
    if (typeof isCancelled === 'function' && isCancelled()) {
      throw new LeaseLostError();
    }
  };

  const report = async (stage) => {
    ensureAlive();
    if (typeof onStage === 'function') {
      const ok = await onStage(stage);
      // 阶段上报被云端拒（409）→ lease 丢失，中止流水线。
      if (ok === false) throw new LeaseLostError();
    }
    ensureAlive();
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

  // TTS 失败（或取消）时清理临时音频，避免 workDir 残留孤儿文件。
  try {
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
  } catch (err) {
    try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch { /* ignore */ }
    throw err;
  }
}

module.exports = { runPipeline, getTTSInstance, getAudioDuration };
