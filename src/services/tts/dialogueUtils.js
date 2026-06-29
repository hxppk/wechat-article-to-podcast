function normalizeSpeaker(s) {
  const raw = String(s == null ? '' : s).trim();
  if (/^(speaker_?a|老王|小墨|a)$/i.test(raw)) return 'Speaker_A';
  if (/^(speaker_?b|小李|小夏|b)$/i.test(raw)) return 'Speaker_B';
  return 'Speaker_A';
}

/**
 * 把脚本里的韵律标记转换成 ElevenLabs 端能识别的形式：
 *  - 圆括号韵律标记 (laughs) → 方括号 [laughs]
 *  - MiniMax 停顿标记 <#0.5#> 直接删除（ElevenLabs 不认）
 * 仅处理半角圆括号，不影响中文全角括号（）。
 * @param {string} text
 * @returns {string}
 */
function convertProsodyForElevenLabs(text) {
  return String(text == null ? '' : text)
    .replace(/<#[^#>]*#>/g, '')
    .replace(/\(([^)]*)\)/g, '[$1]');
}

function buildDialogueInputs(dialogues, { voiceA, voiceB }) {
  return dialogues.map((d) => {
    const voice_id = normalizeSpeaker(d.speaker) === 'Speaker_A' ? voiceA : voiceB;
    let text = convertProsodyForElevenLabs(d.text == null ? '' : String(d.text));
    if (d.isInterrupt) text = text.replace(/\s*$/, '') + '-';
    return { text, voice_id };
  });
}

function totalChars(inputs) {
  return inputs.reduce((n, i) => n + (i.text ? i.text.length : 0), 0);
}

function chunkInputsByChars(inputs, maxChars) {
  const chunks = [];
  let cur = [];
  let count = 0;
  for (const inp of inputs) {
    const len = inp.text ? inp.text.length : 0;
    if (cur.length > 0 && count + len > maxChars) {
      chunks.push(cur);
      cur = [];
      count = 0;
    }
    cur.push(inp);
    count += len;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

function expectedSeconds(charCount, { charsPerSec = 4.5 } = {}) {
  return charCount / charsPerSec;
}

function isLikelyTruncated(actualSeconds, charCount, { charsPerSec = 4.5, floorRatio = 0.6 } = {}) {
  if (!actualSeconds || actualSeconds <= 0) return true;
  return actualSeconds < expectedSeconds(charCount, { charsPerSec }) * floorRatio;
}

module.exports = {
  normalizeSpeaker, convertProsodyForElevenLabs, buildDialogueInputs, totalChars,
  chunkInputsByChars, expectedSeconds, isLikelyTruncated,
};
