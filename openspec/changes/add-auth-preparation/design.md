# 技术设计：v1.5 用户身份准备期（userId 预埋）

## Context
v1.0 目前为单用户/匿名模式，数据全局共享。v1.5 目标是以最小改动引入 `userId` 字段与接口过滤逻辑，为 v2.0 真正的账号体系铺路。

## Goals / Non-Goals

### Goals
- 通过 `Authorization: Bearer <userId>` 识别用户
- 未提供或非法 token 时默认归属 `public`
- 播客列表/详情/删除按 `userId` 隔离
- 旧数据一次性迁移到 `public` 用户

### Non-Goals
- 不实现 OAuth / JWT / 用户注册
- 不引入数据库或物理目录隔离
- 不做配额限制

## Decisions

### 1. 身份识别规则
**决定**：v1.5 使用简化规则 `Authorization: Bearer <userId>`。

**原因**：
- 无需引入 JWT 或 OAuth 即可验证隔离逻辑
- 便于前端与测试快速验证

### 2. 数据存储
**决定**：继续使用 `data/podcasts.json`，仅新增字段 `userId`。

**原因**：
- 变更成本最低
- 与 v1.0 兼容，便于迁移

### 3. API 行为
**决定**：所有播客 API 按 `req.userId` 过滤与校验。

**原因**：
- 防止不同用户之间的数据互见
- 为 v2.0 的真实鉴权提供一致接口行为

## Migration Plan
1. 备份 `data/podcasts.json`
2. 运行 `scripts/migrate-v1-to-v1.5.js`
3. 将无 `userId` 的记录补为 `public`

## Risks / Trade-offs
- Bearer userId 可被伪造，仅适合准备期验证逻辑
- 数据逻辑隔离但物理共享，不满足更强的安全需求

## Open Questions
- 是否需要在前端加入“当前用户”展示（隐藏状态）
- 迁移脚本是否应在启动时自动执行
