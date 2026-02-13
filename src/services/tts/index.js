const GeminiTTS = require('./GeminiTTS');
const MiniMaxTTS = require('./MiniMaxTTS');

// 当前使用的 TTS 供应商
// 通过 TTS_PROVIDER 环境变量切换: gemini | minimax
const PROVIDER = process.env.TTS_PROVIDER || 'gemini';

let instance = null;

function getTTSProvider() {
  if (instance) return instance;

  switch (PROVIDER.toLowerCase()) {
    case 'minimax':
      instance = new MiniMaxTTS();
      break;
    case 'gemini':
    default:
      instance = new GeminiTTS();
      break;
  }

  console.log(`TTS Provider: ${instance.getName()}`);
  return instance;
}

module.exports = getTTSProvider();
module.exports.default = getTTSProvider();
