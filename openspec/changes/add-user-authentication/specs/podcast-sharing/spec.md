# 能力：播客分享

## ADDED Requirements

### Requirement: 分享链接生成
系统 SHALL 为播客生成可公开访问的分享链接。

#### Scenario: 生成分享链接
- **WHEN** 用户在详情页点击分享
- **THEN** 系统返回包含 share_id 的链接
- **AND** 链接格式为 `/?share=<share_id>`

### Requirement: 匿名访问播放
系统 SHALL 允许匿名用户通过分享链接播放播客。

#### Scenario: 匿名访问
- **WHEN** 匿名用户访问分享链接
- **THEN** 系统允许查看详情与播放音频
- **AND** 不要求登录

#### Scenario: 访问后回流
- **WHEN** 用户点击返回首页
- **THEN** 系统使用当前登录状态展示首页

### Requirement: 分享访问不计配额
系统 SHALL 不将分享访问计入配额。

#### Scenario: 访问分享不计数
- **WHEN** 用户通过分享链接播放
- **THEN** 系统不增加当日使用量

### Requirement: 分享不新增到用户列表
系统 SHALL 不自动将分享播客新增到用户列表。

#### Scenario: 登录用户访问分享
- **WHEN** 已登录用户访问分享链接
- **THEN** 系统不新增播客记录到该用户列表
