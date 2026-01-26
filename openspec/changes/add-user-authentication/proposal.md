# Change: 添加手机号密码账号体系与多用户支持 (v2.0)

> **前置依赖**：v1.5 准备期（userId 预埋）已完成

## Why
v1.5 仅完成了 userId 预埋和逻辑隔离，缺少真实账号体系与持久化用户数据。v2.0 需要引入手机号+密码登录、SQLite 存储与配额/留存规则，满足多用户、可控滥用与商业化前置需求。

## What Changes
- 引入手机号+密码注册/登录（不做短信验证码）
- 使用 JWT + HttpOnly Cookie 管理会话
- 迁移到 SQLite（users/podcasts/usage 三张表）
- 访客/免费/付费配额与留存策略
- 按用户隔离列表/详情/删除与文件存储
- 迁移脚本：v1.5 `podcasts.json` → SQLite
- 播客分享链接支持匿名访问与播放（不计配额）

## Impact
- 新增依赖：`better-sqlite3`、`bcrypt`、`jsonwebtoken`、`cookie-parser`
- 数据结构从 JSON 迁移到 SQLite
- API 行为改变（需登录时返回 401；列表/详情按用户过滤）
- 需要定期清理任务（按北京时间执行）
- 新增分享访问能力与 shareId 字段

---

## API 设计（v2.0）
```
POST /api/auth/register     # 手机号注册
POST /api/auth/login        # 手机号登录
POST /api/auth/logout       # 登出
GET  /api/auth/me           # 当前用户
```

---

## 配额与留存规则
- 访客：每日 1 条，保留 30 分钟
- 免费：每日 2 条，保留 7 天
- 付费：每日 20 条，永久保留
- 计数口径：按“提交”计数，失败也计入
- 清理时区：北京时间（UTC+8）

---

## 迁移计划
### v1.5 → v2.0
1. 备份 `data/podcasts.json`
2. 运行迁移脚本，将记录导入 SQLite
3. 所有旧记录归属 `public`
4. 切换 API 读取 SQLite 作为唯一真源
