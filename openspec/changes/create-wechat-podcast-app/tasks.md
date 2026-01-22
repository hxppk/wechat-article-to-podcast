# 实现任务清单

## 1. 项目初始化
- [ ] 1.1 创建 package.json，配置依赖
  - express, axios, cheerio, @google/genai, uuid, cors, dotenv, undici
- [ ] 1.2 创建 .env.example（GEMINI_API_KEY, PORT, HTTPS_PROXY）
- [ ] 1.3 创建 .gitignore（node_modules, data/, .env）
- [ ] 1.4 创建目录结构（public/, src/, data/scripts, data/audio）

## 2. 文章提取服务（新增）
- [ ] 2.1 创建 `src/services/articleExtractor.js`
- [ ] 2.2 实现 URL 验证（必须是 mp.weixin.qq.com 域名）
- [ ] 2.3 实现 mptext API 调用获取 HTML
- [ ] 2.4 使用 Cheerio 提取标题（og:title / .rich_media_title）
- [ ] 2.5 使用 Cheerio 提取公众号名称（og:site_name / #js_name）
- [ ] 2.6 使用 Cheerio 提取正文（#js_content）
- [ ] 2.7 实现内容验证（长度 >= 100 字）
- [ ] 2.8 定义 ValidationError 类

## 3. LLM 服务（复用）
- [ ] 3.1 从 pdf-to-podcast 复制 `src/services/llm/` 目录
  - LLMProvider.js
  - GeminiLLM.js
  - index.js
- [ ] 3.2 验证 Gemini API 调用正常

## 4. TTS 服务（复用）
- [ ] 4.1 从 pdf-to-podcast 复制 `src/services/tts/` 目录
  - TTSProvider.js
  - GeminiTTS.js
  - index.js
- [ ] 4.2 验证多角色合成正常工作
- [ ] 4.3 在 README 中说明 FFmpeg 依赖

## 5. 任务队列（复用 + 修改）
- [ ] 5.1 从 pdf-to-podcast 复制 `src/services/queue.js`
- [ ] 5.2 从 pdf-to-podcast 复制 `src/services/eta.js`
- [ ] 5.3 修改 createTask 方法：接收 articleUrl 参数
- [ ] 5.4 修改 processTask Stage 1：调用 articleExtractor 替代 pdfParser
- [ ] 5.5 修改 processTask Stage 4：传递 sourceUrl 和 accountName 给 podcastStore

## 6. 播客存储（复用 + 扩展）
- [ ] 6.1 从 pdf-to-podcast 复制 `src/utils/podcastStore.js`
- [ ] 6.2 扩展 addPodcast 方法：增加 sourceUrl 和 accountName 参数
- [ ] 6.3 更新元数据结构，包含新字段

## 7. API 路由
- [ ] 7.1 创建 `src/routes/article.js` - POST /api/article
  - 验证 URL 参数
  - 创建任务并返回 taskId
- [ ] 7.2 从 pdf-to-podcast 复制 `src/routes/status.js` - GET /api/status/:id
- [ ] 7.3 从 pdf-to-podcast 复制 `src/routes/podcast.js`
  - GET /api/podcasts（列表）
  - GET /api/podcasts/:id（详情）
  - DELETE /api/podcasts/:id（删除）

## 8. 服务入口
- [ ] 8.1 创建 `server.js`
- [ ] 8.2 配置中间件（cors, express.json, express.static）
- [ ] 8.3 挂载路由（/api/article, /api/status, /api/podcasts）
- [ ] 8.4 配置音频静态服务（/audio 指向 data/audio）
- [ ] 8.5 实现文件清理定时任务（1 小时过期）

## 9. 前端页面（复用 + 修改）
- [ ] 9.1 从 pdf-to-podcast 复制 `public/index.html`
- [ ] 9.2 修改输入区域：文件上传 → URL 输入框
- [ ] 9.3 修改标题和描述文案
- [ ] 9.4 从 pdf-to-podcast 复制 `public/style.css`
- [ ] 9.5 调整样式适配 URL 输入
- [ ] 9.6 从 pdf-to-podcast 复制 `public/script.js`
- [ ] 9.7 修改提交逻辑：FormData → JSON POST /api/article
- [ ] 9.8 复用状态轮询逻辑
- [ ] 9.9 复用播客列表渲染逻辑
- [ ] 9.10 复用播放器组件（播放、暂停、进度条、倍速、下载）
- [ ] 9.11 可选：在列表中显示原文链接

## 10. 测试验证
- [ ] 10.1 测试完整流程：输入微信文章 URL → 生成播客
- [ ] 10.2 验证播客列表显示正确
- [ ] 10.3 验证播放器功能（播放、暂停、拖动、倍速）
- [ ] 10.4 验证下载功能
- [ ] 10.5 验证删除功能（文件和元数据同步删除）
- [ ] 10.6 测试错误处理（无效 URL、网络错误、API 失败）

## 11. 文档和部署
- [ ] 11.1 创建 README.md（功能介绍、安装步骤、API 文档）
- [ ] 11.2 创建 LICENSE
- [ ] 11.3 创建 Dockerfile（可选）
- [ ] 11.4 初始化 Git 仓库
- [ ] 11.5 推送到 GitHub

---

## 依赖关系图

```
1. 项目初始化
       ↓
   ┌───┴───┐
   ↓       ↓
2. 文章提取  3. LLM服务(复用)  4. TTS服务(复用)
   ↓       ↓                  ↓
   └───────┼──────────────────┘
           ↓
      5. 任务队列
           ↓
      6. 播客存储
           ↓
      7. API 路由
           ↓
      8. 服务入口
           ↓
      9. 前端页面
           ↓
     10. 测试验证
           ↓
     11. 文档部署
```

## 复用文件清单

### 直接复制（无修改）
| 源文件 (pdf-to-podcast) | 目标文件 |
|------------------------|----------|
| src/services/llm/* | src/services/llm/* |
| src/services/tts/* | src/services/tts/* |
| src/services/eta.js | src/services/eta.js |
| src/routes/status.js | src/routes/status.js |
| src/routes/podcast.js | src/routes/podcast.js |

### 复制后修改
| 源文件 (pdf-to-podcast) | 目标文件 | 修改点 |
|------------------------|----------|--------|
| src/services/queue.js | src/services/queue.js | Stage 1 替换为文章提取 |
| src/utils/podcastStore.js | src/utils/podcastStore.js | addPodcast 增加参数 |
| public/index.html | public/index.html | 输入框改为 URL |
| public/script.js | public/script.js | 提交方式改为 JSON |
| public/style.css | public/style.css | 样式微调 |

### 新增
| 文件 | 说明 |
|------|------|
| src/services/articleExtractor.js | 微信文章提取服务 |
| src/routes/article.js | 文章提交 API |

## 验收标准
1. ✅ 输入有效微信文章 URL，能生成可播放的 MP3
2. ✅ 前端显示处理进度和 ETA
3. ✅ 播客列表显示标题、时长、大小、生成时间
4. ✅ 播放器支持播放、暂停、拖动进度、倍速
5. ✅ 支持下载和删除播客
6. ✅ 错误时显示友好提示
7. ✅ 音频包含两个不同声音的角色对话
