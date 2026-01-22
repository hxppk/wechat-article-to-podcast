# 能力：播客管理

## ADDED Requirements

### Requirement: 播客列表查询
系统 SHALL 提供获取所有播客列表的 API。

#### Scenario: 获取播客列表成功
- **WHEN** 客户端请求 GET /api/podcasts
- **THEN** 系统返回所有播客的元数据数组
- **AND** 按生成时间倒序排列（最新在前）

#### Scenario: 列表为空
- **WHEN** 没有任何播客记录
- **THEN** 系统返回空数组 []

#### Scenario: 列表字段完整
- **WHEN** 返回播客列表
- **THEN** 每条记录包含：id, title, sourceUrl, accountName, durationMs, fileSizeBytes, scriptPreview, generatedAt

### Requirement: 播客详情查询
系统 SHALL 提供获取单个播客详情的 API。

#### Scenario: 获取详情成功
- **WHEN** 客户端请求 GET /api/podcasts/:id
- **AND** 该 id 对应的播客存在
- **THEN** 系统返回完整的播客元数据

#### Scenario: 播客不存在
- **WHEN** 客户端请求 GET /api/podcasts/:id
- **AND** 该 id 不存在
- **THEN** 系统返回 404 错误

### Requirement: 播客删除
系统 SHALL 提供删除播客的 API。

#### Scenario: 删除成功
- **WHEN** 客户端请求 DELETE /api/podcasts/:id
- **AND** 该 id 对应的播客存在
- **THEN** 系统删除元数据记录
- **AND** 系统删除对应的音频文件（data/audio/{id}.mp3）
- **AND** 系统删除对应的脚本文件（data/scripts/{id}.json）

#### Scenario: 删除不存在的播客
- **WHEN** 客户端请求 DELETE /api/podcasts/:id
- **AND** 该 id 不存在
- **THEN** 系统返回 404 错误

### Requirement: 音频文件服务
系统 SHALL 提供音频文件的流式访问。

#### Scenario: 播放音频
- **WHEN** 客户端请求 GET /audio/{id}.mp3
- **AND** 音频文件存在
- **THEN** 系统返回音频文件流
- **AND** 设置 Content-Type 为 audio/mpeg

#### Scenario: 下载音频
- **WHEN** 客户端请求下载音频
- **THEN** 系统返回音频文件
- **AND** 设置 Content-Disposition 为 attachment

#### Scenario: 音频文件不存在
- **WHEN** 客户端请求 GET /audio/{id}.mp3
- **AND** 文件不存在
- **THEN** 系统返回 404 错误

### Requirement: 文件自动清理
系统 SHALL 定期清理过期文件。

#### Scenario: 清理过期文件
- **WHEN** 文件创建时间超过 1 小时
- **THEN** 系统自动删除该文件
- **AND** 同时删除对应的元数据记录

#### Scenario: 保留新文件
- **WHEN** 文件创建时间未超过 1 小时
- **THEN** 系统保留该文件

### Requirement: 前端播客列表
系统 SHALL 在前端展示播客列表。

#### Scenario: 列表渲染
- **WHEN** 页面加载完成
- **THEN** 系统请求 /api/podcasts 获取列表
- **AND** 渲染每条播客：标题、时长、文件大小、生成时间、摘要

#### Scenario: 列表自动刷新
- **WHEN** 任务处理完成
- **THEN** 系统自动刷新播客列表

### Requirement: 前端播放器
系统 SHALL 提供音频播放器组件。

#### Scenario: 播放功能
- **WHEN** 用户点击播放按钮
- **THEN** 播放器开始播放音频
- **AND** 显示当前进度和总时长

#### Scenario: 进度控制
- **WHEN** 用户拖动进度条
- **THEN** 播放器跳转到对应位置

#### Scenario: 倍速播放
- **WHEN** 用户选择播放速度（0.5x/1x/1.5x/2x）
- **THEN** 播放器按选定速度播放

#### Scenario: 下载按钮
- **WHEN** 用户点击下载按钮
- **THEN** 浏览器下载 MP3 文件
