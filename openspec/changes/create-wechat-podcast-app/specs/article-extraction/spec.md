# 能力：文章提取

## ADDED Requirements

### Requirement: 微信文章 URL 验证
系统 SHALL 验证输入的 URL 是否为有效的微信公众号文章链接。

#### Scenario: 有效的微信文章 URL
- **WHEN** 用户提交 `https://mp.weixin.qq.com/s/xxx` 格式的 URL
- **THEN** 系统接受该 URL 并开始处理

#### Scenario: 无效的 URL 格式
- **WHEN** 用户提交非微信域名的 URL
- **THEN** 系统返回错误提示「请输入有效的微信公众号文章链接」

#### Scenario: 空 URL
- **WHEN** 用户未提供 URL
- **THEN** 系统返回错误提示「请输入文章链接」

### Requirement: 文章内容获取
系统 SHALL 通过 mptext API 获取微信文章的 HTML 内容。

#### Scenario: 成功获取文章内容
- **WHEN** mptext API 返回 HTML 内容
- **THEN** 系统解析 HTML 提取文章信息

#### Scenario: mptext API 请求失败
- **WHEN** mptext API 返回错误或超时
- **THEN** 系统返回错误提示「获取文章内容失败，请稍后重试」

#### Scenario: 文章已被删除
- **WHEN** mptext API 返回空内容或错误页面
- **THEN** 系统返回错误提示「文章不存在或已被删除」

### Requirement: 文章信息提取
系统 SHALL 从 HTML 中提取文章标题和正文内容。

#### Scenario: 提取完整信息
- **WHEN** HTML 包含标题和正文
- **THEN** 系统提取标题（og:title 或 .rich_media_title）
- **AND** 系统提取正文（#js_content 容器内的文本）

#### Scenario: 正文过短
- **WHEN** 提取的正文少于 100 字
- **THEN** 系统返回错误提示「文章内容过短，无法生成播客」

#### Scenario: 去除干扰元素
- **WHEN** 正文包含图片说明、广告文本
- **THEN** 系统清理这些干扰内容，保留核心文本
