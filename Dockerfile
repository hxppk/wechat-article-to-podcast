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
CMD ["npm", "start"]
