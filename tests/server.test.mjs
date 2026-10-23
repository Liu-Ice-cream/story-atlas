import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { demoProject } from '../public/domain.js';
import http from 'node:http';

async function cleanTestDir(dir) {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(dir));
  assert.ok(relative.startsWith('story-atlas-test-') && !relative.includes(path.sep) && !relative.startsWith('..'));
  await rm(dir, { recursive: true, force: true });
}

test('本机存储、重启恢复、备份、版本冲突与来源限制', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'story-atlas-test-'));
  let server;
  const launch = async () => { server = await createApp({ dataDir: dir }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; };
  const stop = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  try {
    let base = await launch();
    const p = await (await fetch(`${base}/api/project`)).json();
    p.title = '测试作品'; p.settings.apiKey = 'must-not-be-persisted';
    const put = data => fetch(`${base}/api/project`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const saved = await (await put(p)).json();
    assert.equal(saved.revision, 1); assert.equal(saved.settings.apiKey, undefined);
    assert.equal((await put(p)).status, 409);
    saved.note = '新的备忘';
    assert.equal((await put(saved)).status, 200);
    const previous = JSON.parse(await readFile(path.join(dir, 'project.previous.json'), 'utf8'));
    assert.equal(previous.title, '测试作品'); assert.equal(previous.revision, 1);
    assert.equal((await fetch(`${base}/api/project`, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(`${base}/data/project.json`)).status, 404);
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.ok((await (await fetch(`${base}/`)).text()).includes('拾章'));
    const bad = await fetch(`${base}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chapterIds: ['x'], endpoint: 'http://external.example', model: 'test', apiKey: '' }) });
    assert.equal(bad.status, 400);
    await stop(); base = await launch();
    const restored = await (await fetch(`${base}/api/project`)).json();
    assert.equal(restored.note, '新的备忘'); assert.equal(restored.revision, 2);
  } finally { if (server?.listening) await stop(); await cleanTestDir(dir); }
});

test('软件内 AI 使用兼容接口，返回结果等待确认，密钥不落盘', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'story-atlas-test-'));
  let payload, authorization;
  const upstream = http.createServer(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    authorization = req.headers.authorization;
    let raw = ''; for await (const chunk of req) raw += chunk;
    payload = JSON.parse(raw);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaVersion: 1, suggestions: [{ type: 'summary', text: '沈舟抵达渡口。', chapterId: 'ch1', quote: '沈舟撑着一把旧伞走进渡口。' }] }) } }] }));
  });
  let server;
  try {
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    server = await createApp({ dataDir: dir }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    await fetch(`${base}/api/project`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(demoProject()) });
    const response = await fetch(`${base}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chapterIds: ['ch1'], endpoint: `http://127.0.0.1:${upstream.address().port}/v1`, model: 'test-model', apiKey: 'test-session-secret' }) });
    assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(JSON.parse(result.content).suggestions.length, 1);
    assert.equal(payload.model, 'test-model'); assert.equal(authorization, 'Bearer test-session-secret');
    assert.ok(payload.messages[1].content.includes('<chapter id="ch1">'));
    const persisted = await readFile(path.join(dir, 'project.json'), 'utf8');
    assert.ok(!persisted.includes('test-session-secret')); assert.ok(!persisted.includes('沈舟抵达渡口。'));
  } finally {
    for (const s of [server, upstream]) if (s?.listening) { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)); }
    await cleanTestDir(dir);
  }
});

test('接口自检使用已保存会话，只发送固定短测试，检查 JSON 且不保存密钥', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'story-atlas-test-'));
  const seen = []; let responseBody = '{"ok":true}', status = 200;
  const upstream = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    seen.push({ payload: JSON.parse(body), authorization: req.headers.authorization });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: responseBody } }] }));
  });
  let server;
  try {
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    server = await createApp({ dataDir: dir }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (url, data = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal((await post('/api/ai/test')).status, 400);
    const before = await (await fetch(base + '/api/project')).text();
    await post('/api/ai/session', { endpoint: `http://127.0.0.1:${upstream.address().port}/v1`, model: 'check-model', apiKey: 'connection-test-secret' });
    let r = await post('/api/ai/test'); assert.equal(r.status, 200);
    const result = await r.json(); assert.equal(result.ok, true); assert.equal(result.jsonCompatible, true);
    assert.equal(seen[0].authorization, 'Bearer connection-test-secret');
    assert.equal(seen[0].payload.max_tokens, 128); assert.equal(seen[0].payload.model, 'check-model');
    assert.ok(JSON.stringify(seen[0].payload.messages).length < 300);
    responseBody = '接口连通，但不是 JSON'; r = await post('/api/ai/test'); assert.equal((await r.json()).jsonCompatible, false);
    status = 401; r = await post('/api/ai/test'); assert.equal(r.status, 400); assert.match((await r.json()).error, /HTTP 401/);
    assert.equal(await (await fetch(base + '/api/project')).text(), before);
    assert.ok(!(await readFile(path.join(dir, 'ai-jobs.json'), 'utf8')).includes('connection-test-secret'));
  } finally {
    for (const s of [server, upstream]) if (s?.listening) { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)); }
    await cleanTestDir(dir);
  }
});

test('停止服务接口需要确认并等待保存后正常关闭', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'story-atlas-test-'));
  const server = await createApp({ dataDir: dir });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = confirm => fetch(`${base}/api/shutdown`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm }) });
    assert.equal((await post(false)).status, 400);
    const closed = new Promise(resolve => server.once('close', resolve));
    assert.equal((await post(true)).status, 200);
    await closed;
    assert.equal(server.listening, false);
  } finally { if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await cleanTestDir(dir); }
});
