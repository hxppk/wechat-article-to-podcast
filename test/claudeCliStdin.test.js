const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 用一个会忽略所有参数、立即非零退出（不读取 stdin）的小脚本伪装成 claude，
// 这样写入 >64KB 的 stdin 必然触发 EPIPE。CLAUDE_BIN 在模块加载时读取，
// 因此必须在 require 之前设置（放在独立测试文件里避免影响其它用例）。
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakeclaude-'));
const helper = path.join(dir, 'fake-claude.sh');
fs.writeFileSync(helper, '#!/bin/sh\nexit 1\n');
fs.chmodSync(helper, 0o755);
process.env.CLAUDE_BIN = helper;
process.env.CLAUDE_RETRY_BASE_MS = '1';

const ClaudeCliLLM = require('../src/services/llm/ClaudeCliLLM');

test('runClaude：子进程提前退出且未排空大 stdin 时，EPIPE 不会让进程崩溃，只 reject', async () => {
  const llm = new ClaudeCliLLM();
  // 中文 ≈3 字节/字 → ~300KB，远超 64KB 管道缓冲，确保写入触发 EPIPE。
  const bigPrompt = '汉'.repeat(100000);
  await assert.rejects(
    () => llm.runClaude(bigPrompt),
    (e) => e instanceof Error, // 非零退出 → reject（普通 Error 或 ProviderError），关键是不崩溃
  );
});

test('generateScript：大 prompt + 子进程提前退出，整体 reject 而非崩溃', async () => {
  const llm = new ClaudeCliLLM();
  // getPrompt 会把超大正文包进 prompt，stdin 仍然 >64KB。
  await assert.rejects(() => llm.generateScript('汉'.repeat(100000)), (e) => e instanceof Error);
});
