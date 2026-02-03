## 实现任务清单

1. 分析现有代码
   - [ ] 1.1 阅读 `src/services/articleExtractor.js` 获取现有 accountName 逻辑
   - [ ] 1.2 阅读 `src/utils/podcastStore.js` 看写入字段
   - [ ] 1.3 阅读前端 `public/script.js` 列表/播放器展示逻辑

2. 提取真实公众号名称
   - [ ] 2.1 扩充 articleExtractor 的选择器（如 `.profile_nickname`）
   - [ ] 2.2 添加兜底策略（缺失时逐个尝试，再 fallback “未知公众号”）
   - [ ] 2.3 为该功能写最小化单元或调试日志验证

3. 播客元数据更新
   - [ ] 3.1 `queue.js`/`podcastStore.js` 确保新字段写入 (sourceUrl, accountName)
   - [ ] 3.2 API `GET /api/podcasts` / `/api/podcast/:id` 返回真实 accountName

4. 前端展示
   - [ ] 4.1 列表项显示 `podcast.accountName`，移除固定文案
   - [ ] 4.2 播放器顶部同步显示当前播客昵称
   - [ ] 4.3 Fallback：若字段缺失显示“未知公众号”

5. 验证
   - [ ] 5.1 本地运行，抓取多篇公众号文章，确认昵称准确
   - [ ] 5.2 `openspec validate show-real-account-name --strict`

