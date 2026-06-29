// fetch 兜底：Node 18+ / 22 原生自带 globalThis.fetch；旧版本回退到 node-fetch。
// MiniMax / ElevenLabs 都依赖全局 fetch，这里在任何模块加载前确保其可用。
if (!globalThis.fetch) {
  const nf = require('node-fetch');
  globalThis.fetch = nf;
  globalThis.Headers = nf.Headers;
  globalThis.Request = nf.Request;
  globalThis.Response = nf.Response;
}

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

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.static('public'));

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

// v2.0: 音频通过 /api/podcasts/audio/:id 或 /api/share/:shareId/audio 提供
// 不再使用静态目录，以支持用户隔离和权限校验

// API 路由
const articleRouter = require('./src/routes/article');
const statusRouter = require('./src/routes/status');
const podcastRouter = require('./src/routes/podcast');
const authRouter = require('./src/routes/auth');
const shareRouter = require('./src/routes/share');
const authMiddleware = require('./src/middleware/auth');

// v2.0: 全局 auth 中间件（解析用户身份）
app.use(authMiddleware);

// 认证路由（不需要登录）
app.use('/api/auth', authRouter);

// 分享路由（匿名可访问）
app.use('/api/share', shareRouter);

// 业务路由
app.use('/api/article', articleRouter);
app.use('/api/status', statusRouter);
app.use('/api/podcasts', podcastRouter);

// 打印 LLM 和 TTS 信息（TTS 按任务按需实例化，此处不强制初始化）
const llm = require('./src/services/llm');
console.log('LLM Provider:', llm.getName());
console.log('TTS providers available: minimax, elevenlabs (selected per task via ttsProvider param)');

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
