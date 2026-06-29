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
   * 将对话数组合成为音频文件
   * @param {Array<{speaker: string, text: string, isInterrupt?: boolean}>} dialogues - 对话数组
   * @param {string} outputPath - 输出音频文件路径
   * @returns {Promise<void>}
   */
  async synthesize(dialogues, outputPath) {
    throw new Error('子类必须实现 synthesize 方法');
  }
}

module.exports = TTSProvider;
