// 禁用工具的确切 flag 以 `claude --help` 实测为准。
// 语义要求：禁用全部内置工具 + MCP 工具(mcp__*)，不使用 --bare。
const DEFAULT_DISABLE_TOOLS_ARGS = ['--tools', '', '--disallowedTools', 'mcp__*'];

const ENV_ALLOWLIST = [
  'PATH', 'HOME', 'SHELL', 'USER', 'TERM', 'TMPDIR',
  // 代理（大小写两种写法，curl/undici 各有偏好）
  'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY',
  'https_proxy', 'http_proxy', 'no_proxy',
  // 区域设置
  'LANG', 'LC_ALL', 'LC_CTYPE',
  // claude / XDG 配置与状态目录
  'CLAUDE_CONFIG_DIR',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME',
  // 证书（自定义 CA / 企业代理）
  'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS',
];

function buildClaudeArgs({ model, disableToolsArgs = DEFAULT_DISABLE_TOOLS_ARGS }) {
  const resolvedModel = model || 'claude-opus-4-8';
  return ['-p', '--model', resolvedModel, '--output-format', 'text', ...disableToolsArgs];
}

function buildChildEnv(env, { allowApiKey = false } = {}) {
  const out = {};
  for (const key of ENV_ALLOWLIST) {
    if (env[key] !== undefined) out[key] = env[key];
  }
  if (allowApiKey && env.ANTHROPIC_API_KEY) {
    out.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  }
  return out;
}

module.exports = { buildClaudeArgs, buildChildEnv, DEFAULT_DISABLE_TOOLS_ARGS };
