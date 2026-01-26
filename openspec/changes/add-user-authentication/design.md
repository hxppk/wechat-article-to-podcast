# 技术设计：手机号密码账号体系与多用户支持 (v2.0)

## Context
v1.5 已完成 userId 预埋与逻辑隔离，但缺少真实账号体系和持久化用户数据。v2.0 采用手机号+密码与 SQLite 方案，构建可扩展的多用户与配额系统。

## Goals / Non-Goals

### Goals
- 手机号+密码注册/登录
- JWT + HttpOnly Cookie 会话
- SQLite 持久化（users/podcasts/usage）
- 数据与文件按用户隔离
- 配额与留存规则落地
- 北京时间清理策略

### Non-Goals
- 不做短信验证码与找回流程（v2.1 再考虑）
- 不做付费系统接入
- 不做多租户/团队功能

---

## Decisions

### 1. 认证方案
**决定**：手机号+密码（无短信），JWT 会话

**实现要点**：
- 密码使用 `bcrypt` 哈希存储
- 登录成功签发 JWT（7 天有效期）
- Cookie：HttpOnly + SameSite=Lax
- 登录失败限制：同手机号 5 次/10 分钟（内存计数即可）

### 2. 数据存储（SQLite）
**决定**：使用 `better-sqlite3`，本地 `data/app.db`

**表结构**：
```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  tier TEXT DEFAULT 'free',
  created_at INTEGER,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS podcasts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  share_id TEXT,
  source_url TEXT,
  title TEXT,
  account_name TEXT,
  duration_ms INTEGER,
  file_size_bytes INTEGER,
  summary TEXT,
  script_preview TEXT,
  audio_path TEXT,
  script_path TEXT,
  created_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS usage (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
```

### 3. 分享访问（匿名可播放）
**决定**：为每条播客生成 `share_id`，分享链接使用 `/?share=<share_id>`。\n
**规则**：
- 分享访问无需登录，仅用于播放与查看详情
- 分享访问不计入配额（配额仅在提交转换时计数）
- 分享访问不新增到用户列表
- 返回首页后若已登录，仍显示登录用户列表

### 3. 配额与留存
**决定**：按提交计数（失败也计入），按北京时间（UTC+8）重置

- 访客：1/天，保留 30 分钟
- 免费：2/天，保留 7 天
- 付费：20/天，永久

### 4. 数据隔离与文件路径
**决定**：音频/脚本按用户目录存储

```
data/users/{userId}/audio/{id}.mp3
 data/users/{userId}/scripts/{id}.json
```

匿名用户使用 `data/users/public/`。

### 5. 迁移策略
- 从 v1.5 的 `podcasts.json` 迁移到 SQLite
- 旧记录统一归属 `public`

---

## Risks / Trade-offs
- 无短信验证码，存在撞库风险（需登录失败限制）
- SQLite 单机适配良好，但未来可能需迁移到 Postgres

## Open Questions
- 是否需要 admin 后台调整 `tier`
- v2.1 是否引入短信验证码与找回
