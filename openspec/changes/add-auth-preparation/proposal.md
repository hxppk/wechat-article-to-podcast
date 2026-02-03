# Change: v1.5 用户身份准备期（userId 预埋）

## Why
当前所有播客数据为全局共享，不具备用户维度。为 v2.0 账号系统做准备，需要在不引入真实登录的前提下完成数据模型升级与接口兼容。

## What Changes
- 播客元数据新增 `userId` 字段，匿名用户归属 `public`
- API 支持可选的 `Authorization: Bearer <userId>` 识别用户
- 列表/详情/删除接口按 `userId` 过滤与校验
- 新增迁移脚本，为旧数据补齐 `userId: 'public'`
- 前端预留登录入口（隐藏）与可选 token 传递

## Impact
- 影响数据结构（`podcasts.json` 新增字段）
- 影响 API 返回与权限行为（按 `userId` 过滤）
- 需要一次性迁移旧数据
