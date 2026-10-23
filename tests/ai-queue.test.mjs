import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { emptyProject, applySuggestions } from '../public/domain.js';

async function fixture(handler) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'story-atlas-queue-test-'));
  const requests = [];
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw); requests.push(payload);
    await handler(payload, res, requests.length);
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  let server, base;
  const launch = async () => { server = await createApp({ dataDir: dir }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; };
  await launch();
  const request = async (url, method = 'GET', data) => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  const stop = async () => { if (server?.listening) { const closed = new Promise(resolve => server.once('close', resolve)); await request('/api/shutdown', 'POST', { confirm: true }); await closed; } };
  return {
    dir, requests, request, launch, stop,
    config: { endpoint: `http://127.0.0.1:${upstream.address().port}/v1`, model: 'queue-test', apiKey: 'queue-test-secret' },
    async poll(predicate) {
      const limit = Date.now() + 4000;
      while (Date.now() < limit) { const q = await request('/api/ai/jobs'); if (predicate(q)) return q; await new Promise(resolve => setTimeout(resolve, 10)); }
      throw new Error('任务状态未在限定时间内到达');
    },
    async close() {
      await stop(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
      const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(dir));
      assert.ok(relative.startsWith('story-atlas-queue-test-') && !relative.includes(path.sep));
      await rm(dir, { recursive: true, force: true });
    }
  };
}
const chapter = (id, body, order = 1) => ({ id, title: '新章 ' + id, filename: id + '.md', body, summary: '', order, volume: '', status: 'unprocessed' });
function reply(payload, res) {
  const prompt = payload.messages[1].content;
  const chapterId = prompt.match(/<chapter id="([^"]+)">/)[1];
  const quote = prompt.includes('甲向乙道谢。') ? '甲向乙道谢。' : '甲遇见乙。';
  const content = JSON.stringify({ schemaVersion: 1, suggestions: [
    { type: 'character_fact', name: '甲', text: '本章与乙相遇。', chapterId, quote },
    { type: 'relationship', from: '甲', to: '乙', text: '本章相识', chapterId, quote }
  ] });
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
}

test('导入后只整理新增章节；结果持久化但不直接改人物，领取幂等且可明确确认入库', async () => {
  const f = await fixture(async (payload, res) => reply(payload, res));
  try {
    let p = emptyProject(); p.title = '自动整理测试'; p.chapters = [chapter('old', '这一整段旧正文不应重新发送。')];
    p = await f.request('/api/project', 'PUT', p);
    p.settings = { ...p.settings, autoOrganize: true };
    p = await f.request('/api/project', 'PUT', p);
    await f.request('/api/ai/session', 'POST', f.config);
    assert.equal((await f.request('/api/ai/jobs')).jobs.length, 0);
    p.chapters.push(chapter('new', '甲遇见乙。', 2));
    p = await f.request('/api/project', 'PUT', p);
    const q = await f.poll(q => q.jobs.some(j => j.status === 'ready'));
    const job = q.jobs[0]; assert.equal(job.chapterId, 'new'); assert.equal(f.requests.length, 1);
    assert.ok(!f.requests[0].messages[1].content.includes('这一整段旧正文不应重新发送'));
    const before = await f.request('/api/project'); assert.equal(before.characters.length, 0); assert.equal(before.review?.length || 0, 0);
    let result = await f.request(`/api/ai/jobs/${job.id}/collect`, 'POST', { revision: before.revision });
    assert.equal(result.project.review.length, 2); assert.equal(result.project.characters.length, 0);
    result = await f.request(`/api/ai/jobs/${job.id}/collect`, 'POST', { revision: result.project.revision });
    assert.equal(result.project.review.length, 2);
    p = applySuggestions(result.project, result.project.review); p.review = [];
    p = await f.request('/api/project', 'PUT', p);
    assert.equal(p.characters.length, 2); assert.equal(p.relationships.length, 1);
    p = await f.request('/api/project', 'PUT', p);
    assert.equal(f.requests.length, 1); assert.equal((await f.request('/api/ai/jobs')).jobs.length, 1);
    for (const name of ['project.json', 'ai-jobs.json']) assert.ok(!(await readFile(path.join(f.dir, name), 'utf8')).includes('queue-test-secret'));
  } finally { await f.close(); }
});

test('缺少会话时等待配置；失败不重发，重试由作者明确触发', async () => {
  let fail = true;
  const f = await fixture(async (payload, res) => { if (fail) { res.writeHead(429); res.end(); } else reply(payload, res); });
  try {
    let p = await f.request('/api/project'); p.settings.autoOrganize = true; p.chapters = [chapter('one', '甲遇见乙。')];
    await f.request('/api/project', 'PUT', p);
    const waiting = await f.request('/api/ai/jobs'); assert.equal(waiting.jobs[0].status, 'waiting_config'); assert.equal(f.requests.length, 0);
    await f.request('/api/ai/session', 'POST', f.config);
    const failed = await f.poll(q => q.jobs[0]?.status === 'failed');
    assert.equal(failed.jobs[0].attempts, 1); assert.equal(f.requests.length, 1);
    fail = false;
    await f.request(`/api/ai/jobs/${failed.jobs[0].id}/retry`, 'POST', {});
    const ready = await f.poll(q => q.jobs[0]?.status === 'ready'); assert.equal(ready.jobs[0].attempts, 2); assert.equal(f.requests.length, 2);
    assert.equal((await f.request('/api/project')).characters.length, 0);
  } finally { await f.close(); }
});

test('整理期间修改原文会使旧结果失效，新版本排队整理', async () => {
  let release, started;
  const firstStarted = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(async (payload, res, count) => { if (count === 1) { started(); await gate; } reply(payload, res); });
  try {
    await f.request('/api/ai/session', 'POST', f.config);
    let p = await f.request('/api/project'); p.settings.autoOrganize = true; p.chapters = [chapter('one', '甲遇见乙。')];
    p = await f.request('/api/project', 'PUT', p); await firstStarted;
    p.chapters[0].body = '甲向乙道谢。'; p = await f.request('/api/project', 'PUT', p);
    release();
    const q = await f.poll(q => q.jobs.length === 2 && q.jobs.some(j => j.status === 'ready') && q.jobs.some(j => j.status === 'outdated'));
    const old = q.jobs.find(j => j.status === 'outdated');
    await assert.rejects(f.request(`/api/ai/jobs/${old.id}/collect`, 'POST', { revision: p.revision }), /变更/);
    assert.equal((await f.request('/api/project')).chapters[0].body, '甲向乙道谢。'); assert.equal(f.requests.length, 2);
  } finally { release(); await f.close(); }
});

test('暂停可阻止后续请求；重启保留队列但不保存密钥', async () => {
  const f = await fixture(async (payload, res) => reply(payload, res));
  try {
    await f.request('/api/ai/paused', 'POST', { paused: true });
    await f.request('/api/ai/session', 'POST', f.config);
    const p = await f.request('/api/project'); p.settings.autoOrganize = true; p.chapters = [chapter('one', '甲遇见乙。'), chapter('two', '甲向乙道谢。', 2)];
    await f.request('/api/project', 'PUT', p);
    assert.equal(f.requests.length, 0); assert.equal((await f.request('/api/ai/jobs')).jobs.length, 2);
    await f.stop(); await f.launch();
    const q = await f.request('/api/ai/jobs'); assert.equal(q.configured, false); assert.equal(q.paused, true); assert.ok(q.jobs.every(j => j.status === 'waiting_config'));
    await f.request('/api/ai/session', 'POST', f.config);
    assert.equal(f.requests.length, 0);
    await f.request('/api/ai/paused', 'POST', { paused: false });
    await f.poll(q => q.jobs.every(j => j.status === 'ready')); assert.equal(f.requests.length, 2);
  } finally { await f.close(); }
});

test('同一作品恢复备份保留原有复核状态，不排 AI 任务，并保护当前版本和清除会话', async () => {
  const f = await fixture(async (payload, res) => reply(payload, res));
  try {
    let p = await f.request('/api/project');
    p.chapters = [chapter('one', '甲遇见乙。')];
    p = await f.request('/api/project', 'PUT', p);
    const backup = structuredClone(p); backup.settings.autoOrganize = true;
    backup.settings.apiKey = 'must-not-be-saved';
    backup.chapters[0].summary = '原备份中已核实的摘要';
    p.chapters[0].body = '甲向乙道谢。';
    p = await f.request('/api/project', 'PUT', p);
    await f.request('/api/ai/session', 'POST', f.config);
    await assert.rejects(f.request('/api/project/restore', 'POST', backup), /其他窗口更新/);
    assert.equal((await f.request('/api/project')).chapters[0].body, '甲向乙道谢。');
    backup.revision = p.revision;
    const restored = await f.request('/api/project/restore', 'POST', backup);
    assert.equal(restored.revision, p.revision + 1);
    assert.equal(restored.projectId, p.projectId);
    assert.equal(restored.chapters[0].body, '甲遇见乙。');
    assert.ok(!restored.chapters[0].summaryNeedsReview);
    const q = await f.request('/api/ai/jobs');
    assert.equal(q.paused, true); assert.equal(q.configured, false);
    assert.equal(q.jobs.length, 0); assert.equal(f.requests.length, 0);
    assert.ok(!(await readFile(path.join(f.dir, 'project.json'), 'utf8')).includes('must-not-be-saved'));
    const snapshots = await f.request('/api/snapshots');
    assert.ok(JSON.stringify(snapshots).includes('恢复备份前保护'));
    await f.stop(); await f.launch();
    assert.equal((await f.request('/api/project')).chapters[0].summary, '原备份中已核实的摘要');
    assert.equal((await f.request('/api/ai/jobs')).paused, true);
  } finally { await f.close(); }
});

test('恢复另一部作品不会因备份中的开关而自动发送整本正文', async () => {
  const f = await fixture(async (payload, res) => reply(payload, res));
  try {
    await f.request('/api/ai/session', 'POST', f.config);
    const current = await f.request('/api/project');
    let restored = emptyProject(); restored.revision = current.revision;
    restored.settings.autoOrganize = true; restored.chapters = [chapter('old', '旧作品正文。')];
    restored = await f.request('/api/project', 'PUT', restored);
    assert.equal((await f.request('/api/ai/jobs')).jobs.length, 0); assert.equal(f.requests.length, 0);
    restored.chapters.push(chapter('new', '甲遇见乙。', 2));
    await f.request('/api/project', 'PUT', restored);
    const queue = await f.poll(q => q.jobs[0]?.status === 'ready');
    assert.equal(queue.jobs.length, 1); assert.equal(queue.jobs[0].chapterId, 'new'); assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});
