// 引轻量 URL 校验模块取 ValidationError，避免间接加载 puppeteer（articleExtractor）。
const { ValidationError } = require('../utils/validateWechatUrl');

class ProviderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * 租约丢失错误：worker 在心跳/阶段上报被拒（409）时抛出，
 * 用于中止流水线，且后续不再 result/fail（任务已被云端回收）。
 */
class LeaseLostError extends Error {
  constructor(message = 'lease lost') {
    super(message);
    this.name = 'LeaseLostError';
  }
}

function isDisplayableError(error) {
  if (!error) return false;
  if (error instanceof ProviderError) return true;
  if (ValidationError && error instanceof ValidationError) return true;
  return error.name === 'ValidationError' || error.name === 'ProviderError';
}

/**
 * 根据错误类型解析用户展示消息（可展示错误透传 message，否则用通用文案）
 * @param {Error} error
 * @returns {string}
 */
function resolveErrorMessage(error) {
  return isDisplayableError(error) ? error.message : '处理过程中发生错误，请重试';
}

module.exports = { ProviderError, LeaseLostError, isDisplayableError, resolveErrorMessage };
