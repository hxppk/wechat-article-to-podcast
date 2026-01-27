# 微信文章转播客

将微信公众号文章一键转换为双人对话播客音频。

## 功能特性

- **微信文章提取**：使用 Puppeteer 无头浏览器渲染，支持动态加载内容
- **AI 脚本生成**：Gemini 2.0 Flash 将文章改写为自然对话脚本
- **多人语音合成**：Gemini TTS 多说话人模式，一次生成完整音频
- **Web 界面**：简洁的前端，支持播客列表、在线播放、下载
- **任务队列**：异步处理，支持并发，自动重试

## 技术栈

- **后端**：Node.js + Express
- **文章提取**：Puppeteer
- **AI 服务**：Google Gemini API (LLM + TTS)
- **前端**：原生 HTML/CSS/JS

## 快速开始

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
GEMINI_API_KEY=your_gemini_api_key
WECHAT_APP_ID=your_wechat_app_id
WECHAT_APP_SECRET=your_wechat_app_secret
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
3. 点击"转换"按钮
4. 等待处理完成（约 1-2 分钟）
5. 在播客列表中播放或下载

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/article` | 提交文章 URL，返回任务 ID |
| GET | `/api/status/:id` | 查询任务状态 |
| GET | `/api/podcasts` | 获取播客列表 |
| GET | `/api/podcasts/:id` | 获取单个播客详情 |
| DELETE | `/api/podcasts/:id` | 删除播客 |
| GET | `/audio/:id.mp3` | 获取音频文件 |
| POST | `/api/wechat/jssdk-signature` | 获取微信 JS-SDK 签名 |

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
│   │   ├── llm/                 # LLM 服务
│   │   └── tts/                 # TTS 服务
│   └── utils/
│       └── podcastStore.js      # 播客存储
└── data/                  # 数据目录（自动创建）
    ├── audio/             # 生成的音频
    ├── scripts/           # 生成的脚本
    └── podcasts.json      # 播客元数据
```

## 配置说明

### 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `GEMINI_API_KEY` | 是 | Google Gemini API 密钥 |
| `WECHAT_APP_ID` | 否 | 公众号 AppID（微信内分享卡片） |
| `WECHAT_APP_SECRET` | 否 | 公众号 AppSecret（微信内分享卡片） |
| `HTTP_PROXY` | 否 | HTTP 代理地址 |
| `HTTPS_PROXY` | 否 | HTTPS 代理地址 |
| `PORT` | 否 | 服务端口，默认 3000 |
| `MAX_CONCURRENT_TASKS` | 否 | 最大并发任务数，默认 3 |
| `ENABLE_FILE_CLEANUP` | 否 | 设为 `true` 启用自动清理（1小时过期），默认禁用 |

### 音色配置

默认音色：
- Speaker_A（老王）：Achird
- Speaker_B（小李）：Callirrhoe

可在 `src/services/tts/GeminiTTS.js` 中修改 `SPEAKER_VOICE_MAP`。

## 相关项目

- [pdf-to-podcast](https://github.com/hxppk/pdf-to-podcast) - PDF 转播客

## License

MIT
