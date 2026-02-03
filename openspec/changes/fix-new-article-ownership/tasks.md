## 1. 后端修复

- [x] 1.1 `src/routes/article.js`: `POST /` 添加 `requireAuth` 中间件，未登录返回 401
- [x] 1.2 `src/middleware/auth.js`: 保留现有降级逻辑，配合 requireAuth 确保需要登录的接口不会以 public 身份执行

## 2. 前端修复

- [x] 2.1 `public/script.js`: `authFetch` 拦截 401 响应，自动清除无效 token 并弹出登录框
- [x] 2.2 `public/script.js`: `handleConvert` 在提交前检查 `currentUser` 状态，未登录时直接弹出登录框

## 3. 数据修复

- [x] 3.1 检查 `user_id = 'public'` 的播客记录 — 确认无此类数据，无需修复
