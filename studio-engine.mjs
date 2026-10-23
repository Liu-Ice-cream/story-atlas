import { createHash } from 'node:crypto';
import { AGENTS, PROMPT_VERSION, resolvedPrompts, parseStyleAnalysis, parseObject, parseReview, profileForGeneration } from './public/studio-domain.js';
import { characterTimeline } from './public/maintenance.js';
import { sortChapters } from './public/domain.js';
import { analysisSamples, SAMPLING_VERSION } from './public/style-sampling.js';
import { selectProfileScenes } from './public/scene-domain.js';
import { captureSceneAnalysis, indexesChanged, executeSceneIndex, executeSceneAnalysis } from './scene-engine.mjs';

export const digest = text => createHash('sha256').update(text).digest('hex');
export const profileStale = (profile, p) => (profile.sourceManifest || []).some(s => digest(p.studio.sources.find(x => x.id === s.id)?.body || '') !== s.hash) || indexesChanged(profile, p);
export function captureAnalysis(p, data) {
  if (data.analysisMode === 'scenes') return captureSceneAnalysis(p, data);
  if (!Array.isArray(data.sourceIds) || !data.sourceIds.length) throw new Error('请选择参考文档');
  const sources = p.studio.sources.filter(s => data.sourceIds.includes(s.id));
  if (sources.length !== new Set(data.sourceIds).size || sources.length > 12) throw new Error('参考材料选择无效，一次最多 12 份');
  if (data.samplingVersion != null && data.samplingVersion !== SAMPLING_VERSION) throw new Error('抽样规则已更新，请重新预览');
  const sampling = analysisSamples(sources, data.sampleBudget == null ? {} : { budget: data.sampleBudget });
  if (data.profileName != null && (typeof data.profileName !== 'string' || data.profileName.length > 200)) throw new Error('文风档案名称须在 200 字符以内');
  const manifest = sources.map(s => ({ id: s.id, name: s.name, hash: digest(s.body), fullLength: s.body.length }));
  return { type: 'analysis', profileName: data.profileName?.trim() || '', sources: sampling.samples.flatMap(s => s.parts), sourceManifest: manifest, sampling: { version: sampling.version, budget: sampling.budget, fullLength: sampling.fullLength, sampleLength: sampling.sampleLength, sources: sampling.samples.map(({ parts, ...s }) => s) }, promptVersion: PROMPT_VERSION, promptRevision: p.studio.promptRevision, prompts: resolvedPrompts(p) };
}
export function captureWriting(p, data) {
  if (!['rewrite', 'continue'].includes(data.mode)) throw new Error('请选择改写或续写');
  const profile = profileForGeneration(p.studio.profiles.find(x => x.id === data.profileId), data.sceneType || 'auto');
  if (data.referenceLevel != null && !['light', 'strong'].includes(data.referenceLevel)) throw new Error('请选择有效的文风参考程度');
  const length = Number(data.length || 600);
  if (!Number.isInteger(length) || length < 100 || length > 3000) throw new Error('目标篇幅须为 100—3000 字');
  for (const key of ['instructions', 'lockedFacts', 'stopAt']) if (typeof (data[key] || '') !== 'string' || (data[key] || '').length > 6000) throw new Error('写作要求格式无效或过长');
  if (data.mode === 'continue' && (!(data.instructions || '').trim() || !(data.stopAt || '').trim())) throw new Error('续写需要提供事件方向和停止位置');
  const selected = Array.isArray(data.characterIds) ? data.characterIds : [];
  if (selected.length > 12 || selected.some(id => !p.characters.some(c => c.id === id))) throw new Error('关联人物无效，一次最多 12 人');
  let source, original, before = '', after = '', cutoff;
  if (data.sourceKind === 'chapter') {
    const ch = p.chapters.find(c => c.id === data.chapterId);
    if (!ch || typeof data.bodyHash !== 'string' || digest(ch.body) !== data.bodyHash) throw new Error('章节正文已改变，请重新选择片段');
    const { start, end } = data;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > ch.body.length || end - start > 12000) throw new Error('正文选择范围无效，最多 1.2 万字符');
    if (data.mode === 'rewrite' && start === end) throw new Error('请先选择需要改写的正文');
    const point = data.mode === 'continue' ? end : start;
    if (data.mode === 'continue' && point < 10) throw new Error('请将续写位置放在已有正文之后');
    original = data.mode === 'rewrite' ? ch.body.slice(start, end) : '';
    before = ch.body.slice(Math.max(0, point - 3000), point);
    after = data.mode === 'rewrite' ? ch.body.slice(end, end + 1500) : '';
    source = { kind: 'chapter', chapterId: ch.id, title: ch.title, filename: ch.filename, bodyHash: digest(ch.body), start: data.mode === 'continue' ? end : start, end, original };
    cutoff = ch;
  } else if (data.sourceKind === 'paste') {
    if (typeof data.text !== 'string' || data.text.trim().length < 10 || data.text.length > 12000) throw new Error('请粘贴 10—12000 字符的完整片段');
    original = data.mode === 'rewrite' ? data.text : '';
    before = data.mode === 'continue' ? data.text : '';
    source = { kind: 'paste', title: '粘贴片段', original, preceding: before };
    cutoff = data.cutoffId ? p.chapters.find(c => c.id === data.cutoffId) : sortChapters(p.chapters).at(-1);
    if (data.cutoffId && !cutoff) throw new Error('截止章节不存在');
  } else throw new Error('请选择正文来源');
  const allowedChapters = new Set(sortChapters(p.chapters).filter(ch => cutoff && ch.order <= cutoff.order).map(ch => ch.id));
  const inScope = entry => {
    if (!allowedChapters.has(entry.chapterId)) return false;
    if (source.kind !== 'chapter' || entry.chapterId !== source.chapterId) return true;
    const quote = entry.quote?.trim(), body = p.chapters.find(c => c.id === source.chapterId).body;
    const index = quote ? body.indexOf(quote) : -1;
    return index >= 0 && index + quote.length <= source.end;
  };
  const text = original + before + after + (data.instructions || '');
  const characters = p.characters.filter(c => selected.length ? selected.includes(c.id) : [c.name, ...c.aliases].some(n => n && text.includes(n))).slice(0, 12);
  const pool = [];
  for (const character of characters) {
    for (const fact of character.facts.filter(f => f.kind === 'canon' && inScope(f) && !f.needsReview).slice(-10)) pool.push({ id: 'fact:' + character.id + ':' + fact.id, person: character.name, kind: 'canon', text: fact.text.slice(0, 1800), chapterId: fact.chapterId, quote: (fact.quote || '').slice(0, 1800) });
    const temporal = { ...p, characters: [{ ...character, states: (character.states || []).filter(inScope) }] };
    for (const s of characterTimeline(temporal, character.id, cutoff?.id).current.filter(s => !s.needsReview)) pool.push({ id: 'state:' + character.id + ':' + s.id, person: character.name, kind: s.kind, text: s.label + '：' + s.value.slice(0, 1800), chapterId: s.chapterId, quote: (s.quote || '').slice(0, 1800) });
  }
  for (const r of p.relationships.filter(r => !r.needsReview && inScope(r) && characters.some(c => c.id === r.fromId || c.id === r.toId)).slice(-20)) pool.push({ id: 'relation:' + r.id, kind: 'canon', text: `${p.characters.find(c => c.id === r.fromId).name} → ${p.characters.find(c => c.id === r.toId).name}：${r.name}；${r.description || ''}`.slice(0, 2000), chapterId: r.chapterId, quote: (r.quote || '').slice(0, 1500) });
  // Hard cap keeps a long novel's context bounded; author-locked facts are always included separately.
  const bounded = []; let chars = 0;
  for (const entry of pool) { const size = JSON.stringify(entry).length; if (chars + size > 36000) break; bounded.push(entry); chars += size; }
  return { type: 'writing', mode: data.mode, sceneType: data.sceneType || 'auto', profile, original, before, after, source, cutoffTitle: cutoff?.title || '无作品资料', pool: bounded, characterNames: characters.map(c => c.name), instructions: (data.instructions || '').trim(), lockedFacts: (data.lockedFacts || '').trim(), stopAt: (data.stopAt || '').trim(), length, referenceLevel: data.referenceLevel || 'light', intensity: ['light', 'medium', 'strong'].includes(data.intensity) ? data.intensity : 'light', revise: data.revise !== false, promptVersion: PROMPT_VERSION, promptRevision: p.studio.promptRevision, prompts: resolvedPrompts(p) };
}
export function jobOutdated(job, p) {
  if (p.projectId !== job.projectId) return true;
  if (['analysis', 'scene-index'].includes(job.input.type)) return (job.input.sourceManifest || job.input.sources.map(s => ({ id: s.id, hash: digest(s.body) }))).some(s => digest(p.studio.sources.find(x => x.id === s.id)?.body || '') !== s.hash) || indexesChanged(job.input, p);
  return job.input.source.kind === 'chapter' && digest(p.chapters.find(c => c.id === job.input.source.chapterId)?.body || '') !== job.input.source.bodyHash;
}
export function styleCopyWarnings(text, input) {
  const warnings = [];
  for (const example of input.profile?.examples || []) {
    for (let i = 0; i + 45 <= example.quote.length; i += 20) {
      const part = example.quote.slice(i, i + 45);
      if (text.includes(part) && !((input.original || '') + (input.before || '')).includes(part)) { warnings.push('候选稿与文风样例有较长连续重合，请核对是否需要保留。'); return warnings; }
    }
  }
  return warnings;
}
const writingSchema = '只返回 {"text":"完整候选正文","notes":"简短说明","unresolved":["需作者决定的问题"]}。';
const reviewSchema = '只返回 {"status":"pass|issues|uncertain","issues":[{"severity":"blocking|suggestion|uncertain","quote":"候选稿连续原文或空字符串","message":"问题","suggestion":"局部建议","referenceIds":["依据编号"]}],"notes":"简短说明"}。';
export async function executeStudio(job, call, persist, reuseStep = () => null) {
  const input = job.input;
  const step = async (id, role, payload, parse, cacheKey) => {
    if (job.steps[id]?.status === 'done') return job.steps[id].result;
    const cached = cacheKey && reuseStep(cacheKey);
    if (cached) { const result = parse(JSON.stringify(cached.result)); job.steps[id] = { role, status: 'done', attempts: 0, result, reused: true, cacheKey }; await persist(); return result; }
    const saved = job.steps[id] || { attempts: 0 };
    if (saved.attempts >= 3) throw new Error('此步骤已尝试三次，请检查接口或提示词后新建任务');
    job.steps[id] = { ...saved, role, status: 'running', attempts: saved.attempts + 1, startedAt: new Date().toISOString(), error: '', ...(cacheKey ? { cacheKey } : {}) };
    job.currentStep = id; await persist();
    try {
      const result = await call(role, input.prompts[role], payload);
      const parsed = parse(result.content);
      job.steps[id] = { ...job.steps[id], status: 'done', result: parsed, usage: result.usage, completedAt: new Date().toISOString() };
      await persist(); return parsed;
    } catch (error) { job.steps[id].status = 'failed'; job.steps[id].error = error.message; await persist(); throw error; }
  };
  if (input.type === 'scene-index') return executeSceneIndex(job, step, persist);
  if (input.analysisMode === 'scenes') return executeSceneAnalysis(job, step, persist);
  if (input.type === 'analysis') {
    job.result = await step('style', 'style', { task: '分析所选材料的文风；不同样本为不连续原文，分别核对出处。仅依据这些样本归纳，不声称已读完整本书。', sources: input.sources, sampling: input.sampling, schema: '{name,overview,uncertainty,rules:[{category:"syntax|perspective|description|dialogue|rhythm|rhetoric|other",rule,scope:"general|scene",scene,sourceId,quote}],examples:[{sourceId,quote,scene}]}' }, text => {
      const result = parseStyleAnalysis(text, input.sources);
      if (input.profileName) result.name = input.profileName;
      // Keep original document IDs for the editable library; verify against the
      // actual samples first, so quotes from unsent parts cannot be accepted.
      for (const item of [...result.rules, ...result.examples]) { const source = input.sources.find(s => s.id === item.sourceId); item.sampleStart = source.start; item.sampleEnd = source.end; item.sourceId = source.originalSourceId || source.id; }
      return result;
    });
    return;
  }
  const chosen = await step('context', 'context', { task: '为本次片段任务选择相关资料编号', mode: input.mode, instructions: input.instructions, lockedFacts: input.lockedFacts, original: input.original, before: input.before, cutoff: input.cutoffTitle, pool: input.pool, availableSceneTypes: input.sceneType === 'auto' ? input.profile.availableSceneTypes || [] : [], schema: '{"selectedIds":["池中编号"],"missing":["缺失信息"],"sceneTypes":["本次适用的场景编号，最多两个；只从 availableSceneTypes 选取"]}' }, text => {
    const r = parseObject(text);
    if (!Array.isArray(r.selectedIds) || r.selectedIds.some(id => !input.pool.some(x => x.id === id)) || !Array.isArray(r.missing) || r.missing.some(x => typeof x !== 'string')) throw new Error('资料 Agent 返回了无效资料编号或缺失说明');
    if (r.sceneTypes !== undefined && (!Array.isArray(r.sceneTypes) || r.sceneTypes.length > 2 || r.sceneTypes.some(t => !input.profile.availableSceneTypes?.includes(t)))) throw new Error('自动场景建议包含未知类型');
    return { sceneTypes: input.sceneType === 'auto' ? [...new Set(r.sceneTypes || [])] : [], selectedIds: [...new Set(r.selectedIds)], missing: r.missing.slice(0, 20).map(x => x.slice(0, 1000)) };
  });
  const facts = input.pool.filter(x => chosen.selectedIds.includes(x.id) || x.id.startsWith('state:'));
  const activeProfile = input.sceneType === 'auto' && input.profile.availableSceneTypes?.length ? selectProfileScenes(input.profile, chosen.sceneTypes || []) : input.profile;
  if (!activeProfile.rules.length) throw new Error('本次未找到适用的文风规则，请手动选择已有专项或补充通用习惯');
  const common = { mode: input.mode, instructions: input.instructions, lockedFacts: input.lockedFacts, stopAt: input.stopAt, targetLength: input.length, intensity: input.intensity, referenceLevel: input.referenceLevel || 'light', original: input.original, before: input.before, after: input.after, facts, missing: chosen.missing, profile: activeProfile };
  const parseWriting = text => { const r = parseObject(text); if (typeof r.text !== 'string' || !r.text.trim() || r.text.length > 40000 || !Array.isArray(r.unresolved) || r.unresolved.some(x => typeof x !== 'string')) throw new Error('写作 Agent 返回格式无效或正文超过 4 万字符'); return { text: r.text, notes: String(r.notes || '').slice(0, 3000), unresolved: r.unresolved.slice(0, 20).map(x => x.slice(0, 1000)) }; };
  const initial = await step('write', 'writer', { ...common, schema: writingSchema }, parseWriting);
  const review = async (suffix, text) => {
    const results = await Promise.allSettled([
      step('continuity' + suffix, 'continuity', { task: '核对候选稿情节一致性', ...common, profile: undefined, candidate: text, schema: reviewSchema }, r => parseReview(r, text, facts.map(x => x.id))),
      step('styleReview' + suffix, 'styleReview', { task: '核对候选稿文风', instructions: input.instructions, mode: input.mode, referenceLevel: input.referenceLevel || 'light', profile: activeProfile, candidate: text, original: input.original, schema: reviewSchema }, r => parseReview(r, text, activeProfile.rules.map(x => x.id)))
    ]);
    const failed = results.find(r => r.status === 'rejected'); if (failed) throw failed.reason;
    return { continuity: results[0].value, style: results[1].value };
  };
  job.result = { versions: [{ label: '初稿', ...initial }], facts, missing: chosen.missing, profileSnapshot: activeProfile }; await persist();
  const initialReviews = await review('', initial.text);
  job.result.versions[0].reviews = initialReviews; await persist();
  const issues = [...initialReviews.continuity.issues, ...initialReviews.style.issues];
  if (input.revise && issues.some(x => x.severity !== 'uncertain')) {
    const revised = await step('revise', 'writer', { ...common, candidate: initial.text, reviews: initialReviews, task: '只修正有依据的问题；保留作者原意和有效表达。最多这一轮修订。', schema: writingSchema }, parseWriting);
    job.result.versions.push({ label: '审查后修订', ...revised }); await persist();
    job.result.versions[1].reviews = await review('2', revised.text); await persist();
  }
  job.result.warnings = styleCopyWarnings(job.result.versions.at(-1).text, input);
}
