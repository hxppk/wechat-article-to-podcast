require('dotenv').config();

// 配置代理（需要在其他模块加载前设置）
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  const { bootstrap } = require('global-agent');
  bootstrap();
  console.log('代理已启用:', process.env.HTTPS_PROXY || process.env.HTTP_PROXY);
}

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const podcastsDb = require('./src/db/podcasts');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(cookieParser());
app.use(express.json());

// 确保数据目录存在
const dataDir = path.join(__dirname, 'data');
const usersDir = path.join(dataDir, 'users');
const dbDir = path.join(dataDir, 'db');

// v2.0: 用户数据在 data/users/{userId}/ 下
[dataDir, usersDir, dbDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const indexHtmlPath = path.join(__dirname, 'public', 'index.html');
let baseIndexHtml = '';
try {
  baseIndexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
} catch (err) {
  console.error('读取 index.html 失败:', err.message);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getRequestOrigin(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol;
  return `${proto}://${req.get('host')}`;
}

function buildShareHtml(req, podcast, shareId) {
  if (!baseIndexHtml) {
    return '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
  }
  const origin = getRequestOrigin(req);
  const shareUrl = `${origin}${req.originalUrl || `/?share=${shareId}`}`;
  const title = podcast?.title || '微信文章转播客';
  const description = podcast?.summary || '将微信公众号文章转换为双人对话播客音频';
  const imageUrl = `${origin}/favicon.png`;

  const metaTags = [
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:image" content="${escapeHtml(imageUrl)}">`,
    `<meta property="og:url" content="${escapeHtml(shareUrl)}">`,
    `<meta property="og:site_name" content="微信文章转播客">`,
    `<meta property="og:type" content="website">`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta itemprop="image" content="${escapeHtml(imageUrl)}">`
  ].join('\n  ');

  let html = baseIndexHtml;
  if (html.includes('<head>')) {
    html = html.replace('<head>', `<head>\n  ${metaTags}`);
  }
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
  return html;
}

// v2.0: 音频通过 /api/podcasts/audio/:id 或 /api/share/:shareId/audio 提供
// 不再使用静态目录，以支持用户隔离和权限校验

// API 路由
const articleRouter = require('./src/routes/article');
const statusRouter = require('./src/routes/status');
const podcastRouter = require('./src/routes/podcast');
const authRouter = require('./src/routes/auth');
const shareRouter = require('./src/routes/share');
const wechatRouter = require('./src/routes/wechat');
const authMiddleware = require('./src/middleware/auth');

// v2.0: 全局 auth 中间件（解析用户身份）
app.use(authMiddleware);

// 分享链接预览（微信抓取 HTML meta）
app.get('/', (req, res, next) => {
  const shareId = req.query.share;
  if (!shareId) {
    return next();
  }
  let podcast = null;
  try {
    podcast = podcastsDb.findByShareId(shareId);
  } catch (err) {
    console.error('读取分享播客失败:', err.message);
  }
  const html = buildShareHtml(req, podcast, shareId);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// 静态资源
app.use(express.static('public'));

// 认证路由（不需要登录）
app.use('/api/auth', authRouter);

// 分享路由（匿名可访问）
app.use('/api/share', shareRouter);

// 微信 JS-SDK 签名（匿名可访问）
app.use('/api/wechat', wechatRouter);

// 业务路由
app.use('/api/article', articleRouter);
app.use('/api/status', statusRouter);
app.use('/api/podcasts', podcastRouter);

// 获取 LLM 和 TTS 提供者信息
const llm = require('./src/services/llm');
const tts = require('./src/services/tts');

console.log('LLM Provider:', llm.getName());
console.log('TTS Provider:', tts.getName());

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// v2.0: 数据清理任务（按用户等级）
// 默认启用，设置 DISABLE_CLEANUP=true 禁用
if (process.env.DISABLE_CLEANUP !== 'true') {
  const cleanup = require('./src/services/cleanup');
  // 每 5 分钟检查一次
  cleanup.startCleanupTask(5 * 60 * 1000);
} else {
  console.log('[cleanup] 清理任务已禁用');
}

// 启动服务
app.listen(PORT, () => {
  console.log(`微信文章转播客服务已启动: http://localhost:${PORT}`);
});
