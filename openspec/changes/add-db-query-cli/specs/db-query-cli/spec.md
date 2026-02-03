## ADDED Requirements

### Requirement: 本地数据库 SQL 查询 CLI
系统 SHALL 提供一个本地 CLI 工具，允许用户在终端传入 SQL 并查询 `data/app.db`。

#### Scenario: 执行 SELECT 查询
- **WHEN** 用户在终端提供有效的 SQL 查询语句
- **THEN** 系统输出查询结果到标准输出并返回成功退出码

#### Scenario: SQL 无效或执行失败
- **WHEN** 用户提供的 SQL 语句语法错误或执行失败
- **THEN** 系统输出错误信息并返回非零退出码
