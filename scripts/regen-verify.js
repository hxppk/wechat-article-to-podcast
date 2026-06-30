/* 本地用修好的 TTS 代码重生成指定文章，产物落到 /tmp/regen_fixed.mp3 供验收。
 * 不入库、不上传，仅验证：完整（不截断）+ 可 seek（Xing 头覆盖全长）+ 段间一致。 */
require('dotenv').config({ path: '.env.worker' });
['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']
  .forEach((k) => { delete process.env[k]; });
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { runPipeline } = require(path.join(__dirname, '..', 'src', 'worker', 'pipeline'));

const url = process.argv[2] || 'https://mp.weixin.qq.com/s/U9IGThOHpcXtiztm1MjzMg';
const out = '/tmp/regen_fixed.mp3';

(async () => {
  const t0 = Date.now();
  const sec = () => ((Date.now() - t0) / 1000).toFixed(0);
  const r = await runPipeline(
    { sourceUrl: url, ttsProvider: 'elevenlabs' },
    { onStage: (s) => console.log(`[stage ${sec()}s] ${s}`) },
  );
  fs.copyFileSync(r.audioPath, out);
  const size = fs.statSync(out).size;
  let probe = '?';
  try {
    probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', out]).toString().trim();
  } catch (e) { probe = 'ffprobe失败:' + e.message; }
  const scriptChars = r.script ? r.script.length : 'n/a';
  console.log('RESULT_JSON ' + JSON.stringify({
    scriptChars, durationMs: r.durationMs, sizeBytes: size, ffprobeSec: probe, out,
  }));
})().catch((e) => { console.error('REGEN_ERROR ' + e.message); process.exit(1); });
