# 能力：数据隔离（v1.5 预埋）

## ADDED Requirements

### Requirement: 播客记录绑定用户
系统 SHALL 为每条播客记录保存 `userId` 字段。

#### Scenario: 匿名用户生成播客
- **WHEN** 未提供 Authorization Header
- **THEN** 系统将 `userId` 设为 `public`

#### Scenario: 指定用户生成播客
- **WHEN** 请求携带 `Authorization: Bearer <userId>`
- **THEN** 系统将 `userId` 设为该值

### Requirement: 播客查询按用户隔离
系统 SHALL 仅返回当前用户的播客记录。

#### Scenario: 列表过滤
- **WHEN** 用户请求 GET /api/podcasts
- **THEN** 仅返回 `userId` 等于当前用户的记录

#### Scenario: 详情过滤
- **WHEN** 用户请求 GET /api/podcasts/:id
- **AND** 该记录 `userId` 不属于当前用户
- **THEN** 系统返回 404

### Requirement: 播客删除按用户校验
系统 SHALL 阻止用户删除不属于自己的播客。

#### Scenario: 删除越权
- **WHEN** 用户请求 DELETE /api/podcasts/:id
- **AND** 该记录 `userId` 不属于当前用户
- **THEN** 系统返回 404
