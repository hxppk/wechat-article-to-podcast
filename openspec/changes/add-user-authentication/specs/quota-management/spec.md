# 能力：配额管理

## ADDED Requirements

### Requirement: 用户配额限制
系统 SHALL 对用户使用量进行限制。

#### Scenario: 访客配额
- **WHEN** 匿名用户提交文章
- **THEN** 限制为每日 1 次

#### Scenario: 免费用户配额
- **WHEN** 免费用户提交文章
- **THEN** 限制为每日 2 次

#### Scenario: 付费用户配额
- **WHEN** 付费用户提交文章
- **THEN** 限制为每日 20 次

### Requirement: 配额检查与计数
系统 SHALL 在提交时进行配额检查并计数。

#### Scenario: 提交即计数
- **WHEN** 用户提交文章
- **THEN** 系统先计数 +1
- **AND** 即使后续处理失败也计入

#### Scenario: 配额耗尽
- **WHEN** 用户提交文章
- **AND** 当日使用量已达上限
- **THEN** 返回 429
- **AND** 返回 usage, limit, resetAt

### Requirement: 配额重置
系统 SHALL 每日重置用户配额（北京时间）。

#### Scenario: 每日重置
- **WHEN** 北京时间 00:00
- **THEN** 当日使用量归零

#### Scenario: 重置时间提示
- **WHEN** 用户配额耗尽
- **THEN** 返回下次重置时间（北京时间次日 00:00）

### Requirement: 留存与清理
系统 SHALL 按用户等级清理播客数据。

#### Scenario: 访客清理
- **WHEN** 访客播客生成超过 30 分钟
- **THEN** 系统删除播客数据

#### Scenario: 免费清理
- **WHEN** 免费用户播客生成超过 7 天
- **THEN** 系统删除播客数据

#### Scenario: 付费保留
- **WHEN** 付费用户播客生成
- **THEN** 系统永久保留

### Requirement: 配额信息展示
系统 SHALL 向用户展示配额信息。

#### Scenario: 前端配额显示
- **WHEN** 用户查看页面
- **THEN** 显示当前使用量和上限

#### Scenario: 配额耗尽提示
- **WHEN** 用户配额耗尽
- **THEN** 前端显示提示与重置时间
