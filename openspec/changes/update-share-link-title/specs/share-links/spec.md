## MODIFIED Requirements

### Requirement: 分享链接格式
系统 SHALL 生成 `share` 参数的分享链接，并在标题存在时追加 URL 编码后的 `title` 参数。

#### Scenario: 分享链接包含标题
- **WHEN** 用户复制带标题播客的分享链接
- **THEN** 链接包含 `?share=<id>&title=<url-encoded-title>`

#### Scenario: 标题为空时不追加
- **WHEN** 用户复制标题为空的播客分享链接
- **THEN** 链接仅包含 `?share=<id>`
