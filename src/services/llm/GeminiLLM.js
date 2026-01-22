const { GoogleGenerativeAI } = require('@google/generative-ai');
const LLMProvider = require('./LLMProvider');

/**
 * Gemini LLM 实现
 */
class GeminiLLM extends LLMProvider {
  constructor() {
    super();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY 环境变量未设置');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  }

  getName() {
    return 'Gemini';
  }

  async generateScript(articleText) {
    const prompt = this.getPrompt(articleText);

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const rawScript = response.text();

      // 解析脚本：提取对话和简介
      const { dialogues, summary } = this.parseScript(rawScript);

      if (dialogues.length === 0) {
        throw new Error('生成的脚本格式不正确，无法解析对话');
      }

      console.log(`脚本生成成功: ${dialogues.length} 段对话`);
      if (summary) {
        console.log(`简介已提取: ${summary.length} 字`);
      }

      // 生成用于 TTS 的纯文本（Speaker_A: text 格式）
      const ttsText = dialogues
        .map(d => `${d.speaker}: ${d.text}`)
        .join('\n');

      return {
        raw: rawScript,
        dialogues,
        summary: summary || this.fallbackSummary(dialogues),
        ttsText
      };
    } catch (error) {
      console.error('Gemini 脚本生成失败:', error);
      throw new Error(`对话脚本生成失败: ${error.message}`);
    }
  }

  /**
   * 兜底简介生成（当 LLM 未返回 # Summary 时）
   */
  fallbackSummary(dialogues) {
    const texts = dialogues
      .slice(0, 5)
      .map(d => d.text)
      .join(' ')
      .replace(/[「」""'']/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return texts.substring(0, 180);
  }
}

module.exports = GeminiLLM;
