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

// 多角色声音配置 - 映射到 MultiSpeakerVoiceConfig 的 speaker name
const SPEAKER_VOICE_MAP = {
  // 新格式：直接使用 Speaker_A/Speaker_B
  'Speaker_A': { speakerName: 'Speaker_A', voiceName: 'Fenrir' },      // 老王
  'Speaker_B': { speakerName: 'Speaker_B', voiceName: 'Callirrhoe' },  // 小李
  // 兼容中文角色名
  '老王': { speakerName: 'Speaker_A', voiceName: 'Fenrir' },
  '小李': { speakerName: 'Speaker_B', voiceName: 'Callirrhoe' },
  '小墨': { speakerName: 'Speaker_A', voiceName: 'Achird' },
  '小夏': { speakerName: 'Speaker_B', voiceName: 'Callirrhoe' },
  // 兼容旧 JSON 格式
  'A': { speakerName: 'Speaker_A', voiceName: 'Fenrir' },
  'B': { speakerName: 'Speaker_B', voiceName: 'Callirrhoe' }
};

// 默认风格提示词：用于引导整体播客语气与互动节奏
const DEFAULT_STYLE_PROMPT = `
Create a realistic, conversational podcast in Mandarin Chinese.

1. Speaker_A (老王 - The Veteran):
   - Voice Identity: Male, deep, resonant. **Age: approx. 50 years old.**
   - Audio Quality: **Crystal clear studio recording, high fidelity, NO background static.**
   - Tone: Calm, steady, authoritative but relaxed.
   - Pacing: Thoughtful, slightly slower than Speaker B.
   - Note: Make the voice sound experienced but clean, not raspy.

2. Speaker_B (小李 - The Rookie):
   - Voice Identity: Female, clear, articulate, and engaging. **Age: approx. 28 years old.**
   - Tone: Curious, bright, but professional.
   - Interaction: Reacts quickly, asks questions with genuine interest.
   - Note: Callirrhoe usually sounds calm, so inject some energy and curiosity into her tone.

3. Environment:
   - **Soundproof Podcasting Studio.** (Professional recording environment)
   - Zero ambient noise, zero music.

4. Language: Mandarin Chinese (Colloquial & Natural).
`;

// 重试配置 - 增加延迟应对限流
const RETRY_CONFIG = {
  maxRetries: 5,
  baseDelayMs: 3000,
  maxDelayMs: 30000
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Gemini TTS 实现
 * 使用 Gemini 2.5 Flash TTS 的原生多角色功能，一次 API 调用生成完整音频
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
   * @param {Array<{speaker: string, text: string}>} dialogues
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
      lines.push(`${speakerName}: ${dialogue.text}`);
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
          model: 'gemini-2.5-flash-preview-tts',
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

        // 验证响应格式
        if (!response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
          throw new Error('TTS API 返回数据格式异常');
        }

        const audioData = response.candidates[0].content.parts[0].inlineData.data;
        const audioBuffer = Buffer.from(audioData, 'base64');
        fs.writeFileSync(outputPath, audioBuffer);

        console.log('TTS API 调用成功');
        return;
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
   * 合成完整播客 - 使用多角色一次性生成
   * @param {Array<{speaker: string, text: string}>} dialogues
   * @param {string} outputPath
   * @param {{stylePrompt?: string}} options
   */
  async synthesize(dialogues, outputPath, options = {}) {
    if (!Array.isArray(dialogues) || dialogues.length === 0) {
      throw new Error('对话数据无效');
    }

    console.log(`开始合成 ${dialogues.length} 段对话（多角色一次性生成）...`);

    // 转换为多角色格式
    const stylePrompt = options.stylePrompt || DEFAULT_STYLE_PROMPT;
    const { text, speakers } = this.convertToMultiSpeakerFormat(dialogues, stylePrompt);

    console.log(`角色配置: ${speakers.map(s => `${s.speaker}=${s.voiceName}`).join(', ')}`);
    console.log(`文本长度: ${text.length} 字符`);

    const tempDir = path.dirname(outputPath);
    const taskId = path.basename(outputPath, '.mp3');
    const pcmPath = path.join(tempDir, `${taskId}_raw.pcm`);

    try {
      // 一次性调用 API 生成完整音频
      await this.synthesizeWithRetry(text, speakers, pcmPath);

      // 转换为 MP3
      console.log('正在转换为 MP3 格式...');
      await execAsync(
        `ffmpeg -y -f s16le -ar 24000 -ac 1 -i "${pcmPath}" -codec:a libmp3lame -qscale:a 2 "${outputPath}"`
      );

      console.log(`音频已保存: ${outputPath}`);

      // 清理临时文件
      try {
        if (fs.existsSync(pcmPath)) fs.unlinkSync(pcmPath);
      } catch (e) { /* ignore */ }

    } catch (error) {
      // 清理临时文件
      try {
        if (fs.existsSync(pcmPath)) fs.unlinkSync(pcmPath);
      } catch (e) { /* ignore */ }

      if (error.message.includes('fetch failed')) {
        throw new Error('语音合成网络连接失败，请检查网络或代理设置后重试');
      }
      throw new Error(`语音合成失败: ${error.message}`);
    }
  }
}

module.exports = GeminiTTS;
