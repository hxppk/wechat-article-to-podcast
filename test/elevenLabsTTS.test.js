const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.ELEVENLABS_API_KEY = 'test-key';
process.env.ELEVENLABS_SINGLE_SHOT_MAX = '50'; // 小阈值便于触发分块
process.env.ELEVENLABS_CHUNK_CHARS = '50';     // 小分块预算，确保两段各自成块
const ElevenLabsTTS = require('../src/services/tts/ElevenLabsTTS');

test('短对话走单次合成且校验通过，callDialogue 调用一次', async () => {
  const tts = new ElevenLabsTTS();
  const call = mock.method(tts, 'callDialogue', async () => Buffer.from('FAKEMP3'));
  mock.method(tts, 'probeDurationMs', async () => 999000); // 时长充足，校验通过
  const out = path.join(os.tmpdir(), `t_${Date.now()}.mp3`);
  await tts.synthesize([{ speaker: 'Speaker_A', text: '短句' }], out);
  assert.ok(fs.existsSync(out));
  assert.equal(call.mock.calls.length, 1);
  fs.unlinkSync(out);
});

test('超阈值走分块，callDialogue 两次 + concatSegments 一次', async () => {
  const tts = new ElevenLabsTTS();
  const call = mock.method(tts, 'callDialogue', async () => Buffer.from('SEG'));
  const concat = mock.method(tts, 'concatSegments', async (segs, out) => fs.writeFileSync(out, 'MERGED'));
  // 两段共 80 字符 > SINGLE_SHOT_MAX(50) → 分块；每段 40 ≤ CHUNK_CHARS(50) → 各自成块
  const long = 'x'.repeat(40);
  const dialogues = [
    { speaker: 'Speaker_A', text: long },
    { speaker: 'Speaker_B', text: long },
  ];
  const out = path.join(os.tmpdir(), `t2_${Date.now()}.mp3`);
  await tts.synthesize(dialogues, out);
  assert.equal(call.mock.calls.length, 2);
  assert.equal(concat.mock.calls.length, 1);
  assert.ok(fs.existsSync(out));
  fs.unlinkSync(out);
});

test('单次合成疑似截断 → 降级分块(callDialogue 两次)', async () => {
  const tts = new ElevenLabsTTS();
  const call = mock.method(tts, 'callDialogue', async () => Buffer.from('FAKE'));
  mock.method(tts, 'probeDurationMs', async () => 1000); // 1s，远短于 40 字符预期(~8.9s)→ 判截断
  const out = path.join(os.tmpdir(), `t3_${Date.now()}.mp3`);
  // 40 字符 ≤ SINGLE_SHOT_MAX(50) 走单次；截断后降级 synthesizeChunked，单块再调一次
  await tts.synthesize([{ speaker: 'Speaker_A', text: 'x'.repeat(40) }], out);
  assert.equal(call.mock.calls.length, 2);
  assert.ok(fs.existsSync(out));
  fs.unlinkSync(out);
});

test('缺少 API key 时构造抛 ProviderError', () => {
  const { ProviderError } = require('../src/services/errors');
  const saved = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    assert.throws(() => new ElevenLabsTTS(), (e) => e instanceof ProviderError);
  } finally {
    process.env.ELEVENLABS_API_KEY = saved;
  }
});

test('callDialogue：422 语音/模型错误 → ProviderError（不打 isValidation，不降级）', async () => {
  const { ProviderError } = require('../src/services/errors');
  const tts = new ElevenLabsTTS();
  const savedFetch = global.fetch;
  global.fetch = async () => ({
    status: 422,
    ok: false,
    async text() { return JSON.stringify({ detail: { message: 'voice_id ByhE not found' } }); },
    async arrayBuffer() { return new ArrayBuffer(0); },
  });
  try {
    await assert.rejects(
      () => tts.callDialogue([{ text: 'x', voice_id: 'v' }]),
      (e) => e instanceof ProviderError && e.isValidation !== true,
    );
  } finally {
    global.fetch = savedFetch;
  }
});

test('callDialogue：422 长度错误 → isValidation（触发分块降级）', async () => {
  const tts = new ElevenLabsTTS();
  const savedFetch = global.fetch;
  global.fetch = async () => ({
    status: 422,
    ok: false,
    async text() { return JSON.stringify({ detail: { message: 'text exceeds maximum character length' } }); },
    async arrayBuffer() { return new ArrayBuffer(0); },
  });
  try {
    await assert.rejects(
      () => tts.callDialogue([{ text: 'x', voice_id: 'v' }]),
      (e) => e.isValidation === true,
    );
  } finally {
    global.fetch = savedFetch;
  }
});

test('synthesize：callDialogue 抛 ProviderError 不降级分块，也不留半截文件', async () => {
  const { ProviderError } = require('../src/services/errors');
  const tts = new ElevenLabsTTS();
  mock.method(tts, 'callDialogue', async () => {
    throw new ProviderError('ElevenLabs 请求被拒绝 422: voice not found');
  });
  const chunked = mock.method(tts, 'synthesizeChunked', async () => {});
  const out = path.join(os.tmpdir(), `t5_${Date.now()}.mp3`);
  await assert.rejects(
    () => tts.synthesize([{ speaker: 'Speaker_A', text: '短句' }], out),
    (e) => e instanceof ProviderError,
  );
  assert.equal(chunked.mock.calls.length, 0);
  assert.ok(!fs.existsSync(out));
});

test('synthesize：ffprobe 探测失败(返回0)视为未知，不降级分块', async () => {
  const tts = new ElevenLabsTTS();
  const call = mock.method(tts, 'callDialogue', async () => Buffer.from('FAKEMP3'));
  mock.method(tts, 'probeDurationMs', async () => 0); // 探测失败
  const chunked = mock.method(tts, 'synthesizeChunked', async () => {});
  const out = path.join(os.tmpdir(), `t6_${Date.now()}.mp3`);
  await tts.synthesize([{ speaker: 'Speaker_A', text: 'x'.repeat(40) }], out);
  assert.equal(call.mock.calls.length, 1); // 仅单次合成，未降级
  assert.equal(chunked.mock.calls.length, 0);
  assert.ok(fs.existsSync(out));
  fs.unlinkSync(out);
});

test('单次合成校验错误(isValidation) → 降级分块，callDialogue 调用两次', async () => {
  const tts = new ElevenLabsTTS();
  let callCount = 0;
  const call = mock.method(tts, 'callDialogue', async () => {
    callCount++;
    if (callCount === 1) {
      // First call: simulate validation error (e.g. 422)
      throw Object.assign(new Error('422'), { isValidation: true });
    }
    return Buffer.from('CHUNKED');
  });
  // concatSegments should not be needed (single chunk), but mock it just in case
  mock.method(tts, 'concatSegments', async (_segs, out) => fs.writeFileSync(out, 'MERGED'));
  // probeDurationMs should not be called in the validation-error path, but mock defensively
  mock.method(tts, 'probeDurationMs', async () => 999000);
  const out = path.join(os.tmpdir(), `t4_${Date.now()}.mp3`);
  // 20 chars ≤ SINGLE_SHOT_MAX(50) → single-shot path first; validation error → chunked fallback
  await tts.synthesize([{ speaker: 'Speaker_A', text: 'x'.repeat(20) }], out);
  assert.ok(fs.existsSync(out));
  // callDialogue called at least twice: once for single-shot (failed), once for chunked fallback
  assert.ok(call.mock.calls.length >= 2, `Expected ≥2 callDialogue calls, got ${call.mock.calls.length}`);
  fs.unlinkSync(out);
});
