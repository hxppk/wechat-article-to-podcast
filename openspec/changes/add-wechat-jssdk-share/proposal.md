# 变更：接入微信 JS-SDK 分享卡片

## 为什么
当前微信内分享只显示标题或链接，无法稳定展示摘要与封面。接入 JS-SDK 可在微信分享面板中设置标题/描述/封面，提升分享效果。

## 改什么
- 增加服务端 JS-SDK 签名接口，返回 appId/nonceStr/timestamp/signature。
- 前端在微信内加载 JS-SDK 并设置分享数据（标题、摘要、封面、链接）。
- 增加 JS 接口安全域名验证文件（放置在 `public/` 根目录）。
- 使用环境变量配置 AppID 与 AppSecret（不写入仓库）。

## 影响范围
- 影响规格：wechat-jssdk-share
- 影响代码：server.js、src/routes/*、public/index.html、public/script.js
