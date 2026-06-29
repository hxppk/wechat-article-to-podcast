const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const TTSProvider = require('./TTSProvider');
const { ProviderError } = require('../errors');
const { createSemaphore } = require('../../utils/semaphore');
const { parsePositiveInt } = require('../../utils/parsePositiveInt');
const {
  buildDialogueInputs, totalChars, chunkInputsByChars, isLikelyTruncated,
} = require('./dialogueUtils');

if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY || process.env.HTTP_PROXY));
}

const API_URL = 'https://api.elevenlabs.io/v1/text-to-dialogue';
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_v3';
const LANGUAGE = process.env.ELEVENLABS_LANGUAGE || 'cmn';
const OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128';
const VOICE_A = process.env.ELEVENLABS_VOICE_A || 'DowyQ68vDpgFYdWVGjc3';
const VOICE_B = process.env.ELEVENLABS_VOICE_B || 'ByhETIclHirOlWnWKhHc';
const SINGLE_SHOT_MAX = parsePositiveInt(process.env.ELEVENLABS_SINGLE_SHOT_MAX, 4500);
const CHUNK_CHARS = parsePositiveInt(process.env.ELEVENLABS_CHUNK_CHARS, 1800);
const STABILITY = process.env.ELEVENLABS_STABILITY;
const MAX_CONCURRENT = parsePositiveInt(process.env.ELEVENLABS_MAX_CONCURRENT, 1);
const RETRY = { maxRetries: 5, baseDelayMs: 4000, maxDelayMs: 60000 };

const semaphore = createSemaphore(MAX_CONCURRENT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class ElevenLabsTTS extends TTSProvider {
  constructor() {
    super();
    this.apiKey = process.env.ELEVENLABS_API_KEY;
    if (!this.apiKey) throw new ProviderError('ELEVENLABS_API_KEY 环境变量未设置');
  }

  getName() {
    return 'ElevenLabs (eleven_v3)';
  }

  /** 调用对话端点，返回 mp3 Buffer。长度类错误打 isValidation 标记。 */
  async callDialogue(inputs) {
    const body = { inputs, model_id: MODEL, language_code: LANGUAGE };
    if (STABILITY) body.settings = { stability: parseFloat(STABILITY), use_speaker_boost: true };
    const url = `${API_URL}?output_format=${encodeURIComponent(OUTPUT_FORMAT)}`;
    let lastError;
    for (let attempt = 1; attempt <= RETRY.maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'xi-api-key': this.apiKey, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.status === 401 || res.status === 403) {
          throw new ProviderError('ElevenLabs 鉴权失败，请检查 API key 与权限范围');
        }
        if (res.status === 400 || res.status === 422) {
          const t = await res.text();
          // 先识别需要直接上报、重试/降级都无用的错误（语音/模型/鉴权/额度/权限）。
          // 注意顺序：quota exceeded 含 "exceed" 必须先于长度分支命中。
          if (/voice|model|api[_\s-]?key|unauthor|quota|subscription|credit|insufficient|permission|forbidden/i.test(t)) {
            throw new ProviderError(`ElevenLabs 请求被拒绝 ${res.status}: ${t}`);
          }
          // 仅长度/字符上限类错误才打 isValidation 标记触发分块降级。
          if (/character|too\s*long|max(imum)?\s*length|length\s*limit|exceed/i.test(t)) {
            const e = new Error(`ElevenLabs 长度校验错误 ${res.status}: ${t}`);
            e.isValidation = true;
            throw e;
          }
          // 其它未知校验错误：上报真实原因，不做无意义的分块重试。
          throw new ProviderError(`ElevenLabs 请求校验失败 ${res.status}: ${t}`);
        }
        if (res.status === 429) throw new Error('ElevenLabs 限流(429)');
        if (!res.ok) throw new Error(`ElevenLabs 错误 ${res.status}: ${await res.text()}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length) throw new Error('ElevenLabs 返回空音频');
        return buf;
      } catch (err) {
        if (err instanceof ProviderError || err.isValidation) throw err;
        lastError = err;
        if (attempt < RETRY.maxRetries) {
          await sleep(Math.min(RETRY.baseDelayMs * 2 ** (attempt - 1), RETRY.maxDelayMs));
        }
      }
    }
    throw new Error(`ElevenLabs 合成失败(已重试 ${RETRY.maxRetries} 次): ${lastError && lastError.message}`);
  }

  async probeDurationMs(filePath) {
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);
      return Math.round(parseFloat(stdout.trim()) * 1000);
    } catch {
      return 0;
    }
  }

  async concatSegments(segPaths, outputPath, tmpDir) {
    const listPath = path.join(tmpDir, 'concat.txt');
    const lines = segPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listPath, lines);
    await execFileAsync('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath,
    ]);
  }

  async synthesizeChunked(inputs, outputPath, tmpDir) {
    const chunks = chunkInputsByChars(inputs, CHUNK_CHARS);
    if (chunks.length === 1) {
      const buf = await this.callDialogue(chunks[0]);
      fs.writeFileSync(outputPath, buf);
      return;
    }
    const segPaths = [];
    for (let i = 0; i < chunks.length; i++) {
      const buf = await this.callDialogue(chunks[i]);
      const p = path.join(tmpDir, `seg_${i}.mp3`);
      fs.writeFileSync(p, buf);
      segPaths.push(p);
    }
    await this.concatSegments(segPaths, outputPath, tmpDir);
  }

  /**
   * 把临时合成结果落到最终路径。仅在完整性校验/拼接全部成功后调用，
   * 保证失败时不会在 outputPath 留下半截文件。跨设备 rename 失败时回退到复制。
   * @param {string} tmpPath
   * @param {string} outputPath
   */
  finalizeOutput(tmpPath, outputPath) {
    try {
      fs.renameSync(tmpPath, outputPath);
    } catch (err) {
      if (err && err.code === 'EXDEV') {
        fs.copyFileSync(tmpPath, outputPath);
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      } else {
        throw err;
      }
    }
  }

  async synthesize(dialogues, outputPath, _options = {}) {
    if (!Array.isArray(dialogues) || dialogues.length === 0) {
      throw new Error('对话数据无效');
    }
    await semaphore.acquire();
    let tmpDir;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eleven-'));
      // 所有合成先写到临时输出，只有在校验/拼接成功后才搬到最终 outputPath，
      // 避免单次合成截断后又分块失败时留下被截断的最终文件。
      const tmpOut = path.join(tmpDir, 'output.mp3');
      const inputs = buildDialogueInputs(dialogues, { voiceA: VOICE_A, voiceB: VOICE_B });
      const total = totalChars(inputs);

      if (total <= SINGLE_SHOT_MAX) {
        let buf;
        try {
          buf = await this.callDialogue(inputs);
        } catch (err) {
          if (err.isValidation) {
            console.warn('[ElevenLabs] 单次合成校验错误，降级分块');
            await this.synthesizeChunked(inputs, tmpOut, tmpDir);
            this.finalizeOutput(tmpOut, outputPath);
            return;
          }
          throw err;
        }
        fs.writeFileSync(tmpOut, buf);
        const durMs = await this.probeDurationMs(tmpOut);
        // 仅在探测到“真实存在但明显偏短”的时长时才判定截断并降级。
        // 探测失败(durMs<=0)视为未知，不降级——否则 ffprobe 故障会被
        // 误判为截断而触发一次毫无必要的重新合成。
        if (durMs > 0 && isLikelyTruncated(durMs / 1000, total)) {
          console.warn('[ElevenLabs] 单次合成疑似截断，降级分块重试');
          await this.synthesizeChunked(inputs, tmpOut, tmpDir);
        }
        this.finalizeOutput(tmpOut, outputPath);
        return;
      }
      await this.synthesizeChunked(inputs, tmpOut, tmpDir);
      this.finalizeOutput(tmpOut, outputPath);
    } finally {
      try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      semaphore.release();
    }
  }
}

module.exports = ElevenLabsTTS;
