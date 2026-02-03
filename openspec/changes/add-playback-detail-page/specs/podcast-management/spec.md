# 能力：播客管理

## ADDED Requirements

### Requirement: 播放详情页
系统 SHALL 提供播放详情页以展示当前播客信息与扩展控制。

#### Scenario: 点击播放器进入详情页
- **WHEN** 用户点击播放器非播放按钮区域或执行上滑手势
- **THEN** 系统展示详情页抽屉
- **AND** 显示播客标题、公众号名称、简介与时长信息

#### Scenario: 关闭详情页
- **WHEN** 用户下滑或点击关闭按钮
- **THEN** 系统收起详情页
- **AND** 播放状态保持不变

### Requirement: 分享链接生成与访问
系统 SHALL 支持为当前播客生成可访问的分享链接。

#### Scenario: 复制分享链接
- **WHEN** 用户点击详情页分享按钮
- **THEN** 系统生成 `/?podcast=<id>` 并复制到剪贴板
- **AND** 给出成功或失败提示

#### Scenario: 通过分享链接访问
- **WHEN** 用户访问带有 `podcast` 参数的页面
- **THEN** 系统加载对应播客并打开详情页
- **AND** 默认不自动播放

### Requirement: 原文跳转
系统 SHALL 支持从详情页跳转到原文链接。

#### Scenario: 原文链接存在
- **WHEN** 播客元数据包含 `sourceUrl`
- **THEN** 用户点击“查看原文”在新标签页打开链接

#### Scenario: 原文链接缺失
- **WHEN** `sourceUrl` 为空
- **THEN** 系统隐藏或置灰原文入口并提示不可用

### Requirement: 快退与快进控制
系统 SHALL 在详情页提供快退与快进控制。

#### Scenario: 后退 15 秒
- **WHEN** 用户点击后退按钮
- **THEN** 播放进度回退 15 秒
- **AND** 不得小于 0 秒

#### Scenario: 前进 30 秒
- **WHEN** 用户点击前进按钮
- **THEN** 播放进度前进 30 秒
- **AND** 不得超过音频总时长
