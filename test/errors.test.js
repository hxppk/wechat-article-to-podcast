const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ProviderError, isDisplayableError } = require('../src/services/errors');

test('ProviderError 有正确的 name 且是 Error 子类', () => {
  const e = new ProviderError('缺少 API key');
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'ProviderError');
  assert.equal(e.message, '缺少 API key');
});

test('isDisplayableError 对 ProviderError 返回 true', () => {
  assert.equal(isDisplayableError(new ProviderError('x')), true);
});

test('isDisplayableError 对普通 Error 返回 false', () => {
  assert.equal(isDisplayableError(new Error('boom')), false);
});

test('isDisplayableError 对 null/undefined 安全返回 false', () => {
  assert.equal(isDisplayableError(null), false);
  assert.equal(isDisplayableError(undefined), false);
});

test('isDisplayableError 认可 ValidationError(name 匹配)', () => {
  const fake = new Error('bad url'); fake.name = 'ValidationError';
  assert.equal(isDisplayableError(fake), true);
});
