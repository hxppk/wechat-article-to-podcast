require('dotenv').config();

// 配置代理（需要在其他模块加载前设置）
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  const { bootstrap } = require('global-agent');
  bootstrap();
  console.log('代理已启用:', process.env.HTTPS_PROXY || process.env.HTTP_PROXY);
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 确保数据目录存在
const dataDir = path.join(__dirname, 'data');
const audioDir = path.join(dataDir, 'audio');
const scriptsDir = path.join(dataDir, 'scripts');

[dataDir, audioDir, scriptsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// 音频文件静态服务
app.use('/audio', express.static(audioDir));

// API 路由
const articleRouter = require('./src/routes/article');
const statusRouter = require('./src/routes/status');
const podcastRouter = require('./src/routes/podcast');

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

// 文件清理定时任务（1 小时过期）
setInterval(() => {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 小时

  // 清理音频文件
  if (fs.existsSync(audioDir)) {
    fs.readdirSync(audioDir).forEach(file => {
      const filePath = path.join(audioDir, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          console.log('已清理过期音频:', file);
        }
      } catch (e) { /* ignore */ }
    });
  }

  // 清理脚本文件
  if (fs.existsSync(scriptsDir)) {
    fs.readdirSync(scriptsDir).forEach(file => {
      const filePath = path.join(scriptsDir, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          console.log('已清理过期脚本:', file);
        }
      } catch (e) { /* ignore */ }
    });
  }
}, 30 * 60 * 1000); // 每 30 分钟检查一次

// 启动服务
app.listen(PORT, () => {
  console.log(`微信文章转播客服务已启动: http://localhost:${PORT}`);
});
