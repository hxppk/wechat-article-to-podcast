const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
process.env.CLAUDE_RETRY_BASE_MS = '1'; // 让重试退避在测试中接近瞬时
const ClaudeCliLLM = require('../src/services/llm/ClaudeCliLLM');
const { ProviderError } = require('../src/services/errors');

const SCRIPT = [
  'Speaker_B: [curious] 哎老王，这个我没看懂。',
  'Speaker_A: 这么跟你说吧，其实--',
  'Speaker_B: 等等，你又要打比方？',
  '# Summary: 我们聊了一个很有意思的话题。',
].join('\n');

test('generateScript 解析对话与简介并返回标准结构', async () => {
  const llm = new ClaudeCliLLM();
  mock.method(llm, 'runClaude', async () => SCRIPT);
  const out = await llm.generateScript('文章正文');
  assert.equal(out.dialogues.length, 3);
  assert.equal(out.dialogues[0].speaker, 'Speaker_B');
  assert.equal(out.dialogues[1].isInterrupt, true);
  assert.ok(out.summary.includes('有意思'));
  assert.ok(out.ttsText.includes('Speaker_A:'));
  assert.equal(out.raw, SCRIPT);
});

test('generateScript 在无法解析时（重试耗尽后）抛错', async () => {
  const llm = new ClaudeCliLLM();
  mock.method(llm, 'runClaude', async () => '一段没有 Speaker 前缀的普通文字');
  await assert.rejects(() => llm.generateScript('x'), /无法解析|格式/);
});

test('generateScript 解析失败会重试，再次成功后返回（parse 失败可重试）', async () => {
  const llm = new ClaudeCliLLM();
  let n = 0;
  const m = mock.method(llm, 'runClaude', async () => {
    n++;
    return n === 1 ? '没有任何 Speaker 前缀的垃圾输出' : SCRIPT;
  });
  const out = await llm.generateScript('x');
  assert.equal(m.mock.calls.length, 2);
  assert.equal(out.dialogues.length, 3);
});

test('generateScript 不重试 ProviderError（鉴权/模型/额度类直接上报）', async () => {
  const llm = new ClaudeCliLLM();
  const m = mock.method(llm, 'runClaude', async () => {
    throw new ProviderError('claude 未登录或鉴权失败');
  });
  await assert.rejects(() => llm.generateScript('x'), (e) => e instanceof ProviderError);
  assert.equal(m.mock.calls.length, 1); // 只调用一次，未重试
});

test('classifyExitError 将模型/额度/权限类 stderr 归为 ProviderError', () => {
  const llm = new ClaudeCliLLM();
  assert.ok(llm.classifyExitError(1, 'Error: model claude-foo not found') instanceof ProviderError);
  assert.ok(llm.classifyExitError(1, 'invalid model specified') instanceof ProviderError);
  assert.ok(llm.classifyExitError(1, 'Your subscription quota has been exceeded') instanceof ProviderError);
  assert.ok(llm.classifyExitError(1, 'Permission denied for this action') instanceof ProviderError);
  assert.ok(llm.classifyExitError(1, 'Please login to continue') instanceof ProviderError);
  // 普通错误仍是可重试的普通 Error
  const generic = llm.classifyExitError(2, 'segfault boom');
  assert.ok(generic instanceof Error);
  assert.ok(!(generic instanceof ProviderError));
});
