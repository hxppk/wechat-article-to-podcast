const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const TTSProvider = require('./TTSProvider');
const { processDialogues } = require('./prosodyProcessor');

// 代理配置
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = require('undici');
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log('MiniMax TTS 模块代理已配置:', proxyUrl);
}

const API_URL = 'https://api.minimaxi.com/v1/t2a_v2';
const MODEL = 'speech-2.8-hd';

// 重试配置
const RETRY_CONFIG = {
  maxRetries: 5,
  baseDelayMs: 3000,
  maxDelayMs: 30000
};

// 音频采样率 & 码率
const AUDIO_SAMPLE_RATE = 32000;
const AUDIO_BITRATE = 128000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 根据对话上下文计算两段之间的静音间隔（毫秒）
 * @param {Object} prevDialogue - 上一句对话
 * @param {Object} currentDialogue - 当前对话
 * @returns {number} 静音间隔（毫秒）
 */
function calculateSilenceGap(prevDialogue, currentDialogue) {
  if (!prevDialogue) return 0;

  // 打断场景：极短间隔
  if (prevDialogue.isInterrupt) return 40;

  // 短回应（少于 10 字）
  if (currentDialogue.text.length < 10) return 80;

  // 回应提问（上一句以问号结尾）
  if (/[？?]$/.test(prevDialogue.text)) return 350;

  // 默认正常轮换
  return 200;
}

/**
 * 将对话数组按"连续同角色发言"分组
 * @param {Array} dialogues
 * @returns {Array<{speaker: string, dialogues: Array, text: string}>} 分组结果
 */
function groupDialoguesByTurn(dialogues) {
  const groups = [];
  let current = null;

  for (const dialogue of dialogues) {
    const speaker = normalizeSpeaker(dialogue.speaker);

    if (!current || current.speaker !== speaker) {
      if (current) groups.push(current);
      current = {
        speaker,
        dialogues: [dialogue],
        text: dialogue.text
      };
    } else {
      current.dialogues.push(dialogue);
      current.text += '\n' + dialogue.text;
    }
  }

  if (current) groups.push(current);
  return groups;
}

function normalizeSpeaker(rawSpeaker) {
  const s = typeof rawSpeaker === 'string' ? rawSpeaker.trim() : '';
  if (/^Speaker_A$/i.test(s) || s === '老王' || s === 'A' || s === '小墨') return 'Speaker_A';
  if (/^Speaker_B$/i.test(s) || s === '小李' || s === 'B' || s === '小夏') return 'Speaker_B';
  return 'Speaker_A';
}

/**
 * MiniMax TTS 实现
 * 使用 MiniMax Speech-2.8-HD 进行逐轮合成 + FFmpeg 拼接
 */
class MiniMaxTTS extends TTSProvider {
  constructor() {
    super();
    this.apiKey = process.env.MINIMAX_API_KEY;
    if (!this.apiKey) {
      throw new Error('MINIMAX_API_KEY 环境变量未设置');
    }

    // 声音配置
    this.voices = {
      Speaker_A: {
        voice_id: process.env.MINIMAX_VOICE_A || 'Chinese (Mandarin)_Southern_Young_Man',
        emotion: 'calm'
      },
      Speaker_B: {
        voice_id: process.env.MINIMAX_VOICE_B || 'Chinese (Mandarin)_Crisp_Girl',
        emotion: 'happy'
      }
    };
  }

  getName() {
    return 'MiniMax TTS';
  }

  /**
   * 调用 MiniMax TTS API 合成单段音频
   * @param {string} text - 要合成的文本
   * @param {string} voiceId - 声音 ID
   * @param {string} emotion - 情绪
   * @param {string} outputPath - 输出文件路径
   * @returns {Promise<{durationMs: number}>}
   */
  async synthesizeSegment(text, voiceId, emotion, outputPath) {
    const body = {
      model: MODEL,
      text,
      stream: false,
      voice_setting: {
        voice_id: voiceId,
        speed: 1.0,
        vol: 1.0,
        pitch: 0,
        emotion: emotion || 'happy'
      },
      audio_setting: {
        sample_rate: AUDIO_SAMPLE_RATE,
        bitrate: AUDIO_BITRATE,
        format: 'mp3',
        channel: 1
      }
    };

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MiniMax API 请求失败 (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    if (result.base_resp && result.base_resp.status_code !== 0) {
      throw new Error(`MiniMax API 错误: ${result.base_resp.status_msg || JSON.stringify(result.base_resp)}`);
    }

    const audioHex = result.data?.audio;
    if (!audioHex) {
      throw new Error('MiniMax API 未返回音频数据');
    }

    const audioBuffer = Buffer.from(audioHex, 'hex');
    fs.writeFileSync(outputPath, audioBuffer);

    const durationMs = result.extra_info?.audio_length || 0;
    return { durationMs };
  }

  /**
   * 带重试的单段合成
   */
  async synthesizeSegmentWithRetry(text, voiceId, emotion, outputPath) {
    let lastError = null;

    for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        return await this.synthesizeSegment(text, voiceId, emotion, outputPath);
      } catch (error) {
        lastError = error;
        console.log(`MiniMax TTS 错误 (尝试 ${attempt}/${RETRY_CONFIG.maxRetries}): ${error.message}`);

        const isRetryable = error.message.includes('429') ||
                            error.message.includes('rate limit') ||
                            error.message.includes('fetch failed') ||
                            error.message.includes('ECONNRESET') ||
                            error.message.includes('ETIMEDOUT') ||
                            error.message.includes('timeout');

        if (attempt < RETRY_CONFIG.maxRetries && isRetryable) {
          const delay = Math.min(
            RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1),
            RETRY_CONFIG.maxDelayMs
          );
          console.log(`${delay / 1000}秒后重试...`);
          await sleep(delay);
        } else if (!isRetryable) {
          throw error;
        }
      }
    }

    throw new Error(`MiniMax TTS 合成失败（已重试 ${RETRY_CONFIG.maxRetries} 次）: ${lastError.message}`);
  }

  /**
   * 生成指定时长的静音 MP3
   */
  async generateSilence(durationMs, outputPath) {
    const durationSec = durationMs / 1000;
    await execAsync(
      `ffmpeg -y -f lavfi -i anullsrc=r=${AUDIO_SAMPLE_RATE}:cl=mono -t ${durationSec} -codec:a libmp3lame -b:a ${AUDIO_BITRATE / 1000}k "${outputPath}"`
    );
  }

  /**
   * 裁剪音频尾部静音
   */
  async trimTrailingSilence(inputPath, outputPath) {
    try {
      await execAsync(
        `ffmpeg -y -i "${inputPath}" -af "areverse,silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB,areverse" "${outputPath}"`
      );
    } catch (err) {
      // 裁剪失败时使用原文件
      console.warn(`裁剪尾部静音失败，使用原文件: ${err.message}`);
      if (inputPath !== outputPath) {
        fs.copyFileSync(inputPath, outputPath);
      }
    }
  }

  /**
   * 合成完整播客
   * @param {Array<{speaker: string, text: string, isInterrupt?: boolean}>} dialogues
   * @param {string} outputPath
   */
  async synthesize(dialogues, outputPath) {
    if (!Array.isArray(dialogues) || dialogues.length === 0) {
      throw new Error('对话数据无效');
    }

    // 韵律标记后处理
    dialogues = processDialogues(dialogues);

    // 按连续同角色发言分组
    const groups = groupDialoguesByTurn(dialogues);

    console.log(`开始 MiniMax TTS 合成 ${dialogues.length} 段对话...`);
    console.log(`  - 分组数量: ${groups.length}`);
    console.log(`  - 总字符数: ${dialogues.reduce((sum, d) => sum + d.text.length, 0)}`);

    const tempDir = path.dirname(outputPath);
    const taskId = path.basename(outputPath, '.mp3');
    const workDir = fs.mkdtempSync(path.join(tempDir, `${taskId}_minimax_`));

    try {
      const filesToConcat = [];
      let prevDialogue = null;

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const voiceConfig = this.voices[group.speaker] || this.voices.Speaker_A;

        // 计算与前一组之间的静音间隔
        if (prevDialogue) {
          const firstDialogueOfGroup = group.dialogues[0];
          const gapMs = calculateSilenceGap(prevDialogue, firstDialogueOfGroup);

          if (gapMs > 0) {
            const silencePath = path.join(workDir, `silence_${String(i).padStart(4, '0')}.mp3`);
            await this.generateSilence(gapMs, silencePath);
            filesToConcat.push(silencePath);
          }
        }

        // 合成该组的音频
        const rawPath = path.join(workDir, `segment_${String(i).padStart(4, '0')}_raw.mp3`);
        const trimmedPath = path.join(workDir, `segment_${String(i).padStart(4, '0')}.mp3`);

        console.log(`正在合成分组 ${i + 1}/${groups.length} [${group.speaker}] (${group.text.length} 字符)...`);

        await this.synthesizeSegmentWithRetry(
          group.text,
          voiceConfig.voice_id,
          voiceConfig.emotion,
          rawPath
        );

        // 裁剪尾部静音
        await this.trimTrailingSilence(rawPath, trimmedPath);
        filesToConcat.push(trimmedPath);

        // 清理原始文件
        if (rawPath !== trimmedPath && fs.existsSync(rawPath)) {
          try { fs.unlinkSync(rawPath); } catch (e) { /* ignore */ }
        }

        // 记录最后一句用于计算下一组的静音间隔
        prevDialogue = group.dialogues[group.dialogues.length - 1];
      }

      // 拼接所有音频片段
      const concatListPath = path.join(workDir, 'concat.txt');
      const concatContent = filesToConcat
        .map(f => `file '${path.resolve(f)}'`)
        .join('\n') + '\n';
      fs.writeFileSync(concatListPath, concatContent);

      console.log('正在拼接音频...');
      await execAsync(
        `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${outputPath}"`
      );

      console.log(`音频已保存: ${outputPath}`);
    } catch (error) {
      if (error.message.includes('fetch failed')) {
        throw new Error('MiniMax TTS 网络连接失败，请检查网络设置后重试');
      }
      throw new Error(`MiniMax TTS 合成失败: ${error.message}`);
    } finally {
      // 清理工作目录
      try {
        if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      } catch (e) { /* ignore */ }
    }
  }
}

module.exports = MiniMaxTTS;
