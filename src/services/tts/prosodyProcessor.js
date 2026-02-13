/**
 * 韵律标记后处理模块
 * 只做校验清理，不做转换：
 * - 移除不在白名单中的标记
 * - 移除连续重复标记
 * - 清理"中文拟声词+标记"冗余（哈哈(laughs) → (laughs)）
 * - 校验 <#x#> 停顿数值范围（0.01-2.0）
 */

// 白名单：仅 speech-2.8-hd/turbo 支持的 19 种韵律标记
const ALLOWED_MARKERS = new Set([
  'laughs', 'chuckle', 'sighs', 'coughs', 'breath',
  'pant', 'inhale', 'exhale', 'gasps', 'sniffs',
  'snorts', 'burps', 'lip-smacking', 'humming', 'hissing',
  'emm', 'sneezes', 'groans', 'clear-throat'
]);

// 中文拟声词 → 对应韵律标记的映射（用于清理冗余）
const ONOMATOPOEIA_PATTERNS = [
  { regex: /哈哈+\s*/, marker: 'laughs' },
  { regex: /呵呵+\s*/, marker: 'chuckle' },
  { regex: /嘿嘿+\s*/, marker: 'chuckle' },
  { regex: /唉\s*/, marker: 'sighs' },
  { regex: /呃+\s*/, marker: 'emm' },
  { regex: /嗯+\s*/, marker: 'emm' },
  { regex: /啊[！!]?\s*/, marker: 'gasps' },
];

/**
 * 处理单行对话文本的韵律标记
 * @param {string} text - 对话文本
 * @returns {string} 处理后的文本
 */
function processLine(text) {
  if (!text) return text;

  // 1. 移除不在白名单中的标记
  text = text.replace(/\(([^)]+)\)/g, (match, marker) => {
    if (ALLOWED_MARKERS.has(marker.trim())) {
      return match;
    }
    return '';
  });

  // 2. 清理"中文拟声词+标记"冗余
  for (const { regex, marker } of ONOMATOPOEIA_PATTERNS) {
    // 匹配 "拟声词(marker)" 的组合，去掉拟声词
    const combined = new RegExp(regex.source + `\\(${marker}\\)`, 'g');
    text = text.replace(combined, `(${marker})`);
  }

  // 3. 移除连续重复标记 (laughs)(laughs) → (laughs)
  text = text.replace(/(\([^)]+\))\s*\1/g, '$1');

  // 4. 校验 <#x#> 停顿数值范围
  text = text.replace(/<#([^#]+)#>/g, (match, value) => {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0.01 || num > 2.0) {
      // 超出范围则移除
      return '';
    }
    return match;
  });

  // 5. 清理多余空格
  text = text.replace(/\s{2,}/g, ' ').trim();

  return text;
}

/**
 * 处理整个对话数组的韵律标记
 * @param {Array<{speaker: string, text: string, isInterrupt?: boolean}>} dialogues
 * @returns {Array<{speaker: string, text: string, isInterrupt?: boolean}>}
 */
function processDialogues(dialogues) {
  if (!Array.isArray(dialogues)) return dialogues;

  return dialogues.map(dialogue => ({
    ...dialogue,
    text: processLine(dialogue.text)
  }));
}

module.exports = { processLine, processDialogues, ALLOWED_MARKERS };
