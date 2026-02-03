## 实现任务清单

1. 现状检查
   - [x] 1.1 阅读 `public/index.html`/`public/script.js`/`public/style.css` 播放器与列表结构
   - [x] 1.2 确认 `GET /api/podcasts` 与 `/api/podcasts/:id` 返回 `sourceUrl` 字段

2. 详情页结构与样式
   - [x] 2.1 在 `public/index.html` 添加详情页抽屉与遮罩 DOM
   - [x] 2.2 在 `public/style.css` 增加抽屉、遮罩、按钮、toast、移动端适配样式

3. 详情页交互与数据绑定
   - [x] 3.1 在 `public/script.js` 新增详情页状态与 DOM 引用
   - [x] 3.2 支持点击播放器非按钮区域和上滑打开，下滑/关闭按钮关闭
   - [x] 3.3 打开详情页时填充标题/账号/简介/时长等信息

4. 分享与原文入口
   - [x] 4.1 分享按钮生成 `/?podcast=<id>` 并复制（含失败兜底与 toast）
   - [x] 4.2 页面加载解析 `podcast` 参数并打开详情页（不自动播放）
   - [x] 4.3 原文按钮按 `sourceUrl` 是否存在显示/置灰并支持跳转

5. 播放控制增强
   - [x] 5.1 增加后退 15s、前进 30s 按钮并做边界处理
   - [ ] 5.2 可选：更新键盘左右键为 15s/30s

6. 验证
   - [ ] 6.1 手动验证分享链接、原文跳转、快退/快进与详情页展开
   - [ ] 6.2 `openspec validate add-playback-detail-page --strict`
