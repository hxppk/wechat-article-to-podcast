# 微信文章转播客

将微信公众号文章一键转换为双人对话播客音频。

## 功能特性

- **微信文章提取**：使用 Puppeteer 无头浏览器渲染，支持动态加载内容
- **AI 脚本生成**：Claude（`claude -p`）将文章改写为自然对话脚本
- **多人语音合成**：MiniMax Speech-2.8-HD（默认）或 ElevenLabs（可选），逐轮合成 + FFmpeg 拼接
- **Web 界面**：简洁的前端，支持播客列表、在线播放、下载
- **任务队列**：异步处理，支持并发，自动重试

## 技术栈

- **后端**：Node.js + Express
- **文章提取**：Puppeteer
- **AI 服务**：Claude CLI（脚本生成）+ MiniMax / ElevenLabs（语音合成）
- **前端**：原生 HTML/CSS/JS

## 快速开始

### 前置条件

脚本生成依赖 Claude Code CLI：

- **方式一（推荐）**：在部署机上安装并登录 Claude Code CLI（`npm install -g @anthropic-ai/claude-code` 后执行 `claude` 完成 OAuth 登录）。
- **方式二**：设置 `CLAUDE_ALLOW_API_KEY=1` 并提供 `ANTHROPIC_API_KEY`，通过 API Key 鉴权。

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的配置：

```env
# 语音合成（至少配一个）
MINIMAX_API_KEY=your_minimax_api_key       # 默认 TTS
ELEVENLABS_API_KEY=your_elevenlabs_api_key # 可选，按任务选择

# Claude CLI（若使用 API Key 模式）
# CLAUDE_ALLOW_API_KEY=1
# ANTHROPIC_API_KEY=your_anthropic_api_key

HTTP_PROXY=http://127.0.0.1:7890  # 可选，代理设置
```

### 3. 启动服务

```bash
npm start
```

访问 http://localhost:3000

## 使用方法

1. 打开浏览器访问 http://localhost:3000
2. 粘贴微信公众号文章链接
3. 选择 TTS 提供商（MiniMax 或 ElevenLabs）
4. 点击"转换"按钮
5. 等待处理完成（约 1-2 分钟）
6. 在播客列表中播放或下载

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/article` | 提交文章 URL，返回任务 ID |
| GET | `/api/status/:id` | 查询任务状态 |
| GET | `/api/podcasts` | 获取播客列表 |
| GET | `/api/podcasts/:id` | 获取单个播客详情 |
| DELETE | `/api/podcasts/:id` | 删除播客 |
| GET | `/api/podcasts/audio/:id` | 获取音频文件 |

## 目录结构

```
├── server.js              # 服务入口
├── package.json
├── .env.example           # 环境变量模板
├── public/                # 前端静态文件
│   ├── index.html
│   ├── script.js
│   └── style.css
├── src/
│   ├── routes/            # API 路由
│   │   ├── article.js
│   │   ├── status.js
│   │   └── podcast.js
│   ├── services/          # 核心服务
│   │   ├── articleExtractor.js  # 文章提取
│   │   ├── queue.js             # 任务队列
│   │   ├── eta.js               # 时间估算
│   │   ├── llm/                 # LLM 服务（Claude CLI）
│   │   └── tts/                 # TTS 服务（MiniMax / ElevenLabs）
│   └── utils/
└── data/                  # 数据目录（自动创建）
    ├── users/             # 用户数据（按 userId 隔离）
    ├── db/                # SQLite 数据库
    └── raw-scripts/       # 原始脚本（调试用）
```

## 配置说明

### 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `MINIMAX_API_KEY` | 条件必填 | MiniMax TTS API 密钥（使用 MiniMax 时必填） |
| `ELEVENLABS_API_KEY` | 条件必填 | ElevenLabs API 密钥（使用 ElevenLabs 时必填） |
| `ANTHROPIC_API_KEY` | 否 | Claude API Key（配合 `CLAUDE_ALLOW_API_KEY=1` 使用） |
| `CLAUDE_ALLOW_API_KEY` | 否 | 设为 `1` 时允许通过 API Key 调用 Claude CLI |
| `HTTP_PROXY` | 否 | HTTP 代理地址 |
| `HTTPS_PROXY` | 否 | HTTPS 代理地址 |
| `PORT` | 否 | 服务端口，默认 3000 |
| `MAX_CONCURRENT_TASKS` | 否 | 最大并发任务数，默认 3 |
| `ELEVENLABS_SINGLE_SHOT_MAX` | 否 | ElevenLabs 单次请求最大字符数，默认 4500 |
| `ELEVENLABS_CHUNK_CHARS` | 否 | ElevenLabs 分块字符数，默认 1800 |
| `DISABLE_CLEANUP` | 否 | 设为 `true` 禁用自动清理 |

### 音色配置

MiniMax 默认音色：
- Speaker_A（老王）：`Chinese (Mandarin)_Southern_Young_Man`
- Speaker_B（小李）：`Chinese (Mandarin)_Crisp_Girl`

可通过 `MINIMAX_VOICE_A` / `MINIMAX_VOICE_B` 环境变量覆盖。

ElevenLabs 默认音色通过 `ELEVENLABS_VOICE_A` / `ELEVENLABS_VOICE_B` 配置。

## 相关项目

- [pdf-to-podcast](https://github.com/hxppk/pdf-to-podcast) - PDF 转播客

## License

MIT
