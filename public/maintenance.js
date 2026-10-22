export const stateCategories = { condition: '身体状况', ability: '能力', location: '所在位置', faction: '阵营', relationship: '关系', knowledge: '知情情况', identity: '身份', other: '其他状态' };

export function validateStates(character, chapterIds) {
  if (character.states == null) character.states = [];
  if (!Array.isArray(character.states) || character.states.length > 10000) throw new Error('人物状态列表无效');
  const ids = new Set();
  for (const s of character.states) {
    if (!s || typeof s.id !== 'string' || !s.id || ids.has(s.id)) throw new Error('人物状态编号重复或缺失');
    ids.add(s.id);
    if (!stateCategories[s.category] || !['canon', 'author'].includes(s.kind)) throw new Error('人物状态类型无效');
    for (const [key, max] of [['label', 200], ['value', 20000], ['quote', 20000]]) if (typeof s[key] !== 'string' || s[key].length > max) throw new Error('人物状态内容无效');
    if (!s.label.trim() || !s.value.trim() || (s.chapterId ? !chapterIds.has(s.chapterId) : s.kind !== 'author')) throw new Error('人物状态需要名称、内容与有效章节');
  }
}

export function characterTimeline(p, characterId, cutoffId = '') {
  const c = p.characters.find(c => c.id === characterId);
  if (!c) return { events: [], current: [] };
  const sorted = [...p.chapters].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN', { numeric: true }));
  const positions = new Map(sorted.map((ch, i) => [ch.id, i]));
  if (cutoffId && !positions.has(cutoffId)) throw new Error('时间线截止章节不存在');
  const cutoff = cutoffId ? positions.get(cutoffId) : sorted.length - 1;
  const events = [];
  const append = (entry, type, text, extra = {}) => {
    if (!positions.has(entry.chapterId) || positions.get(entry.chapterId) > cutoff) return;
    events.push({ ...entry, ...extra, type, text, position: positions.get(entry.chapterId) });
  };
  for (const fact of c.facts) if (fact.kind === 'canon') append(fact, 'fact', fact.text);
  for (const relation of p.relationships.filter(r => r.fromId === c.id || r.toId === c.id)) {
    const from = p.characters.find(x => x.id === relation.fromId)?.name || '未关联';
    const to = p.characters.find(x => x.id === relation.toId)?.name || '未关联';
    append(relation, 'relationship', `${from} → ${to}：${relation.name}${relation.description ? '；' + relation.description : ''}`);
  }
  for (const s of c.states || []) append(s, 'state', s.value);
  events.sort((a, b) => a.position - b.position);
  const latest = new Map();
  for (const event of events.filter(x => x.type === 'state')) latest.set(event.category + ':' + event.label, event);
  return { events, current: [...latest.values()], cutoffChapter: sorted[cutoff] };
}

export function reviewItems(p) {
  const items = [];
  for (const c of p.characters) {
    for (const f of c.facts) if (f.needsReview) items.push({ type: 'fact', id: f.id, personId: c.id, chapterId: f.chapterId, title: c.name + ' · 人物设定', text: f.text, quote: f.quote || '' });
    for (const s of c.states || []) if (s.needsReview) items.push({ type: 'state', id: s.id, personId: c.id, chapterId: s.chapterId, title: c.name + ' · ' + s.label, text: s.value, quote: s.quote || '' });
  }
  for (const [kind, title] of [['relationships', '人物关系'], ['threads', '支线'], ['ideas', '灵感关联']]) for (const x of p[kind]) if (x.needsReview) {
    const chapterId = x.reviewChapterIds?.[0] || x.chapterId;
    items.push({ type: kind, id: x.id, chapterId, relatedChapterIds: [...new Set([...(x.reviewChapterIds || []), x.chapterId].filter(Boolean))], title: title + ' · ' + (x.name || x.title), text: x.description || x.name, quote: chapterId === x.chapterId ? x.quote || '' : '' });
  }
  for (const ch of p.chapters) if (ch.summaryNeedsReview && ch.summary) items.push({ type: 'summary', id: ch.id, chapterId: ch.id, title: '章节摘要 · ' + ch.title, text: ch.summary, quote: '' });
  return items;
}

export function invalidateChapterReferences(before, next) {
  if (before.projectId !== next.projectId) return next;
  const changed = new Set(next.chapters.filter(ch => before.chapters.some(old => old.id === ch.id && old.body !== ch.body)).map(c => c.id));
  if (!changed.size) return next;
  for (const c of next.characters) for (const entry of [...c.facts, ...(c.states || [])]) if (changed.has(entry.chapterId)) entry.needsReview = true;
  for (const entry of [...next.relationships, ...next.threads, ...next.ideas, ...(next.review || [])]) {
    const refs = [...new Set([entry.chapterId, ...(entry.sourceChapterIds || [])].filter(id => changed.has(id)))];
    if (refs.length) { entry.needsReview = true; entry.reviewChapterIds = [...new Set([...(entry.reviewChapterIds || []), ...refs])]; }
  }
  for (const ch of next.chapters) if (changed.has(ch.id)) { ch.status = 'changed'; ch.summaryNeedsReview = Boolean(ch.summary); delete ch.reviewedAt; }
  return next;
}

export function acknowledgeReview(p, item) {
  const character = p.characters.find(c => c.id === item.personId);
  const record = item.type === 'fact' ? character?.facts.find(f => f.id === item.id) : item.type === 'state' ? character?.states?.find(s => s.id === item.id) : item.type === 'summary' ? p.chapters.find(c => c.id === item.id) : p[item.type]?.find(x => x.id === item.id);
  if (!record) throw new Error('待复核记录已不存在');
  const chapter = p.chapters.find(c => c.id === record.chapterId || item.type === 'summary' && c.id === record.id);
  if (record.quote && !chapter?.body.includes(record.quote.trim())) throw new Error('原文证据已不匹配，请先编辑内容或出处再确认');
  if (item.type === 'summary') record.summaryNeedsReview = false;
  else { record.needsReview = false; delete record.reviewChapterIds; }
  record.reviewedAt = new Date().toISOString();
}

export function chapterProgress(p, chapterId, jobs = []) {
  const chapter = p.chapters.find(c => c.id === chapterId);
  const pending = (p.review || []).filter(s => s.chapterId === chapterId).length;
  const stale = reviewItems(p).filter(x => x.chapterId === chapterId || x.relatedChapterIds?.includes(chapterId)).length;
  const records = p.characters.reduce((n, c) => n + c.facts.filter(f => f.chapterId === chapterId).length + (c.states || []).filter(s => s.chapterId === chapterId).length, 0) + p.relationships.filter(r => r.chapterId === chapterId).length + p.threads.filter(t => t.chapterId === chapterId).length;
  const job = jobs.find(j => j.chapterId === chapterId && !j.outdated);
  const extraction = job ? ({ ready: '已提取', collected: '已提取', empty: '已提取 · 无新增', failed: '提取失败', running: '正在提取', queued: '等待提取', waiting_config: '等待接口', outdated: '需要重提取' }[job.status] || '未提取') : pending || chapter?.aiExtractedAt && chapter.status !== 'changed' ? '已提取（导入记录）' : '未记录 AI 提取';
  const review = stale ? `${stale} 条需复核` : pending ? `${pending} 条待确认` : chapter?.status === 'done' ? '已核对' : records ? '已有资料 · 未完成核对' : '尚未核对';
  return { imported: true, extraction, pending, stale, records, reviewed: chapter?.status === 'done' && !pending && !stale, review };
}
