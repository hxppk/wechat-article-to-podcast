const { test } = require('node:test');
const assert = require('node:assert/strict');

// 默认 TTS 是 minimax；这里显式切到 elevenlabs 分支验证工厂能正确实例化。
process.env.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'test-key';
process.env.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || 'test-key';
process.env.TTS_PROVIDER = 'elevenlabs';

test('LLM 工厂默认返回 Claude provider', () => {
  const llm = require('../src/services/llm');
  assert.equal(llm.getName(), 'Claude (claude -p)');
});

test('TTS 工厂 elevenlabs 分支返回 ElevenLabs provider', () => {
  const tts = require('../src/services/tts');
  assert.equal(tts.getName(), 'ElevenLabs (eleven_v3)');
});

test('queue.getTTSInstance 按名选择实例（默认 minimax）', () => {
  const queue = require('../src/services/queue');
  assert.equal(queue.getTTSInstance('elevenlabs').getName(), 'ElevenLabs (eleven_v3)');
  assert.equal(queue.getTTSInstance('minimax').getName(), 'MiniMax TTS');
  assert.equal(queue.getTTSInstance().getName(), 'MiniMax TTS');
});
