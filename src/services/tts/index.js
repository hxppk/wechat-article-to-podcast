const MiniMaxTTS = require('./MiniMaxTTS');
const ElevenLabsTTS = require('./ElevenLabsTTS');

// 当前使用的 TTS 供应商
// 通过 TTS_PROVIDER 环境变量切换: minimax(默认) | elevenlabs
const PROVIDER = (process.env.TTS_PROVIDER || 'minimax').toLowerCase();

let instance = null;

function getTTSProvider() {
  if (instance) return instance;

  switch (PROVIDER) {
    case 'elevenlabs':
      instance = new ElevenLabsTTS();
      break;
    case 'minimax':
    default:
      instance = new MiniMaxTTS();
      break;
  }

  console.log(`TTS Provider: ${instance.getName()}`);
  return instance;
}

module.exports = getTTSProvider();
module.exports.default = getTTSProvider();
