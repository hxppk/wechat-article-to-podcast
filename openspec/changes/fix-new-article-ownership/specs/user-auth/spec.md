## ADDED Requirements

### Requirement: 文章创建需要登录
`POST /api/article` 接口 SHALL 要求用户已登录（`req.userId` 不为 `public`）。未登录用户提交文章时 SHALL 返回 401 错误。

#### Scenario: 未登录用户提交文章
- **WHEN** 用户未登录或 JWT 已过期时提交文章
- **THEN** 返回 HTTP 401 和 `{ error: '请先登录', code: 'UNAUTHORIZED' }`

#### Scenario: 已登录用户提交文章
- **WHEN** 用户已登录且 JWT 有效时提交文章
- **THEN** 文章创建成功，`user_id` 关联到当前用户

### Requirement: 前端认证失效自动处理
前端 `authFetch` SHALL 在收到 HTTP 401 响应时自动清除本地存储的无效 token 并提示用户重新登录。

#### Scenario: 请求返回 401
- **WHEN** 任何 `authFetch` 请求返回 HTTP 401
- **THEN** 清除 localStorage 中的 authToken，弹出登录框

#### Scenario: 提交文章前检查登录状态
- **WHEN** 用户点击"开始转换"但 `currentUser` 为 null
- **THEN** 弹出登录框而不发送请求
