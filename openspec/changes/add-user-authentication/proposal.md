# Change: 添加用户认证与多用户支持 (v2.0)

> **前置依赖**：`create-wechat-podcast-app`（v1.0）必须先完成并稳定运行

## Why
v1.0 作为 MVP 发布后，需要引入账号体系以支持：
- 用户数据隔离，每个用户只能看到自己的播客
- 防止滥用，通过配额限制保护 API 资源
- 支持更多商业化场景（付费用户、高级功能）

采用**渐进增强**策略，确保不影响无门槛体验。

## What Changes

### 阶段一：v1.5 准备期（数据模型升级）
- 播客元数据增加 `userId` 字段
- 匿名用户归属到 `public` 默认账号
- API 支持可选的 `Authorization` header
- 前端预留登录入口（隐藏状态）

### 阶段二：v2.0 完整账号系统
- **身份验证**：OAuth 登录（微信/Google）+ JWT session
- **数据隔离**：按用户存储和查询数据
- **配额管理**：每用户每日限额
- **访客模式**：保留有限的匿名体验

## Impact
- 新增能力：`user-authentication`（用户认证）
- 新增能力：`data-isolation`（数据隔离）
- 新增能力：`quota-management`（配额管理）
- **BREAKING**：`podcasts.json` 结构变更，需迁移脚本
- 部署要求：HTTPS、持久存储、环境变量（JWT secret、OAuth credentials）

---

## 技术方案概览

### 1. 身份验证

#### OAuth 选型
| 方案 | 适用场景 | 实现复杂度 |
|------|---------|-----------|
| 微信 OAuth | 国内用户为主 | 中（需企业认证） |
| Google OAuth | 海外/技术用户 | 低 |
| 账号密码 | 通用 | 中（需密码安全） |

**建议**：先实现 Google OAuth（无需企业认证），后续按需增加微信。

#### API 设计
```
POST /api/auth/login          # 发起 OAuth 登录
GET  /api/auth/callback       # OAuth 回调
POST /api/auth/logout         # 登出
GET  /api/auth/me             # 获取当前用户信息
```

#### Session 管理
- 使用 JWT（JSON Web Token）
- Token 存储在 HttpOnly Cookie
- 有效期 7 天，支持刷新

### 2. 数据隔离

#### 存储方案演进
```
v1.0: data/podcasts.json                    # 全局单文件
v1.5: data/podcasts.json + userId 字段       # 加字段，逻辑隔离
v2.0: SQLite/PostgreSQL 或按用户分目录        # 物理隔离
```

#### 目录结构（文件系统方案）
```
data/
├── users/
│   ├── {userId}/
│   │   ├── podcasts.json
│   │   ├── scripts/
│   │   └── audio/
│   └── public/           # 匿名用户
│       ├── podcasts.json
│       ├── scripts/
│       └── audio/
└── users.json            # 用户表
```

#### 数据库方案（推荐长期）
```sql
-- users 表
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  avatar_url TEXT,
  provider TEXT,           -- 'google' | 'wechat'
  provider_id TEXT,
  created_at INTEGER,
  last_login_at INTEGER
);

-- podcasts 表
CREATE TABLE podcasts (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  source_url TEXT,
  title TEXT,
  account_name TEXT,
  duration_ms INTEGER,
  file_size_bytes INTEGER,
  script_preview TEXT,
  audio_path TEXT,
  script_path TEXT,
  created_at INTEGER
);
```

### 3. 配额管理

#### 配额规则
| 用户类型 | 每日限额 | 单文件限制 |
|---------|---------|-----------|
| 访客 | 2 次 | 5000 字 |
| 免费用户 | 10 次 | 10000 字 |
| 付费用户 | 无限制 | 50000 字 |

#### 实现方式
```javascript
// middleware/quota.js
async function checkQuota(req, res, next) {
  const userId = req.user?.id || 'public';
  const today = new Date().toISOString().slice(0, 10);
  const usage = await getUsage(userId, today);
  const limit = getLimit(req.user?.tier || 'guest');

  if (usage >= limit) {
    return res.status(429).json({
      error: '今日额度已用完',
      usage,
      limit,
      resetAt: getNextReset()
    });
  }
  next();
}
```

### 4. 访客模式保留

#### 行为
- 无需登录即可使用
- 生成的播客归属 `public` 用户
- 每日限制 2 次
- 播客 1 小时后自动清理（比登录用户更短）

#### 前端提示
```
您正在以访客身份使用，播客将在 1 小时后自动删除。
[登录] 以保存您的播客并获得更多配额。
```

### 5. 部署要求

#### 环境变量
```env
# 必需
JWT_SECRET=your-jwt-secret-key
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx

# 可选（微信 OAuth）
WECHAT_APP_ID=xxx
WECHAT_APP_SECRET=xxx

# 数据库（v2.0 完整版）
DATABASE_URL=postgresql://...
```

#### HTTPS
- OAuth 回调必须使用 HTTPS
- 推荐使用 Cloudflare 或 Let's Encrypt

#### 持久存储
- Render/Zeabur 需配置持久化磁盘
- 或迁移到云数据库（Supabase/PlanetScale）

---

## 迁移计划

### v1.0 → v1.5
1. 备份现有 `data/podcasts.json`
2. 运行迁移脚本，为每条记录添加 `userId: 'public'`
3. 部署新版本，验证匿名访问正常

### v1.5 → v2.0
1. 创建数据库并初始化表结构
2. 运行数据迁移脚本（JSON → DB）
3. 配置 OAuth 环境变量
4. 部署新版本
5. 验证登录、数据隔离、配额功能

---

## 与 v1.0 的关系

| 组件 | v1.0 | v2.0 | 兼容性 |
|------|------|------|--------|
| 数据存储 | podcasts.json | 数据库 + userId | 需迁移 |
| API | 无认证 | JWT + 可选认证 | 向后兼容 |
| 前端 | 无登录 | 登录 + 访客 | 渐进增强 |
| 部署 | HTTP 可用 | HTTPS 必需 | 需升级 |
