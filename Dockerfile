FROM node:20-slim
LABEL "language"="nodejs"
LABEL "framework"="express"

WORKDIR /app

# 瘦云端：不装 Chrome（文章抽取在本地 worker）。仅装健康探测/构建所需。
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# 云端不抽取微信文章，跳过 puppeteer 浏览器下载（puppeteer 包仅本地 worker 使用）
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package*.json ./
RUN npm install --omit=dev

COPY . ./

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 8080
ENV PORT=8080

# 存活探测（Docker 不会自动重启 unhealthy，仅供 docker ps / 外部自愈观测）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1

# 直跑 node（PID 1）：npm 包一层会吞信号，进程被杀时容器不退出、
# restart 策略失效（2026-07 线上假活 502 事故根因）
CMD ["node", "server.js"]
