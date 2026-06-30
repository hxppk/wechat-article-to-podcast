#!/usr/bin/env bash
set -euo pipefail

# 阿里云 ECS 一键部署脚本（瘦云端门面：caddy + app，零 AI / 零代理）。
# 需先准备好 .env（从 .env.production.example 复制并填写 JWT_SECRET / WORKER_API_TOKEN）。

DATA_DIR="/opt/wechat-podcast/data"

echo "==> 前置检查"
test -f .env || { echo "缺少 .env（从 .env.production.example 复制并填写 JWT_SECRET / WORKER_API_TOKEN）"; exit 1; }

echo "==> 确保数据目录存在且归属 1000:1000"
sudo mkdir -p "$DATA_DIR"
sudo chown -R 1000:1000 "$DATA_DIR"

echo "==> 拉取最新代码"
git pull --ff-only

echo "==> 构建并启动"
docker compose up -d --build

echo "==> 健康检查 app（经 caddy 内网）"
docker compose exec -T app sh -lc 'curl -fsS --max-time 10 http://127.0.0.1:8080/health' && echo || echo "warn: /health 探测未通过（栈可能仍在启动，请稍后手动复查 docker compose ps / logs）"

echo "==> 完成。门面（前端/任务队列/音频托管）已起，等待本地 worker 拉取任务（见 LOCAL-WORKER-SETUP.md）。"
