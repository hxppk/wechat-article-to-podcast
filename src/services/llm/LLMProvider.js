/**
 * LLM 服务抽象基类
 * 所有 LLM 实现都应继承此类
 */
class LLMProvider {
  /**
   * 获取供应商名称
   * @returns {string}
   */
  getName() {
    throw new Error('子类必须实现 getName 方法');
  }

  /**
   * 生成播客对话脚本
   * @param {string} pdfText - PDF 提取的文本内容
   * @returns {Promise<{raw: string, dialogues: Array<{speaker: string, text: string, emotion?: string, style_prompt?: string}>}>}
   */
  async generateScript(pdfText) {
    throw new Error('子类必须实现 generateScript 方法');
  }

  /**
   * 获取对话生成提示词
   * @param {string} pdfText - 文章文本
   * @returns {string}
   */
  getPrompt(pdfText) {
    return `# 角色
你是资深中文播客撰稿人兼导演，会写双人对谈脚本，要求脚本直接按多说话人 TTS 的格式输出。

# 人物
Speaker_A（老王）：行业老兵，语气沉稳、偶尔自嘲。
Speaker_B（小李）：好奇的年轻搭档，爱提问、会打断。

# 目标
阅读输入文章，将它改写成 12–18 分钟的双人播客脚本（约 2200-2800 字）。脚本必须是纯文本，每行格式为：

Speaker_A: 具体内容
Speaker_B: 具体内容

不允许 JSON 或 Markdown。允许在对话中穿插 [笑]、[叹气] 等非语言提示。

# 具体要求
1. 完全中文口语，带语气词（"呃、那个、哎、你懂的、嘛、就是说"）。
2. 小李需要在老王发言中打断，如"等等，我插一句"、"啊？真的假的？"。
3. 遇到抽象概念要有生活化类比。
4. 每段不要太长，像真实对谈。
5. 最后两段做总结并给听众思考题/行动建议。
6. 脚本结束后，另起一行写 # Summary: 后面跟 180 字以内的节目简介（口语化、吸引人、像朋友推荐节目）。

# 输出格式示例
Speaker_A: 哎，小李，你最近有没有关注那个...
Speaker_B: 你是说 XXX 吗？那肯定啊！
Speaker_A: 对对对，就是这个...
...
# Summary: 这期节目我们聊了...（180字以内的吸引人简介）

# 输入文本
${pdfText}

请严格遵守上述格式，禁止输出任何 JSON、Markdown 代码块或额外解释。直接开始输出脚本：`;
  }

  /**
   * 解析脚本，提取对话和简介
   * @param {string} rawScript - 原始脚本文本
   * @returns {{dialogues: Array, summary: string}}
   */
  parseScript(rawScript) {
    let scriptText = rawScript.trim();
    let summary = '';

    // 提取 # Summary: 后的简介
    const summaryMatch = scriptText.match(/# Summary:\s*(.+?)$/is);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
      // 移除 summary 部分，只保留对话
      scriptText = scriptText.replace(/# Summary:\s*.+$/is, '').trim();
    }

    // 解析对话
    const dialogues = this.parseDialogues(scriptText);

    return { dialogues, summary };
  }

  /**
   * 解析对话脚本为结构化数据
   * @param {string} rawScript - 原始脚本文本
   * @returns {Array<{speaker: string, text: string}>}
   */
  parseDialogues(rawScript) {
    // 先尝试 Speaker_A/Speaker_B 格式
    let dialogues = this.parseSpeakerFormat(rawScript);

    // 如果失败，尝试 JSON 格式（向后兼容）
    if (dialogues.length === 0) {
      dialogues = this.parseJsonFormat(rawScript);
    }

    // 如果还是失败，尝试中文角色名格式
    if (dialogues.length === 0) {
      dialogues = this.parseChineseFormat(rawScript);
    }

    return dialogues;
  }

  /**
   * 解析 Speaker_A/Speaker_B 格式
   */
  parseSpeakerFormat(rawScript) {
    const dialogues = [];
    const lines = rawScript.split('\n');

    for (const line of lines) {
      const match = line.match(/^(Speaker_[AB])\s*[:：]\s*(.+)/i);
      if (match) {
        dialogues.push({
          speaker: match[1],
          text: match[2].trim()
        });
      }
    }

    return dialogues;
  }

  /**
   * 解析 JSON 格式（向后兼容）
   */
  parseJsonFormat(rawScript) {
    try {
      let cleaned = rawScript.trim();
      // 清理 Markdown 代码块
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
      else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
      cleaned = cleaned.trim();

      const data = JSON.parse(cleaned);
      if (!Array.isArray(data)) return [];

      return data.map(d => ({
        speaker: d.speaker === 'A' ? 'Speaker_A' : d.speaker === 'B' ? 'Speaker_B' : d.speaker,
        text: d.text
      }));
    } catch {
      return [];
    }
  }

  /**
   * 解析中文角色名格式
   */
  parseChineseFormat(rawScript) {
    const dialogues = [];
    const lines = rawScript.split('\n');

    for (const line of lines) {
      const match = line.match(/^(老王|小李|小墨|小夏)\s*[:：]\s*(.+)/);
      if (match) {
        const speaker = match[1] === '老王' || match[1] === '小墨' ? 'Speaker_A' : 'Speaker_B';
        dialogues.push({
          speaker,
          text: match[2].trim()
        });
      }
    }

    return dialogues;
  }
}

module.exports = LLMProvider;
