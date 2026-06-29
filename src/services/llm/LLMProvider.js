/**
 * 从台词中剥离韵律/情绪标记，用于生成纯文本简介(fallbackSummary)。
 * 剥离：方括号 [xxx]、半角圆括号 (xxx) 韵律标记、<#0.5#> 停顿标记。
 * 注意只处理半角括号，不误伤中文全角括号（）。
 * @param {string} text
 * @returns {string}
 */
function stripAudioTags(text) {
  return String(text == null ? '' : text)
    .replace(/\[[^\]]*\]/g, '')
    .replace(/<#[^#>]*#>/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
   * 兜底简介生成（当 LLM 未返回 # Summary 时）。生成前剥离韵律/情绪标记。
   * @param {Array<{text:string}>} dialogues
   * @returns {string}
   */
  fallbackSummary(dialogues) {
    const joined = dialogues.slice(0, 5).map(d => d.text).join(' ');
    const cleaned = stripAudioTags(joined).replace(/[「」""'']/g, '');
    return cleaned.substring(0, 180);
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
    return `# Role
你是顶尖的中文播客制作人，擅长将复杂的输入文本转化为极其自然、充满“人味儿”的深度对谈（Deep Dive）。你的对标节目是 NotebookLM Audio Overview。

# Goal
阅读输入文本，生成一段 2000-2500 字的播客脚本。
核心原则：不要试图“讲完”所有知识点，而是要“聊透”最有趣的部分。目标是让听众觉得自己在偷听两个聪明人的私下闲聊。

# Fatal Constraints (格式死线)
1. 绝对禁止输出 Markdown 代码块（如 \`\`\`text 或 \`\`\`script）。
2. 绝对禁止使用 JSON。
3. 格式严格：每一行必须以 Speaker_A: 或 Speaker_B: 开头（必须是英文冒号）。
4. 禁止在人名和冒号之间加空格或其他符号。

# Characters (Chemistry is Key)
* Speaker_A (老王):
  - 声音/性格: 行业老兵，声音深沉。
  - 风格: 厌恶说教。喜欢用直觉和类比来解释复杂逻辑。
  - 口头禅: “这么跟你说吧...”、“其实本质上...”、“这就很有意思了”。
  - 任务: 负责输出洞察。当意识到自己说得太晦涩时，会主动说“呃，我是说...”来修正。

* Speaker_B (小李):
  - 声音/性格: 年轻好奇，反应极快。
  - 风格: 听众嘴替。完全不怯场，敢于打断老王。
  - 口头禅: “等等，你是说...？”、“啊？真的假的？”、“那岂不是...”。
  - 任务: 负责提问和捧哏。听到惊人观点时要有强烈的情绪反应。

# Conversation Rules (The "NotebookLM" Style)
1. 拒绝"清单体" (Anti-Listicle):
   - 严禁出现"第一点、第二点"或"文章里提到了"。
   - 必须通过对话流自然引出。例如："哎，除此之外，我还发现个特逗的事儿..."

2. 强制"不完美感" (Imperfections):
   - 文本中必须包含自然的口语停顿："那个..."、"呃..."、"就是..."、"咋说呢"。
   - 自我纠错：模拟真人思考过程。
     * Bad: "这是一个复杂的算法。"
     * Good: "这算法...咋说呢，其实挺复杂的，但你可以把它想象成..."

3. 开场即高潮 (Start in Medias Res):
   - 不要写开场白（"大家好，欢迎收听..."）。
   - 直接开始：就像录音键按下时，两人已经聊了一半。
     * 示例："哎老王，我今天看了这篇材料，真的被吓到了..."

4. 生活化类比:
   - 遇到抽象概念，强制要求老王用"吃火锅"、"装修"、"谈恋爱"等生活场景打比方。

5. 插嘴标记 (Interrupt Marker):
   - 当下一句是"插嘴/打断"时，上一句必须以 -- 结尾（双减号）。
   - 插嘴场景：对方话没说完就被打断、表达惊讶/不同意、急于追问等。
   - 示例：
     * Speaker_A: 这个架构其实--
     * Speaker_B: 等等，你说的是那个分布式的吗？
   - 正常轮换（对方说完了再接）不需要 --。

6. 韵律标记 (Prosody Markers for TTS):
   - 可使用的标记：(laughs) (chuckle) (sighs) (breath) (emm) (gasps)
   - 规则：
     a. 整篇脚本中韵律标记总数不超过 8-10 个
     b. 不要连续两句都有标记
     c. 标记放在标点符号之后："对！(laughs)这个比喻太妙了"
     d. Speaker_A 适合：(chuckle) (sighs) (breath) (emm)
     e. Speaker_B 适合：(laughs) (gasps) (emm)
     f. 用韵律标记替代中文拟声词，不要同时出现
        Bad: "哈哈(laughs)这太逗了"
        Good: "(laughs)这太逗了"
     g. 长停顿用 <#0.5#> 格式（秒数，不超过 1.0）

# Output Format Example
Speaker_B: 哎老王，我今天看了这个材料，有个地儿我没太看懂。
Speaker_A: 你是说那个...关于架构的部分？
Speaker_B: 对！它说那个是"解耦"的，啥意思啊？
Speaker_A: 这么跟你说吧，这就好比你家里装修--
Speaker_B: 等等，又是装修？你上次也用这个比喻！
Speaker_A: 哈哈，好吧好吧，换一个...
...
# Summary: 这期节目我们聊了...（150字以内，极具吸引力的口语化简介）

# Input Text
${pdfText}

请直接开始输出脚本，严格遵守上述格式：`;
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
   * 支持 -- 结尾作为"插嘴"标记
   */
  parseSpeakerFormat(rawScript) {
    const dialogues = [];
    const lines = rawScript.split('\n');

    for (const line of lines) {
      const match = line.match(/^(Speaker_[AB])\s*[:：]\s*(.+)/i);
      if (match) {
        let text = match[2].trim();
        let isInterrupt = false;

        // 检测行尾 -- 插嘴标记（容错尾随空白）
        if (/--\s*$/.test(text)) {
          isInterrupt = true;
          text = text.replace(/--\s*$/, '').trim();
        }

        dialogues.push({
          speaker: match[1],
          text,
          isInterrupt
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
   * 支持 -- 结尾作为"插嘴"标记
   */
  parseChineseFormat(rawScript) {
    const dialogues = [];
    const lines = rawScript.split('\n');

    for (const line of lines) {
      const match = line.match(/^(老王|小李|小墨|小夏)\s*[:：]\s*(.+)/);
      if (match) {
        const speaker = match[1] === '老王' || match[1] === '小墨' ? 'Speaker_A' : 'Speaker_B';
        let text = match[2].trim();
        let isInterrupt = false;

        // 检测行尾 -- 插嘴标记（容错尾随空白）
        if (/--\s*$/.test(text)) {
          isInterrupt = true;
          text = text.replace(/--\s*$/, '').trim();
        }

        dialogues.push({
          speaker,
          text,
          isInterrupt
        });
      }
    }

    return dialogues;
  }
}

module.exports = LLMProvider;
module.exports.stripAudioTags = stripAudioTags;
