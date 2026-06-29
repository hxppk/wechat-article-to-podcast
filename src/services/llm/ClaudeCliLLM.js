const { spawn } = require('child_process');
const LLMProvider = require('./LLMProvider');
const { ProviderError } = require('../errors');
const { buildClaudeArgs, buildChildEnv } = require('./claudeProcess');
const { createSemaphore } = require('../../utils/semaphore');
const { parsePositiveInt } = require('../../utils/parsePositiveInt');

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
const TIMEOUT_MS = parsePositiveInt(process.env.CLAUDE_TIMEOUT_MS, 120000);
const MAX_CONCURRENT = parsePositiveInt(process.env.CLAUDE_MAX_CONCURRENT, 1);
const RETRY_BASE_MS = parsePositiveInt(process.env.CLAUDE_RETRY_BASE_MS, 2000);
const ALLOW_API_KEY = process.env.CLAUDE_ALLOW_API_KEY === '1';
const MAX_RETRIES = 3;

const semaphore = createSemaphore(MAX_CONCURRENT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class ClaudeCliLLM extends LLMProvider {
  getName() {
    return 'Claude (claude -p)';
  }

  /**
   * 把非零退出的 stderr 分类为可上报的 ProviderError（鉴权/模型/额度/权限），
   * 这些原因重试也无济于事，应直接上报真实原因而不是重试 3 次后报通用错误。
   * 其它情况返回普通 Error（可重试）。
   * @param {number} code
   * @param {string} stderr
   * @returns {Error}
   */
  classifyExitError(code, stderr) {
    const msg = (stderr || '').trim();
    if (/login|auth|unauthor|credential|not\s*logged|sign\s*in|session\s*expired/i.test(msg)) {
      return new ProviderError('claude 未登录或鉴权失败，请在本机运行 `claude` 登录订阅后重试');
    }
    if (/\bmodel\b/i.test(msg)
      && /(not\s*found|invalid|unavailable|unknown|unsupported|does\s*not\s*exist|no\s*such)/i.test(msg)) {
      return new ProviderError(`claude 模型不可用：${msg}`);
    }
    if (/subscription|quota|usage\s*limit|rate\s*limit|too\s*many\s*requests|insufficient|billing|payment|credit/i.test(msg)) {
      return new ProviderError(`claude 订阅/额度受限：${msg}`);
    }
    if (/permission|forbidden|not\s*allowed|denied/i.test(msg)) {
      return new ProviderError(`claude 权限不足：${msg}`);
    }
    return new Error(`claude -p 退出码 ${code}: ${msg || '未知错误'}`);
  }

  /** 运行 claude -p，stdin 传 prompt，resolve stdout。 */
  runClaude(prompt) {
    return new Promise((resolve, reject) => {
      const args = buildClaudeArgs({ model: CLAUDE_MODEL });
      const env = buildChildEnv(process.env, { allowApiKey: ALLOW_API_KEY });
      let child;
      try {
        child = spawn(CLAUDE_BIN, args, { env });
      } catch (err) {
        return reject(new ProviderError(`无法启动 claude CLI(${CLAUDE_BIN}): ${err.message}`));
      }
      // 单次结算守卫：timeout / child 'error' / 'close' 都经由它，
      // 既防止 timeout-then-close 的二次 reject，也是唯一的 settle 路径。
      let settled = false;
      const settleOnce = (fn) => { if (settled) return; settled = true; fn(); };
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        settleOnce(() => reject(new Error('claude -p 调用超时')));
      }, TIMEOUT_MS);
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      // 吞掉 stdin 的 EPIPE：当 claude 在排空 stdin 前退出（真实微信长文，
      // 中文 ≈3 字节/字，远超 64KB 管道缓冲）时，写入会触发 EPIPE，
      // 若无此监听器会变成未捕获错误使整个 Node 进程崩溃。
      // 真正的失败原因由下面的 close/timeout/error 处理器上报。
      child.stdin.on('error', () => {});
      child.on('error', (err) => {
        clearTimeout(timer);
        settleOnce(() => reject(new ProviderError(`无法启动 claude CLI(${CLAUDE_BIN}): ${err.message}`)));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        settleOnce(() => {
          if (code !== 0) {
            return reject(this.classifyExitError(code, stderr));
          }
          resolve(stdout);
        });
      });
      try {
        child.stdin.end(prompt, () => {});
      } catch { /* EPIPE/“write after end” 等已被 stdin 'error' 处理器吞掉 */ }
    });
  }

  async generateScript(articleText) {
    const prompt = this.getPrompt(articleText);
    await semaphore.acquire();
    try {
      let lastError;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const out = await this.runClaude(prompt);
          if (!out || !out.trim()) throw new Error('claude 返回空输出');

          // 解析失败按规范属于可重试错误，连同空输出一起放进重试循环。
          const { dialogues, summary } = this.parseScript(out);
          if (dialogues.length === 0) throw new Error('生成的脚本格式不正确，无法解析对话');

          const ttsText = dialogues.map((d) => `${d.speaker}: ${d.text}`).join('\n');
          return {
            raw: out,
            dialogues,
            summary: summary || this.fallbackSummary(dialogues),
            ttsText,
          };
        } catch (err) {
          if (err instanceof ProviderError) throw err; // 鉴权/模型/额度类不重试
          lastError = err;
          if (attempt < MAX_RETRIES) await sleep(RETRY_BASE_MS * attempt);
        }
      }
      throw lastError || new Error('claude 脚本生成失败');
    } finally {
      semaphore.release();
    }
  }
}

module.exports = ClaudeCliLLM;
