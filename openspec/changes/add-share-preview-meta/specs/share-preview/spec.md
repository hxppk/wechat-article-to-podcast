## ADDED Requirements

### Requirement: 分享预览 Meta 标签
系统 SHALL 在访问 `/?share=<id>` 时返回包含 `og:title`、`og:description`、`og:image`、`og:url` 的 HTML，用于微信分享预览。

#### Scenario: 生成分享预览
- **WHEN** 用户访问带 `share` 参数的链接
- **THEN** 响应 HTML 包含基于播客 `title` 与 `summary` 的 og 标签，并使用项目图标作为封面
