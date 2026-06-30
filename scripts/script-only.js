/* 只跑「抽取 + claude 生成脚本」，打印结尾若干轮 + 双人收尾检查。不调 ElevenLabs，省额度。 */
require('dotenv').config({ path: '.env.worker' });
['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']
  .forEach((k) => { delete process.env[k]; });
const path = require('path');
const { extractArticle } = require(path.join(__dirname, '..', 'src', 'services', 'articleExtractor'));
const llm = require(path.join(__dirname, '..', 'src', 'services', 'llm'));

const url = process.argv[2] || 'https://mp.weixin.qq.com/s/U9IGThOHpcXtiztm1MjzMg';

(async () => {
  const art = await extractArticle(url);
  const script = await llm.generateScript(art.text);
  const ds = script.dialogues || [];
  console.log('总轮次:', ds.length, '| 总字数:', ds.reduce((n, d) => n + (d.text || '').length, 0));
  console.log('--- 最后 8 轮 ---');
  ds.slice(-8).forEach((d) => console.log(`${d.speaker}: ${d.text}`));
  const last = ds[ds.length - 1];
  const prev = ds[ds.length - 2];
  console.log('--- 收尾检查 ---');
  console.log('倒二/末句说话人:', prev && prev.speaker, '/', last && last.speaker);
  console.log('双人收尾:', (last && prev && last.speaker !== prev.speaker)
    ? '✓ 末两句是不同说话人（两人都有结束语）'
    : '✗ 末尾仍是同一人/不完整');
})().catch((e) => { console.error('ERR ' + e.message); process.exit(1); });
