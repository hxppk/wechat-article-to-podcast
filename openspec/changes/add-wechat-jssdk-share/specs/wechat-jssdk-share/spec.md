## ADDED Requirements

### Requirement: 微信 JS-SDK 分享配置
系统 SHALL 在微信内为分享卡片提供 JS-SDK 配置，并设置标题、摘要、封面与链接。

#### Scenario: 分享卡片配置成功
- **WHEN** 用户在微信内打开带 `share` 参数的页面
- **THEN** 前端通过 JS-SDK 设置分享卡片标题、摘要与封面

### Requirement: 签名接口
系统 SHALL 提供 JS-SDK 签名接口，使用 AppID/AppSecret 获取票据并生成签名。

#### Scenario: 获取签名
- **WHEN** 前端提交当前页面 URL
- **THEN** 服务端返回有效的 signature/nonceStr/timestamp
