# 本地 Worker 部署指南（pm2）

本应用是**分布式架构**：

- **云端（阿里云美国 ECS，`podcast.hxppk.cn`）**：瘦 API + 前端 + 任务队列 + 音频托管/播放 + db。**零 AI key**，不跑任何 AI。
- **本地（你这台机器，pm2 worker）**：跑所有 AI —— Claude `claude -p` 生成脚本（用你的订阅，免费）、MiniMax/ElevenLabs 生成音频、puppeteer 抽取微信文章。本地住宅/公司 IP 天然规避机房风控。

数据流：用户在云端提交文章 URL → 云端入队 → 本地 worker 轮询认领 → 本地全程生成 mp3 → 上传回云端 → 用户在云端播放。

---

## 前置条件（本机）

1. **Claude Code CLI 已登录订阅**。验证：
   ```bash
   printf '只回复两个字：在线' | claude -p --model claude-opus-4-8 --output-format text
   ```
   能输出“在线”即可。worker 用本机登录态，不需要也**不要**设 `ANTHROPIC_API_KEY`。
2. **Node 18+**（已用 v22）、**ffmpeg/ffprobe** 在 PATH（`ffmpeg -version`）。
3. **pm2**：`npm i -g pm2`。
4. MiniMax / ElevenLabs API key（音频生成）。

## 配置

```bash
cd /Users/hexu/wechat-article-to-podcast
npm install                      # 安装依赖（含 multer 等）
cp .env.worker.example .env.worker
```

编辑 `.env.worker`，关键项：

| 变量 | 说明 |
|---|---|
| `CLOUD_API_BASE` | 云端地址，部署后填 `https://podcast.hxppk.cn` |
| `WORKER_API_TOKEN` | **与云端 `.env` 里的同一个强随机 token**（鉴权）。生成：`openssl rand -hex 32` |
| `MINIMAX_API_KEY` / `MINIMAX_VOICE_A` / `MINIMAX_VOICE_B` | MiniMax TTS |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_A` / `ELEVENLABS_VOICE_B` | ElevenLabs TTS（默认 voice 见 `.env.worker.example`） |
| `CLAUDE_MODEL` | `claude-opus-4-8` |
| `WORKER_CONCURRENCY` | 先 `1`（claude/TTS 是长任务，稳了再加） |

> `.env.worker` 已被 `.gitignore` 忽略（含 key，不会进 git）。

## 启动

```bash
pm2 start worker.js --name podcast-worker --time
pm2 save                 # 持久化进程列表
pm2 startup              # 开机自启（按提示执行它给的命令）—— 本机需常开
```

## 验证

```bash
pm2 logs podcast-worker
```
应看到 `worker 启动: id=... base=https://podcast.hxppk.cn ...`，随后持续 `claim`（云端无任务时静默轮询）。

端到端：在 `podcast.hxppk.cn` 提交一篇微信文章 → worker 日志出现认领→parsing→generating→synthesizing→上传 → 云端任务变 completed → 页面可播放。

## 常见问题

- **claim 失败（云端不可达）**：检查 `CLOUD_API_BASE` 和云端是否已部署、`WORKER_API_TOKEN` 两端是否一致。
- **claude 未登录**：worker 脚本生成会报 ProviderError；在本机跑一次 `claude` 登录订阅。
- **音频上传慢/失败**：mp3 走 multipart 到云端，Caddy 需配 `request_body max_size 100MB` + 长超时（云端部署已含）。
- **worker 离线**：云端任务会排队，lease 过期后可被重新认领；worker 恢复后自动继续。
- **本机休眠**：worker 会断；建议在常开机器跑，或关掉睡眠。
