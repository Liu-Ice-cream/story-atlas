import { createHash } from 'node:crypto';
import { sceneDocument, parseSceneLabels, sceneSamples, SCENE_TYPES, SCENE_VERSION } from './public/scene-domain.js';
import { parseObject, parseStyleAnalysis, resolvedPrompts, PROMPT_VERSION } from './public/studio-domain.js';
const hash = text => createHash('sha256').update(text).digest('hex');
const manifest = sources => sources.map(s => ({ id: s.id, name: s.name, hash: hash(s.body) }));
function selected(p, data) {
  if (!Array.isArray(data.sourceIds) || !data.sourceIds.length || data.sourceIds.length > 12 || new Set(data.sourceIds).size !== data.sourceIds.length) throw new Error('请选择 1—12 份参考材料');
  const sources = p.studio.sources.filter(s => data.sourceIds.includes(s.id));
  if (sources.length !== data.sourceIds.length || sources.some(s => s.body.trim().length < 30)) throw new Error('参考材料不存在或过短');
  return sources;
}
export function indexStale(index, p) {
  const source = p.studio.sources.find(s => s.id === index.sourceId);
  return !source || index.sourceHash !== hash(source.body) || index.schemaVersion !== SCENE_VERSION;
}
export function captureSceneIndex(p, data) {
  const sources = selected(p, data), prompts = resolvedPrompts(p);
  const docs = sources.map(s => sceneDocument(s));
  if (docs.some(d => d.paragraphs.length > 50000)) throw new Error('单份材料超过 5 万段，请分卷建立索引');
  return { type: 'scene-index', sources: structuredClone(sources), sourceManifest: manifest(sources), priorIndexVersions: sources.map(s => ({ sourceId: s.id, version: p.studio.sceneIndexes.find(i => i.sourceId === s.id)?.version || 0 })), existingIndexes: structuredClone(p.studio.sceneIndexes.filter(i => sources.some(s => s.id === i.sourceId) && !indexStale(i, p))), totalBatches: docs.reduce((n, d) => n + d.batches.length, 0), prompts, promptVersion: PROMPT_VERSION, promptRevision: p.studio.promptRevision };
}
export function captureSceneAnalysis(p, data) {
  const sources = selected(p, data), indexes = sources.map(s => p.studio.sceneIndexes.find(i => i.sourceId === s.id));
  if (indexes.some(i => !i || indexStale(i, p))) throw new Error('场景索引不存在或原文已更新，请重新识别并保存');
  const sampling = sceneSamples(sources, indexes, data.sceneTypes, data.sampleBudget);
  if (!sampling.sampleLength) throw new Error('所选类型没有可用样本，请调整分类或选择其他类型');
  if (data.profileName != null && (typeof data.profileName !== 'string' || data.profileName.length > 200)) throw new Error('文风名称超过 200 字符');
  return { type: 'analysis', analysisMode: 'scenes', profileName: data.profileName?.trim() || '', sourceManifest: manifest(sources), indexManifest: indexes.map(i => ({ sourceId: i.sourceId, hash: hash(JSON.stringify(i)) })), sources: sampling.groups.flatMap(g => g.samples), groups: sampling.groups, sampling: { version: SCENE_VERSION, fullLength: sampling.fullLength, sampleLength: sampling.sampleLength, budget: sampling.budget, types: sampling.types }, prompts: resolvedPrompts(p), promptVersion: PROMPT_VERSION, promptRevision: p.studio.promptRevision };
}
export function indexesChanged(input, p) { return (input.indexManifest || []).some(m => hash(JSON.stringify(p.studio.sceneIndexes.find(i => i.sourceId === m.sourceId) || null)) !== m.hash); }

export async function executeSceneIndex(job, step, persist) {
  const input = job.input, indexes = [];
  for (const source of input.sources) {
    const saved = input.existingIndexes.find(i => i.sourceId === source.id && i.model === job.model && i.endpoint === job.endpoint && i.promptHash === hash(input.prompts.sceneIndex));
    if (saved) { indexes.push(saved); continue; }
    const doc = sceneDocument(source), labels = [];
    for (let i = 0; i < doc.batches.length; i++) {
      const batch = doc.batches[i];
      const payload = { task: '逐段识别写作内容类型，可多选。只返回每个段落的 id、tags、excluded。章首章末由程序定位，不在这里猜测。封面、目录、版权声明、广告标记 excluded。', tags: Object.keys(SCENE_TYPES).filter(t => !['opening', 'ending'].includes(t)), paragraphs: batch.map(p => ({ id: p.id, chapter: p.chapterTitle, text: p.text })), schema: '{"paragraphs":[{"id":"输入段落编号","tags":["dialogue|environment|action|psychology|narration"],"excluded":false}]}' };
      const cacheKey = hash(JSON.stringify({ payload, prompt: input.prompts.sceneIndex, model: job.model, endpoint: job.endpoint, version: SCENE_VERSION }));
      labels.push(...await step('index-' + source.id + '-' + i, 'sceneIndex', payload, text => ({ paragraphs: parseSceneLabels(parseObject(text), batch) }), cacheKey).then(r => r.paragraphs));
    }
    const byId = new Map(labels.map(p => [p.id, p]));
    indexes.push({ sourceId: source.id, sourceName: source.name, sourceHash: hash(source.body), schemaVersion: SCENE_VERSION, version: 1, model: job.model, endpoint: job.endpoint, promptHash: hash(input.prompts.sceneIndex), chapters: doc.chapters, recognizedChapters: doc.recognizedChapters, paragraphs: doc.paragraphs.map(({ text, ...p }) => ({ ...p, ...byId.get(p.id) })), createdAt: new Date().toISOString() });
  }
  job.result = { indexes }; await persist();
}

const styleSchema = '{name,overview,uncertainty,rules:[{category:"syntax|perspective|description|dialogue|rhythm|rhetoric|other",rule,sourceId,quote,evidence:[{sourceId,quote}]}],examples:[{sourceId,quote,scene}]}';
function focused(source, quote) {
  if (source.focusStart == null) return true;
  for (let at = source.body.indexOf(quote); at >= 0; at = source.body.indexOf(quote, at + 1)) if (Math.min(at + quote.length, source.focusEnd) - Math.max(at, source.focusStart) >= Math.min(8, quote.length)) return true;
  return false;
}
export function parseSpecialty(text, samples, type) {
  const raw = parseObject(text);
  if (type === 'general' && Array.isArray(raw.rules) && raw.rules.length === 0 && Array.isArray(raw.examples) && raw.examples.length === 0 && typeof raw.overview === 'string' && typeof raw.uncertainty === 'string') return { overview: raw.overview.slice(0, 10000), uncertainty: raw.uncertainty.slice(0, 4000), rules: [], examples: [] };
  const result = parseStyleAnalysis(raw, samples);
  for (const [i, item] of [...result.rules, ...result.examples].entries()) if (!focused(samples.find(s => s.id === item.sourceId), item.quote)) {
    const path = i < result.rules.length ? `规则 ${i + 1}` : `样例 ${i - result.rules.length + 1}`;
    throw Object.assign(new Error(`${path}：专项证据须包含标记的场景段落，不能只引用相邻上下文`), { diagnostic: { path, sourceId: item.sourceId, quote: item.quote, reason: '引用只在上下文中，没有覆盖该场景的核心原文' } });
  }
  const limit = type === 'general' ? 6 : 4;
  if (result.rules.length > limit || result.examples.length > (type === 'general' ? 2 : 1)) throw new Error(`本专项最多 ${limit} 条规则、${type === 'general' ? 2 : 1} 个样例，请缩减输出`);
  if (type === 'general') for (let i = 0; i < raw.rules.length; i++) {
    const evidence = raw.rules[i].evidence;
    if (!Array.isArray(evidence) || evidence.length < 2 || evidence.length > 4) throw new Error('通用规律每条须提供 2—4 条跨类型原文依据');
    const matched = evidence.map(e => { const s = samples.find(s => s.id === e.sourceId); if (!s || typeof e.quote !== 'string' || e.quote.trim().length < 8 || e.quote.length > 4000 || !s.body.includes(e.quote.trim()) || !focused(s, e.quote.trim())) throw new Error('通用规律证据无法匹配所选场景段落'); return { sourceId: s.originalSourceId, quote: e.quote.trim(), sampleStart: s.start + s.focusStart, sampleEnd: s.start + s.focusEnd, sceneType: s.sceneType }; });
    if (new Set(matched.map(e => e.sceneType)).size < 2) throw new Error('通用规律须有至少两类写作场景的支持');
    if (new Set(matched.map(e => e.sourceId + ':' + e.sampleStart + ':' + e.quote)).size < 2) throw new Error('通用规律不能用同一段重复文字充当跨场景依据');
    result.rules[i].evidence = matched;
  }
  for (const [i, rule] of result.rules.entries()) { rule.id = type + '-rule-' + (i + 1); rule.scope = type === 'general' ? 'general' : 'scene'; rule.sceneType = type; rule.scene = SCENE_TYPES[type] || '通用习惯'; }
  for (const item of [...result.rules, ...result.examples]) { const source = samples.find(s => s.id === item.sourceId); Object.assign(item, { sourceId: source.originalSourceId, sampleStart: source.start, sampleEnd: source.end, sceneType: type }); }
  return result;
}
export async function executeSceneAnalysis(job, step, persist) {
  const input = job.input, results = [], specialties = [];
  for (const group of input.groups) {
    if (!group.samples.length) { specialties.push({ type: group.type, status: 'missing', candidateCount: 0, sampleCount: 0, overview: '没有该类可用样本', ruleIds: [] }); continue; }
    const result = await step('specialty-' + group.type, 'style', { task: `只分析“${group.label}”的表达方法：动作与停顿、信息安排、句法、视角、修辞等；最多 4 条规则和 1 个样例。不要将这类写法概括为全书通用习惯。sourceId 逐字复制 sources[].id；quote 逐字复制该 source.body 中的连续文字，保留标点、空格、换行，不拼接或添加省略号。证据须包含 focus 场景段落，body 的其余文字只供理解上下文。忽略声明、目录、广告。`, sources: group.samples, sampleStatus: group.status, schema: styleSchema }, text => parseSpecialty(text, group.samples, group.type));
    results.push(result); specialties.push({ type: group.type, status: group.status, candidateCount: group.candidateCount, sampleCount: group.samples.length, overview: result.overview, uncertainty: result.uncertainty, ruleIds: result.rules.map(r => r.id) });
  }
  let general = { overview: '专项分析已完成；通用习惯需要跨类型材料支持。', rules: [], examples: [], uncertainty: '只有一类可用样本，未归纳跨场景通用规律。' };
  if (results.length >= 2) general = await step('scene-general', 'style', { task: '归纳多类样本共同支持的通用表达习惯，最多 6 条规则和 2 个样例。每条规则的 evidence 提供 2—4 条原文依据，须来自至少两种 sceneType；没有跨类型证据的写法留在专项中；没有共同支持的规律时，rules 和 examples 返回空数组并说明原因。sourceId 使用 sources[].id，证据须来自 focus 段落。', sources: input.sources, specialties: specialties.map(s => ({ type: s.type, overview: s.overview })), schema: styleSchema }, text => parseSpecialty(text, input.sources, 'general'));
  job.result = { name: input.profileName || '分场景文风档案', overview: general.overview, uncertainty: general.uncertainty, rules: [...general.rules, ...results.flatMap(r => r.rules)], examples: [...general.examples, ...results.flatMap(r => r.examples)], specialties };
  await persist();
}
