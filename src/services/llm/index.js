const GeminiLLM = require('./GeminiLLM');

// 当前使用的 LLM 供应商
// 后续可通过环境变量切换
const PROVIDER = process.env.LLM_PROVIDER || 'gemini';

let instance = null;

function getLLMProvider() {
  if (instance) return instance;

  switch (PROVIDER.toLowerCase()) {
    case 'gemini':
    default:
      instance = new GeminiLLM();
      break;
    // 后续可添加其他供应商
    // case 'openai':
    //   instance = new OpenAILLM();
    //   break;
  }

  console.log(`LLM Provider: ${instance.getName()}`);
  return instance;
}

module.exports = getLLMProvider();
module.exports.default = getLLMProvider();
