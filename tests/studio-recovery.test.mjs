import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { demoProject, validateProject } from '../public/domain.js';
import { parseStyleAnalysis } from '../public/studio-domain.js';
import { styleWorkflow } from '../public/studio-workflow.js';
import { digest, captureAnalysis, executeStudio } from '../studio-engine.mjs';
import { StudioQueue } from '../studio-queue.mjs';

const reference = '她没有抬头，只将那封信慢慢推回桌边。窗外的雨声渐渐远去，她终于松开了手。';
const prepared = () => {
  const p = validateProject(demoProject());
  p.studio.sources = [{ id: 'ref', name: '测试参考', body: reference }];
  p.studio.profiles = [{ ...styleResult(p.studio.sources), id: 'profile', version: 1, approved: true, sourceManifest: [{ id: 'ref', hash: digest(reference) }] }];
  p.studio.profiles[0] = { ...parseStyleAnalysis(p.studio.profiles[0], p.studio.sources), ...p.studio.profiles[0] };
  // Keep the persisted profile schema, rather than the raw model schema.
  p.studio.profiles[0].rules.forEach((r, i) => Object.assign(r, { id: 'rule-' + i, weight: 'keep' }));
  return p;
};
function styleResult(sources) { const s = sources[0]; return { name: '动作留白', overview: '通过动作呈现情绪', uncertainty: '仅依据样本', rules: [{ category: 'description', rule: '用动作呈现情绪', sourceId: s.id, quote: s.body.slice(0, 20) }], examples: [{ sourceId: s.id, quote: s.body.slice(0, 25) }] }; }
const writing = { type: 'writing', mode: 'rewrite', sourceKind: 'paste', text: '沈舟推开门，握着信纸站在门边。', profileId: 'profile', length: 200, revise: false };
function modelResult(data) {
  if (data.paragraphs) return { paragraphs: data.paragraphs.map(p => ({ id: p.id, tags: ['narration'], excluded: false })) };
  if (data.sources) return styleResult(data.sources);
  if (data.pool) return { selectedIds: [], missing: [] };
  if (data.candidate) return { status: 'pass', issues: [], notes: '' };
  return { text: '沈舟推开门，信纸在手中轻响。', notes: '', unresolved: [] };
}
async function fixture(handler) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'story-atlas-recovery-')), calls = [];
  const mock = http.createServer(async (req, res) => {
    let text = ''; for await (const c of req) text += c;
    const request = JSON.parse(text), data = JSON.parse(request.messages[1].content); calls.push(data);
    const result = await handler(data, calls);
    if (res.destroyed) return;
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  let server, base;
  const launch = async () => { server = await createApp({ dataDir: dir }); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; };
  await launch();
  const request = async (url, method = 'GET', data) => { const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }); const value = await r.json(); if (!r.ok) throw Error(value.error); return value; };
  const config = { endpoint: `http://127.0.0.1:${mock.address().port}/v1`, model: 'recovery-test', apiKey: 'do-not-persist-this-secret' };
  const stop = async () => { if (server.listening) { await request('/api/shutdown', 'POST', { confirm: true }); if (server.listening) await new Promise(r => server.once('close', r)); } };
  const poll = async (id, states) => { const until = Date.now() + 7000; while (Date.now() < until) { const j = await request('/api/studio/jobs/' + id); if (states.includes(j.status)) return j; await new Promise(r => setTimeout(r, 10)); } throw Error('等待任务超时'); };
  return { dir, calls, request, config, stop, launch, poll, async close() { await stop(); mock.closeAllConnections(); await new Promise(r => mock.close(r)); const relative = path.relative(os.tmpdir(), dir); assert.ok(relative.startsWith('story-atlas-recovery-') && !relative.includes(path.sep)); await rm(dir, { recursive: true, force: true }); } };
}

test('失败分析保留脱敏返回与用量，本地修复不调用模型，恢复不重跑已修复步骤', async () => {
  const f = await fixture(data => { const r = styleResult(data.sources); r.overview = 'do-not-persist-this-secret'; r.rules[0].quote = '模型拼接了一段不存在的原文。'; return r; });
  try {
    const p = await f.request('/api/project', 'PUT', prepared()); await f.request('/api/ai/session', 'POST', f.config);
    const queued = await f.request('/api/studio/jobs', 'POST', { type: 'analysis', sourceIds: ['ref'], projectId: p.projectId, revision: p.revision });
    const failed = await f.poll(queued.id, ['failed']);
    assert.match(failed.error, /规则 1.*引用与原文/); assert.equal(failed.repairs[0].diagnostic.path, '规则 1');
    assert.ok(failed.repairs[0].responseText.includes('[密钥已隐藏]'));
    assert.equal(failed.usage.promptTokens, 100); assert.equal(failed.usage.completionTokens, 20);
    const repair = failed.repairs[0], fixed = JSON.parse(repair.responseText);
    await assert.rejects(f.request(`/api/studio/jobs/${queued.id}/repair`, 'POST', { stepId: 'style', content: JSON.stringify(fixed) }), /无法匹配/);
    assert.equal(f.calls.length, 1);
    fixed.rules[0].quote = repair.sources[0].body.slice(0, 20);
    await f.request('/api/ai/session', 'DELETE');
    const saved = await f.request(`/api/studio/jobs/${queued.id}/repair`, 'POST', { stepId: 'style', content: JSON.stringify(fixed) });
    assert.equal(saved.status, 'paused'); assert.equal(f.calls.length, 1);
    assert.equal((await f.request('/api/project')).studio.profiles.length, 1, '修复没有写入正式文风库');
    await f.stop(); await f.launch();
    assert.equal((await f.request('/api/studio/jobs/' + queued.id)).status, 'paused');
    await f.request('/api/ai/session', 'POST', f.config);
    await f.request(`/api/studio/jobs/${queued.id}/retry`, 'POST', {});
    const ready = await f.poll(queued.id, ['ready']); assert.equal(f.calls.length, 1); assert.equal(ready.steps.style.repaired, true);
    await f.request(`/api/studio/jobs/${queued.id}/collect`, 'POST', { revision: p.revision });
    const profile = (await f.request('/api/project')).studio.profiles.at(-1);
    assert.equal(profile.approved, false); assert.equal(profile.rules[0].quote, fixed.rules[0].quote);
    assert.ok(!(await readFile(path.join(f.dir, 'studio-jobs.json'), 'utf8')).includes(f.config.apiKey));
  } finally { await f.close(); }
});

test('暂停等待当前请求完成，批次不标为失败；重启后恢复只处理剩余批次', async () => {
  let began, release; const started = new Promise(r => { began = r; }), gate = new Promise(r => { release = r; });
  const f = await fixture(async (data, calls) => { if (calls.length === 1) { began(); await gate; } return modelResult(data); });
  try {
    const p = prepared(); p.studio.sources[0].body = (reference + '\n').repeat(140);
    const saved = await f.request('/api/project', 'PUT', p); await f.request('/api/ai/session', 'POST', f.config);
    const j = await f.request('/api/studio/jobs', 'POST', { type: 'scene-index', sourceIds: ['ref'], projectId: saved.projectId, revision: saved.revision }); await started;
    const pausing = await f.request(`/api/studio/jobs/${j.id}/pause`, 'POST', {}); assert.equal(pausing.status, 'pausing');
    const queued = await f.request('/api/studio/jobs', 'POST', { ...writing, projectId: saved.projectId, revision: saved.revision });
    assert.equal((await f.request(`/api/studio/jobs/${queued.id}/pause`, 'POST', {})).status, 'paused');
    release(); const paused = await f.poll(j.id, ['paused']); assert.equal(paused.doneBatches, 1); assert.equal(paused.steps[Object.keys(paused.steps)[0]].status, 'done'); assert.equal(f.calls.length, 1);
    await f.stop(); await f.launch(); await f.request('/api/ai/session', 'POST', f.config); await f.request(`/api/studio/jobs/${j.id}/retry`, 'POST', {});
    const ready = await f.poll(j.id, ['ready']); assert.equal(f.calls.length, ready.totalBatches); assert.equal(ready.usage.promptTokens, ready.totalBatches * 100);
    assert.equal((await f.request('/api/studio/jobs/' + queued.id)).calls, 0);
  } finally { release(); await f.close(); }
});

test('整本索引在批次边界让出给写作，之后自动继续且不重发已完成批次', async () => {
  let began, release; const started = new Promise(r => { began = r; }), gate = new Promise(r => { release = r; });
  const f = await fixture(async (data, calls) => { if (calls.length === 1) { began(); await gate; } return modelResult(data); });
  try {
    const p = prepared(); p.studio.sources[0].body = (reference + '\n').repeat(140);
    const saved = await f.request('/api/project', 'PUT', p); await f.request('/api/ai/session', 'POST', f.config);
    const index = await f.request('/api/studio/jobs', 'POST', { type: 'scene-index', sourceIds: ['ref'], projectId: saved.projectId, revision: saved.revision }); await started;
    const write = await f.request('/api/studio/jobs', 'POST', { ...writing, projectId: saved.projectId, revision: saved.revision }); release();
    await f.poll(write.id, ['ready']); const ready = await f.poll(index.id, ['ready']);
    assert.ok(f.calls[0].paragraphs); assert.ok(f.calls[1].pool); assert.equal(f.calls.filter(d => d.paragraphs).length, ready.totalBatches);
    assert.equal(f.calls.findIndex((d, i) => i > 0 && d.paragraphs), 5, '一次写作的四次请求优先于第二批索引');
  } finally { release(); await f.close(); }
});

test('修改材料后阻止本地修复；旧任务缺少失败返回时仍可查看样本', async () => {
  const p = prepared(), input = captureAnalysis(p, { sourceIds: ['ref'] });
  const j = { input, steps: {} };
  await assert.rejects(executeStudio(j, async () => ({ content: JSON.stringify({ ...styleResult(input.sources), rules: [{ category: 'description', rule: '动作', sourceId: 'wrong', quote: reference }] }) }), async () => {}), /来源编号/);
  assert.equal(j.steps.style.status, 'failed'); assert.ok(j.steps.style.responseText); assert.equal(j.steps.style.diagnostic.sourceId, 'wrong');
  delete j.steps.style.responseText;
  j.id = 'old'; j.projectId = p.projectId; j.status = 'failed';
  const queue = new StudioQueue(os.tmpdir(), () => p, () => null); queue.jobs = [j];
  const old = queue.detail('old'); assert.equal(old.repairs[0].responseText, ''); assert.ok(old.repairs[0].sources.length);
  p.studio.sources[0].body += '原文发生变更。';
  await assert.rejects(queue.repair('old', { stepId: 'style', content: JSON.stringify(styleResult(input.sources)) }), /原文或分类已更新/);
});

test('下一步基于材料集、索引、失败任务和确认状态，快捷档案可以直接写作', () => {
  const p = prepared(), local = { selectedSources: new Set(), jobs: [], profileMeta: [], indexMeta: [] };
  assert.equal(styleWorkflow(p, local).action, 'studio-use-profile');
  p.studio.profiles[0].approved = false; assert.equal(styleWorkflow(p, local).action, 'studio-profile');
  p.studio.profiles = []; p.studio.sceneIndexes = [{ sourceId: 'ref' }]; assert.equal(styleWorkflow(p, local).action, 'studio-scene-preview');
  local.jobs = [{ id: 'failed', sourceIds: ['ref'], type: 'analysis', status: 'failed' }];
  assert.match(styleWorkflow(p, local).message, /无需重跑/); assert.equal(styleWorkflow(p, local).id, 'failed');
  local.jobs[0].outdated = true; assert.equal(styleWorkflow(p, local).action, 'studio-scene-preview');
  p.studio.sources.push({ id: 'other', body: reference }); assert.equal(styleWorkflow(p, local).action, '');
  local.selectedSources.add('ref'); assert.equal(styleWorkflow(p, local).action, 'studio-scene-preview');
});
