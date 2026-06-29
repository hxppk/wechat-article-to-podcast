const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const { runPipeline } = require('../src/worker/pipeline');

test('runPipeline 按 parsing→generating→synthesizing 顺序执行并返回元数据', async () => {
  const workDir = path.join(os.tmpdir(), `pipeline-${uuid()}`);
  const order = [];
  let ttsProviderSeen = null;

  const deps = {
    extractArticle: async (url) => {
      order.push('extract');
      assert.equal(url, 'https://mp.weixin.qq.com/s/abc');
      return { title: '标题', accountName: '公众号', text: '正文内容'.repeat(20) };
    },
    llm: {
      getName: () => 'mock-llm',
      generateScript: async (text) => {
        order.push('llm');
        assert.ok(text.length > 0);
        return {
          raw: 'RAW SCRIPT',
          dialogues: [{ speaker: 'A', text: '你好' }, { speaker: 'B', text: '你也好' }],
          summary: '摘要文本',
        };
      },
    },
    getTTSInstance: (name) => {
      ttsProviderSeen = name;
      return {
        getName: () => 'mock-tts',
        synthesize: async (dialogues, outputPath) => {
          order.push('tts');
          assert.equal(dialogues.length, 2);
          fs.writeFileSync(outputPath, Buffer.from('MP3_BYTES_HERE'));
        },
      };
    },
    getAudioDuration: async (audioPath) => {
      assert.ok(fs.existsSync(audioPath));
      return 4242;
    },
    workDir,
  };

  const stages = [];
  const result = await runPipeline(
    { sourceUrl: 'https://mp.weixin.qq.com/s/abc', ttsProvider: 'elevenlabs' },
    { onStage: (s) => stages.push(s), deps }
  );

  assert.deepEqual(stages, ['parsing', 'generating', 'synthesizing']);
  assert.deepEqual(order, ['extract', 'llm', 'tts']);
  assert.equal(ttsProviderSeen, 'elevenlabs');

  assert.equal(result.title, '标题');
  assert.equal(result.accountName, '公众号');
  assert.equal(result.summary, '摘要文本');
  assert.equal(result.durationMs, 4242);
  assert.equal(result.fileSizeBytes, Buffer.from('MP3_BYTES_HERE').length);
  assert.ok(fs.existsSync(result.audioPath));
  assert.equal(result.script.dialogues.length, 2);

  // 清理
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('runPipeline 支持 async onStage（等待上报完成）', async () => {
  const workDir = path.join(os.tmpdir(), `pipeline-${uuid()}`);
  const reported = [];
  const deps = {
    extractArticle: async () => ({ title: 't', accountName: 'a', text: 'x'.repeat(50) }),
    llm: { getName: () => 'm', generateScript: async () => ({ raw: 'r', dialogues: [{ speaker: 'A', text: 'hi' }], summary: '' }) },
    getTTSInstance: () => ({ getName: () => 'm', synthesize: async (d, out) => fs.writeFileSync(out, Buffer.from('x')) }),
    getAudioDuration: async () => 1000,
    workDir,
  };

  await runPipeline({ sourceUrl: 'u', ttsProvider: 'minimax' }, {
    onStage: async (s) => { await new Promise((r) => setTimeout(r, 1)); reported.push(s); },
    deps,
  });

  assert.deepEqual(reported, ['parsing', 'generating', 'synthesizing']);
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
});
