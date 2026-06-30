# 部署手册：podcast.hxppk.cn（瘦云端门面）

> **架构**：阿里云【美国】ECS 只做门面——前端、任务队列、worker 拉取 API、音频托管、SQLite。
> **零 AI key、零代理**。所有 AI 生成（文章抽取 + Claude 脚本 + ElevenLabs 音频）在本地 pm2 worker，
> 见 `LOCAL-WORKER-SETUP.md`。本地 worker 用住宅 IP 出站，规避机房风控；云端无需任何 AI key 或代理。

## 0. 前提
- 一台阿里云【美国】ECS，已装 Docker + Docker Compose 插件。
- 安全组只放行 80/443 与受限来源的 SSH(22)。**不要**放行 8080。

## 1. DNS
阿里云 DNS 控制台为 `hxppk.cn` 加 A 记录：`podcast` → ECS 公网 IP。等待生效（`dig podcast.hxppk.cn`）。

## 2. 拉代码与配置
```bash
git clone <repo> wechat-podcast && cd wechat-podcast
cp .env.production.example .env
openssl rand -hex 32   # 生成 JWT_SECRET，填入 .env
openssl rand -hex 32   # 生成 WORKER_API_TOKEN，填入 .env（须与本地 worker 的 .env.worker 同值）
```
`.env` 需填：`JWT_SECRET`、`WORKER_API_TOKEN`、`CORS_ORIGIN=https://podcast.hxppk.cn`。**无任何 AI key、无代理变量**。

## 3. 上线
```bash
./deploy.sh
```
Caddy 会在 DNS 生效且 80/443 可达后自动签发 Let's Encrypt 证书。

## 4. 本地 worker 接入
云端只接收任务、托管音频；实际生成在本地 worker（拉模式，住宅 IP 出站）。在你本地机器按 `LOCAL-WORKER-SETUP.md` 起 pm2 worker，关键配置：
- `CLOUD_BASE_URL=https://podcast.hxppk.cn`
- `WORKER_API_TOKEN`（与云端 `.env` 同值）

worker 出站轮询云端任务 → 本地完成抽取 + Claude 脚本 + ElevenLabs 音频 → 上传 mp3 回云端。云端无需对 worker 开放任何入站端口。

## 5. 备份
- 云盘快照（整体，最省心）。
- SQLite 一致性备份（瘦身镜像不含 `sqlite3` CLI，用容器内的 better-sqlite3）：
```bash
docker compose exec -T app node -e "require('better-sqlite3')('/app/data/app.db').backup('/app/data/backup-'+new Date().toISOString().slice(0,10)+'.db').then(()=>process.exit(0))"
```
- 同步 `/opt/wechat-podcast/data` 下音频目录到对象存储/异地。

## 6. 回滚
```bash
git checkout <上一个可用 tag/commit>
docker compose up -d --build
```
数据在绑定挂载卷，回滚代码不丢数据。

## 7. 常见问题
- 证书签发失败：确认 DNS 已生效、安全组放行 80/443、`caddy_data` 卷未被清空。
- worker 拉取返回 401：确认云端 `.env` 与本地 worker 的 `WORKER_API_TOKEN` 完全一致。
- 上传 mp3 失败/超时：Caddyfile 已放宽 `request_body 100MB` 与 30m 读写超时；确认音频未超 100MB。
- 任务卡在处理中：worker 心跳续约由 `LEASE_MS` 控制；worker 掉线后任务到期会重新可见。
