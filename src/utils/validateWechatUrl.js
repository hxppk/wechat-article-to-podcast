/**
 * 轻量微信 URL 校验（零依赖，可在"瘦云端"加载，不引入 puppeteer）
 *
 * 仅做纯字符串校验：是否为 mp.weixin.qq.com 文章链接。
 * 真正的文章抓取（puppeteer）只在本地 worker 的 articleExtractor 中进行。
 */

/**
 * 验证错误类
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * 验证微信文章 URL（纯字符串校验）
 * @param {string} url
 * @returns {boolean}
 * @throws {ValidationError}
 */
function validateUrl(url) {
  if (!url) {
    throw new ValidationError('请输入文章链接');
  }

  if (!url.includes('mp.weixin.qq.com')) {
    throw new ValidationError('请输入有效的微信公众号文章链接');
  }

  return true;
}

module.exports = { validateUrl, ValidationError };
