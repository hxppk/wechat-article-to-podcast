# 项目：wechat-article-to-podcast

## 概述
将微信公众号文章 URL 直接转换为双人对话播客音频的 Web 应用。

## 技术栈
- **后端**：Node.js + Express
- **前端**：原生 HTML/CSS/JavaScript
- **文章提取**：mptext API (https://down.mptext.top)
- **文本解析**：Cheerio
- **AI 服务**：Google Gemini API
  - LLM：Gemini 2.5 Flash（脚本生成）
  - TTS：Gemini 2.5 Flash Preview TTS（多角色语音合成）
- **音频处理**：FFmpeg

## 设计原则
1. **简单优先**：最小化实现，只在必要时增加复杂度
2. **单一职责**：每个模块只做一件事
3. **可复用**：核心服务（LLM、TTS）可从 pdf-to-podcast 复用
4. **无 PDF 中间文件**：直接从 HTML 提取文本，跳过 PDF 生成步骤

## 目录结构约定
```
wechat-article-to-podcast/
├── server.js                 # 入口文件
├── public/                   # 前端静态文件
├── src/
│   ├── services/             # 核心服务
│   │   ├── articleExtractor.js  # 文章提取
│   │   ├── llm/              # LLM 服务
│   │   └── tts/              # TTS 服务
│   ├── routes/               # API 路由
│   └── utils/                # 工具函数
└── data/                     # 运行时数据
    ├── scripts/              # 生成的脚本
    └── audio/                # 生成的音频
```

## 环境变量
- `GEMINI_API_KEY`：必填，Google Gemini API 密钥
- `PORT`：服务端口，默认 3000
- `HTTPS_PROXY`：可选，代理地址
