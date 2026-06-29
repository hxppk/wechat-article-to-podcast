/**
 * 解析正整数环境变量。NaN / <=0 / 非有限值都回退到 defaultValue。
 * 与 `parseInt(x) || default` 不同：不会因显式 0 或负数而误用默认值，
 * 也不会把负数透传出去（避免信号量等下游死等）。
 * @param {*} value
 * @param {number} defaultValue
 * @returns {number}
 */
function parsePositiveInt(value, defaultValue) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return n;
}

module.exports = { parsePositiveInt };
