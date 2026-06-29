#!/usr/bin/env bash
set -euo pipefail

# 阿里云 ECS 一键部署脚本。需先准备好 .env 与 proxy/config.yaml。

DATA_DIR="/opt/wechat-podcast/data"

echo "==> 前置检查"
test -f .env || { echo "缺少 .env（从 .env.production.example 复制并填写）"; exit 1; }
test -f proxy/config.yaml || { echo "缺少 proxy/config.yaml（从 proxy/config.example.yaml 复制并填写节点）"; exit 1; }

echo "==> 确保数据目录存在且归属 1000:1000"
sudo mkdir -p "$DATA_DIR"
sudo chown -R 1000:1000 "$DATA_DIR"

echo "==> 拉取最新代码"
git pull --ff-only

echo "==> 构建并启动"
docker compose up -d --build

echo "==> 等待 clash 健康"
for i in $(seq 1 20); do
  status=$(docker compose ps --format '{{.Service}} {{.Health}}' | awk '/^clash/{print $2}')
  echo "  clash health: ${status:-starting} ($i/20)"
  [ "${status:-}" = "healthy" ] && break
  sleep 5
done

echo "==> 健康检查 app（经 caddy 内网）"
docker compose exec -T app sh -lc 'wget -qO- http://127.0.0.1:8080/health' && echo

echo "==> 完成。请继续执行 DEPLOY.md 的"出口 IP 验证"。"
