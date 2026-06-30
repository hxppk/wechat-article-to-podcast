const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'test-key';

test('LLM 工厂默认返回 Claude provider', () => {
  const llm = require('../src/services/llm');
  assert.equal(llm.getName(), 'Claude (claude -p)');
});

test('TTS 工厂 elevenlabs 分支返回 ElevenLabs provider', () => {
  const tts = require('../src/services/tts');
  assert.equal(tts.getName(), 'ElevenLabs (eleven_v3)');
});

test('pipeline.getTTSInstance 始终返回 ElevenLabs 实例', () => {
  // getTTSInstance 已随 AI 流水线搬到本地 worker（src/worker/pipeline.js）
  const { getTTSInstance } = require('../src/worker/pipeline');
  assert.equal(getTTSInstance('elevenlabs').getName(), 'ElevenLabs (eleven_v3)');
  assert.equal(getTTSInstance().getName(), 'ElevenLabs (eleven_v3)');
});
