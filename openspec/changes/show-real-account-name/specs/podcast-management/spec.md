## ADDED Requirements

### Requirement: 显示真实公众号名称
Podcast 列表和播放器 **MUST** 展示真实的微信公众号昵称，帮助用户确认内容来源。

#### Scenario: 列表展示
- **GIVEN** 系统成功提取了 `accountName`
- **WHEN** 用户查看播客列表
- **THEN** 列表中每条卡片 **MUST** 显示对应的 `accountName`

#### Scenario: 播放器展示
- **GIVEN** 用户正在播放某条播客
- **WHEN** 播放器显示标题/来源信息
- **THEN** 必须显示该播客的 `accountName`
- **AND** 若缺失，则显示 "未知公众号"

### Requirement: 抓取真实昵称
文章解析层 **MUST** 从微信文章中抓取真实的公众号昵称，并写入播客元数据。

#### Scenario: 提取成功
- **WHEN** 抓取到 `.rich_media_meta_nickname` 或 `#js_name` 或 meta author 字段
- **THEN** 系统 **MUST** 使用该值作为 `accountName`

#### Scenario: 无法提取
- **WHEN** 页面未提供上述字段
- **THEN** 系统 **MUST** 记录日志并使用 "未知公众号" 作为 fallback

