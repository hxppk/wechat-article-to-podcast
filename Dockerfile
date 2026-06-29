FROM node:20-slim
LABEL "language"="nodejs"
LABEL "framework"="express"

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    libu2f-udev \
    libvulkan1 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# Puppeteer 缓存放到 /app 下，便于 node 用户读写
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

COPY package*.json ./
RUN npm install

COPY . ./

# 数据目录 + 缓存目录归 node 用户；整个 /app 交给 node
RUN mkdir -p /app/data /app/.cache/puppeteer \
  && chown -R node:node /app

USER node

# 以 node 用户安装 Chrome，落到 PUPPETEER_CACHE_DIR
RUN npx puppeteer browsers install chrome

EXPOSE 8080
ENV PORT=8080
CMD ["npm", "start"]
