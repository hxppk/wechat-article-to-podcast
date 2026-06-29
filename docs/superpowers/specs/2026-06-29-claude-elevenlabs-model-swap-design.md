# 设计:脚本与音频模型切换(Gemini → Claude Opus 4.8 + ElevenLabs)

- 日期:2026-06-29
- 状态:已批准设计 + 已纳入 codex 评审修正,待实现计划
- 范围:替换播客生成链路中的两个 AI provider

## 1. 概述

当前项目「微信公众号文章转播客」用 **Gemini** 同时承担两件事:用 `gemini-3-flash-preview` 生成双人对话脚本,用 `gemini-2.5-pro-preview-tts` 一次性合成多角色音频。

本次变更:
- **脚本生成** 改为 **Claude Opus 4.8**,通过本机 `claude -p`(Claude Code CLI headless 模式)子进程调用,复用 CLI 的订阅登录态,默认不使用 Anthropic API key。
- **音频合成** 改为 **ElevenLabs Text to Dialogue(`eleven_v3`)**,原生多角色,默认整篇一次生成,含情绪音频标签。
- **完全切换**:删除 Gemini 实现与依赖,不保留回退。

现有的 provider 抽象(`LLMProvider`/`TTSProvider` 基类 + `index.js` 工厂)保留,`queue.js` 数据流不变(仅扩展一处错误展示判断,见 5.6)。

## 2. 背景:当前架构与数据流

```
extractArticle(url) → { title, accountName, text }
        ↓
llm.generateScript(text) → { raw, dialogues, summary }
        ↓   dialogues = [{ speaker:'Speaker_A'|'Speaker_B', text, isInterrupt }]
tts.synthesize(dialogues, audioPath) → 写出 .mp3
```

关键文件:
- `src/services/llm/LLMProvider.js` — 基类,持有 `getPrompt()`、`parseScript()`、`parseDialogues()`、`parseSpeakerFormat()`。**provider 无关,复用。** `fallbackSummary()` 当前**只在 `GeminiLLM`**,需下沉到此基类(见 5.1)。
- `src/services/llm/GeminiLLM.js` — 当前实现(将删除)。
- `src/services/llm/index.js` — 工厂,按 `LLM_PROVIDER` 选择(默认 `gemini`,将改为 `claude`)。
- `src/services/tts/TTSProvider.js` — 基类(抽象 `synthesize`);JSDoc 当前写 `script: string`,与实际传入的 `dialogues` 数组不符,实现时同步修正。
- `src/services/tts/GeminiTTS.js` — 当前实现(将删除);其代理注入、重试、`taskId_raw.bin` 临时文件、ffmpeg 转码可作参考。
- `src/services/tts/index.js` — 工厂,按 `TTS_PROVIDER` 选择(默认 `gemini`,将改为 `elevenlabs`)。
- `src/services/queue.js` — 编排;`processNext` 对非 `ValidationError` 统一展示“处理过程中发生错误,请重试”(第 188–190 行),需扩展(见 5.6)。

## 3. 目标 / 非目标

目标:
- 脚本由 Claude Opus 4.8 经 `claude -p` 生成,产出结构与现有契约一致。
- 音频由 ElevenLabs `eleven_v3` 对话端点生成,带情绪标签,**默认整篇一次**合成,并对长度风险有检测与降级保底。
- 删除 Gemini 相关代码与依赖。
- 保持 `queue.js` 数据流与对外 API 不变(仅一处错误展示扩展)。

非目标:
- 不改前端、不改数据库 schema、不改文章抽取逻辑。
- 不保留 Gemini 作为可切换回退。
- 不做语音克隆/自定义音色训练。
- 第一版**不覆盖 Docker / 无头服务器部署**(见 8 风险)——仅支持本机已登录运行。

## 4. 已核实的关键事实(2026-06,附官方来源)

### 4.1 ElevenLabs Text to Dialogue
- 端点:`POST https://api.elevenlabs.io/v1/text-to-dialogue`(非流式 convert);流式为 `/stream`。本设计用**非流式 convert**。
- 认证 header:`xi-api-key`。
- 模型 id:`eleven_v3`(对话端点唯一支持的模型)。
- 请求体(REST,snake_case):`inputs` 数组,**每元素带自己的 `text` 与 `voice_id`**,顺序交替即多角色;`model_id`;可选 `language_code`(普通话 `"cmn"`)、`settings`(stability、use_speaker_boost)、`seed`、`apply_text_normalization`。URL query:`output_format`(默认 `mp3_44100_128`,直接返回 mp3)。
- 单请求**最多 10 个唯一 `voice_id`**;`inputs` 条数不限。
- 字符上限:**软上限 2,000 字符**(端点“可靠生成”建议,所有 `inputs[].text` 合计);**硬上限 5,000 字符**(`eleven_v3` 模型级)。中文 1 汉字 = 1 字符,情绪标签也计入。超软上限→“不保证可靠”;超硬上限→基本必然报错。非流式 convert 超限主要表现为**可捕获的 validation error**(“提前截断”警告针对流式端点)。
- 情绪/插嘴:**音频标签**为内联方括号自然语言指令(`[laughs]` `[curious]` `[excited]` `[sighs]` 等);插嘴用行尾破折号 `-` 或 `[jumping in]`,端点自动处理轮替/情绪过渡。低 stability 标签遵循度更高。
- Node SDK:`@elevenlabs/elevenlabs-js`,`client.textToDialogue.convert({ inputs:[{ text, voiceId }], modelId, ... })`(SDK camelCase)。本设计**优先直接用 REST `fetch`**(字段名确定 + 代理可控),SDK 作为可选。
- 可用性:GA(约 2026-03,无需 allowlist)。按字符计费 ~$0.10/1k;免费账户每月 ~10,000 credits 且**无商用授权**。
- 来源:convert / capabilities / cookbook / models API docs、npm 包页(见研究记录)。

### 4.2 `claude -p`(Claude Code CLI headless)
- 打印模式:`-p` / `--print`。
- 选模型:`--model claude-opus-4-8`(版本锁定;别名 `--model opus`)。默认用完整 id。
- 传 prompt:大 prompt 用 **stdin 管道**(避免超长参数/转义),stdin 上限 10MB。
- 输出:`--output-format text`(纯文本)。
- 禁用工具(语义要求,**必须满足**):禁用全部内置工具**且**禁用 MCP 工具(`mcp__*`),做纯文本生成。**不要用 `--bare`**(它会跳过 OAuth/keychain,导致无法复用订阅登录态)。确切 flag 名实现首步以 `claude --help` 实测确认;当前候选组合:`--tools "" --disallowedTools "mcp__*"`(或 `--permission-mode` 等价手段)。
- 认证:本机 `claude` 登录 Max/Pro 订阅后复用其登录态,**默认不依赖 `ANTHROPIC_API_KEY`**。子进程 env 显式构造(见 5.1)。
- 退出码:成功 0,失败非 0。
- 子进程:`child_process.spawn`(非 `exec`),`stdin.write(prompt)+end()`,收集 `stdout`,设超时。
- 来源:Claude Code headless / CLI reference docs、claude-opus-4-8 发布说明。

### 4.3 默认音色(ElevenLabs 语音库,普通话原生)
- 老王(Speaker_A,男,沉稳):**Jason Chen**,`voice_id = DowyQ68vDpgFYdWVGjc3`。
- 小李(Speaker_B,女,明亮):**ShanShan**,`voice_id = ByhETIclHirOlWnWKhHc`。
- 均为语音库共享音色,账户需先 add 一次;上线前用 `GET /v1/voices/{id}` 或一句测试合成验证。
- 兜底内置音色:George `JBFqnCBsd6RMkjVDRZzb`(英语录制,中文带口音,仅硬兜底)。

## 5. 详细设计

### 5.1 脚本生成:`ClaudeCliLLM extends LLMProvider`
新文件 `src/services/llm/ClaudeCliLLM.js`。

- 先将 `fallbackSummary(dialogues)` **从 `GeminiLLM` 下沉到 `LLMProvider` 基类**;实现时在截取摘要前**剥离方括号情绪标签**(正则去 `\[[^\]]*\]`),避免 fallback 摘要混入标签。
- `getName()` → `'Claude (claude -p)'`。
- `generateScript(articleText)`:
  1. `prompt = this.getPrompt(articleText)`(调整后的 prompt,见 5.3)。
  2. `spawn(CLAUDE_BIN, ['-p', '--model', CLAUDE_MODEL, '--output-format', 'text', <禁用工具 flag>], { env: childEnv })`。
  3. **childEnv 显式白名单**:`PATH`、`HOME`、`HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`、locale 等必要项;**默认删除 `ANTHROPIC_API_KEY`**;仅当 `CLAUDE_ALLOW_API_KEY=1` 时才透传 API key 回退。
  4. 将 `prompt` 写入 stdin 后 `end()`;收集 stdout;监听 `close`;`CLAUDE_TIMEOUT_MS`(默认 120000)超时 kill。
  5. 退出码非 0 / stdout 空 / 超时 → 抛错(交给重试)。
  6. `rawScript = stdout`;`this.parseScript(rawScript)` 得 `{ dialogues, summary }`;`dialogues.length === 0` → 抛“格式无法解析”。
  7. 返回 `{ raw, dialogues, summary: summary || this.fallbackSummary(dialogues), ttsText }`(结构同现有契约)。
- 重试:超时/非 0 退出有限次指数退避。
- **并发限流**:provider 级信号量 `CLAUDE_MAX_CONCURRENT`(默认 1),避免多个 `claude` 子进程争抢订阅登录态;超出排队。
- 认证类错误(未登录/模型不可用)以 `ProviderError`(见 5.6)抛出,使 message 可展示。
- 配置:`CLAUDE_MODEL`(默认 `claude-opus-4-8`)、`CLAUDE_BIN`(默认 `claude`)、`CLAUDE_TIMEOUT_MS`、`CLAUDE_MAX_CONCURRENT`、`CLAUDE_ALLOW_API_KEY`。

### 5.2 音频合成:`ElevenLabsTTS extends TTSProvider`
新文件 `src/services/tts/ElevenLabsTTS.js`。

- 构造:读 `ELEVENLABS_API_KEY`(缺失抛 `ProviderError`);若设了 `HTTPS_PROXY/HTTP_PROXY`,用 undici `ProxyAgent` + `setGlobalDispatcher`(沿用 `GeminiTTS` 做法)使 `fetch` 走代理。
- 音色映射:`Speaker_A → ELEVENLABS_VOICE_A`(默认 `DowyQ68vDpgFYdWVGjc3`),`Speaker_B → ELEVENLABS_VOICE_B`(默认 `ByhETIclHirOlWnWKhHc`),归一化 speaker 名(沿用现有容错)。
- 调用方式:**优先 REST**`fetch('https://api.elevenlabs.io/v1/text-to-dialogue?output_format=' + fmt, { method:'POST', headers:{ 'xi-api-key', 'content-type':'application/json' }, body: JSON.stringify({ inputs, model_id, language_code, settings }) })` → 响应 body 为 mp3 二进制,写盘。
- `synthesize(dialogues, outputPath, options)`:
  1. **映射**:`dialogues` → `inputs = [{ text, voice_id }]`。`text` 含 Claude 生成的情绪标签直接透传;`isInterrupt` 句在 `text` 末尾追加 `-`。
  2. **长度评估**:`total = Σ len(text)`(字符数)。`total ≤ ELEVENLABS_SINGLE_SHOT_MAX` → 走单次;否则走分块。
  3. **单次合成**:一次 REST 调用整篇 → 写 `outputPath`。随后做**完整性校验**(见 5.2.1);校验失败或返回长度类 validation error → **自动降级分块**重试。
  4. **分块合成**:在 **speaker 轮替边界**累计切块,每块 ≤ `ELEVENLABS_CHUNK_CHARS`(默认 1800);各块 REST 合成写入**任务级临时目录**(`fs.mkdtemp`)的 mp3 段;用 **ffmpeg concat**(concat list 文件,路径安全转义)合并为 `outputPath`;`finally` 清理临时目录(单块直接用)。
  5. **重试**:每次 API 调用指数退避(429 / 网络错误);沿用 `GeminiTTS` 的 `RETRY_CONFIG` 风格。
- **并发限流**:`ELEVENLABS_MAX_CONCURRENT`(默认 1),配合订阅并发上限;429 退避。
- 配置:`ELEVENLABS_MODEL`(默认 `eleven_v3`)、`ELEVENLABS_LANGUAGE`(默认 `cmn`)、`ELEVENLABS_OUTPUT_FORMAT`(默认 `mp3_44100_128`)、`ELEVENLABS_SINGLE_SHOT_MAX`(默认见 5.2.1)、`ELEVENLABS_CHUNK_CHARS`(默认 1800)、`ELEVENLABS_STABILITY`、`ELEVENLABS_MAX_CONCURRENT`。

#### 5.2.1 单次合成的长度策略与完整性校验(回应软上限 2000 风险)
- 背景:官方“可靠生成”软上限 2,000 字符;硬上限 5,000。常态脚本(2000–2500 汉字 + 标签)落在两者之间(灰区),单次 convert 通常成功但官方不背书可靠性。
- 策略:**默认整篇单次合成**(满足“无拼接断裂”诉求),并用两道保底把灰区风险兜住:
  1. **validation error 降级**:单次调用若返回长度类 4xx/校验错误 → 自动转分块重试。
  2. **音频完整性校验**:单次合成后用 `ffprobe` 取实际时长,与按字符数估算的预期时长(中文约 4–5 字/秒,设宽容下限,如实际 < 预期 × 0.6)比较;明显偏短(疑似静默截断)→ 判定失败 → 自动转分块重试。
- `ELEVENLABS_SINGLE_SHOT_MAX` **默认 4500**(已定:整篇优先,最大化无拼接断裂);≤4500 走单次,>4500 走分块。无论取值,完整性校验与降级都生效。

### 5.3 Prompt 调整(`LLMProvider.getPrompt`)
- 删除 Gemini 专属表述(“由 Google DeepMind 调教”、“对应 TTS: Charon / Callirrhoe”)。
- **保留输出格式契约**:每行 `Speaker_A:`/`Speaker_B:`(英文冒号)、`--` 插嘴标记、结尾 `# Summary:`。
- **情绪标签**:要求台词中**克制**插入英文方括号音频标签(`[laughs]` `[curious]` `[excited]` `[sighs]` `[surprised]` 等),置于**句首或句中**;每句至多 0–1 个、仅情绪明显处;`# Summary:` 行不加标签。
- **插嘴标记位置约束**:`--` 必须置于**该行最末尾**(其后不得再跟情绪标签或文字),保证 parser 的 `endsWith` 判定有效。
- **parser 容错**:`parseSpeakerFormat` 的插嘴判定由严格 `endsWith('--')` 放宽为正则(允许 `--` 后跟尾随空白),并剥离行内/行尾标签不影响 isInterrupt 判定;作为对 prompt 约束的双保险。

### 5.4 配置 / `.env.example`(重写)
删除 `GEMINI_API_KEY`;新增:
```
# ElevenLabs
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_A=DowyQ68vDpgFYdWVGjc3   # 老王/男
ELEVENLABS_VOICE_B=ByhETIclHirOlWnWKhHc   # 小李/女
# 可选:ELEVENLABS_MODEL=eleven_v3 / ELEVENLABS_LANGUAGE=cmn /
#       ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128 /
#       ELEVENLABS_SINGLE_SHOT_MAX=4500 / ELEVENLABS_CHUNK_CHARS=1800 /
#       ELEVENLABS_STABILITY / ELEVENLABS_MAX_CONCURRENT=1

# Claude Code CLI(脚本生成,复用本机 claude 登录态)
# 可选:CLAUDE_MODEL=claude-opus-4-8 / CLAUDE_BIN=claude /
#       CLAUDE_TIMEOUT_MS=120000 / CLAUDE_MAX_CONCURRENT=1 / CLAUDE_ALLOW_API_KEY=0

# 端口 / 代理(保留)
PORT=3000
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
```

### 5.5 完全切换(删除清单)
- 删 `src/services/llm/GeminiLLM.js`、`src/services/tts/GeminiTTS.js`。
- `src/services/llm/index.js`:默认/主分支返回 `ClaudeCliLLM`(`LLM_PROVIDER` 默认 `claude`),移除 gemini 分支。
- `src/services/tts/index.js`:默认/主分支返回 `ElevenLabsTTS`(`TTS_PROVIDER` 默认 `elevenlabs`),移除 gemini 分支。
- `package.json`:移除 `@google/genai`、`@google/generative-ai`;新增 `@elevenlabs/elevenlabs-js`(若用 SDK);更新 `keywords`(gemini → claude/elevenlabs)。
- `package-lock.json`:`npm install` 后自动更新并一并提交(确认不再含 `@google/*`)。
- 清理 `README.md`、`.env.example` 的 Gemini 提及。
- `openspec/**`:为**历史归档**,保持不动(记录的是初版设计);不视为遗漏。
- **勿误删**`public/index.html` 的 `fonts.googleapis.com`(Google Fonts,与 Gemini 无关)。
- 保留 ffmpeg/ffprobe、`undici` 依赖。

### 5.6 可展示错误类型 `ProviderError`
- 新增 `ProviderError`(可放 `articleExtractor.js` 同款模式或独立模块),用于**可安全展示给用户**的配置/认证/voice/额度类错误。
- `queue.js` 第 188–190 行错误展示判断扩展为:`error instanceof ValidationError || error instanceof ProviderError ? error.message : '处理过程中发生错误,请重试'`。这是 `queue.js` 唯一改动。
- Claude/ElevenLabs provider 对“未登录、API key 缺失、模型不可用、voice 无效、额度耗尽”等抛 `ProviderError`;其余非预期错误仍走通用兜底。

## 6. 错误处理与重试
- Claude:未登录 / 模型不可用(`ProviderError`)、超时 / 非 0 退出 / 空输出 / 解析失败(可重试错误)。
- ElevenLabs:API key 缺失 / voice 无效 / 额度耗尽(`ProviderError`);429 / 网络(指数退避重试);长度 validation error 或完整性校验失败(降级分块)。
- 队列层保留现有 try/catch,失败置 `failed`;展示 message 按 5.6。

## 7. 测试策略
- 纯函数单测(优先,无外部依赖):
  - dialogues → inputs 映射(speaker→voice_id、`isInterrupt`→行尾 `-`)。
  - 分块逻辑:字符预算、speaker 边界、单次/分块阈值判定。
  - 长度估算 / 完整性校验阈值(给定字符数与时长,判定是否“疑似截断”)。
  - `parseScript`/`parseSpeakerFormat`:含情绪标签行解析、`--` 行尾(含尾随空白)插嘴判定、标签随 text 保留。
  - childEnv 白名单构造(含/不含 `ANTHROPIC_API_KEY`)。
  - `fallbackSummary` 剥离标签。
- 外部调用 mock:stub REST `fetch`、stub `spawn`、stub `ffprobe/ffmpeg`。
- 端到端冒烟:跑一篇真实微信文章,验证脚本生成 + 单次音频合成 + mp3 落盘(需本机 `claude` 已登录 + `ELEVENLABS_API_KEY` + 代理)。

## 8. 风险与缓解
- ElevenLabs 软上限 2000:单次 + 完整性校验 + validation error 降级,兼顾“整篇一次”诉求与可靠性(见 5.2.1)。
- `claude -p` 禁工具/登录态:语义要求写死(禁内置 + 禁 MCP + 不用 `--bare`),实现首步 `claude --help` 实测确认 flag。
- v3 非确定性 / 标签被读出:prompt 限制标签密度;必要时调 stability。
- **Docker / 无头部署**:当前 `Dockerfile` 未安装 `claude` CLI、未挂载登录态。第一版**仅支持本机已登录运行**;服务器/Docker 支持列为后续(补 CLI 安装 + 认证 token/volume + 启动健康检查),或改用 `CLAUDE_ALLOW_API_KEY` 走 API。
- 并发:provider 级 `*_MAX_CONCURRENT` 默认 1,防止订阅/账户层限流与资源争抢。
- 库音色被取消共享:上线前验证 voice_id,保留内置兜底。
- 免费额度/商用授权:免费计划无商用授权,生产需付费计划。

## 9. 实现时需先核对的细节
- `claude --help`(及 `-p` 相关)确认:禁用内置工具 + 禁 MCP 的确切 flag、`--output-format` 取值、`--model` 接受值、stdin 传 prompt 行为。
- ElevenLabs:用自己的 key 对两个 voice_id 做 `GET /v1/voices/{id}` 验证;确认 REST body/query 字段名(`inputs`/`model_id`/`language_code`、query `output_format`)与响应类型(mp3 二进制)。
- 同步更新 `TTSProvider`/`LLMProvider` 的 JSDoc 至真实契约(`dialogues` 数组、`summary`/`isInterrupt`)。

## 10. 验收标准
- 给定一篇微信文章 URL,任务跑通 parsing → generating(Claude Opus 4.8)→ synthesizing(ElevenLabs `eleven_v3`)→ completed,产出可播放 mp3。
- 脚本能被现有 parser 解析(含情绪标签与 `--` 插嘴);2000–2500 字脚本常态走**单次**合成,完整性校验通过;超长或校验失败时自动分块拼接成功。
- 配置/认证类失败(未登录、缺 key、voice 无效)以可读 message 展示。
- 仓库无 `@google/*` 依赖(含 `package-lock.json`)与 Gemini provider 文件;`.env.example`/README 不再含 Gemini;`public/index.html` 的 Google Fonts 完好。
- 纯函数单测通过;一篇真实文章端到端冒烟通过。

## 附:决定记录
- `ELEVENLABS_SINGLE_SHOT_MAX` 取向 = **整篇优先,默认 4500**(用户 2026-06-29 确认)。理由:最大化“整篇一次、无拼接断裂”;灰区(>2000 软上限)风险由完整性校验 + validation error 自动降级分块兜底。
