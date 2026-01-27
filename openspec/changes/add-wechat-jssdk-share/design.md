# 设计说明：微信 JS-SDK 分享

## 目标
在微信内分享时，稳定显示标题、摘要、封面图。

## 服务端签名流程
1. 前端传入当前页面 URL（不含 hash）。
2. 服务端获取 access_token（缓存至过期前）。
3. 服务端获取 jsapi_ticket（缓存至过期前）。
4. 生成 nonceStr、timestamp。
5. 计算 signature：
   `sha1("jsapi_ticket=...&noncestr=...&timestamp=...&url=...")`
6. 返回 appId、timestamp、nonceStr、signature。

## 缓存策略
- access_token 与 jsapi_ticket 使用内存缓存，按 expires_in 做过期时间。
- 简化实现，不引入外部缓存依赖。

## 安全与限制
- AppSecret 仅通过环境变量注入，不写入仓库。
- 签名接口限制 URL 必须是本站域名（防止被滥用）。

## 前端行为
- 仅在微信内（UA 包含 `MicroMessenger`）加载 JS-SDK。
- 调用 wx.config 后，在 wx.ready 设置分享数据：
  - `updateAppMessageShareData`
  - `updateTimelineShareData`
- 分享链接使用 `/?share=<id>&title=<encoded>`。
- 标题用播客 `title`，描述用 `summary`，封面使用 `public/favicon.png` 的绝对 URL。

## 兼容性
- 若 JS-SDK 不可用或签名失败，降级为当前 og meta 分享效果。
