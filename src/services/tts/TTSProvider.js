/**
 * TTS 服务抽象基类
 * 所有 TTS 实现都应继承此类
 */
class TTSProvider {
  /**
   * 获取供应商名称
   * @returns {string}
   */
  getName() {
    throw new Error('子类必须实现 getName 方法');
  }

  /**
   * 将对话脚本合成为音频
   * @param {string} script - 对话脚本文本
   * @param {string} outputPath - 输出音频文件路径
   * @returns {Promise<void>}
   */
  async synthesize(script, outputPath) {
    throw new Error('子类必须实现 synthesize 方法');
  }
}

module.exports = TTSProvider;
