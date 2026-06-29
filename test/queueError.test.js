const { test } = require('node:test');
const assert = require('node:assert/strict');
// resolveErrorMessage 已从旧 queue.js 移到 errors.js（分布式重构：云端不再有 AI 队列）
const { resolveErrorMessage, ProviderError } = require('../src/services/errors');

test('ProviderError 的 message 被展示', () => {
  assert.equal(
    resolveErrorMessage(new ProviderError('ELEVENLABS_API_KEY 未设置')),
    'ELEVENLABS_API_KEY 未设置'
  );
});

test('普通错误回退到通用文案', () => {
  assert.equal(
    resolveErrorMessage(new Error('boom')),
    '处理过程中发生错误，请重试'
  );
});

test('ValidationError 的 message 被展示（name 匹配）', () => {
  const error = new Error('bad url');
  error.name = 'ValidationError';
  assert.equal(
    resolveErrorMessage(error),
    'bad url'
  );
});
