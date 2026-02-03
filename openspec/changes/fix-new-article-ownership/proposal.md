# Change: 修复新添加文章不归属当前用户的问题

## Why
用户 18601327853（paid 用户）在线上部署版本添加新的公众号文章后，新文章不会出现在自己的内容列表中，但旧文章可以正常显示。这说明**创建文章时的用户身份识别出了问题**，导致新文章被关联到 `public` 用户而非实际登录用户。

## 根因分析

### 问题链路
1. 前端 `authFetch()` 发送请求时同时使用 Cookie（`credentials: 'include'`）和 Authorization header（localStorage token）
2. 后端 auth middleware 先尝试 Cookie JWT → 失败后尝试 Authorization header JWT → 失败后尝试 userId 降级
3. **关键 bug**：当 JWT 过期或无效时，异常被静默捕获（`catch (e) {}`），用户身份默认为 `'public'`
4. `POST /api/article` 路由没有使用 `requireAuth` 中间件，允许 `public` 用户创建文章
5. 新文章以 `user_id = 'public'` 存入数据库
6. 用户重新登录或 Cookie 恢复后，查询列表只返回自己 userId 的文章，看不到 `public` 的

### 触发条件
- JWT 过期（7天有效期到期）
- Cookie 被浏览器清理但 localStorage token 仍在
- 部署环境的 Cookie 传输问题（secure/sameSite 策略）
- 前端未检测到认证失败，继续以匿名身份操作

### 受影响的代码
- `src/middleware/auth.js:17-77` — JWT 验证失败时静默降级为 public
- `src/routes/article.js:17` — 缺少 `requireAuth` 保护
- `public/script.js:89-101` — `authFetch` 未处理认证失效的情况

## What Changes
1. **`POST /api/article` 路由添加 `requireAuth` 中间件** — 未登录用户不允许创建文章，从源头避免 public 文章
2. **auth middleware 增加 JWT 过期检测** — 当 JWT 过期时，返回明确的错误信息而不是静默降级
3. **前端 `authFetch` 处理 401 响应** — 收到 401 时自动弹出登录框，提示用户重新登录
4. **（可选）添加数据修复脚本** — 将已有的 `user_id = 'public'` 的文章重新关联到正确用户

## Impact
- 受影响 specs: user-auth
- 受影响代码:
  - `src/middleware/auth.js` — 改进错误处理
  - `src/routes/article.js` — 添加 requireAuth
  - `public/script.js` — 添加 401 自动处理
- **不影响**已有的旧文章（它们 user_id 已经正确）
- **不是 breaking change**：只是收紧了权限，未登录用户本来也不应该能创建文章
