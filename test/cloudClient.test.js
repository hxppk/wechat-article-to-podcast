const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const { createCloudClient } = require('../src/worker/cloudClient');

function jsonRes(status, data) {
  return { status, ok: status >= 200 && status < 300, json: async () => data };
}

function makeFetch(responder) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return responder(url, opts, calls.length - 1);
  };
  return { fetchImpl, calls };
}

const BASE = 'https://cloud.example.com';
const TOKEN = 'secret-token';

test('claim 发出带 Bearer 的 POST，解析任务体', async () => {
  const { fetchImpl, calls } = makeFetch(() => jsonRes(200, { task: { id: 't1' }, leaseMs: 1000 }));
  const client = createCloudClient({ baseUrl: BASE, token: TOKEN, fetchImpl });
  const res = await client.claim('worker-1');

  assert.equal(calls[0].url, `${BASE}/api/worker/claim`);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { workerId: 'worker-1' });
  assert.deepEqual(res, { task: { id: 't1' }, leaseMs: 1000 });
});

test('claim 204 返回 null（无任务）', async () => {
  const { fetchImpl } = makeFetch(() => jsonRes(204, null));
  const client = createCloudClient({ baseUrl: BASE, token: TOKEN, fetchImpl });
  assert.equal(await client.claim('w'), null);
});

test('claim 非 2xx 抛错', async () => {
  const { fetchImpl } = makeFetch(() => jsonRes(500, {}));
  const client = createCloudClient({ baseUrl: BASE, token: TOKEN, fetchImpl });
  await assert.rejects(() => client.claim('w'), /HTTP 500/);
});

test('heartbeat 200=true / 409=false，body 含 leaseToken', async () => {
  const ok = makeFetch(() => jsonRes(200, { ok: true }));
  const c1 = createCloudClient({ baseUrl: BASE, token: TOKEN, fetchImpl: ok.fetchImpl });
  assert.equal(await c1.heartbeat('t1', 'lease-1'), true);
  assert.equal(ok.calls[0].url, `${BASE}/api/worker/tasks/t1/heartbeat`);
  assert.deepEqual(JSON.parse(ok.calls[0].opts.body), { leaseToken: 'lease-1' });

  const conflict = makeFetch(() => jsonRes(409, {}));
  const c2 = createCloudClient({ baseUrl: BASE, token: TOKEN, fetchImpl: conflict.fetchImpl });
  assert.equal(await c2.heartbeat('t1', 'lease-1'), false);
});

test('setStage 提交 stage', async () => {
  const { fetchImpl, calls } = makeFetch(() => jsonRes(200, { ok: true }));
  const client = createCloudClient({ baseUrl: BASE, token: TOKEN, fetchImpl });
  assert.equal(await client.setStage('t1', 'lease-1', 'generating'), true);
  assert.equal(calls[0].url, `${BASE}/api/worker/tasks/t1/stage`);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { leaseToken: 'lease-1', stage: 'generating' });
});

test('fail 提交 error，409 返回 false', async () => {
  const { fetchImpl, calls } = makeFetch(() => jsonRes(200, { ok: true }));
  const client = createCloudClient({ baseUrl: BASE, token: TOKEN, fetchImpl });
  assert.equal(await client.fail('t1', 'lease-1', 'boom'), true);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { leaseToken: 'lease-1', error: 'boom' });

  const conflict = makeFetch(() => jsonRes(409, {}));
  const c2 = createCloudClient({ baseUrl: BASE, token: TOKEN, fetchImpl: conflict.fetchImpl });
  assert.equal(await c2.fail('t1', 'lease-1', 'boom'), false);
});

test('result 以 multipart 上传 mp3 + 元数据（Bearer，无手动 Content-Type）', async () => {
  // 准备一个临时 mp3
  const tmp = path.join(os.tmpdir(), `cc-${uuid()}.mp3`);
  fs.writeFileSync(tmp, Buffer.from('FAKE_MP3_BYTES'));

  const { fetchImpl, calls } = makeFetch(() => jsonRes(200, { ok: true, podcastId: 't1' }));
  const client = createCloudClient({ baseUrl: BASE, token: TOKEN, fetchImpl });

  const res = await client.result('t1', 'lease-1', {
    audioPath: tmp,
    script: { raw: 'RAW', dialogues: [{ speaker: 'A', text: 'hi' }] },
    summary: 'SUM',
    durationMs: 4242,
    fileSizeBytes: 14,
    title: 'Title',
    accountName: 'Acct',
  });

  const { url, opts } = calls[0];
  assert.equal(url, `${BASE}/api/worker/tasks/t1/result`);
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers.Authorization, `Bearer ${TOKEN}`);
  // 不应手动设置 Content-Type（由 FormData 生成 boundary）
  assert.ok(!('Content-Type' in opts.headers) && !('content-type' in opts.headers));
  assert.ok(opts.body instanceof FormData);

  const form = opts.body;
  assert.equal(form.get('leaseToken'), 'lease-1');
  assert.equal(form.get('summary'), 'SUM');
  assert.equal(form.get('durationMs'), '4242');
  assert.equal(form.get('title'), 'Title');
  assert.equal(form.get('accountName'), 'Acct');
  assert.deepEqual(JSON.parse(form.get('script')), { raw: 'RAW', dialogues: [{ speaker: 'A', text: 'hi' }] });

  const audio = form.get('audio');
  assert.equal(audio.name, 't1.mp3');
  assert.equal(audio.type, 'audio/mpeg');
  assert.equal(audio.size, 14);

  assert.deepEqual(res, { ok: true, podcastId: 't1' });

  fs.unlinkSync(tmp);
});
