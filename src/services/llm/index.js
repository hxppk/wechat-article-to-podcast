const ClaudeCliLLM = require('./ClaudeCliLLM');

// 当前使用的 LLM 供应商（默认 Claude，通过 LLM_PROVIDER 环境变量切换）
const PROVIDER = (process.env.LLM_PROVIDER || 'claude').toLowerCase();

let instance = null;

function getLLMProvider() {
  if (instance) return instance;

  switch (PROVIDER) {
    case 'claude':
    default:
      instance = new ClaudeCliLLM();
      break;
  }

  console.log(`LLM Provider: ${instance.getName()}`);
  return instance;
}

module.exports = getLLMProvider();
module.exports.default = getLLMProvider();
