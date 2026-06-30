const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSpeaker, convertProsodyForElevenLabs, buildDialogueInputs, totalChars,
  chunkInputsByChars, expectedSeconds, isLikelyTruncated,
} = require('../src/services/tts/dialogueUtils');

const VOICES = { voiceA: 'VA', voiceB: 'VB' };

test('normalizeSpeaker 兼容多种写法', () => {
  assert.equal(normalizeSpeaker('Speaker_A'), 'Speaker_A');
  assert.equal(normalizeSpeaker('老王'), 'Speaker_A');
  assert.equal(normalizeSpeaker('B'), 'Speaker_B');
  assert.equal(normalizeSpeaker('小李'), 'Speaker_B');
});

test('buildDialogueInputs 映射 voice_id 并对插嘴句追加 -', () => {
  const inputs = buildDialogueInputs([
    { speaker: 'Speaker_A', text: '这个架构其实', isInterrupt: true },
    { speaker: 'Speaker_B', text: '[curious] 等等' },
  ], VOICES);
  assert.deepEqual(inputs, [
    { text: '这个架构其实-', voice_id: 'VA' },
    { text: '[curious] 等等', voice_id: 'VB' },
  ]);
});

test('totalChars 统计所有 text 字符数', () => {
  assert.equal(totalChars([{ text: 'abcd' }, { text: '一二三' }]), 7);
});

test('chunkInputsByChars 在不超过预算处切块', () => {
  const inputs = [{ text: 'aaaa' }, { text: 'bbbb' }, { text: 'cccc' }];
  const chunks = chunkInputsByChars(inputs, 8);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 2);
  assert.equal(chunks[1].length, 1);
});

test('chunkInputsByChars 单块容纳全部时只产生一块', () => {
  const chunks = chunkInputsByChars([{ text: 'aa' }, { text: 'bb' }], 100);
  assert.equal(chunks.length, 1);
});

test('isLikelyTruncated：实际时长远短于预期判为截断', () => {
  // 900 字符，预期 ~200s，实际 30s → 截断
  assert.equal(isLikelyTruncated(30, 900), true);
  // 实际接近预期 → 正常
  assert.equal(isLikelyTruncated(180, 900), false);
});

test('convertProsodyForElevenLabs 删除停顿标记 <#..#>', () => {
  assert.equal(convertProsodyForElevenLabs('稍等<#0.5#>我想想'), '稍等我想想');
  assert.equal(convertProsodyForElevenLabs('好的<#1.0#>继续'), '好的继续');
});

test('convertProsodyForElevenLabs 方括号韵律标记原样保留', () => {
  // LLM 现在直接输出 ElevenLabs 方括号格式，无需转换
  assert.equal(convertProsodyForElevenLabs('[laughs]太妙了'), '[laughs]太妙了');
  assert.equal(convertProsodyForElevenLabs('[sighs]'), '[sighs]');
  assert.equal(convertProsodyForElevenLabs('[breath]'), '[breath]');
  assert.equal(convertProsodyForElevenLabs('[emm]'), '[emm]');
  assert.equal(convertProsodyForElevenLabs('[gasps]'), '[gasps]');
});

test('convertProsodyForElevenLabs 不影响中文全角括号', () => {
  assert.equal(convertProsodyForElevenLabs('这是（重点）'), '这是（重点）');
});

test('convertProsodyForElevenLabs 半角括号内容原样保留', () => {
  assert.equal(convertProsodyForElevenLabs('发布于(2024)年'), '发布于(2024)年');
  assert.equal(convertProsodyForElevenLabs('调用了(API)接口'), '调用了(API)接口');
});

test('convertProsodyForElevenLabs 混合：方括号保留 + 停顿删除', () => {
  const input = '见到你[laughs]很高兴<#0.5#>，版本(2024)已更新';
  const expected = '见到你[laughs]很高兴，版本(2024)已更新';
  assert.equal(convertProsodyForElevenLabs(input), expected);
});

test('buildDialogueInputs 方括号韵律标记原样通过', () => {
  const inputs = buildDialogueInputs([{ speaker: 'Speaker_A', text: '[chuckle]好吧' }], VOICES);
  assert.equal(inputs[0].text, '[chuckle]好吧');
});
