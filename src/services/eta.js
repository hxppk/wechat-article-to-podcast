// 各阶段基准耗时（秒），可通过环境变量覆盖
const STAGE_BASELINES = {
  pending: 0,
  parsing: parseInt(process.env.ETA_PARSING_SECONDS) || 30,
  generating: parseInt(process.env.ETA_GENERATING_SECONDS) || 90,
  synthesizing: parseInt(process.env.ETA_SYNTHESIZING_SECONDS) || 120
};

// 阶段顺序
const STAGE_ORDER = ['pending', 'parsing', 'generating', 'synthesizing', 'completed'];

/**
 * 计算任务预估剩余时间
 * @param {Object} task - 任务对象
 * @param {string} task.status - 当前状态
 * @param {number} task.stageStartedAt - 当前阶段开始时间戳
 * @returns {number} 预估剩余秒数
 */
function calculateEta(task) {
  const { status, stageStartedAt } = task;

  // 已完成或失败，无 ETA
  if (status === 'completed' || status === 'failed') {
    return 0;
  }

  const currentIndex = STAGE_ORDER.indexOf(status);
  if (currentIndex === -1) {
    // 未知状态，返回总耗时
    return Object.values(STAGE_BASELINES).reduce((a, b) => a + b, 0);
  }

  // 1. 计算当前阶段剩余时间
  const now = Date.now();
  const elapsed = stageStartedAt ? (now - stageStartedAt) / 1000 : 0;
  const currentBaseline = STAGE_BASELINES[status] || 0;
  const currentRemaining = Math.max(0, currentBaseline - elapsed);

  // 2. 累加后续阶段时间
  let futureTotal = 0;
  for (let i = currentIndex + 1; i < STAGE_ORDER.length - 1; i++) {
    const stage = STAGE_ORDER[i];
    futureTotal += STAGE_BASELINES[stage] || 0;
  }

  return Math.round(currentRemaining + futureTotal);
}

/**
 * 格式化 ETA 为可读字符串
 * @param {number} seconds - 秒数
 * @returns {string} 如 "2 分 30 秒"
 */
function formatEta(seconds) {
  if (seconds <= 0) return '即将完成';
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (min > 0) {
    return sec > 0 ? `${min} 分 ${sec} 秒` : `${min} 分钟`;
  }
  return `${sec} 秒`;
}

module.exports = { calculateEta, formatEta, STAGE_BASELINES };
