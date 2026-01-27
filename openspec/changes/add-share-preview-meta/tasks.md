## 1. 实现
- [x] 为 `/?share=<id>` 请求增加服务端渲染的 meta 标签（og:title/og:description/og:image/og:url）。
- [x] 从数据库读取对应播客的 `title` 与 `summary`。
- [x] 使用 `public/favicon.png` 作为默认封面图（拼接绝对 URL）。

## 2. 验证
- [ ] 访问 `/?share=<id>` 的响应 HTML 中包含正确的 og 标签。
- [ ] 在微信分享调试工具或真实分享中确认预览展示标题/摘要/封面。
