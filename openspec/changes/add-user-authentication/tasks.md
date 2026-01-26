# 实现任务清单：手机号密码账号体系与多用户支持 (v2.0)

> **前置条件**：v1.5（userId 预埋）已完成

---

## 1. 依赖与数据库初始化
- [x] 1.1 安装依赖：`better-sqlite3`, `bcrypt`, `jsonwebtoken`, `cookie-parser`
- [x] 1.2 新增 `src/db/index.js` 初始化 SQLite 与表结构
- [x] 1.3 新增 `src/db/users.js`（CRUD）
- [x] 1.4 新增 `src/db/podcasts.js`（CRUD）
- [x] 1.5 新增 `src/db/usage.js`（按 userId+date 计数）

## 2. 认证与会话
- [x] 2.1 新增 `src/routes/auth.js`
  - `POST /api/auth/register`（手机号+密码）
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
- [x] 2.2 密码使用 `bcrypt` 哈希存储
- [x] 2.3 JWT 签发与校验（HttpOnly Cookie）
- [x] 2.4 登录失败限制：同手机号 5 次/10 分钟
- [x] 2.5 `server.js` 挂载 cookie 解析与 auth 路由

## 3. authMiddleware 与用户识别
- [x] 3.1 更新 `authMiddleware`：从 Cookie 解析 JWT
- [x] 3.2 未登录设为 `public`
- [x] 3.3 `requireAuth` 中间件（需要登录的接口用）

## 4. 数据隔离与播客存储
- [x] 4.1 播客 API 改为读取 SQLite
- [x] 4.2 按 `req.userId` 过滤 list/detail/delete
- [x] 4.3 音频/脚本路径改为 `data/users/{userId}/...`
- [x] 4.4 `queue.js` 使用用户目录写入文件

## 5. 配额与留存
- [x] 5.1 新增 `quotaMiddleware`（按提交计数，失败也计入）
- [x] 5.2 配额规则：访客 1/天，免费 2/天，付费 20/天
- [x] 5.3 清理任务：访客 30 分钟，免费 7 天，付费永久
- [x] 5.4 重置时间按北京时间（UTC+8）

## 6. 分享访问（匿名可播放）
- [x] 6.1 为播客生成 `share_id` 并持久化
- [x] 6.2 新增 `GET /api/share/:shareId` 返回公开播客信息
- [x] 6.3 新增 `GET /api/share/:shareId/audio` 提供音频流
- [x] 6.4 前端分享链接改为 `/?share=<shareId>`
- [x] 6.5 分享访问不计配额，不新增到用户列表

## 7. 迁移脚本
- [x] 7.1 编写 `scripts/migrate-v1.5-to-v2.js`
- [x] 7.2 将 `podcasts.json` 导入 SQLite
- [x] 7.3 旧数据归属 `public`

## 8. 前端接入
- [x] 8.1 登录/注册 UI（可弹窗或独立区块）
- [x] 8.2 显示当前用户与配额信息
- [x] 8.3 访客提示（30 分钟保留）
- [x] 8.4 分享页播放与返回首页逻辑（优先使用已登录状态）

## 9. 验证
- [x] 9.1 注册/登录/登出流程
- [x] 9.2 数据隔离（不同用户互不可见）
- [x] 9.3 配额限制与重置时间
- [x] 9.4 留存清理符合规则
- [x] 9.5 分享链接匿名播放可用
- [x] 9.6 分享访问不计配额
- [x] 9.7 迁移脚本运行后数据一致
