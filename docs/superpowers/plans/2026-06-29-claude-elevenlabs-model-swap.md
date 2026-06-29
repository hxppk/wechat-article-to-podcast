# Claude + ElevenLabs 模型切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把播客脚本生成从 Gemini 换成 Claude Opus 4.8(经 `claude -p` headless 子进程),把音频从 Gemini TTS 换成 ElevenLabs Text-to-Dialogue(`eleven_v3`),并完全删除 Gemini。

**Architecture:** 沿用现有 `LLMProvider`/`TTSProvider` 基类 + `index.js` 工厂。新增 `ClaudeCliLLM`(spawn `claude -p`,stdin 传 prompt,捕获 stdout,复用基类 parser)与 `ElevenLabsTTS`(REST `fetch` 调用对话端点,默认整篇单次 + 完整性校验 + 失败降级分块 + ffmpeg 拼接)。可测的纯逻辑(inputs 映射、分块、完整性估算、parser、childEnv、错误展示)抽成独立函数做 TDD;`queue.js` 仅扩展一处错误展示。

**Tech Stack:** Node.js (CommonJS)、`child_process.spawn`、全局 `fetch` + `undici` ProxyAgent、ffmpeg/ffprobe、Node 内置测试运行器 `node --test` + `node:assert/strict`。

## Global Constraints

- 模块系统:CommonJS(`require`/`module.exports`),与现有代码一致。
- 测试:Node 内置 `node --test`,断言用 `node:assert/strict`,测试文件放 `test/`,命名 `*.test.js`。不引入测试框架依赖。
- 不新增运行时依赖:ElevenLabs 用 REST `fetch`(Node 22 内置)+ 已有 `undici` 代理;**不安装** `@elevenlabs/elevenlabs-js`。
- 模型/默认值(verbatim):`CLAUDE_MODEL` 默认 `claude-opus-4-8`;`ELEVENLABS_MODEL` 默认 `eleven_v3`;`ELEVENLABS_LANGUAGE` 默认 `cmn`;`ELEVENLABS_OUTPUT_FORMAT` 默认 `mp3_44100_128`;`ELEVENLABS_VOICE_A` 默认 `DowyQ68vDpgFYdWVGjc3`;`ELEVENLABS_VOICE_B` 默认 `ByhETIclHirOlWnWKhHc`;`ELEVENLABS_SINGLE_SHOT_MAX` 默认 `4500`;`ELEVENLABS_CHUNK_CHARS` 默认 `1800`;`CLAUDE_MAX_CONCURRENT` 默认 `1`;`ELEVENLABS_MAX_CONCURRENT` 默认 `1`。
- Claude 子进程:用 stdin 传 prompt;`--output-format text`;禁用内置工具 + MCP(`mcp__*`);**不用 `--bare`**;child env 白名单 + 默认删 `ANTHROPIC_API_KEY`(仅 `CLAUDE_ALLOW_API_KEY=1` 时透传)。
- ElevenLabs 字符上限:软 2000 / 硬 5000(中文 1 汉字 = 1 字符,情绪标签计入);非流式 convert 端点。
- 保留 `ffmpeg`/`ffprobe`/`undici` 依赖;完全删除 Gemini 与 `@google/*`;勿删 `public/index.html` 的 Google Fonts。
- 现有契约不变:`generateScript(text) → { raw, dialogues, summary, ttsText }`,`dialogues=[{speaker,text,isInterrupt}]`,`tts.synthesize(dialogues, outputPath, options)`。
- 提交信息结尾加:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

### Task 1: 测试基础设施 + 错误类型(ProviderError / isDisplayableError)

**Files:**
- Modify: `package.json`(加 `test` 脚本)
- Create: `src/services/errors.js`
- Create: `test/errors.test.js`
- Read(确认): `src/services/articleExtractor.js`(确认 `ValidationError` 导出与 `name`)

**Interfaces:**
- Produces:
  - `ProviderError`(`class ... extends Error`,`name === 'ProviderError'`)— 用于可安全展示给用户的配置/认证/voice/额度类错误。
  - `isDisplayableError(error) → boolean` — 判断错误 message 是否可直接展示。
  - `npm test` 运行 `node --test test/`。

- [ ] **Step 1: 确认 ValidationError 形态**

Run: `grep -n "class ValidationError\|this.name\|module.exports" src/services/articleExtractor.js`
Expected: 看到 `ValidationError` 的定义与导出。若它**没有**设置 `this.name = 'ValidationError'`,`isDisplayableError` 仍能用 `instanceof` 兜住(下面实现两者都查)。

- [ ] **Step 2: 写失败测试 `test/errors.test.js`**

```js
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
```

- [ ] **Step 3: 加 test 脚本到 package.json**

把 `scripts` 改为含:
```json
"scripts": {
  "start": "node server.js",
  "dev": "node server.js",
  "test": "node --test test/"
}
```

- [ ] **Step 4: 运行测试验证失败**

Run: `npm test`
Expected: FAIL —— `Cannot find module '../src/services/errors'`。

- [ ] **Step 5: 实现 `src/services/errors.js`**

```js
const { ValidationError } = require('./articleExtractor');

class ProviderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProviderError';
  }
}

function isDisplayableError(error) {
  if (!error) return false;
  if (error instanceof ProviderError) return true;
  if (ValidationError && error instanceof ValidationError) return true;
  return error.name === 'ValidationError' || error.name === 'ProviderError';
}

module.exports = { ProviderError, isDisplayableError };
```

- [ ] **Step 6: 运行测试验证通过**

Run: `npm test`
Expected: PASS（5 个 errors 测试通过）。

- [ ] **Step 7: Commit**

```bash
git add package.json src/services/errors.js test/errors.test.js
git commit -m "$(printf 'feat: add ProviderError + isDisplayableError + node test runner\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: 基类增强 —— stripAudioTags + fallbackSummary 下沉 + parser 插嘴容错

**Files:**
- Modify: `src/services/llm/LLMProvider.js`
- Create: `test/llmProvider.test.js`

**Interfaces:**
- Consumes: 现有 `parseScript`/`parseSpeakerFormat`。
- Produces:
  - 模块导出新增 `stripAudioTags(text) → string`(同时仍 `module.exports = LLMProvider`,改为 `module.exports = LLMProvider; module.exports.stripAudioTags = stripAudioTags;`)。
  - 基类方法 `fallbackSummary(dialogues) → string`(下沉自 GeminiLLM,生成前剥离情绪标签)。
  - `parseSpeakerFormat` 的 `isInterrupt` 判定容错 `--` 后跟空白。

- [ ] **Step 1: 写失败测试 `test/llmProvider.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const LLMProvider = require('../src/services/llm/LLMProvider');
const { stripAudioTags } = require('../src/services/llm/LLMProvider');

test('stripAudioTags 移除方括号情绪标签并规整空白', () => {
  assert.equal(stripAudioTags('[laughs] 啊？真的[curious]假的？'), '啊？真的假的？');
  assert.equal(stripAudioTags('没有标签'), '没有标签');
});

test('fallbackSummary 不含情绪标签', () => {
  const p = new LLMProvider();
  const dialogues = [
    { speaker: 'Speaker_A', text: '[excited] 这个事儿特别有意思' },
    { speaker: 'Speaker_B', text: '[surprised] 啊？怎么说？' },
  ];
  const s = p.fallbackSummary(dialogues);
  assert.ok(!s.includes('['), '摘要不应包含 [ 标签');
  assert.ok(s.length > 0);
});

test('parseSpeakerFormat 识别行尾 -- 插嘴(含尾随空白)', () => {
  const p = new LLMProvider();
  const out = p.parseSpeakerFormat('Speaker_A: 这个架构其实--  \nSpeaker_B: 等等，你说的是分布式吗？');
  assert.equal(out.length, 2);
  assert.equal(out[0].isInterrupt, true);
  assert.equal(out[0].text, '这个架构其实');
  assert.equal(out[1].isInterrupt, false);
});

test('parseSpeakerFormat 保留行内情绪标签到 text', () => {
  const p = new LLMProvider();
  const out = p.parseSpeakerFormat('Speaker_B: [curious] 这是啥意思？');
  assert.equal(out[0].text, '[curious] 这是啥意思？');
  assert.equal(out[0].isInterrupt, false);
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm test`
Expected: FAIL（`stripAudioTags` 未导出 / `fallbackSummary` 未定义于基类 / 容错断言）。

- [ ] **Step 3: 在 `LLMProvider.js` 顶部加 `stripAudioTags`,基类加 `fallbackSummary`,改 parser**

在文件顶部(class 定义之前)加:
```js
function stripAudioTags(text) {
  return String(text == null ? '' : text)
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
```

在 `class LLMProvider {` 内新增方法:
```js
  /**
   * 兜底简介生成(当未返回 # Summary 时)。生成前剥离情绪标签。
   * @param {Array<{text:string}>} dialogues
   * @returns {string}
   */
  fallbackSummary(dialogues) {
    const joined = dialogues.slice(0, 5).map(d => d.text).join(' ');
    const cleaned = stripAudioTags(joined).replace(/[「」“”‘’]/g, '');
    return cleaned.substring(0, 180);
  }
```

把 `parseSpeakerFormat` 里的插嘴判定:
```js
        // 检测 -- 结尾标记（表示下一句是插嘴）
        if (text.endsWith('--')) {
          isInterrupt = true;
          text = text.slice(0, -2).trim();
        }
```
改为:
```js
        // 检测行尾 -- 插嘴标记（容错尾随空白）
        if (/--\s*$/.test(text)) {
          isInterrupt = true;
          text = text.replace(/--\s*$/, '').trim();
        }
```

把文件底部 `module.exports = LLMProvider;` 改为:
```js
module.exports = LLMProvider;
module.exports.stripAudioTags = stripAudioTags;
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test`
Expected: PASS（errors + llmProvider 测试全过）。

- [ ] **Step 5: Commit**

```bash
git add src/services/llm/LLMProvider.js test/llmProvider.test.js
git commit -m "$(printf 'feat: base-class fallbackSummary + stripAudioTags + interrupt parse tolerance\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Prompt 调整(去 Gemini、加情绪标签、`--` 行尾约束)

**Files:**
- Modify: `src/services/llm/LLMProvider.js`(`getPrompt`)
- Create: `test/prompt.test.js`

**Interfaces:**
- Consumes: `getPrompt(text)`。
- Produces: 调整后的 `getPrompt`，保留 `Speaker_A:/Speaker_B:` + `--` + `# Summary:` 契约。

- [ ] **Step 1: 写失败测试 `test/prompt.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const LLMProvider = require('../src/services/llm/LLMProvider');

test('getPrompt 不再含 Gemini 专属字眼', () => {
  const p = new LLMProvider().getPrompt('文章正文');
  assert.ok(!/Google DeepMind/i.test(p));
  assert.ok(!/Charon/i.test(p));
  assert.ok(!/Callirrhoe/i.test(p));
});

test('getPrompt 保留输出格式契约', () => {
  const p = new LLMProvider().getPrompt('文章正文');
  assert.ok(p.includes('Speaker_A'));
  assert.ok(p.includes('Speaker_B'));
  assert.ok(p.includes('# Summary'));
  assert.ok(p.includes('--'));
});

test('getPrompt 含情绪标签指令与示例', () => {
  const p = new LLMProvider().getPrompt('文章正文');
  assert.ok(/\[laughs\]|\[curious\]|\[excited\]|\[sighs\]/.test(p), '应包含情绪标签示例');
  assert.ok(p.includes('文章正文'), '应内嵌输入文本');
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm test`
Expected: FAIL（prompt 仍含 Charon/Callirrhoe，缺情绪标签指令）。

- [ ] **Step 3: 改写 `getPrompt`**

把 `getPrompt(pdfText)` 返回的模板按下述要点修改(保持其余结构):
- 把角色介绍里 `(对应 TTS: Charon)` / `(对应 TTS: Callirrhoe)` 删除;把 `# Role` 段开头 `你是由 Google DeepMind 调教的顶尖中文播客制作人` 改为 `你是顶尖的中文播客制作人`。
- 在 `# Conversation Rules` 末尾新增一条规则块:
```
6. 情绪标签 (Audio Tags):
   - 在台词中克制地插入英文方括号情绪标签，交给语音模型表演。可用标签举例：[laughs]、[sighs]、[curious]、[excited]、[surprised]、[thoughtful]。
   - 放在句首或句中，每句至多 0-1 个，仅在情绪明显处使用（过度使用会让语音不稳定）。
   - 示例：Speaker_B: [surprised] 啊？真的假的？
   - # Summary 行不要加任何标签。
```
- 在 `# Fatal Constraints` 里把插嘴说明补一条:`5. 插嘴标记 -- 必须位于该行最末尾，其后不得再跟情绪标签或文字。`

> 注意:`${pdfText}` 内嵌与 `# Output Format Example`、`请直接开始输出脚本` 等保持不变。

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/services/llm/LLMProvider.js test/prompt.test.js
git commit -m "$(printf 'feat: adapt prompt for Claude + ElevenLabs emotion tags\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: Claude 子进程纯工具(buildClaudeArgs / buildChildEnv) + 信号量

**Files:**
- Create: `src/services/llm/claudeProcess.js`
- Create: `src/utils/semaphore.js`
- Create: `test/claudeProcess.test.js`
- Create: `test/semaphore.test.js`

**Interfaces:**
- Produces:
  - `buildClaudeArgs({ model, disableToolsArgs }) → string[]`
  - `buildChildEnv(env, { allowApiKey }) → object`
  - `createSemaphore(max) → { acquire(): Promise<void>, release(): void }`

- [ ] **Step 1: 写失败测试 `test/claudeProcess.test.js`**

```js
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
```

- [ ] **Step 2: 写失败测试 `test/semaphore.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSemaphore } = require('../src/utils/semaphore');

test('createSemaphore 限制并发为 1，串行放行', async () => {
  const sem = createSemaphore(1);
  const order = [];
  async function job(id) {
    await sem.acquire();
    order.push(`start-${id}`);
    await new Promise(r => setTimeout(r, 10));
    order.push(`end-${id}`);
    sem.release();
  }
  await Promise.all([job(1), job(2)]);
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
});
```

- [ ] **Step 3: 运行测试验证失败**

Run: `npm test`
Expected: FAIL（两个新模块不存在）。

- [ ] **Step 4: 实现 `src/utils/semaphore.js`**

```js
function createSemaphore(max) {
  let active = 0;
  const waiters = [];
  return {
    acquire() {
      if (active < max) { active++; return Promise.resolve(); }
      return new Promise(resolve => waiters.push(resolve)).then(() => { active++; });
    },
    release() {
      active--;
      const next = waiters.shift();
      if (next) next();
    },
  };
}

module.exports = { createSemaphore };
```

- [ ] **Step 5: 实现 `src/services/llm/claudeProcess.js`**

```js
// 禁用工具的确切 flag 以 `claude --help` 实测为准。
// 语义要求：禁用全部内置工具 + MCP 工具(mcp__*)，不使用 --bare。
const DEFAULT_DISABLE_TOOLS_ARGS = ['--tools', '', '--disallowedTools', 'mcp__*'];

const ENV_ALLOWLIST = [
  'PATH', 'HOME', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'SHELL', 'USER', 'TERM',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'TMPDIR',
];

function buildClaudeArgs({ model, disableToolsArgs = DEFAULT_DISABLE_TOOLS_ARGS }) {
  return ['-p', '--model', model, '--output-format', 'text', ...disableToolsArgs];
}

function buildChildEnv(env, { allowApiKey = false } = {}) {
  const out = {};
  for (const key of ENV_ALLOWLIST) {
    if (env[key] !== undefined) out[key] = env[key];
  }
  if (allowApiKey && env.ANTHROPIC_API_KEY) {
    out.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  }
  return out;
}

module.exports = { buildClaudeArgs, buildChildEnv, DEFAULT_DISABLE_TOOLS_ARGS };
```

- [ ] **Step 6: 运行测试验证通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/services/llm/claudeProcess.js src/utils/semaphore.js test/claudeProcess.test.js test/semaphore.test.js
git commit -m "$(printf 'feat: claude args/env builders + concurrency semaphore\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: ClaudeCliLLM(组装 spawn + 解析 + 重试 + 并发)

**Files:**
- Create: `src/services/llm/ClaudeCliLLM.js`
- Create: `test/claudeCliLLM.test.js`

**Interfaces:**
- Consumes: `LLMProvider`(getPrompt/parseScript/fallbackSummary)、`buildClaudeArgs`/`buildChildEnv`、`createSemaphore`、`ProviderError`。
- Produces: `class ClaudeCliLLM extends LLMProvider`,`getName()→'Claude (claude -p)'`,`async generateScript(text)→{raw,dialogues,summary,ttsText}`,内部 `async runClaude(prompt)→string`(供测试 mock)。

- [ ] **Step 1: 写失败测试 `test/claudeCliLLM.test.js`**(mock `runClaude`,只验证组装/解析/fallback)

```js
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const ClaudeCliLLM = require('../src/services/llm/ClaudeCliLLM');

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

test('generateScript 在无法解析时抛错', async () => {
  const llm = new ClaudeCliLLM();
  mock.method(llm, 'runClaude', async () => '一段没有 Speaker 前缀的普通文字');
  await assert.rejects(() => llm.generateScript('x'), /无法解析|格式/);
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm test`
Expected: FAIL（`ClaudeCliLLM` 不存在）。

- [ ] **Step 3: 实现 `src/services/llm/ClaudeCliLLM.js`**

```js
const { spawn } = require('child_process');
const LLMProvider = require('./LLMProvider');
const { ProviderError } = require('../errors');
const { buildClaudeArgs, buildChildEnv } = require('./claudeProcess');
const { createSemaphore } = require('../utils/semaphore');

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS) || 120000;
const MAX_CONCURRENT = parseInt(process.env.CLAUDE_MAX_CONCURRENT) || 1;
const ALLOW_API_KEY = process.env.CLAUDE_ALLOW_API_KEY === '1';
const MAX_RETRIES = 3;

const semaphore = createSemaphore(MAX_CONCURRENT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class ClaudeCliLLM extends LLMProvider {
  getName() {
    return 'Claude (claude -p)';
  }

  /** 运行 claude -p，stdin 传 prompt，resolve stdout。 */
  runClaude(prompt) {
    return new Promise((resolve, reject) => {
      const args = buildClaudeArgs({ model: CLAUDE_MODEL });
      const env = buildChildEnv(process.env, { allowApiKey: ALLOW_API_KEY });
      let child;
      try {
        child = spawn(CLAUDE_BIN, args, { env });
      } catch (err) {
        return reject(new ProviderError(`无法启动 claude CLI(${CLAUDE_BIN}): ${err.message}`));
      }
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('claude -p 调用超时'));
      }, TIMEOUT_MS);
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new ProviderError(`无法启动 claude CLI(${CLAUDE_BIN}): ${err.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          const msg = stderr.trim();
          if (/login|auth|unauthor|credential|not logged/i.test(msg)) {
            return reject(new ProviderError('claude 未登录或鉴权失败，请在本机运行 `claude` 登录订阅后重试'));
          }
          return reject(new Error(`claude -p 退出码 ${code}: ${msg || '未知错误'}`));
        }
        resolve(stdout);
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }

  async generateScript(articleText) {
    const prompt = this.getPrompt(articleText);
    await semaphore.acquire();
    try {
      let rawScript = '';
      let lastError;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const out = await this.runClaude(prompt);
          if (out && out.trim()) { rawScript = out; break; }
          throw new Error('claude 返回空输出');
        } catch (err) {
          if (err instanceof ProviderError) throw err; // 鉴权类不重试
          lastError = err;
          if (attempt < MAX_RETRIES) await sleep(2000 * attempt);
        }
      }
      if (!rawScript) throw lastError || new Error('claude 脚本生成失败');

      const { dialogues, summary } = this.parseScript(rawScript);
      if (dialogues.length === 0) throw new Error('生成的脚本格式不正确，无法解析对话');

      const ttsText = dialogues.map((d) => `${d.speaker}: ${d.text}`).join('\n');
      return {
        raw: rawScript,
        dialogues,
        summary: summary || this.fallbackSummary(dialogues),
        ttsText,
      };
    } finally {
      semaphore.release();
    }
  }
}

module.exports = ClaudeCliLLM;
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/services/llm/ClaudeCliLLM.js test/claudeCliLLM.test.js
git commit -m "$(printf 'feat: ClaudeCliLLM via claude -p subprocess\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: ElevenLabs 对话纯逻辑(dialogueUtils)

**Files:**
- Create: `src/services/tts/dialogueUtils.js`
- Create: `test/dialogueUtils.test.js`

**Interfaces:**
- Produces:
  - `normalizeSpeaker(s) → 'Speaker_A'|'Speaker_B'`
  - `buildDialogueInputs(dialogues, { voiceA, voiceB }) → Array<{text, voice_id}>`(isInterrupt → text 末尾追加 `-`)
  - `totalChars(inputs) → number`
  - `chunkInputsByChars(inputs, maxChars) → Array<Array<{text,voice_id}>>`(speaker 边界即每个 input 边界)
  - `expectedSeconds(charCount, opts) → number`
  - `isLikelyTruncated(actualSeconds, charCount, opts) → boolean`

- [ ] **Step 1: 写失败测试 `test/dialogueUtils.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSpeaker, buildDialogueInputs, totalChars,
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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm test`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/services/tts/dialogueUtils.js`**

```js
function normalizeSpeaker(s) {
  const raw = String(s == null ? '' : s).trim();
  if (/^(speaker_?a|老王|小墨|a)$/i.test(raw)) return 'Speaker_A';
  if (/^(speaker_?b|小李|小夏|b)$/i.test(raw)) return 'Speaker_B';
  return 'Speaker_A';
}

function buildDialogueInputs(dialogues, { voiceA, voiceB }) {
  return dialogues.map((d) => {
    const voice_id = normalizeSpeaker(d.speaker) === 'Speaker_A' ? voiceA : voiceB;
    let text = d.text == null ? '' : String(d.text);
    if (d.isInterrupt) text = text.replace(/\s*$/, '') + '-';
    return { text, voice_id };
  });
}

function totalChars(inputs) {
  return inputs.reduce((n, i) => n + (i.text ? i.text.length : 0), 0);
}

function chunkInputsByChars(inputs, maxChars) {
  const chunks = [];
  let cur = [];
  let count = 0;
  for (const inp of inputs) {
    const len = inp.text ? inp.text.length : 0;
    if (cur.length > 0 && count + len > maxChars) {
      chunks.push(cur);
      cur = [];
      count = 0;
    }
    cur.push(inp);
    count += len;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

function expectedSeconds(charCount, { charsPerSec = 4.5 } = {}) {
  return charCount / charsPerSec;
}

function isLikelyTruncated(actualSeconds, charCount, { charsPerSec = 4.5, floorRatio = 0.6 } = {}) {
  if (!actualSeconds || actualSeconds <= 0) return true;
  return actualSeconds < expectedSeconds(charCount, { charsPerSec }) * floorRatio;
}

module.exports = {
  normalizeSpeaker, buildDialogueInputs, totalChars,
  chunkInputsByChars, expectedSeconds, isLikelyTruncated,
};
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/services/tts/dialogueUtils.js test/dialogueUtils.test.js
git commit -m "$(printf 'feat: ElevenLabs dialogue mapping/chunking/integrity utils\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: ElevenLabsTTS(REST + 单次/分块 + 完整性校验 + ffmpeg 拼接)

**Files:**
- Create: `src/services/tts/ElevenLabsTTS.js`
- Create: `test/elevenLabsTTS.test.js`

**Interfaces:**
- Consumes: `TTSProvider`、`dialogueUtils`、`ProviderError`、`createSemaphore`、`undici` ProxyAgent、`ffmpeg`/`ffprobe`。
- Produces: `class ElevenLabsTTS extends TTSProvider`,`getName()→'ElevenLabs (eleven_v3)'`,`async synthesize(dialogues, outputPath, options)`,内部 `async callDialogue(inputs)→Buffer`(供测试 mock)。

- [ ] **Step 1: 写失败测试 `test/elevenLabsTTS.test.js`**(mock `callDialogue`,避免真实网络/ffmpeg)

```js
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
```

> 说明:`callDialogue`、`probeDurationMs`、`concatSegments` 都是实例方法，方便 `mock.method` 注入，绕开真实网络与 ffmpeg。测试用小的 `SINGLE_SHOT_MAX`/`CHUNK_CHARS` 触发各分支。

- [ ] **Step 2: 运行测试验证失败**

Run: `npm test`
Expected: FAIL（`ElevenLabsTTS` 不存在）。

- [ ] **Step 3: 实现 `src/services/tts/ElevenLabsTTS.js`**

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const TTSProvider = require('./TTSProvider');
const { ProviderError } = require('../errors');
const { createSemaphore } = require('../utils/semaphore');
const {
  buildDialogueInputs, totalChars, chunkInputsByChars, isLikelyTruncated,
} = require('./dialogueUtils');

if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY || process.env.HTTP_PROXY));
}

const API_URL = 'https://api.elevenlabs.io/v1/text-to-dialogue';
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_v3';
const LANGUAGE = process.env.ELEVENLABS_LANGUAGE || 'cmn';
const OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128';
const VOICE_A = process.env.ELEVENLABS_VOICE_A || 'DowyQ68vDpgFYdWVGjc3';
const VOICE_B = process.env.ELEVENLABS_VOICE_B || 'ByhETIclHirOlWnWKhHc';
const SINGLE_SHOT_MAX = parseInt(process.env.ELEVENLABS_SINGLE_SHOT_MAX) || 4500;
const CHUNK_CHARS = parseInt(process.env.ELEVENLABS_CHUNK_CHARS) || 1800;
const STABILITY = process.env.ELEVENLABS_STABILITY;
const MAX_CONCURRENT = parseInt(process.env.ELEVENLABS_MAX_CONCURRENT) || 1;
const RETRY = { maxRetries: 5, baseDelayMs: 4000, maxDelayMs: 60000 };

const semaphore = createSemaphore(MAX_CONCURRENT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class ElevenLabsTTS extends TTSProvider {
  constructor() {
    super();
    this.apiKey = process.env.ELEVENLABS_API_KEY;
    if (!this.apiKey) throw new ProviderError('ELEVENLABS_API_KEY 环境变量未设置');
  }

  getName() {
    return 'ElevenLabs (eleven_v3)';
  }

  /** 调用对话端点,返回 mp3 Buffer。长度类错误打 isValidation 标记。 */
  async callDialogue(inputs) {
    const body = { inputs, model_id: MODEL, language_code: LANGUAGE };
    if (STABILITY) body.settings = { stability: parseFloat(STABILITY), use_speaker_boost: true };
    const url = `${API_URL}?output_format=${encodeURIComponent(OUTPUT_FORMAT)}`;
    let lastError;
    for (let attempt = 1; attempt <= RETRY.maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'xi-api-key': this.apiKey, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.status === 401 || res.status === 403) {
          throw new ProviderError('ElevenLabs 鉴权失败，请检查 API key 与权限范围');
        }
        if (res.status === 400 || res.status === 422) {
          const t = await res.text();
          const e = new Error(`ElevenLabs 校验错误 ${res.status}: ${t}`);
          e.isValidation = true;
          throw e;
        }
        if (res.status === 429) throw new Error('ElevenLabs 限流(429)');
        if (!res.ok) throw new Error(`ElevenLabs 错误 ${res.status}: ${await res.text()}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length) throw new Error('ElevenLabs 返回空音频');
        return buf;
      } catch (err) {
        if (err instanceof ProviderError || err.isValidation) throw err;
        lastError = err;
        if (attempt < RETRY.maxRetries) {
          await sleep(Math.min(RETRY.baseDelayMs * 2 ** (attempt - 1), RETRY.maxDelayMs));
        }
      }
    }
    throw new Error(`ElevenLabs 合成失败(已重试 ${RETRY.maxRetries} 次): ${lastError && lastError.message}`);
  }

  async probeDurationMs(filePath) {
    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
      );
      return Math.round(parseFloat(stdout.trim()) * 1000);
    } catch {
      return 0;
    }
  }

  async concatSegments(segPaths, outputPath, tmpDir) {
    const listPath = path.join(tmpDir, 'concat.txt');
    const lines = segPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listPath, lines);
    await execAsync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`);
  }

  async synthesizeChunked(inputs, outputPath, tmpDir) {
    const chunks = chunkInputsByChars(inputs, CHUNK_CHARS);
    if (chunks.length === 1) {
      const buf = await this.callDialogue(chunks[0]);
      fs.writeFileSync(outputPath, buf);
      return;
    }
    const segPaths = [];
    for (let i = 0; i < chunks.length; i++) {
      const buf = await this.callDialogue(chunks[i]);
      const p = path.join(tmpDir, `seg_${i}.mp3`);
      fs.writeFileSync(p, buf);
      segPaths.push(p);
    }
    await this.concatSegments(segPaths, outputPath, tmpDir);
  }

  async synthesize(dialogues, outputPath, _options = {}) {
    if (!Array.isArray(dialogues) || dialogues.length === 0) {
      throw new Error('对话数据无效');
    }
    await semaphore.acquire();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eleven-'));
    try {
      const inputs = buildDialogueInputs(dialogues, { voiceA: VOICE_A, voiceB: VOICE_B });
      const total = totalChars(inputs);

      if (total <= SINGLE_SHOT_MAX) {
        try {
          const buf = await this.callDialogue(inputs);
          fs.writeFileSync(outputPath, buf);
          const durMs = await this.probeDurationMs(outputPath);
          if (isLikelyTruncated(durMs / 1000, total)) {
            console.warn('[ElevenLabs] 单次合成疑似截断，降级分块重试');
            await this.synthesizeChunked(inputs, outputPath, tmpDir);
          }
          return;
        } catch (err) {
          if (err.isValidation) {
            console.warn('[ElevenLabs] 单次合成校验错误，降级分块');
            await this.synthesizeChunked(inputs, outputPath, tmpDir);
            return;
          }
          throw err;
        }
      }
      await this.synthesizeChunked(inputs, outputPath, tmpDir);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      semaphore.release();
    }
  }
}

module.exports = ElevenLabsTTS;
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/services/tts/ElevenLabsTTS.js test/elevenLabsTTS.test.js
git commit -m "$(printf 'feat: ElevenLabsTTS via text-to-dialogue REST + integrity/chunk fallback\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 8: 工厂切换 + 删除 Gemini + JSDoc 修正

**Files:**
- Modify: `src/services/llm/index.js`
- Modify: `src/services/tts/index.js`
- Modify: `src/services/tts/TTSProvider.js`(JSDoc)
- Delete: `src/services/llm/GeminiLLM.js`
- Delete: `src/services/tts/GeminiTTS.js`
- Create: `test/factories.test.js`

**Interfaces:**
- Consumes: `ClaudeCliLLM`、`ElevenLabsTTS`。
- Produces: 工厂默认返回新 provider。

- [ ] **Step 1: 写失败测试 `test/factories.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'test-key';

test('LLM 工厂默认返回 Claude provider', () => {
  const llm = require('../src/services/llm');
  assert.equal(llm.getName(), 'Claude (claude -p)');
});

test('TTS 工厂默认返回 ElevenLabs provider', () => {
  const tts = require('../src/services/tts');
  assert.equal(tts.getName(), 'ElevenLabs (eleven_v3)');
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm test`
Expected: FAIL（工厂仍返回 Gemini）。

- [ ] **Step 3: 改写 `src/services/llm/index.js`**

```js
const ClaudeCliLLM = require('./ClaudeCliLLM');

const PROVIDER = (process.env.LLM_PROVIDER || 'claude').toLowerCase();

let instance = null;

function getLLMProvider() {
  if (instance) return instance;
  switch (PROVIDER) {
    case 'claude':
    default:
      instance = new ClaudeCliLLM();
      break;
  }
  console.log(`LLM Provider: ${instance.getName()}`);
  return instance;
}

module.exports = getLLMProvider();
module.exports.default = getLLMProvider();
```

- [ ] **Step 4: 改写 `src/services/tts/index.js`**

```js
const ElevenLabsTTS = require('./ElevenLabsTTS');

const PROVIDER = (process.env.TTS_PROVIDER || 'elevenlabs').toLowerCase();

let instance = null;

function getTTSProvider() {
  if (instance) return instance;
  switch (PROVIDER) {
    case 'elevenlabs':
    default:
      instance = new ElevenLabsTTS();
      break;
  }
  console.log(`TTS Provider: ${instance.getName()}`);
  return instance;
}

module.exports = getTTSProvider();
module.exports.default = getTTSProvider();
```

- [ ] **Step 5: 修正 `TTSProvider.js` 的 JSDoc**

把 `synthesize` 的 JSDoc 由 `@param {string} script` 改为真实契约:
```js
  /**
   * 将对话脚本合成为音频
   * @param {Array<{speaker:string,text:string,isInterrupt?:boolean}>} dialogues - 结构化对话
   * @param {string} outputPath - 输出音频文件路径
   * @param {{stylePrompt?:string}} [options]
   * @returns {Promise<void>}
   */
```

- [ ] **Step 6: 删除 Gemini 实现**

```bash
git rm src/services/llm/GeminiLLM.js src/services/tts/GeminiTTS.js
```

- [ ] **Step 7: 运行测试验证通过 + 确认无残留 import**

Run: `npm test`
Expected: PASS。
Run: `grep -rn "GeminiLLM\|GeminiTTS\|@google/" src/`
Expected: 无输出。

- [ ] **Step 8: Commit**

```bash
git add src/services/llm/index.js src/services/tts/index.js src/services/tts/TTSProvider.js test/factories.test.js
git commit -m "$(printf 'feat: switch factories to Claude+ElevenLabs, remove Gemini providers\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 9: queue.js 错误展示扩展

**Files:**
- Modify: `src/services/queue.js`
- Create: `test/queueError.test.js`

**Interfaces:**
- Consumes: `isDisplayableError`。
- Produces: queue 对 `ProviderError`/`ValidationError` 保留原始 message。

- [ ] **Step 1: 写失败测试 `test/queueError.test.js`**(验证 isDisplayableError 在 queue 选择 message 的逻辑)

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isDisplayableError, ProviderError } = require('../src/services/errors');

// 复刻 queue 的展示选择逻辑，确保契约一致
function resolveMessage(error) {
  return isDisplayableError(error) ? error.message : '处理过程中发生错误，请重试';
}

test('ProviderError 的 message 被展示', () => {
  assert.equal(resolveMessage(new ProviderError('ELEVENLABS_API_KEY 未设置')), 'ELEVENLABS_API_KEY 未设置');
});

test('普通错误回退到通用文案', () => {
  assert.equal(resolveMessage(new Error('boom')), '处理过程中发生错误，请重试');
});
```

- [ ] **Step 2: 运行测试验证通过(纯逻辑)**

Run: `npm test`
Expected: PASS（此测试锁定我们将写入 queue 的逻辑契约）。

- [ ] **Step 3: 修改 `src/services/queue.js`**

在文件顶部 require 区加:
```js
const { isDisplayableError } = require('./errors');
```

把 `processNext` 的 catch 中:
```js
      const errorMessage = error instanceof ValidationError
        ? error.message
        : '处理过程中发生错误，请重试';
```
改为:
```js
      const errorMessage = isDisplayableError(error)
        ? error.message
        : '处理过程中发生错误，请重试';
```

- [ ] **Step 4: 运行测试 + 确认 server 仍能加载**

Run: `npm test`
Expected: PASS。
Run: `node -e "process.env.ELEVENLABS_API_KEY='x'; require('./src/services/queue.js'); console.log('queue loads OK')"`
Expected: 打印 `queue loads OK`(无 require 错误)。

- [ ] **Step 5: Commit**

```bash
git add src/services/queue.js test/queueError.test.js
git commit -m "$(printf 'feat: surface ProviderError messages in task queue\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 10: 配置与文档(.env.example / package.json / lockfile / README)

**Files:**
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `package-lock.json`(经 `npm install` 自动更新)
- Modify: `README.md`

- [ ] **Step 1: 改写 `.env.example`**

整体替换为:
```
# ElevenLabs
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_A=DowyQ68vDpgFYdWVGjc3   # 老王/男
ELEVENLABS_VOICE_B=ByhETIclHirOlWnWKhHc   # 小李/女
# 可选: ELEVENLABS_MODEL=eleven_v3 / ELEVENLABS_LANGUAGE=cmn /
#        ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128 /
#        ELEVENLABS_SINGLE_SHOT_MAX=4500 / ELEVENLABS_CHUNK_CHARS=1800 /
#        ELEVENLABS_STABILITY / ELEVENLABS_MAX_CONCURRENT=1

# Claude Code CLI (脚本生成, 复用本机 claude 登录态)
# 可选: CLAUDE_MODEL=claude-opus-4-8 / CLAUDE_BIN=claude /
#        CLAUDE_TIMEOUT_MS=120000 / CLAUDE_MAX_CONCURRENT=1 / CLAUDE_ALLOW_API_KEY=0

# 服务端口 (可选, 默认 3000)
PORT=3000

# 代理设置 (可选, 用于访问 ElevenLabs / Claude)
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
```

- [ ] **Step 2: 改 `package.json` 依赖与 keywords**

- 从 `dependencies` 删除 `@google/genai` 与 `@google/generative-ai` 两行。
- `keywords` 把 `"gemini"` 改为 `"claude"`,把 `"tts"` 后追加 `"elevenlabs"`。

- [ ] **Step 3: 更新 lockfile 并验证无 @google 残留**

Run:
```bash
npm install
grep -c "@google/" package-lock.json || echo "0 @google refs"
```
Expected: `@google/` 计数为 0(或 grep 无匹配返回 "0 @google refs")。

- [ ] **Step 4: 更新 README**

Run: `grep -ni "gemini\|google gemini\|GEMINI_API_KEY" README.md`
逐条把命中行的描述从 Gemini 改为 “Claude Opus 4.8(经 claude -p)+ ElevenLabs(eleven_v3)”;把环境变量 `GEMINI_API_KEY` 的说明替换为 `ELEVENLABS_API_KEY`(及可选 `CLAUDE_*`/`ELEVENLABS_*`);新增“前置条件:本机已安装并登录 Claude Code CLI(`claude`)”。
**不要**改动任何 `fonts.googleapis.com` 行(Google Fonts,与 Gemini 无关)。

- [ ] **Step 5: 验证 + Commit**

Run: `npm test`
Expected: PASS。
```bash
git add .env.example package.json package-lock.json README.md
git commit -m "$(printf 'chore: env/deps/docs for Claude+ElevenLabs, drop @google/*\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 11: 端到端冒烟验收(手动)

**Files:** 无(运行验证)

**前置条件:** 本机 `claude` 已登录订阅;`.env` 内已配 `ELEVENLABS_API_KEY`(有 Text-to-Speech/Dialogue 权限)与代理;已 `npm install`。

- [ ] **Step 1: 校验两个默认 voice_id 可用**

```bash
curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" https://api.elevenlabs.io/v1/voices/DowyQ68vDpgFYdWVGjc3 | head -c 200
curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" https://api.elevenlabs.io/v1/voices/ByhETIclHirOlWnWKhHc | head -c 200
```
Expected: 返回 voice 详情 JSON(非 404/401)。若失败,改用自己账户已 add 的 voice_id 并更新 `.env`。

- [ ] **Step 2: 确认 claude -p 可用**

Run: `printf '只回复两个字：在线' | claude -p --model claude-opus-4-8 --output-format text`
Expected: 输出包含“在线”,无登录/鉴权报错。若报登录错,先运行 `claude` 完成订阅登录。

- [ ] **Step 3: 启动服务并跑一篇真实文章**

```bash
npm start
```
通过前端或 API 提交一个真实微信公众号文章 URL,观察任务状态依次进入 parsing → generating → synthesizing → completed。

- [ ] **Step 4: 验证产物**

Expected:
- 生成的脚本可被解析(任务不因“格式无法解析”失败)。
- `data/users/<uid>/audio/<taskId>.mp3` 存在且可播放;2000–2500 字脚本应走单次合成(日志无“降级分块”),时长合理。
- 配置类错误(如未登录、缺 key、voice 无效)在前端展示为可读 message。

- [ ] **Step 5: 标记完成**

无需提交(纯验证)。若发现缺陷,回到对应 Task 修复。

---

## 附:依赖关系

- Task 1 → 所有(ProviderError/测试基础)。
- Task 2,3 改 `LLMProvider`(可顺序做)。
- Task 4 → Task 5(ClaudeCliLLM 依赖 args/env/semaphore)。
- Task 6 → Task 7(ElevenLabsTTS 依赖 dialogueUtils;semaphore 来自 Task 4)。
- Task 8 依赖 Task 5、7(新 provider 存在)。
- Task 9 依赖 Task 1(isDisplayableError)。
- Task 10、11 最后。
