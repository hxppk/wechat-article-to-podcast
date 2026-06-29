const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildClaudeArgs, buildChildEnv } = require('../src/services/llm/claudeProcess');

test('buildClaudeArgs 含 -p / 模型 / 文本输出 / 禁用工具', () => {
  const args = buildClaudeArgs({ model: 'claude-opus-4-8', disableToolsArgs: ['--tools', ''] });
  assert.ok(args.includes('-p'));
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'claude-opus-4-8']);
  assert.deepEqual(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2), ['--output-format', 'text']);
  assert.ok(args.includes('--tools'));
  assert.ok(!args.includes('--bare'));
});

test('buildChildEnv 默认删除 ANTHROPIC_API_KEY 且保留代理/HOME/PATH', () => {
  const env = buildChildEnv({ PATH: '/bin', HOME: '/h', HTTPS_PROXY: 'http://p', ANTHROPIC_API_KEY: 'sk-x', SECRET: 'no' }, { allowApiKey: false });
  assert.equal(env.PATH, '/bin');
  assert.equal(env.HOME, '/h');
  assert.equal(env.HTTPS_PROXY, 'http://p');
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.SECRET, undefined);
});

test('buildChildEnv 在 allowApiKey 时透传 ANTHROPIC_API_KEY', () => {
  const env = buildChildEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'sk-x' }, { allowApiKey: true });
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-x');
});
