const { test } = require('node:test');
const assert = require('node:assert/strict');
const LLMProvider = require('../src/services/llm/LLMProvider');
const { stripAudioTags } = require('../src/services/llm/LLMProvider');

test('stripAudioTags 移除方括号情绪标签并规整空白', () => {
  assert.equal(stripAudioTags('[laughs] 啊？真的[curious]假的？'), '啊？真的假的？');
  assert.equal(stripAudioTags('没有标签'), '没有标签');
});

test('stripAudioTags 剥离圆括号韵律标记与 <#..#> 停顿', () => {
  assert.equal(stripAudioTags('对！(laughs)这个比喻太妙了'), '对！这个比喻太妙了');
  assert.equal(stripAudioTags('稍等<#0.5#>我想想'), '稍等我想想');
});

test('stripAudioTags 不误伤中文全角括号', () => {
  assert.equal(stripAudioTags('这是（重点）部分'), '这是（重点）部分');
});

test('fallbackSummary 不含韵律/情绪标签', () => {
  const p = new LLMProvider();
  const dialogues = [
    { speaker: 'Speaker_A', text: '(chuckle) 这个事儿特别有意思' },
    { speaker: 'Speaker_B', text: '[surprised] 啊？怎么说？' },
  ];
  const s = p.fallbackSummary(dialogues);
  assert.ok(!s.includes('['), '摘要不应包含 [ 标签');
  assert.ok(!s.includes('(chuckle)'), '摘要不应包含圆括号标记');
  assert.ok(s.length > 0);
});

test('parseSpeakerFormat 识别行尾 -- 插嘴(含尾随空白)', () => {
  const p = new LLMProvider();
  const out = p.parseSpeakerFormat('Speaker_A: 这个架构其实--  \nSpeaker_B: 等等，你说的是分布式吗？');
  assert.equal(out.length, 2);
  assert.equal(out[0].isInterrupt, true);
  assert.equal(out[0].text, '这个架构其实');
  assert.equal(out[1].isInterrupt, false);
});

test('parseSpeakerFormat 保留行内情绪标签到 text', () => {
  const p = new LLMProvider();
  const out = p.parseSpeakerFormat('Speaker_B: [curious] 这是啥意思？');
  assert.equal(out[0].text, '[curious] 这是啥意思？');
  assert.equal(out[0].isInterrupt, false);
});
