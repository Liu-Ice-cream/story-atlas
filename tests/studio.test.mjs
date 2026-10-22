import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server.mjs';
import { demoProject, validateProject } from '../public/domain.js';
import { AGENTS, parseStyleAnalysis, sentenceDiff, parseReview } from '../public/studio-domain.js';
import { captureWriting, digest, profileStale } from '../studio-engine.mjs';

const reference = '雨落在檐下。她没有抬头，只将那封信慢慢推回桌边。门外的人等了一会儿，也没有再问。';
function prepared() {
  const p = validateProject(demoProject());
  p.studio.sources = [{ id: 'ref-1', name: '参考文档', scene: '日常', body: reference }];
  const analysis = parseStyleAnalysis({ name: '克制叙述', overview: '通过动作呈现情绪', uncertainty: '样本较少', rules: [{ category: 'description', rule: '以细小动作传递情绪，不直接解释动机', scope: 'general', sourceId: 'ref-1', quote: '她没有抬头，只将那封信慢慢推回桌边。' }], examples: [{ sourceId: 'ref-1', scene: '日常', quote: reference }] }, p.studio.sources);
  p.studio.profiles = [{ ...analysis, id: 'profile-1', approved: true, version: 1, sourceManifest: [{ id: 'ref-1', hash: digest(reference) }] }];
  return p;
}
function task(p, extra = {}) {
  return { type: 'writing', projectId: p.projectId, revision: p.revision, mode: 'rewrite', sourceKind: 'chapter', chapterId: 'ch1', bodyHash: digest(p.chapters[0].body), start: 0, end: 24, characterIds: ['c1'], profileId: p.studio.profiles[0].id, instructions: '保留事件，只调整表达。', lockedFacts: '不得新增人物或改变旧伤。', length: 300, revise: false, ...extra };
}

test('文风规则必须有准确出处；参考资料独立，完整备份保留样例和 Prompt', () => {
  const p = prepared();
  p.studio.promptOverrides.writer = AGENTS.writer.prompt + '\n保持原段落数量'; p.studio.promptRevision = 1;
  const restored = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(restored.studio.profiles[0].examples[0].quote, reference);
  assert.equal(restored.characters.length, 5); assert.equal(restored.chapters.length, 5);
  assert.equal(profileStale(restored.studio.profiles[0], restored), false);
  restored.studio.sources[0].body += '后来。'; assert.equal(profileStale(restored.studio.profiles[0], restored), true);
  const bad = structuredClone(p.studio.profiles[0]); bad.rules[0].quote = '这是参考材料没有写过的句子。';
  assert.throws(() => parseStyleAnalysis(bad, p.studio.sources), /无法匹配/);
  assert.throws(() => parseReview({ status: 'issues', issues: [{ severity: 'blocking', quote: '不存在', message: '问题', suggestion: '建议', referenceIds: [] }] }, '候选稿', []), /定位/);
});

test('片段范围绑定正文版本，截止章节不泄漏未来设定，续写必须明确方向和停止位置', () => {
  const p = prepared();
  p.characters[0].states.push({ id: 'future', category: 'identity', label: '真实身份', value: '未来秘密', chapterId: 'ch5', kind: 'author', quote: '' });
  const input = captureWriting(p, task(p));
  assert.equal(input.original, p.chapters[0].body.slice(0, 24));
  assert.ok(input.pool.every(x => x.chapterId === 'ch1')); assert.ok(!JSON.stringify(input).includes('未来秘密'));
  assert.ok(!input.pool.some(x => x.text.includes('对外自称行商')), '同章较晚处的事实不可提前进入资料池');
  assert.throws(() => captureWriting(p, task(p, { bodyHash: 'old' })), /已改变/);
  assert.throws(() => captureWriting(p, task(p, { mode: 'continue', instructions: '', stopAt: '' })), /停止位置/);
  const continued = captureWriting(p, task(p, { mode: 'continue', start: 24, end: 24, instructions: '两人见面', stopAt: '交谈结束' }));
  assert.equal(continued.original, ''); assert.equal(continued.source.start, 24); assert.equal(continued.before, p.chapters[0].body.slice(0, 24));
});

test('中文句子对照保留全部字符，大段文本也能重建两份原文', () => {
  for (const [before, after] of [['雨停了。\n他回头。', '雨停了。\n她没有回头。'], ['', '新增正文！'], ['旧文', ''], ['甲。'.repeat(500), '乙。'.repeat(500)]]) {
    const diff = sentenceDiff(before, after);
    assert.equal(diff.filter(x => x.type !== 'add').map(x => x.text).join(''), before);
    assert.equal(diff.filter(x => x.type !== 'remove').map(x => x.text).join(''), after);
  }
});

async function fixture(handler) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'story-atlas-studio-'));
  const requests = [];
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw), data = JSON.parse(payload.messages[1].content);
    const role = Object.keys(AGENTS).find(key => payload.messages[0].content.includes('“' + AGENTS[key].name + '”任务'));
    requests.push({ role, payload, data });
    await handler({ role, payload, data, res, requests });
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  let server, base;
  const launch = async () => { server = await createApp({ dataDir: dir }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; };
  await launch();
  const request = async (url, method = 'GET', value) => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
  };
  const config = { endpoint: `http://127.0.0.1:${upstream.address().port}/v1`, model: 'one-model-for-all', apiKey: 'studio-test-secret-key' };
  const stop = async () => { if (server?.listening) { await request('/api/shutdown', 'POST', { confirm: true }); if (server.listening) await new Promise(resolve => server.once('close', resolve)); } };
  return { dir, request, requests, config, launch, stop, async poll(id, status) { const until = Date.now() + 5000; while (Date.now() < until) { const j = await request('/api/studio/jobs/' + id); if (status.includes(j.status)) return j; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('等待文风任务超时'); }, async close() { await stop(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); const rel = path.relative(path.resolve(os.tmpdir()), path.resolve(dir)); assert.ok(rel.startsWith('story-atlas-studio-') && !rel.includes(path.sep)); await rm(dir, { recursive: true, force: true }); } };
}
function reply(res, object) { if (res.destroyed) return; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(object) } }], usage: { prompt_tokens: 100, completion_tokens: 60 } })); }
const pass = { status: 'pass', issues: [], notes: '未发现具体问题' };
function simple({ role, data, res }) {
  if (role === 'style') return reply(res, { name: '动作与留白', overview: '用动作呈现情绪', uncertainty: '仅依据所选材料', rules: [{ category: 'description', rule: '用动作传达情绪', scope: 'general', scene: '', sourceId: data.sources[0].id, quote: '她没有抬头，只将那封信慢慢推回桌边。' }], examples: [{ sourceId: data.sources[0].id, quote: data.sources[0].body, scene: '日常' }] });
  if (role === 'context') return reply(res, { selectedIds: data.pool.map(x => x.id), missing: [] });
  if (role === 'writer') return reply(res, { text: data.candidate ? '沈舟推开门，手指停在门沿。' : '沈舟推开门，笑了笑。', notes: '候选表达', unresolved: [] });
  return reply(res, pass);
}

test('同一模型完成分析、资料准备、写作及并行情节文风审查，最多一轮修订且不改正文', async () => {
  let reviewCount = 0, releaseReviews, parallel = 0;
  const reviewGate = new Promise(resolve => { releaseReviews = resolve; });
  const f = await fixture(async input => {
    if (['continuity', 'styleReview'].includes(input.role) && !input.data.candidate.includes('手指')) {
      reviewCount++; if (reviewCount === 2) { parallel = reviewCount; releaseReviews(); } await reviewGate;
      if (input.role === 'styleReview') return reply(input.res, { status: 'issues', issues: [{ severity: 'suggestion', quote: '笑了笑', message: '情绪动作较泛化', suggestion: '用更具体动作呈现停顿', referenceIds: ['rule-1'] }], notes: '' });
    }
    simple(input);
  });
  try {
    let p = prepared(); p.studio.profiles = []; p.studio.promptOverrides.writer = AGENTS.writer.prompt + '\nCUSTOM_WRITER'; p.studio.promptRevision = 2;
    p = await f.request('/api/project', 'PUT', p); await f.request('/api/ai/session', 'POST', f.config);
    const analysis = await f.request('/api/studio/jobs', 'POST', { type: 'analysis', projectId: p.projectId, revision: p.revision, sourceIds: ['ref-1'], clientRequestId: 'analysis-once' });
    await f.poll(analysis.id, ['ready']);
    assert.equal((await f.request('/api/project')).studio.profiles.length, 0);
    let collected = await f.request(`/api/studio/jobs/${analysis.id}/collect`, 'POST', { revision: p.revision }); p = collected.project;
    assert.equal(p.studio.profiles[0].approved, false); p.studio.profiles[0].approved = true; p = await f.request('/api/project', 'PUT', p);
    const original = structuredClone(p);
    const data = task(p, { revise: true, clientRequestId: 'writing-once' });
    const job = await f.request('/api/studio/jobs', 'POST', data);
    const duplicate = await f.request('/api/studio/jobs', 'POST', data); assert.equal(job.id, duplicate.id);
    const ready = await f.poll(job.id, ['ready', 'failed']); assert.equal(ready.status, 'ready', ready.error);
    assert.equal(ready.calls, 7); assert.equal(ready.result.versions.length, 2); assert.equal(parallel, 2);
    assert.equal(ready.audit.promptRevision, 2); assert.ok(ready.input.prompts.writer.includes('CUSTOM_WRITER'));
    assert.ok(f.requests.every(x => x.payload.model === 'one-model-for-all'));
    assert.ok(!f.requests.find(x => x.role === 'context').payload.messages[1].content.includes(reference));
    collected = await f.request(`/api/studio/jobs/${job.id}/collect`, 'POST', { revision: p.revision }); p = collected.project;
    assert.equal(p.studio.drafts.length, 1); assert.equal(p.studio.drafts[0].versions[1].reviews.style.status, 'pass');
    assert.deepEqual(p.chapters, original.chapters); assert.deepEqual(p.characters, original.characters); assert.deepEqual(p.relationships, original.relationships);
    collected = await f.request(`/api/studio/jobs/${job.id}/collect`, 'POST', { revision: p.revision }); assert.equal(collected.project.studio.drafts.length, 1);
    for (const name of ['project.json', 'studio-jobs.json']) assert.ok(!(await readFile(path.join(f.dir, name), 'utf8')).includes(f.config.apiKey));
  } finally { releaseReviews(); await f.close(); }
});

test('审查失败保留初稿，只重试失败步骤，并可更新已领取的部分候选稿', async () => {
  let fail = true;
  const f = await fixture(async input => { if (input.role === 'styleReview' && fail) { input.res.writeHead(429); input.res.end(); } else simple(input); });
  try {
    let p = await f.request('/api/project', 'PUT', prepared()); await f.request('/api/ai/session', 'POST', f.config);
    const job = await f.request('/api/studio/jobs', 'POST', task(p));
    const failed = await f.poll(job.id, ['failed']); assert.equal(failed.result.versions.length, 1); assert.equal(failed.calls, 4);
    let collected = await f.request(`/api/studio/jobs/${job.id}/collect`, 'POST', { revision: p.revision }); p = collected.project; assert.equal(p.studio.drafts[0].incomplete, true); const draftId = p.studio.drafts[0].id;
    fail = false; await f.request(`/api/studio/jobs/${job.id}/retry`, 'POST', {});
    const ready = await f.poll(job.id, ['ready']); assert.equal(ready.calls, 5);
    assert.equal(f.requests.filter(x => x.role === 'writer').length, 1); assert.equal(f.requests.filter(x => x.role === 'continuity').length, 1);
    collected = await f.request(`/api/studio/jobs/${job.id}/collect`, 'POST', { revision: p.revision });
    assert.equal(collected.project.studio.drafts.length, 1); assert.equal(collected.project.studio.drafts[0].id, draftId); assert.equal(collected.project.studio.drafts[0].incomplete, false);
  } finally { await f.close(); }
});

test('生成期间原文变化，结果保留可看但不能领取为当前候选稿', async () => {
  let release, started; const startedPromise = new Promise(resolve => { started = resolve; }); const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(async input => { if (input.role === 'writer') { started(); await gate; } simple(input); });
  try {
    let p = await f.request('/api/project', 'PUT', prepared()); await f.request('/api/ai/session', 'POST', f.config);
    const job = await f.request('/api/studio/jobs', 'POST', task(p)); await startedPromise;
    p.chapters[0].body += '\n作者更新原文。'; p = await f.request('/api/project', 'PUT', p); release();
    const outdated = await f.poll(job.id, ['outdated']); assert.ok(outdated.result.versions[0].text);
    await assert.rejects(f.request(`/api/studio/jobs/${job.id}/collect`, 'POST', { revision: p.revision }), /已改变/);
    assert.equal((await f.request('/api/project')).studio.drafts.length, 0);
  } finally { release(); await f.close(); }
});

test('服务重启后需重新配置密钥，手动继续时不重复已完成的资料步骤', async () => {
  let release, started; const began = new Promise(resolve => { started = resolve; }); const gate = new Promise(resolve => { release = resolve; }); let hold = true;
  const f = await fixture(async input => { if (input.role === 'writer' && hold) { started(); await gate; } simple(input); });
  try {
    const p = await f.request('/api/project', 'PUT', prepared()); await f.request('/api/ai/session', 'POST', f.config);
    const job = await f.request('/api/studio/jobs', 'POST', task(p)); await began;
    await f.stop(); hold = false; release(); await f.launch();
    const stopped = await f.request('/api/studio'); assert.equal(stopped.configured, false);
    await assert.rejects(f.request(`/api/studio/jobs/${job.id}/retry`, 'POST', {}), /配置/);
    await f.request('/api/ai/session', 'POST', f.config); await f.request(`/api/studio/jobs/${job.id}/retry`, 'POST', {});
    const ready = await f.poll(job.id, ['ready']); assert.equal(ready.status, 'ready'); assert.equal(f.requests.filter(x => x.role === 'context').length, 1);
  } finally { release(); await f.close(); }
});

test('排队任务可以停止；正在处理的任务停止后不再启动审查请求', async () => {
  let release, started; const began = new Promise(resolve => { started = resolve; }); const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(async input => { if (input.role === 'writer') { started(); await gate; } simple(input); });
  try {
    const p = await f.request('/api/project', 'PUT', prepared()); await f.request('/api/ai/session', 'POST', f.config);
    const first = await f.request('/api/studio/jobs', 'POST', task(p)); await began;
    const second = await f.request('/api/studio/jobs', 'POST', task(p));
    await f.request(`/api/studio/jobs/${second.id}/cancel`, 'POST', {});
    await f.request(`/api/studio/jobs/${first.id}/cancel`, 'POST', {}); release();
    const stopped = await f.poll(first.id, ['cancelled']); assert.ok(stopped.error.includes('停止'));
    assert.equal((await f.request('/api/studio/jobs/' + second.id)).calls, 0);
    assert.equal(f.requests.filter(x => ['continuity', 'styleReview'].includes(x.role)).length, 0);
  } finally { release(); await f.close(); }
});
