const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const TTSProvider = require('./TTSProvider');

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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function isRawPcmMimeType(mimeType) {
  if (!mimeType) return false;
  const lower = mimeType.toLowerCase();
  return lower.includes('audio/l16') || lower.includes('pcm');
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
      const normalizedSpeaker = rawSpeaker
        .replace(/^speaker_/i, 'Speaker_')
        .replace(/^Speaker_([ab])$/i, (_, letter) => `Speaker_${letter.toUpperCase()}`);
      const config = SPEAKER_VOICE_MAP[normalizedSpeaker] ||
        SPEAKER_VOICE_MAP[rawSpeaker] ||
        SPEAKER_VOICE_MAP['A'];
      const speakerName = config.speakerName;

      // 记录使用的角色
      if (!usedSpeakers.has(speakerName)) {
        usedSpeakers.set(speakerName, config.voiceName);
      }

      // 格式化为 "Speaker_X: 文本" 格式
      // 如果是插嘴场景，保留 -- 标记影响 TTS 节奏
      let text = dialogue.text;
      if (dialogue.isInterrupt) {
        text = text + '--';
      }
      lines.push(`${speakerName}: ${text}`);
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
    const { text, speakers } = this.convertToMultiSpeakerFormat(dialogues, stylePrompt);
    console.log(`开始合成 ${dialogues.length} 段对话（一次性生成）...`);
    console.log(`  - 文本长度: ${text.length} 字符`);

    const tempDir = path.dirname(outputPath);
    const taskId = path.basename(outputPath, '.mp3');
    const tempAudioPath = path.join(tempDir, `${taskId}_raw.bin`);

    try {
      const { mimeType } = await this.synthesizeWithRetry(text, speakers, tempAudioPath);
      const needsRawInput = isRawPcmMimeType(mimeType);
      const ffmpegInput = needsRawInput
        ? `-f s16le -ar 24000 -ac 1 -i "${tempAudioPath}"`
        : `-i "${tempAudioPath}"`;

      console.log('正在转换为 MP3 格式...');
      await execAsync(
        `ffmpeg -y ${ffmpegInput} -codec:a libmp3lame -qscale:a 2 "${outputPath}"`
      );
      console.log(`音频已保存: ${outputPath}`);
    } catch (error) {
      if (error.message.includes('fetch failed')) {
        throw new Error('语音合成网络连接失败，请检查网络或代理设置后重试');
      }
      throw new Error(`语音合成失败: ${error.message}`);
    } finally {
      try {
        if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
      } catch (e) { /* ignore */ }
    }
  }
}

module.exports = GeminiTTS;
