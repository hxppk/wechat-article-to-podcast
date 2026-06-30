const ElevenLabsTTS = require('./ElevenLabsTTS');

// 唯一 TTS 供应商：ElevenLabs
let instance = null;

function getTTSProvider() {
  if (instance) return instance;
  instance = new ElevenLabsTTS();
  console.log(`TTS Provider: ${instance.getName()}`);
  return instance;
}

module.exports = getTTSProvider();
module.exports.default = getTTSProvider();
