# 阿里云美国 ECS 部署 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一套与提供商无关的 Docker Compose 部署基础设施，把应用通过 `podcast.hxppk.cn` 以 HTTPS 上线，Claude 出站经静态 IP 代理、ElevenLabs 直连。

**Architecture:** 单台 ECS、一个 Compose，三容器：`caddy`（反代+自动 TLS）、`app`（业务，非 root，不暴露公网）、`clash`（mihomo 边车，按域名分流）。基础设施文件不引用 provider 代码，迁移分支落地后配 key 即可上线。

**Tech Stack:** Docker / Docker Compose、Caddy 2、mihomo(clash-meta)、Node.js 20、better-sqlite3、Puppeteer。

## Global Constraints

- 子域名固定 `podcast.hxppk.cn`；ACME 邮箱 `admin@hxppk.cn`（可在 Caddyfile 调整）。
- `app` 与 `clash` 绝不向公网暴露端口；仅 `caddy` 暴露 `80`/`443`。
- 应用数据绑定挂载固定路径：宿主机 `/opt/wechat-podcast/data` → 容器 `/app/data`。
- `app` 容器以 `1000:1000`（node 用户）运行。
- 代理地址统一 `http://clash:7890`；分流规则：`anthropic.com=PROXY`，其余 `DIRECT`。
- `.env` 必须同时设置 `GLOBAL_AGENT_HTTP_PROXY`/`GLOBAL_AGENT_HTTPS_PROXY` 与 `HTTP_PROXY`/`HTTPS_PROXY`（否则 global-agent 静默直连）。
- 真实密钥与真实 mihomo 配置一律不进 git。
- 终态 provider：`LLM_PROVIDER=claude`、`TTS_PROVIDER=elevenlabs`（值须与迁移分支工厂的 case 一致）。

---

### Task 1: 密钥卫生 + 生产环境变量模板

**Files:**
- Modify: `.gitignore`
- Create: `.env.production.example`

**Interfaces:**
- Produces: `.env.production.example` 中定义的全部环境变量名，被 Task 5 的 `docker-compose.yml`（`env_file: .env`）和 Task 8 的 `DEPLOY.md` 引用。

- [ ] **Step 1: 追加 .gitignore 忽略真实代理配置与生产 env**

在 `.gitignore` 末尾追加：

```gitignore

# 部署：真实 mihomo 配置与生产环境变量（含密钥），不进 git
proxy/config.yaml
.env.production
```

- [ ] **Step 2: 创建 `.env.production.example`**

```bash
# ---- Provider（终态 Claude + ElevenLabs，值须与迁移分支工厂 case 一致）----
LLM_PROVIDER=claude
TTS_PROVIDER=elevenlabs
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=

# ---- 服务 ----
PORT=8080

# ---- 代理（关键）----
# global-agent 默认只认 GLOBAL_AGENT_ 前缀；server.js 的开关判断认 HTTP(S)_PROXY。
# 两组都必须配，否则会“假启用真直连”。
GLOBAL_AGENT_HTTP_PROXY=http://clash:7890
GLOBAL_AGENT_HTTPS_PROXY=http://clash:7890
HTTP_PROXY=http://clash:7890
HTTPS_PROXY=http://clash:7890

# ---- 安全 ----
# 用 `openssl rand -hex 32` 生成
JWT_SECRET=
CORS_ORIGIN=https://podcast.hxppk.cn

# ---- 其它 ----
DISABLE_CLEANUP=false
```

- [ ] **Step 3: 校验文件存在且不含真实密钥**

Run: `grep -nE '=(sk-|xi-|[A-Za-z0-9]{30,})' .env.production.example || echo "OK: 无真实密钥"`
Expected: 输出 `OK: 无真实密钥`

- [ ] **Step 4: Commit**

```bash
git add .gitignore .env.production.example
git commit -m "chore: 生产环境变量模板与代理/密钥 gitignore"
```

---

### Task 2: Dockerfile 非 root + Puppeteer 缓存加固

**Files:**
- Modify: `Dockerfile`

**Interfaces:**
- Produces: 镜像以 `node`(1000) 运行，Chrome 装在 `/app/.cache/puppeteer`（node 用户可读写）；被 Task 5 的 `app` 服务（`user: "1000:1000"`）依赖。

**背景**：当前 Dockerfile 以 root 运行，且 `npx puppeteer browsers install chrome` 在 root 阶段把 Chrome 装进 `/root/.cache`。切换到非 root 后 Chrome 必须装在 node 用户可访问的目录，否则启动报找不到浏览器。

- [ ] **Step 1: 用以下内容替换 `Dockerfile`**

```dockerfile
FROM node:20-slim
LABEL "language"="nodejs"
LABEL "framework"="express"

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
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
```

- [ ] **Step 2: 构建镜像验证（在有 docker 的主机执行）**

Run: `docker build -t wechat-podcast:deploytest .`
Expected: 构建成功；末尾 `npx puppeteer browsers install chrome` 在 node 用户下完成，无 permission denied。

- [ ] **Step 3: 验证运行用户与 Chrome 路径**

Run: `docker run --rm wechat-podcast:deploytest sh -lc 'id -u; ls /app/.cache/puppeteer'`
Expected: 第一行输出 `1000`；第二行列出 chrome 目录（非空）。

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "build: Dockerfile 以非 root 运行并修正 Puppeteer 缓存目录"
```

---

### Task 3: Caddyfile（反代 + 自动 HTTPS）

**Files:**
- Create: `Caddyfile`

**Interfaces:**
- Consumes: Task 5 `app` 服务名 `app` 与端口 `8080`。
- Produces: `Caddyfile`，被 Task 5 `caddy` 服务挂载到 `/etc/caddy/Caddyfile`。

- [ ] **Step 1: 创建 `Caddyfile`**

```caddyfile
{
	email admin@hxppk.cn
}

podcast.hxppk.cn {
	encode gzip
	reverse_proxy app:8080
}
```

- [ ] **Step 2: 语法校验（在有 docker 的主机执行）**

Run: `docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile`
Expected: 输出 `Valid configuration`。

- [ ] **Step 3: Commit**

```bash
git add Caddyfile
git commit -m "feat: Caddyfile 反代 podcast.hxppk.cn 到 app:8080"
```

---

### Task 4: mihomo 分流配置模板

**Files:**
- Create: `proxy/config.example.yaml`

**Interfaces:**
- Produces: mihomo 配置模板，含 `mixed-port: 7890`、`external-controller: 0.0.0.0:9090`（供 Task 5 healthcheck）、分流规则。真实配置由用户复制为 `proxy/config.yaml`（已被 Task 1 gitignore）。

- [ ] **Step 1: 创建 `proxy/config.example.yaml`**

```yaml
# mihomo (clash-meta) 配置模板
# 复制为 proxy/config.yaml 并填入你的静态 IP 节点。proxy/config.yaml 不进 git。

mixed-port: 7890
allow-lan: true        # 仅在 docker 内网，app 容器需要从另一容器访问，故允许 LAN
bind-address: "*"
mode: rule
log-level: info
# 供 compose healthcheck 探活；只在 docker 内网可达，不要在安全组放行 9090
external-controller: 0.0.0.0:9090

proxies:
  # ↓↓↓ 用你自己的静态 IP 节点替换（类型/字段按你的协议来）↓↓↓
  - name: "static-exit"
    type: ss
    server: YOUR_STATIC_NODE_HOST
    port: 8388
    cipher: aes-256-gcm
    password: "YOUR_PASSWORD"
  # ↑↑↑ 也可改成 vmess / trojan / hysteria2 等 ↑↑↑

proxy-groups:
  - name: PROXY
    type: select
    proxies:
      - static-exit

rules:
  # 只有 Anthropic 走静态 IP 出口，规避机房 IP 风控
  - DOMAIN-SUFFIX,anthropic.com,PROXY
  # ElevenLabs 直连，避免大音频吃代理带宽
  - DOMAIN-SUFFIX,elevenlabs.io,DIRECT
  # 兜底直连
  - MATCH,DIRECT
```

- [ ] **Step 2: YAML 合法性校验**

Run: `python3 -c "import yaml,sys; d=yaml.safe_load(open('proxy/config.example.yaml')); assert d['mixed-port']==7890; assert any('anthropic.com' in r for r in d['rules']); print('OK')"`
Expected: 输出 `OK`。

- [ ] **Step 3: Commit**

```bash
git add proxy/config.example.yaml
git commit -m "feat: mihomo 分流配置模板（Anthropic 走静态代理，其余直连）"
```

---

### Task 5: docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: Task 2 `Dockerfile`、Task 3 `Caddyfile`、Task 4 `proxy/config.yaml`、Task 1 `.env`（由 `.env.production.example` 复制）。
- Produces: 三服务 `caddy`/`app`/`clash`，被 Task 7 `deploy.sh` 和 Task 8 `DEPLOY.md` 调用。

- [ ] **Step 1: 创建 `docker-compose.yml`**

```yaml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app
    networks:
      - web

  app:
    build: .
    restart: unless-stopped
    env_file: .env
    user: "1000:1000"
    shm_size: "1gb"
    expose:
      - "8080"
    volumes:
      - /opt/wechat-podcast/data:/app/data
    depends_on:
      clash:
        condition: service_healthy
    networks:
      - web
      - internal

  clash:
    image: metacubex/mihomo:Alpine
    restart: unless-stopped
    volumes:
      - ./proxy/config.yaml:/root/.config/mihomo/config.yaml:ro
    healthcheck:
      # mihomo:Alpine 自带 busybox wget；探 external-controller
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:9090/version"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks:
      - internal

volumes:
  caddy_data:
  caddy_config:

networks:
  web:
  internal:
```

- [ ] **Step 2: 准备最小校验前置（在有 docker 的主机执行）**

Compose 校验需要引用到的文件存在。Run:

```bash
cp -n .env.production.example .env
cp -n proxy/config.example.yaml proxy/config.yaml
```
Expected: 生成本地用 `.env` 与 `proxy/config.yaml`（均已 gitignore，不会被提交）。

- [ ] **Step 3: 校验 compose 配置**

Run: `docker compose config -q && echo "OK"`
Expected: 输出 `OK`，无报错（确认服务名、卷、网络、depends_on 解析正确）。

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: docker-compose 三容器(caddy/app/mihomo) 编排"
```

---

### Task 6: 代码加固（SQLite WAL/busy_timeout + CORS 锁域名）

**Files:**
- Modify: `src/db/index.js:17-20`
- Modify: `server.js:20-23`
- Test: `test/db-pragma.test.js`

**Interfaces:**
- Consumes: `CORS_ORIGIN` 环境变量（Task 1 定义）。
- Produces: `src/db/index.js` 导出的 `db` 启用 WAL 与 `busy_timeout=5000`；`server.js` 的 CORS origin 受 `CORS_ORIGIN` 控制。

- [ ] **Step 1: 写失败测试 `test/db-pragma.test.js`**

```javascript
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// require 会在 worktree 内创建 data/app.db（已 gitignore）
const db = require(path.join(__dirname, '..', 'src', 'db'));

test('SQLite 启用 WAL', () => {
  assert.strictEqual(db.pragma('journal_mode', { simple: true }), 'wal');
});

test('SQLite 设置 busy_timeout=5000', () => {
  assert.strictEqual(db.pragma('busy_timeout', { simple: true }), 5000);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/db-pragma.test.js`
Expected: FAIL —— `journal_mode` 实为 `delete`（非 `wal`），`busy_timeout` 实为 `0`。

- [ ] **Step 3: 修改 `src/db/index.js`**

把：

```javascript
// 初始化数据库连接
const db = new Database(DB_PATH);

// 启用外键约束
db.pragma('foreign_keys = ON');
```

改为：

```javascript
// 初始化数据库连接
const db = new Database(DB_PATH);

// 生产并发加固：WAL 模式 + 锁等待
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// 启用外键约束
db.pragma('foreign_keys = ON');
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/db-pragma.test.js`
Expected: PASS（2 tests passing）。

- [ ] **Step 5: 修改 `server.js` 的 CORS**

把：

```javascript
app.use(cors({
  origin: true,
  credentials: true
}));
```

改为：

```javascript
app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true
}));
```

- [ ] **Step 6: 验证 CORS 改动落地**

Run: `grep -n "process.env.CORS_ORIGIN" server.js`
Expected: 命中一行（确认环境变量已接入；生产由 `.env` 的 `CORS_ORIGIN` 锁定，本地未设时回退 `true` 保持现状）。

- [ ] **Step 7: 清理测试副产物并提交**

```bash
rm -f data/app.db data/app.db-wal data/app.db-shm
git add test/db-pragma.test.js src/db/index.js server.js
git commit -m "feat: SQLite WAL/busy_timeout 与 CORS 按环境变量锁域名"
```

---

### Task 7: deploy.sh 便捷部署脚本

**Files:**
- Create: `deploy.sh`

**Interfaces:**
- Consumes: Task 5 `docker-compose.yml`、Task 1 `.env`、Task 4 `proxy/config.yaml`。
- Produces: 一键 `拉取→构建→起服务→健康检查` 脚本，被 Task 8 `DEPLOY.md` 引用。

- [ ] **Step 1: 创建 `deploy.sh`**

```bash
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

echo "==> 完成。请继续执行 DEPLOY.md 的“出口 IP 验证”。"
```

- [ ] **Step 2: 赋可执行权限并做 bash 语法检查**

Run: `chmod +x deploy.sh && bash -n deploy.sh && echo "OK"`
Expected: 输出 `OK`（语法无误）。

- [ ] **Step 3: Commit**

```bash
git add deploy.sh
git commit -m "feat: deploy.sh 一键部署与健康检查"
```

---

### Task 8: DEPLOY.md 操作手册

**Files:**
- Create: `DEPLOY.md`

**Interfaces:**
- Consumes: 前序所有交付物。
- Produces: 从零到上线的完整手册（含出口 IP 验证、备份、回滚）。

- [ ] **Step 1: 创建 `DEPLOY.md`**

````markdown
# 部署手册：podcast.hxppk.cn

## 0. 前提
- 一台阿里云【美国】ECS，已装 Docker + Docker Compose 插件。
- 安全组只放行 80/443 与受限来源的 SSH(22)。**不要**放行 8080 / 7890 / 9090。
- 你的 clash 静态 IP 节点信息。

## 1. DNS
阿里云 DNS 控制台为 `hxppk.cn` 加 A 记录：`podcast` → ECS 公网 IP。等待生效（`dig podcast.hxppk.cn`）。

## 2. 拉代码与配置
```bash
git clone <repo> wechat-podcast && cd wechat-podcast
cp .env.production.example .env          # 填 ANTHROPIC_API_KEY / ELEVENLABS_API_KEY / JWT_SECRET
openssl rand -hex 32                      # 生成 JWT_SECRET 填入 .env
cp proxy/config.example.yaml proxy/config.yaml   # 填入静态 IP 节点
```

## 3. 上线
```bash
./deploy.sh
```
Caddy 会在 DNS 生效且 80/443 可达后自动签发 Let's Encrypt 证书。

## 4. 出口 IP 验证（必做）
确认 Claude 走静态出口、ElevenLabs 直连：
```bash
# Anthropic 方向（经代理）——应显示静态节点 IP
docker compose exec -T app sh -lc 'curl -s -x http://clash:7890 https://api.ipify.org; echo'
# 直连方向——应显示 ECS 机房 IP
docker compose exec -T app sh -lc 'curl -s https://api.ipify.org; echo'
```
两个 IP 必须不同；前者应为你的静态节点。若相同，检查 `.env` 的 `GLOBAL_AGENT_*` 变量是否生效。

## 5. 备份
- 云盘快照（整体）。
- SQLite 一致性备份：
```bash
docker compose exec -T app sh -lc 'cd /app/data && sqlite3 app.db ".backup /app/data/backup-$(date +%F).db"'
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
- clash 一直 unhealthy：确认 `proxy/config.yaml` 里 `external-controller: 0.0.0.0:9090` 在、节点可连。
- Claude 报风控/连接异常：先做第 4 步出口 IP 验证。
````

- [ ] **Step 2: 校验 Markdown 链接到的文件均存在**

Run: `for f in .env.production.example proxy/config.example.yaml deploy.sh docker-compose.yml Caddyfile; do test -f "$f" && echo "OK $f" || echo "MISSING $f"; done`
Expected: 全部 `OK`。

- [ ] **Step 3: Commit**

```bash
git add DEPLOY.md
git commit -m "docs: 部署手册（DNS/上线/出口IP验证/备份/回滚）"
```

---

## Self-Review

**Spec coverage：**
- §2 架构三容器 → Task 5 ✓
- §3 数据流/分流规则 → Task 4（mihomo rules）✓
- §4 代理 env 修正 → Task 1（GLOBAL_AGENT_* 配齐）+ Task 8 §4 出口 IP 验证 ✓；GeminiTTS 衔接备注属迁移分支，不在本计划（spec 已声明）✓
- §5 持久化/密钥：绑定挂载 → Task 5 + deploy.sh chown；caddy_data 卷 → Task 5；mihomo 配置 gitignore → Task 1；.env 变量 → Task 1 ✓
- §6 DNS/安全组/备案 → Task 8 ✓
- §7 加固：mihomo healthcheck+depends_on → Task 5；WAL/busy_timeout → Task 6；并发(MAX_CONCURRENT_TASKS 已 env 驱动，DEPLOY 可调) → Task 8 备注；Puppeteer 非 root+shm_size → Task 2 + Task 5；JWT_SECRET/CORS → Task 1 + Task 6 ✓
- §8 交付物 6 项 → Task 1–8 全覆盖 ✓
- §9 验证清单 → Task 各步 + DEPLOY.md §4 ✓

**Placeholder scan：** 无 TBD/TODO；mihomo 模板里的 `YOUR_*` 是用户必填的真实凭据占位，属设计意图，已在注释说明。

**Type consistency：** 服务名 `app`/`clash`/`caddy`、端口 `8080`/`7890`/`9090`、路径 `/opt/wechat-podcast/data`、env 变量名在 Task 1/5/8 间一致；`db.pragma` 读写名与 better-sqlite3 API 一致。

> 说明：并发默认值（队列 `maxConcurrent=3`）本计划不改代码，因 `MAX_CONCURRENT_TASKS` 已是环境变量，按 spec §7 在 `.env`/压测时调整即可，避免无谓改动业务代码。
