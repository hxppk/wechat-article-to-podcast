## 实现任务清单

1. 现状检查
   - [x] 1.1 确认 `podcasts.json` 当前字段结构
   - [x] 1.2 盘点 `routes/podcast.js` 与 `podcastStore.js` 读取/删除流程

2. 用户身份识别（v1.5）
   - [x] 2.1 新增 `authMiddleware`，解析 `Authorization: Bearer <userId>`
   - [x] 2.2 未提供或解析失败时设置 `req.userId = 'public'`

3. 数据模型升级
   - [x] 3.1 `podcastStore.addPodcast` 增加 `userId` 参数并持久化
   - [x] 3.2 新增 `getByUserId(userId)`
   - [x] 3.3 `getPodcast(id)` 支持按 `userId` 过滤
   - [x] 3.4 `deletePodcast(id, userId)` 校验归属

4. 生成流程接入
   - [x] 4.1 `queue.createTask` 增加 `userId` 参数
   - [x] 4.2 `processTask` 传递 `userId` 至 `addPodcast`

5. API 改造
   - [x] 5.1 `GET /api/podcasts` 返回当前用户播客
   - [x] 5.2 `GET /api/podcasts/:id` 仅返回所属用户播客
   - [x] 5.3 `DELETE /api/podcasts/:id` 校验用户归属

6. 前端预留
   - [x] 6.1 预留登录入口结构（默认隐藏）
   - [x] 6.2 若存在 token，则所有请求带 `Authorization`

7. 迁移脚本
   - [x] 7.1 新增 `scripts/migrate-v1-to-v1.5.js`
   - [x] 7.2 为所有旧记录补 `userId: 'public'`

8. 验证
   - [ ] 8.1 新生成播客包含 `userId: 'public'`
   - [ ] 8.2 Bearer userId 仅能看到自己的播客
   - [ ] 8.3 迁移后旧数据可正常展示
   - [ ] 8.4 `openspec validate add-auth-preparation --strict`
