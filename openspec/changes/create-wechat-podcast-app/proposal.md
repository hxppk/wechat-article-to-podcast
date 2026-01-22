# Change: 创建微信文章转播客应用

## Why
用户希望将微信公众号文章快速转换为播客音频，无需手动复制粘贴文章内容。现有的两个项目分别实现了：
- `wechat-article-to-pdf`：从微信文章 URL 提取内容
- `pdf-to-podcast`：将文本转换为双人对话播客，含完整的播放列表管理

将两者结合，可以实现一键输入 URL 即生成播客的流畅体验，并具备与 pdf-to-podcast 等价的播放体验。

## What Changes
- 创建新项目 `wechat-article-to-podcast`
- 使用 mptext API 提取微信文章 HTML 内容
- 使用 Cheerio 解析 HTML，提取纯文本（标题 + 正文）
- 复用 pdf-to-podcast 的 LLM 脚本生成逻辑
- 复用 pdf-to-podcast 的 Gemini TTS 多角色合成逻辑
- 复用 pdf-to-podcast 的任务队列（queue.js）和 ETA 计算
- 复用 pdf-to-podcast 的数据存储结构和播客管理 API
- 复用 pdf-to-podcast 的前端播放器组件
- **跳过 PDF 生成步骤**，直接从文本生成播客

## Impact
- 新增能力：`article-extraction`（文章提取）
- 新增能力：`podcast-generation`（播客生成）
- 新增能力：`podcast-management`（播客管理 - 列表、播放、删除）
- 依赖：mptext API（第三方服务）、Gemini API

## 架构流程
```
用户输入 URL
    ↓
POST /api/article → 返回 taskId
    ↓
┌─────────────────────────────────────┐
│ 任务队列处理 (queue.js)              │
│                                     │
│ Stage 1: 解析微信文章                │
│   - mptext API 获取 HTML            │
│   - Cheerio 提取标题+正文            │
│                                     │
│ Stage 2: 生成对话脚本                │
│   - Gemini LLM 生成脚本              │
│   - 保存 data/scripts/{id}.json     │
│                                     │
│ Stage 3: 合成语音                    │
│   - Gemini TTS 多角色合成            │
│   - 保存 data/audio/{id}.mp3        │
│                                     │
│ Stage 4: 保存元数据                  │
│   - 写入 data/podcasts.json         │
└─────────────────────────────────────┘
    ↓
GET /api/status/:id → 轮询状态
    ↓
GET /api/podcasts → 刷新列表
    ↓
GET /audio/:id → 播放/下载
```

## 数据存储设计

### 目录结构
```
data/
├── scripts/{taskId}.json   # 对话脚本
├── audio/{taskId}.mp3      # 播客音频
└── podcasts.json           # 播客元数据列表
```

### podcasts.json 数据结构
```json
[
  {
    "id": "uuid",
    "sourceUrl": "https://mp.weixin.qq.com/s/xxx",
    "sourceFileName": "文章标题",
    "title": "文章标题 的音频概览",
    "accountName": "公众号名称",
    "generatedAt": 1705000000000,
    "status": "completed",
    "durationMs": 180000,
    "fileSizeBytes": 2048000,
    "scriptPreview": "前200字摘要...",
    "audioPath": "data/audio/{id}.mp3",
    "scriptPath": "data/scripts/{id}.json"
  }
]
```

## 后端 API 设计

| 方法 | 路径 | 说明 | 复用来源 |
|------|------|------|----------|
| POST | /api/article | 提交微信文章 URL，启动任务 | 新增（类似 /api/upload） |
| GET | /api/status/:id | 查询任务状态和 ETA | 复用 pdf-to-podcast |
| GET | /api/podcasts | 获取全部播客列表 | 复用 pdf-to-podcast |
| GET | /api/podcasts/:id | 获取单条播客详情 | 复用 pdf-to-podcast |
| DELETE | /api/podcasts/:id | 删除播客（含文件） | 复用 pdf-to-podcast |
| GET | /audio/:id.mp3 | 流式播放/下载音频 | 复用 pdf-to-podcast |

## 前端页面设计

### 页面布局（复用 pdf-to-podcast）
```
┌─────────────────────────────────────────┐
│  微信文章转播客                          │
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────────┐│
│  │ 输入微信公众号文章链接              ││
│  │ [____________________________] [转换]││
│  └─────────────────────────────────────┘│
├─────────────────────────────────────────┤
│  处理状态：正在生成对话脚本... (预计30秒) │
│  [████████████░░░░░░░░░] 60%            │
├─────────────────────────────────────────┤
│  播客列表                               │
│  ┌─────────────────────────────────────┐│
│  │ ▶ 文章标题 - 公众号名称             ││
│  │   3:20 | 2.1MB | 刚刚生成           ││
│  │   摘要前200字...                    ││
│  │   [播放] [下载] [删除]              ││
│  └─────────────────────────────────────┘│
│  ┌─────────────────────────────────────┐│
│  │ ▶ 另一篇文章标题                    ││
│  │   ...                               ││
│  └─────────────────────────────────────┘│
├─────────────────────────────────────────┤
│  播放器                                 │
│  [▶] [████░░░░░░░░░░░░░░░░] 1:23/3:20  │
│  [1x▼] [下载]                           │
└─────────────────────────────────────────┘
```

### 交互功能
- 输入 URL 后点击转换，显示处理进度
- 任务完成后自动刷新播客列表
- 点击列表项播放音频
- 支持播放、暂停、拖动进度、倍速播放
- 支持下载 MP3
- 支持删除播客

## 与 pdf-to-podcast 的关系

| 组件 | pdf-to-podcast | 本项目 | 复用方式 |
|------|---------------|--------|----------|
| 文件上传 | routes/upload.js | routes/article.js | 替换为 URL 输入 |
| PDF 解析 | pdfParser.js | articleExtractor.js | 替换为文章提取 |
| 任务队列 | queue.js | queue.js | 直接复用 |
| ETA 计算 | eta.js | eta.js | 直接复用 |
| LLM 服务 | llm/ | llm/ | 直接复用 |
| TTS 服务 | tts/ | tts/ | 直接复用 |
| 播客存储 | podcastStore.js | podcastStore.js | 扩展字段 |
| 播客 API | routes/podcast.js | routes/podcast.js | 直接复用 |
| 状态 API | routes/status.js | routes/status.js | 直接复用 |
| 前端页面 | public/ | public/ | 调整输入方式 |

---

## 版本演进路线

本项目采用**渐进增强**策略，分阶段引入账号体系，避免影响 MVP 的无门槛体验。

### v1.0（当前 - MVP）
- **目标**：发布无需登录的最小可用版本
- **特性**：
  - 提交任意公众号文章 URL，即可生成播客
  - 所有数据存本地 `data/`，无用户区分
  - 专注流程稳定性和基础体验
- **状态**：本 proposal 覆盖范围

### v1.5（准备期）
- **目标**：为账号系统做数据和 API 层面的准备，但仍保持匿名可用
- **特性**：
  - 引入用户数据模型（预留 `userId` 字段）
  - 匿名用户使用默认 `public` uid
  - API 支持可选的 token 参数
  - 前端预留登录组件入口（暂隐藏）
- **详见**：`changes/add-auth-preparation/`（待规划）

### v2.0（账号系统）
- **目标**：完整的多用户支持
- **特性**：
  - OAuth 登录（微信/Google）
  - 用户数据隔离
  - 配额与使用限制
  - 保留访客试用模式
- **详见**：`changes/add-user-authentication/`（待规划）
