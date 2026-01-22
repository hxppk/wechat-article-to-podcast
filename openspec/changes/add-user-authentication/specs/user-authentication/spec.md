# 能力：用户认证

## ADDED Requirements

### Requirement: OAuth 登录
系统 SHALL 支持通过 OAuth 2.0 进行用户登录。

#### Scenario: Google OAuth 登录成功
- **WHEN** 用户点击 Google 登录按钮
- **THEN** 系统重定向到 Google 授权页面
- **AND** 用户授权后回调到系统
- **AND** 系统创建或更新用户记录
- **AND** 系统签发 JWT token 并设置到 Cookie

#### Scenario: 新用户首次登录
- **WHEN** 用户首次通过 OAuth 登录
- **THEN** 系统创建新用户记录
- **AND** 用户记录包含：id, email, name, avatar_url, provider

#### Scenario: 老用户再次登录
- **WHEN** 用户再次通过 OAuth 登录
- **THEN** 系统更新 last_login_at 时间
- **AND** 不创建重复用户

### Requirement: JWT Session 管理
系统 SHALL 使用 JWT 管理用户会话。

#### Scenario: Token 签发
- **WHEN** 用户登录成功
- **THEN** 系统签发 JWT token
- **AND** token 包含用户 id 和基本信息
- **AND** token 有效期为 7 天
- **AND** token 存储在 HttpOnly Cookie

#### Scenario: Token 验证
- **WHEN** 请求携带有效 token
- **THEN** 系统解析 token 获取用户信息
- **AND** 设置 req.user 和 req.userId

#### Scenario: Token 过期
- **WHEN** 请求携带过期 token
- **THEN** 系统将用户视为匿名
- **AND** 设置 req.userId = 'public'

### Requirement: 登出功能
系统 SHALL 支持用户登出。

#### Scenario: 登出成功
- **WHEN** 用户请求 POST /api/auth/logout
- **THEN** 系统清除 token Cookie
- **AND** 返回登出成功

### Requirement: 获取当前用户
系统 SHALL 提供获取当前用户信息的 API。

#### Scenario: 已登录用户
- **WHEN** 已登录用户请求 GET /api/auth/me
- **THEN** 系统返回用户信息（id, email, name, avatar_url, tier）

#### Scenario: 匿名用户
- **WHEN** 匿名用户请求 GET /api/auth/me
- **THEN** 系统返回 401 未授权

### Requirement: 匿名访问支持
系统 SHALL 支持匿名用户访问。

#### Scenario: 无 token 访问
- **WHEN** 请求未携带 token
- **THEN** 系统设置 req.userId = 'public'
- **AND** 允许访问基本功能（受配额限制）

#### Scenario: 匿名用户提示
- **WHEN** 匿名用户使用系统
- **THEN** 前端显示提示："您正在以访客身份使用"
- **AND** 显示登录引导
