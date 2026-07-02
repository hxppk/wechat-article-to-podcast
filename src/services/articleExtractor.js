const puppeteer = require('puppeteer');
// URL 校验拆到零依赖的轻量模块，云端 article route 只引它（不加载 puppeteer）。
const { validateUrl, ValidationError } = require('../utils/validateWechatUrl');

// 浏览器实例缓存
let browserInstance = null;

/**
 * 获取或创建浏览器实例
 */
async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
  }
  return browserInstance;
}

/**
 * 从微信文章 URL 提取内容
 * @param {string} url - 微信文章 URL
 * @returns {Promise<{title: string, accountName: string, text: string, coverUrl: string}>}
 */
async function extractArticle(url) {
  validateUrl(url);

  console.log('正在使用浏览器获取文章内容...');

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // 设置用户代理
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 设置视口
    await page.setViewport({ width: 1280, height: 800 });

    // 导航到页面
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // 等待内容加载
    try {
      await page.waitForSelector('#js_content', { timeout: 10000 });
    } catch {
      // 如果找不到 #js_content，尝试其他选择器
      console.log('未找到 #js_content，尝试其他选择器...');
    }

    // 检查错误页面
    const pageText = await page.evaluate(() => document.body.innerText?.trim() || '');

    // 常见的微信错误提示
    const errorPatterns = ['参数错误', '该内容已被发布者删除', '此内容因违规无法查看', '该公众号已被封禁', '链接已失效'];
    for (const pattern of errorPatterns) {
      if (pageText.includes(pattern)) {
        throw new ValidationError(`无法获取文章：${pattern}`);
      }
    }

    // 提取内容
    const result = await page.evaluate(() => {
      // 提取标题
      const titleMeta = document.querySelector('meta[property="og:title"]');
      const titleEl = document.querySelector('.rich_media_title') || document.querySelector('h1');
      const title = titleMeta?.content?.trim()
        || titleEl?.textContent?.trim()
        || document.title?.trim()
        || '微信文章';

      // 提取公众号名称（优先使用页面上的真实昵称）
      const nicknameEl = document.querySelector('.rich_media_meta_nickname')  // 文章作者昵称
        || document.querySelector('#js_name')                                  // 公众号名称
        || document.querySelector('.profile_nickname')                         // 个人资料昵称
        || document.querySelector('a.wx_tap_link[href*="biz"]');              // 公众号链接文本
      const authorMeta = document.querySelector('meta[name="author"]');

      // 优先使用 DOM 元素中的真实昵称，避免使用 og:site_name（总是"微信公众平台"）
      let accountName = nicknameEl?.textContent?.trim()
        || authorMeta?.content?.trim()
        || '微信公众平台';

      // 过滤掉无效值
      if (accountName === '微信公众平台' || accountName === 'Weixin Official Accounts Platform' || !accountName) {
        // 尝试从页面其他位置获取
        const allLinks = document.querySelectorAll('a');
        for (const link of allLinks) {
          if (link.href?.includes('__biz=') && link.textContent?.trim()) {
            const text = link.textContent.trim();
            if (text && text !== '微信公众平台' && text.length < 30) {
              accountName = text;
              break;
            }
          }
        }
      }

      // 提取正文内容
      let text = '';

      // 优先使用 #js_content
      const jsContent = document.querySelector('#js_content');
      if (jsContent) {
        text = jsContent.innerText?.trim() || '';
      }

      // 如果内容太短，尝试其他选择器
      if (!text || text.length < 50) {
        const contentEl = document.querySelector('.rich_media_content')
          || document.querySelector('article')
          || document.querySelector('.article-content')
          || document.querySelector('main');
        if (contentEl) {
          text = contentEl.innerText?.trim() || '';
        }
      }

      // 如果还是没有，收集所有段落
      if (!text || text.length < 50) {
        const paragraphs = Array.from(document.querySelectorAll('p'))
          .map(p => p.innerText?.trim())
          .filter(p => p && p.length > 10);
        text = paragraphs.join('\n\n');
      }

      // 提取封面图（og:image 是微信文章标配，msg_cdn_url 兜底）
      const coverMeta = document.querySelector('meta[property="og:image"]');
      const coverUrl = coverMeta?.content?.trim()
        || (typeof window.msg_cdn_url === 'string' ? window.msg_cdn_url.trim() : '')
        || '';

      return { title, accountName, text, coverUrl };
    });

    // 清理文本
    let text = result.text
      .replace(/\s+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    console.log(`成功获取文章内容，长度: ${text.length}`);

    // 验证内容长度
    if (text.length < 100) {
      throw new ValidationError('文章内容过短，无法生成播客');
    }

    console.log(`文章解析成功: "${result.title}" - ${result.accountName}`);
    console.log(`正文长度: ${text.length} 字`);

    return {
      title: result.title,
      accountName: result.accountName,
      text
    };

  } finally {
    await page.close();
  }
}

/**
 * 关闭浏览器
 */
async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

module.exports = {
  extractArticle,
  validateUrl,
  ValidationError,
  closeBrowser
};
