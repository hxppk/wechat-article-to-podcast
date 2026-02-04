const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const TTSProvider = require('./TTSProvider');

// 🔧 修复 Zeabur 环境下的 fetch 问题
// 使用 node-fetch 替代可能有问题的内置 fetch
const nodeFetch = require('node-fetch');
if (!globalThis.fetch) {
  globalThis.fetch = nodeFetch;
  globalThis.Headers = nodeFetch.Headers;
  globalThis.Request = nodeFetch.Request;
  globalThis.Response = nodeFetch.Response;
  console.log('TTS 模块: 使用 node-fetch 作为全局 fetch');
}

// 确保代理对 @google/genai 的 fetch 生效
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = require('undici');
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log('TTS 模块代理已配置:', proxyUrl);
}

// 多角色声音配置 - 统一使用 Charon + Callirrhoe
const SPEAKER_VOICE_MAP = {
  // Speaker_A (老王) → Charon
  'Speaker_A': { speakerName: 'Speaker_A', voiceName: 'Charon' },
  '老王': { speakerName: 'Speaker_A', voiceName: 'Charon' },
  'A': { speakerName: 'Speaker_A', voiceName: 'Charon' },
  // Speaker_B (小李) → Callirrhoe
  'Speaker_B': { speakerName: 'Speaker_B', voiceName: 'Callirrhoe' },
  '小李': { speakerName: 'Speaker_B', voiceName: 'Callirrhoe' },
  'B': { speakerName: 'Speaker_B', voiceName: 'Callirrhoe' }
};

// 默认风格提示词：用于引导整体播客语气与互动节奏
const DEFAULT_STYLE_PROMPT = `
Create a realistic, conversational podcast in Mandarin Chinese.

1. Speaker_A (老王 - Charon voice):
   - Voice Identity: Male, deep, resonant. **Age: approx. 50 years old.**
   - Audio Quality: **Crystal clear studio recording, high fidelity, NO background static.**
   - Tone: Calm, steady, authoritative but relaxed.
   - Pacing: Thoughtful, slightly slower than Speaker B.

2. Speaker_B (小李 - Callirrhoe voice):
   - Voice Identity: Female, clear, articulate, and engaging. **Age: approx. 28 years old.**
   - Tone: Curious, bright, but professional.
   - Interaction: Reacts quickly, asks questions with genuine interest.

3. Environment:
   - **Soundproof Podcasting Studio.** (Professional recording environment)
   - Zero ambient noise, zero music.

4. Language: Mandarin Chinese (Colloquial & Natural).

5. Pacing Rules:
   - Lines ending with "--" indicate an interruption: the speaker trails off as the next speaker cuts in.
   - For interruptions: minimal pause (<100ms), next speaker starts almost immediately.
   - Normal turn-taking: natural pause (200-300ms) between speakers.
`;

// 重试配置 - 增加延迟应对限流
const RETRY_CONFIG = {
  maxRetries: 5,
  baseDelayMs: 6000, // 增加基础延迟
  maxDelayMs: 60000  // 增加最大延迟
};

// Gemini TTS 长文本合成可能耗时较长，@google/genai 默认超时较短（约 1 分钟）。
// 这里把单次 API 调用的 HTTP 超时设置为更长时间（默认 10 分钟）。
const GEMINI_TTS_HTTP_TIMEOUT_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function isRawPcmMimeType(mimeType) {
  if (!mimeType) return false;
  const lower = mimeType.toLowerCase();
  return lower.includes('audio/l16') || lower.includes('pcm');
}

// 分段配置：当对话文本（不含 style prompt）超过 1000 字符时，自动分段合成
const DIALOGUE_SEGMENT_CONFIG = {
  minChars: 800,
  softMaxChars: 950, // 留余量，尽量把每段控制在 800~1000 之间
  hardMaxChars: 1000
};

// 分段合成时固定使用同一套 speakers 配置（Charon + Callirrhoe）
const FIXED_SPEAKERS = [
  { speaker: 'Speaker_A', voiceName: 'Charon' },
  { speaker: 'Speaker_B', voiceName: 'Callirrhoe' }
];

function normalizeSpeaker(rawSpeaker) {
  const speaker = typeof rawSpeaker === 'string' ? rawSpeaker.trim() : '';
  return speaker
    .replace(/^speaker_/i, 'Speaker_')
    .replace(/^Speaker_([ab])$/i, (_, letter) => `Speaker_${letter.toUpperCase()}`);
}

function getSpeakerConfig(rawSpeaker) {
  const normalizedSpeaker = normalizeSpeaker(rawSpeaker);
  return SPEAKER_VOICE_MAP[normalizedSpeaker] ||
    SPEAKER_VOICE_MAP[rawSpeaker] ||
    SPEAKER_VOICE_MAP['A'];
}

function formatDialogueLine(dialogue) {
  const config = getSpeakerConfig(dialogue?.speaker);
  let text = dialogue?.text ?? '';
  if (dialogue?.isInterrupt) {
    text = text + '--';
  }
  return `${config.speakerName}: ${text}`;
}

/**
 * Gemini TTS 实现
 * 使用 Gemini 2.5 Pro Preview TTS 的原生多角色功能，一次 API 调用生成完整音频
 */
class GeminiTTS extends TTSProvider {
  constructor() {
    super();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY 环境变量未设置');
    }
    this.client = new GoogleGenAI({ apiKey });
  }

  getName() {
    return 'Gemini TTS';
  }

  /**
   * 将对话数组转换为多角色文本格式
   * @param {Array<{speaker: string, text: string, isInterrupt?: boolean}>} dialogues
   * @param {string} stylePrompt
   * @returns {{text: string, speakers: Array<{speaker: string, voiceName: string}>}}
   */
  convertToMultiSpeakerFormat(dialogues, stylePrompt = '') {
    const usedSpeakers = new Map(); // 记录使用的角色 -> speakerName
    const lines = [];

    if (stylePrompt) {
      lines.push(stylePrompt.trim());
      lines.push('');
    }

    for (const dialogue of dialogues) {
      const rawSpeaker = typeof dialogue.speaker === 'string' ? dialogue.speaker.trim() : '';
      const config = getSpeakerConfig(rawSpeaker);
      const speakerName = config.speakerName;

      // 记录使用的角色
      if (!usedSpeakers.has(speakerName)) {
        usedSpeakers.set(speakerName, config.voiceName);
      }

      lines.push(formatDialogueLine(dialogue));
    }

    // 构建 speakers 配置
    const speakers = Array.from(usedSpeakers.entries()).map(([speaker, voiceName]) => ({
      speaker,
      voiceName
    }));

    return {
      text: lines.join('\n'),
      speakers
    };
  }

  /**
   * 带重试的多角色合成
   */
  async synthesizeWithRetry(text, speakers, outputPath) {
    let lastError = null;

    for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        console.log(`正在调用 Gemini TTS API (尝试 ${attempt}/${RETRY_CONFIG.maxRetries})...`);

        const response = await this.client.models.generateContent({
          model: 'gemini-2.5-pro-preview-tts',
          contents: [{ parts: [{ text }] }],
          config: {
            httpOptions: {
              timeout: GEMINI_TTS_HTTP_TIMEOUT_MS
            },
            responseModalities: ['AUDIO'],
            speechConfig: {
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: speakers.map(s => ({
                  speaker: s.speaker,
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: s.voiceName }
                  }
                }))
              }
            }
          }
        });

        const inlineData = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        // 验证响应格式
        if (!inlineData?.data) {
          throw new Error('TTS API 返回数据格式异常');
        }

        const mimeType = inlineData.mimeType || 'unknown';
        console.log(`TTS 输出 mimeType: ${mimeType}`);
        const audioData = inlineData.data;
        const audioBuffer = Buffer.from(audioData, 'base64');
        fs.writeFileSync(outputPath, audioBuffer);

        console.log('TTS API 调用成功');
        return { mimeType };
      } catch (error) {
        lastError = error;
        console.log(`TTS 错误详情: ${error.message}`);

        const isNetworkError = error.message.includes('fetch failed') ||
                               error.message.includes('ECONNRESET') ||
                               error.message.includes('ECONNREFUSED') ||
                               error.message.includes('ETIMEDOUT') ||
                               error.message.includes('timeout') ||
                               error.code === 'ECONNRESET';

        const isRateLimitError = error.message.includes('429') ||
                                 error.message.includes('RESOURCE_EXHAUSTED') ||
                                 error.message.includes('rate limit');

        if (attempt < RETRY_CONFIG.maxRetries && (isNetworkError || isRateLimitError)) {
          const delay = Math.min(
            RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1),
            RETRY_CONFIG.maxDelayMs
          );
          const reason = isRateLimitError ? '限流' : '网络错误';
          console.log(`${reason}，${delay / 1000}秒后重试...`);
          await sleep(delay);
        } else if (!isNetworkError && !isRateLimitError) {
          throw error;
        }
      }
    }

    throw new Error(`TTS 合成失败（已重试 ${RETRY_CONFIG.maxRetries} 次）: ${lastError.message}`);
  }

  /**
   * 计算对话文本长度（不包含 style prompt）
   * - 按 convertToMultiSpeakerFormat 的实际行格式估算
   */
  getDialoguesTextLength(dialogues) {
    if (!Array.isArray(dialogues) || dialogues.length === 0) return 0;
    let total = 0;
    for (const dialogue of dialogues) {
      const line = formatDialogueLine(dialogue);
      if (total > 0) total += 1; // '\n'
      total += line.length;
    }
    return total;
  }

  /**
   * 将对话按段落分段（不切断单个对话）
   * - 目标每段 800~1000 字符（不含 style prompt）
   * - 优先在完整对话之间切割
   * - 若单个对话超过 1000 字符，则单独作为一段
   */
  splitDialoguesIntoSegments(dialogues) {
    if (!Array.isArray(dialogues) || dialogues.length === 0) return [];

    const totalLen = this.getDialoguesTextLength(dialogues);
    if (totalLen <= DIALOGUE_SEGMENT_CONFIG.hardMaxChars) {
      return [dialogues];
    }

    const segments = [];
    let current = [];
    let currentLen = 0;

    const pushCurrent = () => {
      if (current.length > 0) {
        segments.push(current);
        current = [];
        currentLen = 0;
      }
    };

    for (const dialogue of dialogues) {
      const line = formatDialogueLine(dialogue);
      const lineLen = line.length;

      // 单个对话超长：直接单独一段（不切断）
      if (lineLen > DIALOGUE_SEGMENT_CONFIG.hardMaxChars) {
        pushCurrent();
        segments.push([dialogue]);
        continue;
      }

      if (current.length === 0) {
        current.push(dialogue);
        currentLen = lineLen;
        continue;
      }

      const additionalLen = 1 + lineLen; // '\n' + line
      const nextLen = currentLen + additionalLen;
      const wouldExceedHard = nextLen > DIALOGUE_SEGMENT_CONFIG.hardMaxChars;
      const wouldExceedSoft = nextLen > DIALOGUE_SEGMENT_CONFIG.softMaxChars;

      if (wouldExceedHard || (currentLen >= DIALOGUE_SEGMENT_CONFIG.minChars && wouldExceedSoft)) {
        pushCurrent();
        current.push(dialogue);
        currentLen = lineLen;
        continue;
      }

      current.push(dialogue);
      currentLen = nextLen;
    }

    pushCurrent();
    return segments;
  }

  async convertToMp3(tempAudioPath, mimeType, outputPath) {
    const needsRawInput = isRawPcmMimeType(mimeType);
    const ffmpegInput = needsRawInput
      ? `-f s16le -ar 24000 -ac 1 -i "${tempAudioPath}"`
      : `-i "${tempAudioPath}"`;

    await execAsync(
      `ffmpeg -y ${ffmpegInput} -codec:a libmp3lame -qscale:a 2 "${outputPath}"`
    );
  }

  /**
   * 合成完整播客 - 一次性生成完整音频
   * @param {Array<{speaker: string, text: string, isInterrupt?: boolean}>} dialogues
   * @param {string} outputPath
   * @param {{stylePrompt?: string}} options
   */
  async synthesize(dialogues, outputPath, options = {}) {
    if (!Array.isArray(dialogues) || dialogues.length === 0) {
      throw new Error('对话数据无效');
    }

    const stylePrompt = options.stylePrompt || DEFAULT_STYLE_PROMPT;
    const dialogueTextLength = this.getDialoguesTextLength(dialogues);
    const segments = this.splitDialoguesIntoSegments(dialogues);

    console.log(`开始合成 ${dialogues.length} 段对话...`);
    console.log(`  - 对话文本长度(不含 style prompt): ${dialogueTextLength} 字符`);
    console.log(`  - 分段数量: ${segments.length}`);

    try {
      // 单段：沿用原流程（一次 API 调用 + 转 MP3）
      if (segments.length <= 1) {
        const { text } = this.convertToMultiSpeakerFormat(dialogues, stylePrompt);
        console.log('  - 模式: 单段合成');
        console.log(`  - 输入总长度(含 style prompt): ${text.length} 字符`);

        const tempDir = path.dirname(outputPath);
        const taskId = path.basename(outputPath, '.mp3');
        const tempAudioPath = path.join(tempDir, `${taskId}_raw.bin`);

        try {
          const { mimeType } = await this.synthesizeWithRetry(text, FIXED_SPEAKERS, tempAudioPath);
          console.log('正在转换为 MP3 格式...');
          await this.convertToMp3(tempAudioPath, mimeType, outputPath);
          console.log(`音频已保存: ${outputPath}`);
        } finally {
          try {
            if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
          } catch (e) { /* ignore */ }
        }

        return;
      }

      // 多段：每段独立调用 API，然后用 ffmpeg concat 拼接
      console.log('  - 模式: 分段合成 + 拼接');
      const tempDir = path.dirname(outputPath);
      const taskId = path.basename(outputPath, '.mp3');
      const workDir = fs.mkdtempSync(path.join(tempDir, `${taskId}_tts_`));

      const segmentMp3Files = [];
      try {
        for (let i = 0; i < segments.length; i++) {
          const segmentDialogues = segments[i];
          const segmentIndex = String(i + 1).padStart(4, '0');
          const rawPath = path.join(workDir, `segment_${segmentIndex}.bin`);
          const mp3Path = path.join(workDir, `segment_${segmentIndex}.mp3`);

          const segmentDialogueLen = this.getDialoguesTextLength(segmentDialogues);
          const { text } = this.convertToMultiSpeakerFormat(segmentDialogues, stylePrompt);

          console.log(`正在合成分段 ${i + 1}/${segments.length}...`);
          console.log(`  - 分段对话长度(不含 style prompt): ${segmentDialogueLen} 字符`);

          const { mimeType } = await this.synthesizeWithRetry(text, FIXED_SPEAKERS, rawPath);
          await this.convertToMp3(rawPath, mimeType, mp3Path);

          segmentMp3Files.push(mp3Path);

          try {
            if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
          } catch (e) { /* ignore */ }
        }

        const concatListPath = path.join(workDir, 'concat.txt');
        const concatListContent = segmentMp3Files
          .map(p => `file '${path.basename(p)}'`)
          .join('\n') + '\n';
        fs.writeFileSync(concatListPath, concatListContent);

        console.log('正在使用 ffmpeg concat 拼接 MP3...');
        await execAsync(
          `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${outputPath}"`
        );

        console.log(`音频已保存: ${outputPath}`);
      } finally {
        try {
          if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
        } catch (e) { /* ignore */ }
      }
    } catch (error) {
      if (error.message.includes('fetch failed')) {
        throw new Error('语音合成网络连接失败，请检查网络或代理设置后重试');
      }
      throw new Error(`语音合成失败: ${error.message}`);
    }
  }
}

module.exports = GeminiTTS;
