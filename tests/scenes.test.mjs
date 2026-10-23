import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject } from '../public/domain.js';
import { sceneDocument, parseSceneLabels, sceneSamples, selectProfileScenes } from '../public/scene-domain.js';
import { captureSceneIndex, captureSceneAnalysis, indexStale } from '../scene-engine.mjs';
import { executeStudio, jobOutdated, captureWriting, digest } from '../studio-engine.mjs';
import { StudioQueue } from '../studio-queue.mjs';
import { createApp } from '../server.mjs';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const body = '版权声明，仅为测试文档。\r\n\r\n第一幕 雨夜\r\n她推开窗。雨落在门前，远处的灯光被水汽遮住。😀\r\n\r\n“你来了。”她放下杯子，转过身去。\r\n\r\n他拔出剑，向门外冲去，脚步声在巷子里回响。\r\n\r\n第二章 归途\r\n她有些害怕，但仍沿着山路走下去。\r\n\r\n“别回头。”他说完便关上了门。\r\n\r\n故事到这里暂时结束，夜色仍然很深。';
const prepared = () => { const p = validateProject(demoProject()); p.studio.sources = [{ id: 'book', name: '测试参考书', body }]; return p; };
const job = (p, input) => ({ id: 'j', projectId: p.projectId, input, steps: {}, model: 'mock', endpoint: 'http://localhost/v1' });
const tag = p => p.text.includes('版权') ? { id: p.id, tags: [], excluded: true } : { id: p.id, tags: [p.text.includes('“') ? 'dialogue' : p.text.includes('拔出剑') ? 'action' : p.text.includes('害怕') ? 'psychology' : p.text.includes('雨落') ? 'environment' : 'narration'], excluded: false };
async function index(p) {
  const j = job(p, captureSceneIndex(p, { sourceIds: ['book'] }));
  await executeStudio(j, async (role, prompt, payload) => { assert.equal(role, 'sceneIndex'); return { content: JSON.stringify({ paragraphs: payload.paragraphs.map(tag) }) }; }, async () => {});
  p.studio.sceneIndexes = j.result.indexes; return j;
}
function styleReply(payload, general = false) {
  const s = payload.sources[0];
  return { name: '测试文风', overview: '以动作呈现情绪', uncertainty: '基于所选样本', rules: [{ category: 'description', rule: '通过动作与停顿组织叙述', sourceId: s.id, quote: (s.focus || s.body).slice(0, 12), ...(general ? { evidence: payload.sources.filter((x, i, all) => all.findIndex(y => y.sceneType === x.sceneType) === i).slice(0, 2).map(x => ({ sourceId: x.id, quote: (x.focus || x.body).slice(0, 12) })) } : {}) }], examples: [{ sourceId: s.id, quote: (s.focus || s.body).slice(0, 20) }] };
}

test('章节定位与内容标签分离，CRLF 与 Emoji 原文位置完整且不改正文', () => {
  const doc = sceneDocument({ id: 'book', body });
  assert.equal(doc.recognizedChapters, 2);
  for (const p of doc.paragraphs) assert.equal(body.slice(p.start, p.end), p.text);
  const first = doc.paragraphs.find(p => p.text.includes('雨落'));
  assert.ok(first.positions.includes('opening')); assert.ok(!first.positions.includes('ending'));
  assert.throws(() => parseSceneLabels({ paragraphs: [] }, doc.paragraphs), /所有段落/);
  const labels = doc.paragraphs.map(tag); labels[1].id = labels[0].id;
  assert.throws(() => parseSceneLabels({ paragraphs: labels }, doc.paragraphs), /重复/);
});

test('分类索引持久化兼容旧备份；缺失类型标注不足，排除段落不会被选作样本', async () => {
  const p = prepared(), original = p.studio.sources[0].body; await index(p); validateProject(p);
  const plan = sceneSamples(p.studio.sources, p.studio.sceneIndexes, ['dialogue', 'action', 'psychology'], 20000);
  assert.equal(plan.groups[0].candidateCount, 2); assert.equal(plan.groups[1].status, 'limited');
  assert.ok(plan.groups.flatMap(g => g.samples).every(s => !s.body.includes('版权')));
  assert.ok(plan.sampleLength <= 20000);
  p.studio.sceneIndexes[0].paragraphs.forEach(p => { if (p.tags.includes('action')) p.excluded = true; });
  assert.equal(sceneSamples(p.studio.sources, p.studio.sceneIndexes, ['action']).groups[0].status, 'missing');
  assert.equal(p.studio.sources[0].body, original);
  assert.equal(validateProject(JSON.parse(JSON.stringify(p))).studio.sceneIndexes.length, 1);
});

test('失败批次可继续，已完成批次与跨任务的同一批次不会重复调用', async () => {
  const p = prepared(); p.studio.sources[0].body = body.repeat(100);
  const input = captureSceneIndex(p, { sourceIds: ['book'] }); assert.ok(input.totalBatches > 1);
  const j = job(p, input); let calls = 0, fail = true;
  const call = async (role, prompt, payload) => { calls++; if (calls === 2 && fail) throw Error('模拟失败'); return { content: JSON.stringify({ paragraphs: payload.paragraphs.map(tag) }) }; };
  await assert.rejects(executeStudio(j, call, async () => {}), /模拟失败/);
  fail = false; await executeStudio(j, call, async () => {});
  assert.equal(calls, input.totalBatches + 1);
  const next = job(p, captureSceneIndex(p, { sourceIds: ['book'] })); let repeated = 0;
  await executeStudio(next, async () => { repeated++; throw Error('不应重发'); }, async () => {}, key => Object.values(j.steps).find(s => s.cacheKey === key && s.status === 'done'));
  assert.equal(repeated, 0); assert.ok(Object.values(next.steps).every(s => s.reused));
});

test('专项分析校验出处并保留类型，编辑分类或原文后旧任务会失效', async () => {
  const p = prepared(); await index(p);
  const input = captureSceneAnalysis(p, { sourceIds: ['book'], sceneTypes: ['dialogue', 'action'], sampleBudget: 20000, profileName: '分类档案' });
  const j = job(p, input); const roles = [];
  await executeStudio(j, async (role, prompt, payload) => { roles.push(role); return { content: JSON.stringify(styleReply(payload, payload.task.includes('共同支持'))) }; }, async () => {});
  assert.equal(roles.length, 3); assert.equal(j.result.name, '分类档案');
  assert.deepEqual(new Set(j.result.rules.map(r => r.sceneType)), new Set(['general', 'dialogue', 'action']));
  assert.ok(j.result.rules.every(r => r.sourceId === 'book' && body.includes(r.quote)));
  assert.equal(jobOutdated(j, p), false); p.studio.sceneIndexes[0].version++; assert.equal(jobOutdated(j, p), true);
  assert.equal(indexStale(p.studio.sceneIndexes[0], p), false); p.studio.sources[0].body += '改变';
  assert.equal(indexStale(p.studio.sceneIndexes[0], p), true);
  assert.throws(() => captureSceneAnalysis(p, { sourceIds: ['book'] }), /重新识别/);
});

test('通用归纳拒绝单类型依据；没有跨场景规律可明确返回空通用规则', async () => {
  const p = prepared(); await index(p);
  const input = captureSceneAnalysis(p, { sourceIds: ['book'], sceneTypes: ['dialogue', 'action'] });
  const j = job(p, input);
  await assert.rejects(executeStudio(j, async (role, prompt, payload) => {
    const r = styleReply(payload, payload.task.includes('共同支持'));
    if (r.rules[0].evidence) r.rules[0].evidence[1] = r.rules[0].evidence[0];
    return { content: JSON.stringify(r) };
  }, async () => {}), /两类|重复文字/);
  await executeStudio(j, async () => ({ content: JSON.stringify({ name: '无通用规律', overview: '仅保留专项', uncertainty: '缺少共同依据', rules: [], examples: [] }) }), async () => {});
  assert.equal(j.result.rules.length, 2);
});

test('专项不能只用相邻环境文字充当战斗证据', async () => {
  const p = prepared(); await index(p);
  const input = captureSceneAnalysis(p, { sourceIds: ['book'], sceneTypes: ['action'] });
  const j = job(p, input);
  await assert.rejects(executeStudio(j, async (role, prompt, payload) => {
    const result = styleReply(payload), sample = payload.sources[0];
    result.rules[0].quote = sample.body.slice(0, 12);
    assert.ok(!sample.focus.includes(result.rules[0].quote));
    return { content: JSON.stringify(result) };
  }, async () => {}), /场景段落/);
});

test('手动与自动场景选择均只向写作和文风核对传入相关规则', async () => {
  const p = prepared(); await index(p);
  const input = captureSceneAnalysis(p, { sourceIds: ['book'], sceneTypes: ['dialogue', 'action'] }); const analysis = job(p, input);
  await executeStudio(analysis, async (r, prompt, payload) => ({ content: JSON.stringify(styleReply(payload, payload.task.includes('共同支持'))) }), async () => {});
  p.studio.profiles = [{ ...analysis.result, id: 'profile', approved: true, version: 1 }];
  const task = sceneType => ({ profileId: 'profile', mode: 'rewrite', sourceKind: 'paste', text: '他拔出剑冲向门口，忽然停下了脚步。', sceneType, revise: false });
  assert.ok(captureWriting(p, task('action')).profile.rules.every(r => ['general', 'action'].includes(r.sceneType)));
  const writing = job(p, captureWriting(p, task('auto'))), requests = [];
  await executeStudio(writing, async (role, prompt, payload) => {
    requests.push({ role, payload });
    if (role === 'context') return { content: JSON.stringify({ selectedIds: [], missing: [], sceneTypes: ['action'] }) };
    if (role === 'writer') return { content: JSON.stringify({ text: '他拔出剑，停在门前。', notes: '', unresolved: [] }) };
    return { content: JSON.stringify({ status: 'pass', issues: [], notes: '' }) };
  }, async () => {});
  for (const r of requests.filter(r => ['writer', 'styleReview'].includes(r.role))) assert.ok(r.payload.profile.rules.every(x => ['general', 'action'].includes(x.sceneType)));
  assert.deepEqual(writing.result.profileSnapshot.appliedSceneTypes, ['action']);
  assert.ok(!JSON.stringify(selectProfileScenes(writing.input.profile, ['action'])).includes('dialogue-rule'));
});

test('重新识别不会覆盖识别期间保存的人工分类', async () => {
  const p = prepared(); await index(p);
  const input = captureSceneIndex(p, { sourceIds: ['book'] }), j = job(p, input);
  await executeStudio(j, async (role, prompt, payload) => ({ content: JSON.stringify({ paragraphs: payload.paragraphs.map(tag) }) }), async () => {});
  j.status = 'ready'; const queue = new StudioQueue('', () => p, () => null); queue.jobs = [j];
  p.studio.sceneIndexes[0].paragraphs[1].tags = ['psychology']; p.studio.sceneIndexes[0].version++;
  assert.throws(() => queue.collect(j.id, structuredClone(p)), /分类已被修改/);
});

test('索引领取、零请求复用、专项档案确认与场景写作通过真实本机路由串联', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'story-atlas-scenes-')), calls = [];
  const mock = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw), data = JSON.parse(payload.messages[1].content); calls.push(data);
    let result;
    if (data.paragraphs) result = { paragraphs: data.paragraphs.map(tag) };
    else if (data.sources) result = styleReply(data, data.task.includes('共同支持'));
    else if (data.pool) result = { selectedIds: [], missing: [], sceneTypes: ['action'] };
    else if (data.targetLength) result = { text: '他拔出剑，停在门前。', notes: '', unresolved: [] };
    else result = { status: 'pass', issues: [], notes: '' };
    // Continuity requests carry targetLength too; they are reviews, not writing.
    if (data.candidate) result = { status: 'pass', issues: [], notes: '' };
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  });
  let server, base;
  const request = async (url, method = 'GET', data) => { const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) }); const value = await r.json(); if (!r.ok) throw Error(value.error); return value; };
  const poll = async id => { const end = Date.now() + 5000; while (Date.now() < end) { const j = await request('/api/studio/jobs/' + id); if (!['queued', 'running'].includes(j.status)) { assert.equal(j.status, 'ready', j.error); return j; } await new Promise(r => setTimeout(r, 10)); } throw Error('场景任务超时'); };
  try {
    await new Promise(r => mock.listen(0, '127.0.0.1', r)); server = await createApp({ dataDir: dir }); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
    let p = await request('/api/project', 'PUT', prepared());
    await request('/api/ai/session', 'POST', { endpoint: `http://127.0.0.1:${mock.address().port}/v1`, model: 'scene-test' });
    const enqueue = extra => request('/api/studio/jobs', 'POST', { projectId: p.projectId, revision: p.revision, sourceIds: ['book'], ...extra });
    let j = await enqueue({ type: 'scene-index' }); await poll(j.id);
    p = (await request('/api/studio/jobs/' + j.id + '/collect', 'POST', { revision: p.revision })).project;
    assert.equal(p.studio.sceneIndexes.length, 1); const version = p.studio.sceneIndexes[0].version;
    j = await enqueue({ type: 'scene-index' }); assert.equal((await poll(j.id)).calls, 0);
    p = (await request('/api/studio/jobs/' + j.id + '/collect', 'POST', { revision: p.revision })).project;
    assert.equal(p.studio.sceneIndexes[0].version, version);
    j = await enqueue({ type: 'analysis', analysisMode: 'scenes', sceneTypes: ['dialogue', 'action'], profileName: '专项测试' }); await poll(j.id);
    p = (await request('/api/studio/jobs/' + j.id + '/collect', 'POST', { revision: p.revision })).project;
    assert.equal(p.studio.profiles[0].specialties.length, 2); p.studio.profiles[0].approved = true; p = await request('/api/project', 'PUT', p);
    j = await enqueue({ type: 'writing', profileId: p.studio.profiles[0].id, mode: 'rewrite', sourceKind: 'paste', text: '他握住剑柄，看向门外。风声渐渐停了。', sceneType: 'auto', revise: false });
    const ready = await poll(j.id); assert.deepEqual(ready.result.profileSnapshot.appliedSceneTypes, ['action']);
    p = (await request('/api/studio/jobs/' + j.id + '/collect', 'POST', { revision: p.revision })).project;
    assert.deepEqual(p.studio.drafts[0].profileSnapshot.appliedSceneTypes, ['action']); assert.equal(p.chapters.length, 5);
    assert.ok(calls.filter(c => c.targetLength && !c.candidate).every(c => c.profile.rules.every(r => r.sceneType !== 'dialogue')));
    assert.equal((await request('/api/studio')).sceneIndexes[0].outdated, false);
  } finally {
    if (server?.listening) { await request('/api/shutdown', 'POST', { confirm: true }); if (server.listening) await new Promise(r => server.once('close', r)); }
    if (mock.listening) { mock.closeAllConnections(); await new Promise(r => mock.close(r)); }
    assert.ok(path.relative(os.tmpdir(), dir).startsWith('story-atlas-scenes-')); await rm(dir, { recursive: true, force: true });
  }
});
