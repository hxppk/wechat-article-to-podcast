# 变更：为分享链接添加微信预览 Meta

## 为什么
微信分享卡片预览依赖服务端返回的 HTML meta 标签。当前分享链接只有 query 参数，微信抓取时无法看到标题/摘要/封面，导致预览效果差。

## 改什么
- 当访问 `/?share=<id>` 时，服务端返回带 `og:title` / `og:description` / `og:image` / `og:url` 的 HTML。
- 标题用播客 `title`，摘要用 `summary`，封面图使用项目图标 `public/favicon.png`（绝对 URL）。
- 继续加载现有前端页面，保持功能不变。

## 影响范围
- 影响规格：share-preview
- 影响代码：server.js（路由处理）、public/index.html（模板注入或读取）、src/db/podcasts.js（查询）
