const { ValidationError } = require('./articleExtractor');

class ProviderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProviderError';
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

module.exports = { ProviderError, isDisplayableError, resolveErrorMessage };
