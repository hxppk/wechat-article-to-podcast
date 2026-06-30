const { test } = require('node:test');
const assert = require('node:assert/strict');
const LLMProvider = require('../src/services/llm/LLMProvider');

test('getPrompt 不再含 Gemini/Google 专属字眼', () => {
  const p = new LLMProvider().getPrompt('文章正文');
  assert.ok(!/Google\s*DeepMind/i.test(p));
  assert.ok(!/Charon/i.test(p));
  assert.ok(!/Callirrhoe/i.test(p));
  assert.ok(!/gemini/i.test(p));
});

test('getPrompt 保留输出格式契约', () => {
  const p = new LLMProvider().getPrompt('文章正文');
  assert.ok(p.includes('Speaker_A'));
  assert.ok(p.includes('Speaker_B'));
  assert.ok(p.includes('# Summary'));
  assert.ok(p.includes('--'));
});

test('getPrompt 含方括号韵律标记说明（ElevenLabs audio tags）', () => {
  const p = new LLMProvider().getPrompt('文章正文');
  assert.ok(/\[laughs\]|\[chuckle\]|\[sighs\]/.test(p), '应包含方括号韵律标记示例');
  assert.ok(p.includes('文章正文'), '应内嵌输入文本');
});
