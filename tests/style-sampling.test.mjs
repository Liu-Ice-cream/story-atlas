import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisSamples, SOURCE_MAX_CHARS } from '../public/style-sampling.js';
import { demoProject, validateProject } from '../public/domain.js';
import { captureAnalysis, captureWriting, jobOutdated, digest, executeStudio } from '../studio-engine.mjs';

const longText = Array.from({ length: 15000 }, (_, i) => `第${i}段。她收起伞，沿着街道慢慢走。😀\n\n`).join('');
const source = (id, body) => ({ id, name: id + '.txt', body, scene: '' });

test('整本参考书可保存；抽样覆盖前中后，字符上限、原文位置与 Emoji 完整', () => {
  assert.ok(longText.length > 200000);
  const p = validateProject(demoProject()); p.studio.sources = [source('book', longText)]; validateProject(p);
  const plan = analysisSamples(p.studio.sources);
  assert.ok(plan.sampleLength <= 40000 && plan.sampleLength > 38000);
  const sample = plan.samples[0]; assert.equal(sample.parts.length, 5);
  assert.equal(sample.ranges[0].start, 0); assert.equal(sample.ranges.at(-1).end, longText.trimEnd().length);
  let previous = 0;
  for (const part of sample.parts) {
    assert.ok(part.start >= previous); previous = part.end;
    assert.equal(part.body, longText.slice(part.start, part.end));
    assert.ok(!/^[\uDC00-\uDFFF]/.test(part.body)); assert.ok(!/[\uD800-\uDBFF]$/.test(part.body));
  }
  const input = captureAnalysis(p, { sourceIds: ['book'] });
  assert.equal(input.sampling.sampleLength, plan.sampleLength);
  assert.ok(!input.sources.some(s => s.body === longText));
  assert.equal(jobOutdated({ projectId: p.projectId, input }, p), false);
  p.studio.sources[0].body += '后加文字'; assert.equal(jobOutdated({ projectId: p.projectId, input }, p), true);
});

test('短材料完整分析，多个长文档公平分配；异常预算和过大文档被拦截', () => {
  const short = '短参考材料。'.repeat(10);
  const plan = analysisSamples([source('short', short), source('a', longText), source('b', longText)], { budget: 20000 });
  assert.equal(plan.samples[0].parts[0].body, short);
  assert.equal(plan.samples[0].sampled, false); assert.ok(plan.sampleLength <= 20000);
  assert.equal(plan.samples[1].parts.reduce((n, s) => n + s.body.length, 0), plan.samples[2].parts.reduce((n, s) => n + s.body.length, 0));
  assert.throws(() => analysisSamples([]), /请选择/);
  assert.throws(() => analysisSamples([source('a', longText)], { budget: 65001 }), /总量/);
  assert.throws(() => analysisSamples([source('a', '字'.repeat(SOURCE_MAX_CHARS + 1))]), /200 万/);
});

test('分析只接受已发送样本内的证据，并将原始文档出处保留在规则中', async () => {
  const p = validateProject(demoProject()); p.studio.sources = [source('book', longText)];
  const input = captureAnalysis(p, { sourceIds: ['book'], profileName: '我的动作文风' });
  const first = input.sources[0], quote = first.body.slice(0, 20);
  const response = evidence => ({ content: JSON.stringify({ name: '模型命名', overview: '通过动作叙述', rules: [{ category: 'description', rule: '用动作呈现情绪', sourceId: first.id, quote: evidence }], examples: [{ sourceId: first.id, quote: evidence }] }) });
  const job = { input, steps: {} };
  await executeStudio(job, async () => response(quote), async () => {});
  assert.equal(job.result.name, '我的动作文风'); assert.equal(job.result.rules[0].sourceId, 'book');
  assert.equal(job.result.rules[0].sampleStart, first.start);
  const unsent = longText.slice(50000, 50040); assert.ok(!first.body.includes(unsent));
  await assert.rejects(executeStudio({ input, steps: {} }, async () => response(unsent), async () => {}), /无法匹配/);
});

test('不同片段仅带入本次选择的文风与参考程度，不混用其他档案', () => {
  const p = validateProject(demoProject());
  const profile = id => ({ id, name: id, approved: true, version: 1, overview: id + '专用规则', rules: [{ id: 'r1', category: 'syntax', rule: id + '写法', weight: 'keep' }], examples: [{ quote: id + '样例', enabled: true }] });
  p.studio.profiles = [profile('日常对白'), profile('悬疑动作')];
  const task = profileId => ({ mode: 'rewrite', profileId, sourceKind: 'chapter', chapterId: p.chapters[0].id, start: 0, end: 20, bodyHash: digest(p.chapters[0].body), referenceLevel: 'strong' });
  const a = captureWriting(p, task('日常对白')), b = captureWriting(p, task('悬疑动作'));
  assert.equal(a.profile.name, '日常对白'); assert.equal(b.profile.name, '悬疑动作');
  assert.equal(b.referenceLevel, 'strong'); assert.ok(!JSON.stringify(b.profile).includes('日常对白'));
  assert.throws(() => captureWriting(p, { ...task('悬疑动作'), referenceLevel: 'random' }), /参考程度/);
});
