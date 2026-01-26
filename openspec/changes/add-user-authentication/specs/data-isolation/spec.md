# 能力：数据隔离

## ADDED Requirements

### Requirement: 用户数据隔离
系统 SHALL 确保每个用户只能访问自己的数据。

#### Scenario: 播客列表隔离
- **WHEN** 用户请求 GET /api/podcasts
- **THEN** 系统只返回该用户创建的播客

#### Scenario: 播客详情隔离
- **WHEN** 用户请求 GET /api/podcasts/:id
- **AND** 该播客不属于当前用户
- **THEN** 系统返回 404

#### Scenario: 播客删除隔离
- **WHEN** 用户请求 DELETE /api/podcasts/:id
- **AND** 该播客不属于当前用户
- **THEN** 系统返回 404

### Requirement: 文件存储隔离
系统 SHALL 按用户隔离存储文件。

#### Scenario: 音频文件存储
- **WHEN** 系统为用户生成音频
- **THEN** 文件存储在 `data/users/{userId}/audio/{id}.mp3`

#### Scenario: 脚本文件存储
- **WHEN** 系统为用户生成脚本
- **THEN** 文件存储在 `data/users/{userId}/scripts/{id}.json`

#### Scenario: 匿名用户文件存储
- **WHEN** 匿名用户生成播客
- **THEN** 文件存储在 `data/users/public/` 目录下

### Requirement: 用户数据模型
系统 SHALL 维护用户数据表。

#### Scenario: 用户表结构
- **WHEN** 系统存储用户信息
- **THEN** 记录包含：id, phone, password_hash, tier, created_at, last_login_at

#### Scenario: 播客关联用户
- **WHEN** 系统存储播客元数据
- **THEN** 记录包含 user_id 字段

### Requirement: 数据迁移支持
系统 SHALL 支持从 v1.5 数据迁移到 v2.0。

#### Scenario: 迁移 v1.5 数据
- **WHEN** 运行迁移脚本
- **THEN** 现有播客记录写入 SQLite
- **AND** user_id 设为 'public'

#### Scenario: 迁移备份
- **WHEN** 运行迁移脚本前
- **THEN** 系统自动备份原数据文件
