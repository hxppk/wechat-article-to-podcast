const GeminiTTS = require('./GeminiTTS');

// 当前使用的 TTS 供应商
// 后续可通过环境变量切换
const PROVIDER = process.env.TTS_PROVIDER || 'gemini';

let instance = null;

function getTTSProvider() {
  if (instance) return instance;

  switch (PROVIDER.toLowerCase()) {
    case 'gemini':
    default:
      instance = new GeminiTTS();
      break;
    // 后续可添加其他供应商
    // case 'openai':
    //   instance = new OpenAITTS();
    //   break;
  }

  console.log(`TTS Provider: ${instance.getName()}`);
  return instance;
}

module.exports = getTTSProvider();
module.exports.default = getTTSProvider();
