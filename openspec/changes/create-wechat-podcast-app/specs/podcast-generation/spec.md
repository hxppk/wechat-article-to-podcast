# 能力：播客生成

## ADDED Requirements

### Requirement: 对话脚本生成
系统 SHALL 将文章内容转换为双人对话脚本。

#### Scenario: 成功生成脚本
- **WHEN** 输入有效的文章文本
- **THEN** 系统调用 Gemini LLM 生成对话脚本
- **AND** 脚本包含两个角色（老王、小李）的交替对话
- **AND** 脚本以 JSON 数组格式保存

#### Scenario: LLM API 失败
- **WHEN** Gemini API 返回错误
- **THEN** 系统重试最多 3 次
- **AND** 若仍失败，返回错误提示「脚本生成失败，请稍后重试」

#### Scenario: 内容过长截断
- **WHEN** 文章内容超过 LLM token 限制
- **THEN** 系统截取前部分内容生成脚本
- **AND** 确保生成的对话完整闭合

### Requirement: 语音合成
系统 SHALL 将对话脚本转换为音频文件。

#### Scenario: 多角色一次性合成
- **WHEN** 对话脚本包含多个角色
- **THEN** 系统使用 Gemini TTS 的 multiSpeakerVoiceConfig
- **AND** 一次 API 调用生成完整音频
- **AND** 老王使用 Charon 声音，小李使用 Aoede 声音

#### Scenario: TTS API 失败
- **WHEN** Gemini TTS API 返回错误
- **THEN** 系统重试最多 3 次（指数退避）
- **AND** 若仍失败，返回错误提示「语音合成失败，请稍后重试」

#### Scenario: 音频格式转换
- **WHEN** TTS 返回 PCM 原始音频
- **THEN** 系统使用 FFmpeg 转换为 MP3 格式
- **AND** 使用 libmp3lame 编码，质量等级 2

### Requirement: 任务状态管理
系统 SHALL 跟踪任务的处理状态。

#### Scenario: 任务状态查询
- **WHEN** 用户查询任务状态
- **THEN** 系统返回当前状态（processing/completed/failed）
- **AND** 若完成，返回音频下载链接和时长

#### Scenario: 任务超时
- **WHEN** 任务处理超过 5 分钟
- **THEN** 系统标记任务为失败
- **AND** 返回错误提示「处理超时，请重试」

### Requirement: 文件管理
系统 SHALL 管理生成的脚本和音频文件。

#### Scenario: 文件自动清理
- **WHEN** 文件创建超过 1 小时
- **THEN** 系统自动删除该文件
- **AND** 释放存储空间

#### Scenario: 文件下载
- **WHEN** 用户请求下载音频
- **THEN** 系统返回 MP3 文件
- **AND** 设置正确的 Content-Type 和文件名
