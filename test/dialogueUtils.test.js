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

test('convertProsodyForElevenLabs 圆括号→方括号并删除停顿标记', () => {
  assert.equal(convertProsodyForElevenLabs('对！(laughs)太妙了'), '对！[laughs]太妙了');
  assert.equal(convertProsodyForElevenLabs('哈哈(chuckle)好吧(sighs)'), '哈哈[chuckle]好吧[sighs]');
  assert.equal(convertProsodyForElevenLabs('稍等<#0.5#>我想想'), '稍等我想想');
});

test('convertProsodyForElevenLabs 不影响中文全角括号', () => {
  assert.equal(convertProsodyForElevenLabs('这是（重点）'), '这是（重点）');
});

test('convertProsodyForElevenLabs 非白名单半角括号保留原样', () => {
  // 数字、英文缩写、中文拟声词均不在白名单中，不应被转换
  assert.equal(convertProsodyForElevenLabs('发布于(2024)年'), '发布于(2024)年');
  assert.equal(convertProsodyForElevenLabs('调用了(API)接口'), '调用了(API)接口');
  assert.equal(convertProsodyForElevenLabs('他说(咳咳)不好意思'), '他说(咳咳)不好意思');
});

test('convertProsodyForElevenLabs 全部白名单韵律词均转换', () => {
  // 验证白名单中各代表词都被转换
  assert.equal(convertProsodyForElevenLabs('(laughs)'), '[laughs]');
  assert.equal(convertProsodyForElevenLabs('(sighs)'), '[sighs]');
  assert.equal(convertProsodyForElevenLabs('(breath)'), '[breath]');
  assert.equal(convertProsodyForElevenLabs('(emm)'), '[emm]');
  assert.equal(convertProsodyForElevenLabs('(gasps)'), '[gasps]');
  assert.equal(convertProsodyForElevenLabs('(groans)'), '[groans]');
});

test('convertProsodyForElevenLabs 混合场景：白名单转换 + 非白名单保留 + 停顿删除', () => {
  const input = '见到你(laughs)很高兴，版本(2024)<#0.5#>已更新';
  const expected = '见到你[laughs]很高兴，版本(2024)已更新';
  assert.equal(convertProsodyForElevenLabs(input), expected);
});

test('buildDialogueInputs 把圆括号韵律标记转成方括号', () => {
  const inputs = buildDialogueInputs([{ speaker: 'Speaker_A', text: '哈哈(chuckle)好吧' }], VOICES);
  assert.equal(inputs[0].text, '哈哈[chuckle]好吧');
});
