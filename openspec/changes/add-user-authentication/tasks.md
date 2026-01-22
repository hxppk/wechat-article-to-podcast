# 实现任务清单：用户认证与多用户支持 (v2.0)

> **前置条件**：v1.0 (`create-wechat-podcast-app`) 已完成并稳定运行

---

## 阶段一：v1.5 准备期

### 1. 数据模型升级
- [ ] 1.1 备份现有 `data/podcasts.json`
- [ ] 1.2 编写迁移脚本 `scripts/migrate-v1-to-v1.5.js`
- [ ] 1.3 为 podcasts 记录添加 `userId` 字段（默认 `'public'`）
- [ ] 1.4 运行迁移脚本并验证数据完整性

### 2. 后端 API 升级
- [ ] 2.1 创建 `src/middleware/auth.js`
  - 实现 `authMiddleware`：解析可选的 token，设置 `req.userId`
  - 匿名用户 `req.userId = 'public'`
- [ ] 2.2 修改 `src/utils/podcastStore.js`
  - `addPodcast` 增加 `userId` 参数
  - 新增 `getByUserId(userId)` 方法
  - 修改 `deletePodcast` 验证 `userId` 所有权
- [ ] 2.3 修改 `src/services/queue.js`
  - `createTask` 增加 `userId` 参数
  - `processTask` 传递 `userId` 给 `podcastStore`
- [ ] 2.4 修改 `src/routes/podcast.js`
  - 应用 `authMiddleware`
  - `GET /api/podcasts` 返回当前用户的播客
  - `DELETE /api/podcasts/:id` 验证所有权
- [ ] 2.5 修改 `src/routes/article.js`
  - 应用 `authMiddleware`
  - 传递 `userId` 给 `taskQueue.createTask`

### 3. 前端预留
- [ ] 3.1 在 `public/index.html` 添加隐藏的登录按钮区域
- [ ] 3.2 在 `public/script.js` 创建 `AuthContext` 框架（空实现）
- [ ] 3.3 CSS 中添加登录相关样式（display: none）

### 4. 测试验证
- [ ] 4.1 验证无 token 时功能正常（匿名模式）
- [ ] 4.2 验证数据迁移后列表显示正常
- [ ] 4.3 验证新生成的播客有 `userId: 'public'`

---

## 阶段二：v2.0 完整账号系统

### 5. OAuth 认证实现
- [ ] 5.1 安装依赖：`passport`, `passport-google-oauth20`, `jsonwebtoken`, `cookie-parser`
- [ ] 5.2 创建 `src/config/passport.js` - Google OAuth 策略配置
- [ ] 5.3 创建 `src/routes/auth.js`
  - `GET /api/auth/google` - 发起登录
  - `GET /api/auth/google/callback` - 处理回调
  - `POST /api/auth/logout` - 登出
  - `GET /api/auth/me` - 获取当前用户
- [ ] 5.4 修改 `server.js` 挂载 auth 路由
- [ ] 5.5 配置环境变量：`JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

### 6. 用户数据存储
- [ ] 6.1 安装依赖：`better-sqlite3`
- [ ] 6.2 创建 `src/db/index.js` - 数据库初始化
- [ ] 6.3 创建 `src/db/users.js` - 用户 CRUD
  - `findById(id)`
  - `findByEmail(email)`
  - `findOrCreate(profile)`
- [ ] 6.4 创建 `src/db/podcasts.js` - 播客 CRUD（替代 podcastStore.js）
  - `create(podcast)`
  - `findByUserId(userId)`
  - `findById(id)`
  - `deleteById(id, userId)`
- [ ] 6.5 编写迁移脚本 `scripts/migrate-v1.5-to-v2.js`

### 7. 数据隔离实现
- [ ] 7.1 修改 `src/middleware/auth.js`
  - 增加 `requireAuth` 中间件
  - 从数据库加载用户信息
- [ ] 7.2 修改文件存储路径
  - 音频：`data/users/{userId}/audio/{id}.mp3`
  - 脚本：`data/users/{userId}/scripts/{id}.json`
- [ ] 7.3 修改 `queue.js` 使用用户目录
- [ ] 7.4 修改静态文件服务，根据 userId 定位文件

### 8. 配额系统实现
- [ ] 8.1 创建 `src/middleware/quota.js`
- [ ] 8.2 创建 `src/db/usage.js` - 使用量记录
  - `getUsage(userId, date)`
  - `incrementUsage(userId, date)`
- [ ] 8.3 定义配额常量（guest: 2, free: 10, premium: ∞）
- [ ] 8.4 在 `routes/article.js` 应用 quota 中间件
- [ ] 8.5 前端显示配额信息和错误提示

### 9. 前端登录界面
- [ ] 9.1 显示登录按钮和用户信息区域
- [ ] 9.2 实现 `AuthContext`
  - `init()` - 检查登录状态
  - `login()` - 跳转 OAuth
  - `logout()` - 登出
  - `updateUI()` - 更新界面
- [ ] 9.3 添加访客模式提示
  - "您正在以访客身份使用，播客将在 1 小时后删除"
  - "[登录] 以保存播客并获得更多配额"
- [ ] 9.4 登录后自动刷新播客列表

### 10. 访客模式保留
- [ ] 10.1 确保无 token 时仍可使用（配额限制 2 次/天）
- [ ] 10.2 访客播客清理时间改为 1 小时
- [ ] 10.3 前端区分显示访客/登录状态

### 11. 测试验证
- [ ] 11.1 测试 Google OAuth 完整流程
- [ ] 11.2 测试登录后数据隔离
- [ ] 11.3 测试配额限制和提示
- [ ] 11.4 测试访客模式
- [ ] 11.5 测试登出功能
- [ ] 11.6 测试数据迁移脚本

### 12. 部署准备
- [ ] 12.1 配置 HTTPS（Cloudflare 或 Let's Encrypt）
- [ ] 12.2 在 Render/Zeabur 配置环境变量
- [ ] 12.3 配置持久存储（数据库文件）
- [ ] 12.4 更新 README 文档
- [ ] 12.5 更新 Dockerfile（如需）

---

## 依赖关系图

```
阶段一 v1.5
┌─────────────────────────────────────┐
│ 1. 数据模型升级                      │
│         ↓                           │
│ 2. 后端 API 升级                     │
│         ↓                           │
│ 3. 前端预留                          │
│         ↓                           │
│ 4. 测试验证                          │
└─────────────────────────────────────┘
              ↓
阶段二 v2.0
┌─────────────────────────────────────┐
│ 5. OAuth 认证    6. 用户存储         │
│         ↘        ↙                  │
│      7. 数据隔离实现                  │
│              ↓                      │
│      8. 配额系统实现                  │
│              ↓                      │
│      9. 前端登录界面                  │
│              ↓                      │
│     10. 访客模式保留                  │
│              ↓                      │
│     11. 测试验证                     │
│              ↓                      │
│     12. 部署准备                     │
└─────────────────────────────────────┘
```

---

## 新增文件清单

### v1.5
| 文件 | 说明 |
|------|------|
| src/middleware/auth.js | 认证中间件（可选 token） |
| scripts/migrate-v1-to-v1.5.js | 数据迁移脚本 |

### v2.0
| 文件 | 说明 |
|------|------|
| src/config/passport.js | OAuth 策略配置 |
| src/routes/auth.js | 认证 API 路由 |
| src/db/index.js | 数据库初始化 |
| src/db/users.js | 用户数据操作 |
| src/db/podcasts.js | 播客数据操作 |
| src/db/usage.js | 使用量记录 |
| src/middleware/quota.js | 配额中间件 |
| scripts/migrate-v1.5-to-v2.js | 数据迁移脚本 |

---

## 环境变量清单

```env
# v2.0 必需
JWT_SECRET=your-jwt-secret-at-least-32-chars
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx

# v2.0 可选（微信 OAuth）
WECHAT_APP_ID=xxx
WECHAT_APP_SECRET=xxx

# 现有（继承自 v1.0）
GEMINI_API_KEY=xxx
PORT=3000
HTTPS_PROXY=http://127.0.0.1:7890
```

---

## 验收标准

### v1.5
1. ✅ 无 token 时功能与 v1.0 完全一致
2. ✅ 数据迁移后所有播客正常显示
3. ✅ 新生成播客包含 `userId: 'public'`

### v2.0
1. ✅ Google OAuth 登录/登出正常
2. ✅ 登录用户只能看到自己的播客
3. ✅ 访客模式可用，限制 2 次/天
4. ✅ 配额耗尽时显示友好提示
5. ✅ 数据迁移后原有播客归属 public 用户
6. ✅ HTTPS 部署正常
