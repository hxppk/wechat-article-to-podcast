# 阿里云美国 ECS 生产部署设计

**日期**：2026-06-30
**分支**：`worktree-deploy`（基于 `origin/main`）
**目标**：把"微信文章转播客"应用部署到单台阿里云【美国】ECS，通过子域名 `podcast.hxppk.cn` 对外提供 HTTPS 服务。

---

## 1. 背景与目标

应用是一个有状态的 Node.js / Express 服务：抓取微信公众号文章（Puppeteer 无头 Chrome），用 LLM 改写成双人对话脚本，再用 TTS 合成播客音频。数据（SQLite 库、各用户音频、分享数据）全部落在 `data/` 目录。

终态使用 **Claude（Anthropic）+ ElevenLabs**，不再涉及 Gemini。本次部署工作只交付**与提供商无关的基础设施**（compose / Caddy / mihomo 配置 / 部署脚本），不引用任何 provider 代码，因此可以先于"Claude+ElevenLabs 迁移代码"完成。迁移分支落地合并后即可上线。

核心约束：**绝不能让阿里云机房 IP 直连 Anthropic**（云厂商 IP 段访问 Claude 有风控/封号风险），Claude 出站必须经过一个**静态 IP 出口**。

---

## 2. 总体架构

单台 ECS，一个 Docker Compose，三个容器：

| 服务 | 角色 | 公网暴露 | 关键配置 |
|------|------|----------|----------|
| `caddy` | 反向代理 + 自动 HTTPS | 80 / 443 | `podcast.hxppk.cn → app:8080`，Let's Encrypt 自动签发/续期 |
| `app` | 业务应用（现有 Dockerfile 构建） | 无 | 内部监听 8080，非 root（`1000:1000`）运行 |
| `clash` | mihomo/clash-meta 边车 | 无 | 提供静态 IP 出口代理，按域名分流 |

三者在同一 compose 内网，用服务名互相通信。`app` 与 `clash` 都**不**向公网暴露端口。

---

## 3. 数据流与代理隔离

```
浏览器 ──HTTPS──> caddy:443 ──> app:8080
app ──Claude SDK(经 global-agent)──> clash:7890 ──[规则: anthropic.com=PROXY]──> 静态IP出口 ──> Anthropic
app ──ElevenLabs SDK────────────> clash:7890 ──[规则: 其余=DIRECT]──> 直连 ──> ElevenLabs
app ──Puppeteer(Chromium,不吃 Node 代理)──> 直连 ──> mp.weixin.qq.com
```

**代理分流（在 mihomo 规则层完成，零代码改动）：**

- `DOMAIN-SUFFIX,anthropic.com,PROXY`（走静态 IP 节点）
- `DOMAIN-SUFFIX,elevenlabs.io,DIRECT`
- `MATCH,DIRECT`（兜底直连）

这样只有 Claude 走静态出口规避风控；ElevenLabs 的大音频下行直连，不吃代理带宽、不增加延迟与单点。出口节点是否为静态 IP 由用户的 clash 订阅/节点决定，本设计只负责"把 Claude 流量交给那个节点"。

> **微信抓取注意**：Node 层代理不影响 Chromium。当前微信抓取直连（美国访问 mp.weixin.qq.com 可达）。若将来需要让抓取也走代理，需单独给 Chrome 加 `--proxy-server`，不在本期范围。

---

## 4. 代理生效的关键修正（必须做，否则静默直连）

代码层有一个会让代理"假启用真直连"的坑，部署上线前必须处理：

1. `server.js` 用 `process.env.HTTPS_PROXY || HTTP_PROXY` 作为是否 `bootstrap()` 的开关，但 `global-agent` 的 `bootstrap()` **默认只读 `GLOBAL_AGENT_HTTP_PROXY` / `GLOBAL_AGENT_HTTPS_PROXY`**（默认命名空间 `GLOBAL_AGENT_`）。若只设了 `HTTP_PROXY`，会进入 bootstrap 但实际不代理任何请求。
   - **处理**：`.env` 同时设置 `GLOBAL_AGENT_HTTP_PROXY` 与 `GLOBAL_AGENT_HTTPS_PROXY`（值 `http://clash:7890`），并保留 `HTTPS_PROXY`/`HTTP_PROXY` 以满足 server.js 的开关判断；或在代码里把命名空间改为空。本期采用"配齐正确 env 变量"的零代码方案。
2. `src/services/tts/GeminiTTS.js` 另起一套 `undici` 的 `setGlobalDispatcher`——这是 Gemini 时代的第二套全局代理开关。**迁移完成后此处不应再存在 Gemini 的全局 dispatcher**；本部署 spec 不修改它，仅作为给迁移分支的衔接备注。
3. **上线前强制验证出口 IP**：在 `app` 容器内对 Anthropic 方向抓包或 `curl` 查出口 IP，确认确实经过静态节点；对 ElevenLabs 方向确认走直连。验证不通过不算上线完成。

---

## 5. 持久化与密钥

- **应用数据：绑定挂载到固定绝对路径** `/opt/wechat-podcast/data:/app/data`（不依赖随 cwd 漂移的 `./data`）。这是核心业务状态，路径明确便于备份/迁移/排障。
  - 容器以 `1000:1000` 非 root 运行；宿主机 `chown -R 1000:1000 /opt/wechat-podcast/data`。
  - 备份：ECS 云盘快照 + SQLite 一致性备份（`.backup` 或 `VACUUM INTO`）+ 音频目录同步；**不以裸 `cp app.db` 作为可靠备份**。
- **Caddy 证书：持久化 `caddy_data` 命名卷**（映射容器 `/data`），否则重建容器丢 ACME 账号与证书，可能撞 Let's Encrypt 频控。`/config` 也建议持久化（关键度较低）。
- **mihomo 配置**：绑定挂载 `./proxy/config.yaml`（用户提供订阅/配置，**不进 git**）。
- **`.env`**（gitignored）至少包含：
  - `LLM_PROVIDER` / `TTS_PROVIDER`
  - `ANTHROPIC_API_KEY` / `ELEVENLABS_API_KEY`
  - `PORT=8080`
  - `GLOBAL_AGENT_HTTP_PROXY` / `GLOBAL_AGENT_HTTPS_PROXY` / `HTTP_PROXY` / `HTTPS_PROXY`（均 `http://clash:7890`）
  - 强随机 `JWT_SECRET`
  - CORS 允许来源固定为 `https://podcast.hxppk.cn`

---

## 6. DNS 与上线步骤

1. 阿里云 DNS 控制台为 `hxppk.cn` 加 A 记录：`podcast → ECS 公网 IP`。
2. 安全组只放行 **80 / 443** 与受限来源的 **SSH(22)**；**绝不暴露** 8080(app)、7890(clash)、9090(clash 面板)。
3. 宿主机 `docker compose up -d --build`。
4. Caddy 自动签发证书（需 DNS 已生效、80/443 公网可达）。
5. 执行第 4 节的出口 IP 验证。

> **备案**：`.cn` 域名 + 海外 ECS 直连、且不接中国大陆 CDN/服务器，通常不需要 ICP 备案。一旦将来迁回大陆机房或接入大陆资源，ICP 备案成强制项，届时单独确认。

---

## 7. 生产加固清单

- **mihomo 健康检查**：compose `healthcheck` 实测代理可用；`app` 配 `depends_on: { clash: { condition: service_healthy } }`，避免 app 早于代理就绪。
- **SQLite**：`db/index.js` 当前只设 `foreign_keys`。生产开启 `journal_mode = WAL` 与 `busy_timeout`（如 5000ms），降低锁冲突。
- **并发**：队列默认并发 3（`MAX_CONCURRENT_TASKS`）。先压到 **1–2** 压测（Puppeteer + TTS 都吃内存/带宽），稳定后再调。
- **横向扩容**：单 app 容器独占 `data/`；**绝不要**多 app 容器共享同一 `data/`。要扩容须先迁移到 Postgres / 对象存储 / 外部队列。
- **Puppeteer**：当前 `--no-sandbox` 风险偏高；非 root 运行、限制内存，必要时配 `shm_size`（如 `1gb`）防止 Chrome 因 `/dev/shm` 不足崩溃。
- **应用安全**：强 `JWT_SECRET`；CORS 由当前的 `origin: true` 收紧为固定 `https://podcast.hxppk.cn`。

---

## 8. 交付物

- `docker-compose.yml`（三服务 + 卷 + 网络 + healthcheck + depends_on + 非 root + shm_size）
- `Caddyfile`（`podcast.hxppk.cn { reverse_proxy app:8080 }`）
- `proxy/config.example.yaml`（mihomo 配置模板，含分流规则；真实订阅由用户提供，不进 git）
- `.env.production.example`（含上述全部变量，无真实密钥）
- `deploy.sh`（拉取/构建/起服务/健康检查的便捷脚本）
- `DEPLOY.md`（从零到上线的操作手册，含 DNS、安全组、出口 IP 验证、备份、回滚）

---

## 9. 验证清单（本期"测试"=基础设施验证，非单元测试）

1. `docker compose config` 通过校验。
2. 三个镜像/容器构建并启动成功，`clash` healthcheck 变绿。
3. 通过 Caddy 访问 `https://podcast.hxppk.cn/health` 返回 `{status:ok}`，证书有效。
4. `app` 容器内验证：Anthropic 方向出口 IP = 静态节点；ElevenLabs 方向 = 直连。
5. 重建 `caddy` 容器后证书不重签（卷持久化生效）。
6. 重建 `app` 容器后 `data/` 数据不丢（绑定挂载生效）。

---

## 10. 范围外（YAGNI）

CI/CD 流水线、多节点/自动扩缩容、独立监控告警栈、把 SQLite 迁 Postgres——本期不做。v1 以手动 `docker compose up -d --build` 上线为准。

---

## 衔接备注

- 本 spec 只交付基础设施，提供商无关。Claude + ElevenLabs 的 provider 代码（`ClaudeLLM.js` / `ElevenLabsTTS.js` 及工厂 case）属于迁移分支，落地合并后配齐 `.env` 的两个 key 与 `LLM_PROVIDER`/`TTS_PROVIDER` 即可上线，无需改动部署文件。
- 迁移分支需顺带清理 `GeminiTTS.js` 的独立 `setGlobalDispatcher`，使全局代理只剩一处（global-agent）。
