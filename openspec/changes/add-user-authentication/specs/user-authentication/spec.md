# 能力：用户认证

## ADDED Requirements

### Requirement: 手机号注册
系统 SHALL 支持手机号与密码注册。

#### Scenario: 注册成功
- **WHEN** 用户提交有效手机号与密码
- **THEN** 系统创建用户记录
- **AND** 密码以哈希形式存储
- **AND** 默认 tier = free

#### Scenario: 手机号重复
- **WHEN** 用户注册已存在手机号
- **THEN** 系统返回 409

### Requirement: 手机号登录
系统 SHALL 支持手机号与密码登录。

#### Scenario: 登录成功
- **WHEN** 用户提交正确手机号与密码
- **THEN** 系统签发 JWT
- **AND** 设置 HttpOnly Cookie

#### Scenario: 密码错误
- **WHEN** 用户提交错误密码
- **THEN** 系统返回 401

### Requirement: 登录失败限制
系统 SHALL 限制同手机号的登录失败次数。

#### Scenario: 达到限制
- **WHEN** 同一手机号在 10 分钟内失败 5 次
- **THEN** 系统返回 429

### Requirement: JWT Session 管理
系统 SHALL 使用 JWT 管理用户会话。

#### Scenario: Token 验证
- **WHEN** 请求携带有效 JWT Cookie
- **THEN** 系统解析 token 获取用户信息
- **AND** 设置 req.userId

#### Scenario: Token 无效
- **WHEN** 请求携带无效或过期 token
- **THEN** 系统将用户视为匿名
- **AND** 设置 req.userId = 'public'

### Requirement: 登出功能
系统 SHALL 支持用户登出。

#### Scenario: 登出成功
- **WHEN** 用户请求 POST /api/auth/logout
- **THEN** 系统清除 token Cookie

### Requirement: 获取当前用户
系统 SHALL 提供获取当前用户信息的 API。

#### Scenario: 已登录用户
- **WHEN** 已登录用户请求 GET /api/auth/me
- **THEN** 系统返回用户信息（id, phone, tier）

#### Scenario: 匿名用户
- **WHEN** 匿名用户请求 GET /api/auth/me
- **THEN** 系统返回 401

### Requirement: 匿名访问支持
系统 SHALL 支持匿名用户访问基础功能。

#### Scenario: 无 token 访问
- **WHEN** 请求未携带 token
- **THEN** 系统设置 req.userId = 'public'
- **AND** 允许访问基础功能（受配额限制）
