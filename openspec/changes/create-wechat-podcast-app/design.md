# 技术设计：微信文章转播客

## Context
用户需要一个简单的 Web 应用，输入微信公众号文章 URL，自动生成双人对话播客。项目需要整合两个现有项目的核心能力，并提供与 pdf-to-podcast 等价的播放体验。

## Goals / Non-Goals

### Goals
- 一键输入 URL 生成播客
- 具备完整的播客列表管理（查看、播放、下载、删除）
- 最大化复用 pdf-to-podcast 的已验证代码
- 保持代码简洁，易于维护

### Non-Goals
- 不支持批量 URL 处理
- 不支持自定义角色声音（使用默认配置）
- 不做用户认证
- 不支持其他平台（知乎、头条等）

## Decisions

### 1. 数据存储方案
**决定**：完全复用 pdf-to-podcast 的存储结构

**目录结构**：
```
data/
├── scripts/{taskId}.json   # LLM 生成的对话脚本
├── audio/{taskId}.mp3      # TTS 生成的音频文件
└── podcasts.json           # 播客元数据列表
```

**podcasts.json 字段扩展**：
```javascript
{
  id: "uuid",                    // 任务 ID
  sourceUrl: "https://mp...",    // [新增] 原始文章 URL
  sourceFileName: "文章标题",     // 复用，存储文章标题
  accountName: "公众号名称",      // [新增] 公众号名称
  title: "xxx 的音频概览",        // 复用，播客标题
  generatedAt: 1705000000000,    // 复用，生成时间戳
  status: "completed",           // 复用，状态
  durationMs: 180000,            // 复用，音频时长（毫秒）
  fileSizeBytes: 2048000,        // 复用，文件大小（字节）
  scriptPreview: "摘要...",      // 复用，脚本前 200 字
  audioPath: "data/audio/x.mp3", // 复用，音频路径
  scriptPath: "data/scripts/x.json" // 复用，脚本路径
}
```

**理由**：
- podcastStore.js 已实现完整的 CRUD 操作
- 只需扩展 2 个字段（sourceUrl, accountName）
- 列表、详情、删除逻辑无需修改

### 2. 文章提取方案
**决定**：使用 mptext API + Cheerio 提取文章内容

**实现**：
```javascript
// articleExtractor.js
async function extractArticle(url) {
  // 1. 验证 URL
  if (!url.includes('mp.weixin.qq.com')) {
    throw new ValidationError('请输入有效的微信公众号文章链接');
  }

  // 2. 调用 mptext API
  const apiUrl = `https://down.mptext.top/api/public/v1/download?url=${encodeURIComponent(url)}&format=html`;
  const response = await axios.get(apiUrl, { timeout: 60000 });

  // 3. 使用 Cheerio 提取内容
  const $ = cheerio.load(response.data);
  const title = $('meta[property="og:title"]').attr('content')
             || $('.rich_media_title').text().trim();
  const accountName = $('meta[property="og:site_name"]').attr('content')
                   || $('#js_name').text().trim();
  const content = $('#js_content').text().trim();

  // 4. 验证内容
  if (content.length < 100) {
    throw new ValidationError('文章内容过短，无法生成播客');
  }

  return { title, accountName, text: content };
}
```

**理由**：
- mptext API 已处理微信反爬，稳定可靠
- Cheerio 轻量，无需 Puppeteer
- 与 pdf-to-podcast 的 pdfParser 接口一致（返回 { text }）

### 3. 任务队列复用
**决定**：复用 pdf-to-podcast 的 queue.js，仅修改 Stage 1

**修改点**：
```javascript
// queue.js - processTask 方法
async processTask(taskId) {
  const task = this.tasks.get(taskId);
  await this.initServices();

  // Stage 1: 解析微信文章（替换原来的 PDF 解析）
  this.updateStatus(taskId, 'parsing');
  console.log(`[${taskId}] 开始解析微信文章...`);
  const articleData = await extractArticle(task.articleUrl);
  // articleData = { title, accountName, text }

  // Stage 2: 生成对话脚本（复用）
  this.updateStatus(taskId, 'generating');
  const script = await this.llm.generateScript(articleData.text);
  // 保存脚本...

  // Stage 3: 合成语音（复用）
  this.updateStatus(taskId, 'synthesizing');
  await this.tts.synthesize(script.dialogues, audioPath);

  // Stage 4: 保存元数据（扩展）
  await podcastStore.addPodcast(
    taskId,
    articleData.title,      // sourceFileName
    script.raw,
    audioPath,
    scriptPath,
    task.articleUrl,        // [新增] sourceUrl
    articleData.accountName // [新增] accountName
  );
}
```

**理由**：
- 并发控制、ETA 计算、重试逻辑无需重写
- 只需替换 Stage 1 的输入源
- 状态文本映射可复用（parsing → generating → synthesizing）

### 4. 后端 API 设计
**决定**：新增 1 个路由，复用 4 个路由

**新增 - routes/article.js**：
```javascript
// POST /api/article
router.post('/', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: '请输入文章链接' });
  }

  if (!url.includes('mp.weixin.qq.com')) {
    return res.status(400).json({ error: '请输入有效的微信公众号文章链接' });
  }

  const taskId = taskQueue.createTask(url);

  res.json({
    success: true,
    taskId,
    message: '开始处理文章'
  });
});
```

**复用（无修改）**：
- `routes/status.js` - GET /api/status/:id
- `routes/podcast.js` - GET/DELETE /api/podcasts, GET /api/podcasts/:id

**复用（微调）**：
- `server.js` 中的静态文件服务 `/audio/:file`

### 5. 前端页面设计
**决定**：复用 pdf-to-podcast 的页面结构，修改输入方式

**public/index.html 修改**：
```html
<!-- 原来：文件上传 -->
<input type="file" accept=".pdf">

<!-- 修改为：URL 输入 -->
<input type="url" placeholder="输入微信公众号文章链接">
<button>转换</button>
```

**public/script.js 修改**：
```javascript
// 原来：FormData 上传文件
const formData = new FormData();
formData.append('file', file);
await fetch('/api/upload', { method: 'POST', body: formData });

// 修改为：JSON 提交 URL
await fetch('/api/article', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url })
});
```

**复用（无修改）**：
- 状态轮询逻辑
- 播客列表渲染
- 播放器组件（播放、暂停、进度、倍速）
- 下载和删除功能

## Risks / Trade-offs

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| mptext API 不可用 | 无法提取文章 | 返回友好错误，建议稍后重试 |
| mptext API 限流 | 请求被拒绝 | 已有重试机制，可考虑缓存 |
| Gemini API 限流 | 生成失败 | 重试机制 + 指数退避 |
| 长文章超出 token | 脚本不完整 | LLM 服务已处理截断 |
| 音频文件过大 | 存储/下载慢 | 1 小时自动清理 |

## 代码复用清单

### 直接复制（无修改）
- `src/services/llm/` - LLM 服务
- `src/services/tts/` - TTS 服务
- `src/services/eta.js` - ETA 计算
- `src/routes/status.js` - 状态查询 API
- `src/routes/podcast.js` - 播客管理 API
- `src/middleware/rateLimiter.js` - 速率限制

### 复制后修改
- `src/services/queue.js` - Stage 1 替换为文章提取
- `src/utils/podcastStore.js` - addPodcast 增加 2 个参数
- `public/index.html` - 输入框改为 URL
- `public/script.js` - 提交方式改为 JSON
- `public/style.css` - 可能需要微调

### 新增
- `src/services/articleExtractor.js` - 文章提取服务
- `src/routes/article.js` - 文章提交 API

## Open Questions
- ~~是否需要支持其他平台文章？~~ → 暂不支持，专注微信
- ~~是否需要历史记录功能？~~ → 已有播客列表管理
- 是否需要显示原文链接？→ 可在列表中显示，便于溯源
