# 能力：配额管理

## ADDED Requirements

### Requirement: 用户配额限制
系统 SHALL 对用户使用量进行限制。

#### Scenario: 访客配额
- **WHEN** 匿名用户（访客）提交文章
- **THEN** 系统检查当日使用量
- **AND** 限制为每日 2 次

#### Scenario: 免费用户配额
- **WHEN** 免费用户提交文章
- **THEN** 系统检查当日使用量
- **AND** 限制为每日 10 次

#### Scenario: 付费用户配额
- **WHEN** 付费用户提交文章
- **THEN** 不限制使用次数

### Requirement: 配额检查
系统 SHALL 在处理请求前检查配额。

#### Scenario: 配额充足
- **WHEN** 用户提交文章
- **AND** 当日使用量未达上限
- **THEN** 允许继续处理
- **AND** 使用量 +1

#### Scenario: 配额耗尽
- **WHEN** 用户提交文章
- **AND** 当日使用量已达上限
- **THEN** 返回 429 Too Many Requests
- **AND** 返回错误信息包含：usage, limit, resetAt

### Requirement: 配额重置
系统 SHALL 每日重置用户配额。

#### Scenario: 每日重置
- **WHEN** UTC 时间 00:00
- **THEN** 所有用户的当日使用量归零

#### Scenario: 重置时间提示
- **WHEN** 用户配额耗尽
- **THEN** 返回下次重置时间（UTC 次日 00:00）

### Requirement: 配额信息展示
系统 SHALL 向用户展示配额信息。

#### Scenario: 前端配额显示
- **WHEN** 用户查看页面
- **THEN** 显示当前使用量和上限
- **AND** 格式如："今日已使用 3/10 次"

#### Scenario: 配额耗尽提示
- **WHEN** 用户配额耗尽
- **THEN** 前端显示友好提示
- **AND** 提示下次重置时间
- **AND** 建议升级账户（如适用）

### Requirement: 访客特殊限制
系统 SHALL 对访客施加额外限制。

#### Scenario: 访客文件清理
- **WHEN** 访客生成的播客超过 1 小时
- **THEN** 系统自动删除该播客
- **AND** 释放存储空间

#### Scenario: 访客升级引导
- **WHEN** 访客使用系统
- **THEN** 前端显示登录引导
- **AND** 提示登录可保留播客更长时间
