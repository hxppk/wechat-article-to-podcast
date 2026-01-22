# 技术设计：用户认证与多用户支持 (v2.0)

## Context
v1.0 MVP 发布后，需要引入账号体系以支持数据隔离、防止滥用、商业化。采用渐进增强策略，分 v1.5 准备期和 v2.0 完整版两阶段实施。

## Goals / Non-Goals

### Goals
- 支持 OAuth 登录（Google 优先，微信可选）
- 用户数据完全隔离
- 配额限制防止滥用
- 保留访客试用体验
- 平滑迁移，不丢失现有数据

### Non-Goals
- 不做付费系统（v3.0 再考虑）
- 不做团队/组织功能
- 不做社交功能（分享、评论）

---

## Decisions

### 1. 认证方案选型

**决定**：Google OAuth 2.0 + JWT

**理由**：
- Google OAuth 无需企业认证，个人开发者可用
- JWT 无状态，易于扩展
- 后续可增加微信 OAuth（需企业认证）

**库选型**：
- `passport` + `passport-google-oauth20`：成熟稳定
- `jsonwebtoken`：JWT 生成和验证
- `cookie-parser`：Cookie 解析

**实现**：
```javascript
// src/middleware/auth.js
const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    // 匿名用户
    req.user = null;
    req.userId = 'public';
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.userId = decoded.id;
    next();
  } catch (err) {
    // Token 无效，当作匿名用户
    req.user = null;
    req.userId = 'public';
    next();
  }
}

// 强制登录的路由使用
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: '请先登录' });
  }
  next();
}
```

### 2. 数据存储演进

**v1.5 方案**：在现有 JSON 基础上增加 userId

```javascript
// data/podcasts.json
[
  {
    "id": "uuid",
    "userId": "public",      // 新增字段
    "sourceUrl": "...",
    "title": "...",
    // ... 其他字段
  }
]
```

**v2.0 方案**：迁移到 SQLite（简单部署）或 PostgreSQL（生产推荐）

```javascript
// src/db/index.js
const Database = require('better-sqlite3');
const db = new Database('data/app.db');

// 初始化表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
    avatar_url TEXT,
    provider TEXT,
    provider_id TEXT,
    tier TEXT DEFAULT 'free',
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS podcasts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source_url TEXT,
    title TEXT,
    account_name TEXT,
    duration_ms INTEGER,
    file_size_bytes INTEGER,
    script_preview TEXT,
    audio_path TEXT,
    script_path TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_podcasts_user_id ON podcasts(user_id);
`);
```

**理由**：
- v1.5 改动最小，快速验证
- SQLite 单文件，部署简单，无需额外服务
- 数据量大时可平滑迁移到 PostgreSQL

### 3. API 兼容性设计

**决定**：所有现有 API 保持向后兼容，通过可选 token 区分用户

**v1.0 API（保持不变）**：
```
POST /api/article
GET  /api/status/:id
GET  /api/podcasts
GET  /api/podcasts/:id
DELETE /api/podcasts/:id
```

**v2.0 新增 API**：
```
GET  /api/auth/google           # 发起 Google 登录
GET  /api/auth/google/callback  # Google 回调
POST /api/auth/logout           # 登出
GET  /api/auth/me               # 当前用户信息
```

**兼容性实现**：
```javascript
// routes/podcast.js
router.get('/', authMiddleware, async (req, res) => {
  // req.userId 来自 authMiddleware
  // 匿名用户为 'public'，登录用户为实际 userId
  const podcasts = await podcastStore.getByUserId(req.userId);
  res.json(podcasts);
});
```

### 4. 配额系统设计

**决定**：基于 userId + 日期 的计数器

**存储**：
```javascript
// data/usage.json 或数据库表
{
  "public:2025-01-21": 5,
  "user123:2025-01-21": 3
}
```

**中间件**：
```javascript
// src/middleware/quota.js
const LIMITS = {
  guest: 2,
  free: 10,
  premium: Infinity
};

async function quotaMiddleware(req, res, next) {
  const userId = req.userId;
  const tier = req.user?.tier || 'guest';
  const today = new Date().toISOString().slice(0, 10);
  const key = `${userId}:${today}`;

  const usage = await getUsage(key);
  const limit = LIMITS[tier];

  if (usage >= limit) {
    return res.status(429).json({
      error: '今日配额已用完',
      code: 'QUOTA_EXCEEDED',
      usage,
      limit,
      tier,
      resetAt: getNextMidnight()
    });
  }

  // 记录使用
  req.incrementUsage = () => incrementUsage(key);
  next();
}
```

### 5. 前端架构设计

**决定**：使用 Context 模式管理认证状态

```javascript
// public/script.js

// Auth Context
const AuthContext = {
  user: null,
  isLoggedIn: false,

  async init() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        this.user = await res.json();
        this.isLoggedIn = true;
      }
    } catch (e) {
      // 匿名模式
    }
    this.updateUI();
  },

  updateUI() {
    const loginBtn = document.getElementById('login-btn');
    const userInfo = document.getElementById('user-info');

    if (this.isLoggedIn) {
      loginBtn.style.display = 'none';
      userInfo.textContent = `${this.user.name}`;
      userInfo.style.display = 'block';
    } else {
      loginBtn.style.display = 'block';
      userInfo.style.display = 'none';
    }
  },

  login() {
    window.location.href = '/api/auth/google';
  },

  async logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    this.user = null;
    this.isLoggedIn = false;
    this.updateUI();
    location.reload();
  }
};
```

### 6. 文件存储隔离

**v1.5 方案**：逻辑隔离，物理共享
```
data/
├── audio/{id}.mp3        # 所有用户共享目录
├── scripts/{id}.json
└── podcasts.json         # 通过 userId 字段过滤
```

**v2.0 方案**：物理隔离
```
data/
├── users/
│   ├── public/           # 匿名用户
│   │   ├── audio/
│   │   └── scripts/
│   └── {userId}/         # 登录用户
│       ├── audio/
│       └── scripts/
└── app.db                # SQLite 数据库
```

---

## 迁移脚本

### v1.0 → v1.5
```javascript
// scripts/migrate-v1-to-v1.5.js
const fs = require('fs');
const path = require('path');

const dataFile = path.join(__dirname, '../data/podcasts.json');
const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

// 为每条记录添加 userId
const migrated = data.map(podcast => ({
  ...podcast,
  userId: podcast.userId || 'public'
}));

// 备份原文件
fs.copyFileSync(dataFile, dataFile + '.backup');

// 写入迁移后的数据
fs.writeFileSync(dataFile, JSON.stringify(migrated, null, 2));

console.log(`迁移完成: ${migrated.length} 条记录`);
```

### v1.5 → v2.0
```javascript
// scripts/migrate-v1.5-to-v2.js
const fs = require('fs');
const Database = require('better-sqlite3');

const db = new Database('data/app.db');
const podcasts = JSON.parse(fs.readFileSync('data/podcasts.json', 'utf-8'));

// 确保 public 用户存在
db.prepare(`
  INSERT OR IGNORE INTO users (id, email, name, provider)
  VALUES ('public', 'public@local', '访客', 'local')
`).run();

// 迁移播客数据
const insert = db.prepare(`
  INSERT INTO podcasts (id, user_id, source_url, title, account_name,
    duration_ms, file_size_bytes, script_preview, audio_path, script_path, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const p of podcasts) {
  insert.run(
    p.id, p.userId || 'public', p.sourceUrl, p.title, p.accountName,
    p.durationMs, p.fileSizeBytes, p.scriptPreview, p.audioPath, p.scriptPath, p.generatedAt
  );
}

console.log(`迁移完成: ${podcasts.length} 条记录`);
```

---

## Risks / Trade-offs

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| OAuth 配置复杂 | 部署门槛提高 | 提供详细文档，支持环境变量 |
| 数据迁移失败 | 数据丢失 | 自动备份，可回滚 |
| JWT 泄露 | 账号被盗 | HttpOnly Cookie，短有效期 |
| 配额绕过 | 资源滥用 | IP 限制 + 验证码（可选） |

---

## Open Questions
- [ ] 是否需要支持邮箱注册？→ 暂不支持，只做 OAuth
- [ ] 配额重置时间用哪个时区？→ 使用 UTC 0 点
- [ ] 访客播客保留多久？→ 1 小时（比登录用户更短）
