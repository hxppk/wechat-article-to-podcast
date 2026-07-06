#!/usr/bin/env bash
# 播客服务健康自愈（宿主机 crontab 每分钟执行）。
# 兜底场景：进程假死但容器仍 running（如 2026-07 假活 502 事故）、监听但不响应。
# 防误杀：flock 防并发、curl 带超时、连续 N 次失败才 restart、restart 后冷却期。
#
# 安装：
#   install -m 755 scripts/podcast-selfheal.sh /usr/local/bin/podcast-selfheal.sh
#   (crontab -l; echo '* * * * * /usr/local/bin/podcast-selfheal.sh') | crontab -
set -u

CONTAINER="${CONTAINER:-wechat-podcast-app-1}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8080/health}"   # 直探容器映射端口，不经 nginx
FAIL_THRESHOLD=3          # 连续失败次数达到才 restart
COOLDOWN_SECONDS=300      # restart 后冷却期，防止重启风暴
STATE_DIR=/run/podcast-selfheal
LOG_FILE=/var/log/podcast-selfheal.log
LOCK_FILE="$STATE_DIR/lock"
FAIL_FILE="$STATE_DIR/consecutive_failures"
LAST_RESTART_FILE="$STATE_DIR/last_restart_epoch"

mkdir -p "$STATE_DIR"

log() { echo "$(date '+%F %T') $*" >> "$LOG_FILE"; }

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0   # 上一轮还没跑完，直接让位

if curl -fsS --max-time 8 "$HEALTH_URL" > /dev/null 2>&1; then
  # 恢复健康：清零失败计数（只在有历史失败时记一条日志）
  if [[ -s "$FAIL_FILE" && "$(cat "$FAIL_FILE")" != "0" ]]; then
    log "healthy again (failures reset from $(cat "$FAIL_FILE"))"
  fi
  echo 0 > "$FAIL_FILE"
  exit 0
fi

fails=$(( $(cat "$FAIL_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$fails" > "$FAIL_FILE"
log "health check failed ($fails/$FAIL_THRESHOLD)"

if (( fails < FAIL_THRESHOLD )); then
  exit 0
fi

now=$(date +%s)
last_restart=$(cat "$LAST_RESTART_FILE" 2>/dev/null || echo 0)
if (( now - last_restart < COOLDOWN_SECONDS )); then
  log "in cooldown ($(( now - last_restart ))s since last restart), skip"
  exit 0
fi

log "restarting container $CONTAINER"
if timeout 120 docker restart "$CONTAINER" >> "$LOG_FILE" 2>&1; then
  echo "$now" > "$LAST_RESTART_FILE"
  echo 0 > "$FAIL_FILE"
  log "restart done"
else
  log "restart FAILED (docker restart exit=$?)"
fi
