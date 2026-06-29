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

> **⚠ 代理验证局限——必读**
>
> 上面的 `curl -x` 命令只能验证 clash 代理路径可达、出口 IP 符合预期，**并不能证明 Node 应用（Claude SDK）的实际出站流量真的经过了代理**。
>
> - `global-agent` 只 patch `http.globalAgent` / `https.globalAgent`，对 Node 原生 `fetch`（基于 `undici`）**不生效**。若 Claude SDK 版本使用原生 fetch 发起请求，则即使 `.env` 里 `GLOBAL_AGENT_HTTP_PROXY` 配置齐全，Anthropic API 调用仍可能静默直连，绕过代理。
> - 因此，**「Claude SDK 确实经静态代理出站」必须在 Claude+ElevenLabs 迁移分支完成后，用一次真实 Claude 调用 + clash 命中 `PROXY` 的日志进行端到端复核**。
> - 若届时发现 SDK 走原生 fetch 不吃 global-agent，需在 provider 层改用 `undici` 的 `ProxyAgent` / per-request `dispatcher` 显式注入代理，而非依赖全局 patch。

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
