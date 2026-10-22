import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject, contextMarkdown, mergeChapters, removeEntity, applySuggestions } from '../public/domain.js';
import { characterTimeline, chapterProgress, invalidateChapterReferences, reviewItems, acknowledgeReview } from '../public/maintenance.js';
import { mkdtemp, writeFile, readFile, mkdir, unlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server.mjs';

function timelineProject() {
  const p = demoProject();
  p.characters[0].states = [
    { id: 's1', category: 'condition', label: '左手旧伤', value: '握伞发颤', chapterId: 'ch1', kind: 'canon', quote: '他左手虎口有一道旧伤，握伞时微微发颤。' },
    { id: 's2', category: 'condition', label: '左手旧伤', value: '拔剑受到影响', chapterId: 'ch5', kind: 'canon', quote: '旧伤骤痛，剑只拔出半寸。' },
    { id: 's3', category: 'knowledge', label: '对白鹭的了解', value: '获知妹妹曾用此名，尚需核实', chapterId: 'ch3', kind: 'author', quote: '' }
  ];
  return validateProject(p);
}

test('人物时间线按章节回看，同名状态沿用最新变化，前文不显示未来状态', () => {
  const p = timelineProject();
  const before = characterTimeline(p, 'c1', 'ch2');
  assert.equal(before.current.length, 1); assert.equal(before.current[0].value, '握伞发颤');
  assert.ok(before.events.every(e => e.chapterId === 'ch1' || e.chapterId === 'ch2'));
  const after = characterTimeline(p, 'c1');
  assert.equal(after.current.find(s => s.label === '左手旧伤').value, '拔剑受到影响');
  assert.equal(after.current.find(s => s.category === 'knowledge').kind, 'author');
  assert.ok(after.events.some(e => e.type === 'relationship'));
  assert.throws(() => characterTimeline(p, 'c1', 'missing'), /截止/);
  const output = contextMarkdown(p, { cutoffId: 'ch2' });
  assert.ok(output.includes('身体状况 / 左手旧伤：握伞发颤')); assert.ok(!output.includes('拔剑受到影响'));
  const restored = validateProject(JSON.parse(JSON.stringify(p))); assert.equal(restored.characters[0].states.length, 3);
  const removed = removeEntity(p, 'chapters', 'ch1'); validateProject(removed);
  assert.equal(removed.characters[0].states[0].chapterId, ''); assert.equal(removed.characters[0].states[0].needsReview, true);
});

test('正文变更统一标记人物、状态、关系、支线、灵感、摘要和待确认建议，复核需匹配新版出处', () => {
  const p = timelineProject();
  p.ideas[0].chapterId = 'ch1'; p.threads[0].chapterId = 'ch1'; p.relationships[0].chapterId = 'ch1';
  p.review = [{ id: 'review1', type: 'summary', text: '旧摘要', chapterId: 'ch1', quote: '沈舟' }];
  const next = mergeChapters(p, [{ filename: '01.md', body: p.chapters[0].body + '\n新增一句正文。' }]).project;
  assert.equal(next.chapters[0].status, 'changed'); assert.equal(next.chapters[0].summaryNeedsReview, true);
  assert.equal(next.review[0].needsReview, true);
  for (const type of ['fact', 'state', 'relationships', 'threads', 'ideas', 'summary']) assert.ok(reviewItems(next).some(x => x.type === type));
  const fact = reviewItems(next).find(x => x.type === 'fact'); acknowledgeReview(next, fact);
  assert.equal(next.characters[0].facts.find(f => f.id === fact.id).needsReview, false);
  const broken = reviewItems(next).find(x => x.type === 'state');
  next.chapters[0].body = '原文已完全替换。';
  assert.throws(() => acknowledgeReview(next, broken), /不匹配/);
  const unchanged = structuredClone(p); invalidateChapterReferences(p, unchanged);
  assert.ok(!unchanged.characters[0].facts[0].needsReview);
});

test('整理进度区分已有人工资料、AI 提取、待确认和核对完成', () => {
  const p = timelineProject(); p.chapters[0].status = 'unprocessed';
  let result = chapterProgress(p, 'ch1'); assert.ok(result.records > 0); assert.equal(result.extraction, '未记录 AI 提取'); assert.equal(result.reviewed, false);
  p.review = [{ type: 'summary', chapterId: 'ch1' }];
  result = chapterProgress(p, 'ch1'); assert.equal(result.pending, 1); assert.equal(result.extraction, '已提取（导入记录）');
  p.review = []; p.chapters[0].status = 'done'; assert.equal(chapterProgress(p, 'ch1').reviewed, true);
  p.characters[0].facts[0].needsReview = true; assert.equal(chapterProgress(p, 'ch1').reviewed, false);
  result = chapterProgress(p, 'ch1', [{ chapterId: 'ch1', status: 'failed', outdated: false }]); assert.equal(result.extraction, '提取失败');
});

test('持续推进的支线保留历史出处，回改较早章节也会要求复核', () => {
  let p = demoProject();
  p = applySuggestions(p, [{ type: 'thread', title: '寻找失踪的沈月', characters: ['沈舟'], text: '在灰烬中发现白鹭线索', chapterId: 'ch5', quote: '沈舟在灰烬里找到半张运货单，收货人一栏写着“白鹭”。' }]);
  const thread = p.threads.find(t => t.title === '寻找失踪的沈月');
  assert.deepEqual(thread.sourceChapterIds, ['ch3', 'ch5']);
  const next = mergeChapters(p, [{ filename: '03.md', body: p.chapters[2].body + '\n更新了线索。' }]).project;
  const entry = reviewItems(next).find(x => x.id === thread.id);
  assert.equal(entry.chapterId, 'ch3'); assert.ok(entry.relatedChapterIds.includes('ch5'));
  assert.ok(chapterProgress(next, 'ch3').stale > 0); assert.ok(chapterProgress(next, 'ch5').stale > 0);
  validateProject(removeEntity(next, 'chapters', 'ch3'));
});

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'story-atlas-maintenance-'));
  const source = path.join(dir, 'chapters'); await mkdir(source);
  const server = await createApp({ dataDir: path.join(dir, 'data') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, method = 'GET', value) => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
  };
  return { dir, source, request, async close() {
    await request('/api/shutdown', 'POST', { confirm: true });
    if (server.listening) await new Promise(resolve => server.once('close', resolve));
    const rel = path.relative(path.resolve(os.tmpdir()), path.resolve(dir));
    assert.ok(rel.startsWith('story-atlas-maintenance-') && !rel.includes(path.sep)); await rm(dir, { recursive: true, force: true });
  } };
}

test('目录检查只预览，勾选后导入且不改源文件，更新保留标题并联动复核，缺失文件不删除正文', async () => {
  const f = await fixture();
  try {
    let p = timelineProject(); p = await f.request('/api/project', 'PUT', p);
    const original = p.chapters[0].body + '\n新增一行。';
    await writeFile(path.join(f.source, '01.md'), original, 'utf8');
    await writeFile(path.join(f.source, '06.txt'), '第六章 · 新章\n新正文。', 'utf8');
    await f.request('/api/source', 'POST', { projectId: p.projectId, directory: f.source });
    let scan = await f.request('/api/source/check'); assert.equal(scan.entries.length, 2);
    assert.equal((await f.request('/api/project')).chapters.length, 5);
    const updated = scan.entries.find(e => e.status === 'changed'); const added = scan.entries.find(e => e.status === 'new');
    let result = await f.request('/api/source/import', 'POST', { revision: p.revision, scanId: scan.scanId, tokens: [updated.token, added.token], volume: '第二卷' }); p = result.project;
    assert.equal(p.chapters.length, 6); assert.equal(p.chapters[0].title, '第一章 · 雾中来客'); assert.equal(p.chapters[0].volume, '第一卷 · 渡口');
    assert.equal(p.chapters.at(-1).volume, '第二卷'); assert.equal(p.characters[0].facts[0].needsReview, true);
    assert.equal(await readFile(path.join(f.source, '01.md'), 'utf8'), original);
    scan = await f.request('/api/source/check'); assert.ok(scan.entries.every(e => e.status === 'unchanged'));
    await unlink(path.join(f.source, '01.md'));
    scan = await f.request('/api/source/check'); assert.ok(scan.entries.some(e => e.status === 'missing')); assert.equal((await f.request('/api/project')).chapters.length, 6);
    const snapshots = await f.request('/api/snapshots'); assert.ok(snapshots.some(s => s.reason === '目录导入前保护'));
    const fact = reviewItems(p).find(x => x.type === 'fact');
    p = await f.request('/api/maintenance/review', 'POST', { ...fact, revision: p.revision }); assert.ok(!p.characters[0].facts.find(x => x.id === fact.id).needsReview);
  } finally { await f.close(); }
});

test('目录预览后再次修改文件、过期版本与同名冲突均阻止错误覆盖', async () => {
  const f = await fixture();
  try {
    let p = await f.request('/api/project');
    await writeFile(path.join(f.source, '01.md'), '第一版正文', 'utf8');
    await f.request('/api/source', 'POST', { projectId: p.projectId, directory: f.source });
    let scan = await f.request('/api/source/check');
    await writeFile(path.join(f.source, '01.md'), '检查后又改了', 'utf8');
    await assert.rejects(f.request('/api/source/import', 'POST', { revision: p.revision, scanId: scan.scanId, tokens: [scan.entries[0].token] }), /又有修改/);
    scan = await f.request('/api/source/check'); p.note = '同时发生的编辑'; p = await f.request('/api/project', 'PUT', p);
    await assert.rejects(f.request('/api/source/import', 'POST', { revision: p.revision, scanId: scan.scanId, tokens: [scan.entries[0].token] }), /已变化/);
    const original = demoProject(); original.revision = p.revision; p = await f.request('/api/project', 'PUT', original);
    await mkdir(path.join(f.source, '卷二')); await writeFile(path.join(f.source, '卷二', '01.md'), '同名文件', 'utf8');
    await f.request('/api/source', 'POST', { projectId: p.projectId, directory: f.source, recursive: true });
    scan = await f.request('/api/source/check'); assert.equal(scan.entries.filter(e => e.status === 'conflict').length, 2);
    assert.equal((await f.request('/api/project')).chapters[0].body, original.chapters[0].body);
  } finally { await f.close(); }
});

test('快照恢复保持单调版本，先保护当前资料，暂停 AI，快照编号不能穿越目录', async () => {
  const f = await fixture();
  try {
    let p = timelineProject(); p = await f.request('/api/project', 'PUT', p);
    const saved = await f.request('/api/snapshots', 'POST', {});
    p.note = '需要保留的恢复前笔记'; p = await f.request('/api/project', 'PUT', p);
    const revision = p.revision;
    await assert.rejects(f.request('/api/snapshots/restore', 'POST', { id: '../project', revision }), /编号/);
    const result = await f.request('/api/snapshots/restore', 'POST', { id: saved.id, revision });
    assert.equal(result.project.note, demoProject().note); assert.equal(result.project.revision, revision + 1);
    assert.equal(result.project.characters[0].states.length, 3); assert.equal(result.queue.paused, true); assert.equal(result.queue.configured, false);
    const snapshots = await f.request('/api/snapshots'); assert.ok(snapshots.some(s => s.reason === '恢复快照前保护'));
    await assert.rejects(f.request('/api/snapshots/restore', 'POST', { id: saved.id, revision }), /已更新/);
  } finally { await f.close(); }
});

test('旧备份补全的作品编号会落盘，重启后仍可找到原来的日期快照', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'story-atlas-maintenance-'));
  let server;
  try {
    const p = demoProject(); delete p.projectId; await writeFile(path.join(dir, 'project.json'), JSON.stringify(p));
    server = await createApp({ dataDir: dir });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const first = await (await fetch(`http://127.0.0.1:${server.address().port}/api/project`)).json();
    await new Promise(resolve => server.close(resolve));
    server = await createApp({ dataDir: dir }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const second = await (await fetch(base + '/api/project')).json();
    assert.equal(first.projectId, second.projectId); assert.equal(second.chapters.length, 5);
    const snapshots = await (await fetch(base + '/api/snapshots')).json(); assert.equal(snapshots.length, 1);
  } finally {
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    const rel = path.relative(path.resolve(os.tmpdir()), path.resolve(dir)); assert.ok(rel.startsWith('story-atlas-maintenance-') && !rel.includes(path.sep)); await rm(dir, { recursive: true, force: true });
  }
});
