export const SCENE_VERSION = 1;
export const CONTENT_TYPES = { dialogue: '对话', environment: '环境', action: '行动与战斗', psychology: '心理与情绪', narration: '叙述与过渡' };
export const SCENE_TYPES = { opening: '章节开场', ending: '章节收尾', ...CONTENT_TYPES };
const heading = line => /^(?:#{1,6}\s*)?(?:第[^\s]{1,20}[章节回卷部篇幕](?:\s|[·:：、]|$).*|(?:chapter|part)\s+[\dIVX]+\b.*|(?:序章|序幕|楔子|引子|尾声|终章|后记|prologue|epilogue)(?:\s|[·:：、]|$).*)$/i.test(line.trim()) && line.trim().length <= 100;

export function sceneDocument(source) {
  const paragraphs = [], chapters = []; let chapter = null;
  const ensureChapter = (title, start, recognized = false) => { chapter = { id: source.id + ':c' + (chapters.length + 1), title, start, recognized }; chapters.push(chapter); };
  for (const match of source.body.matchAll(/[^\r\n]+/g)) {
    const line = match[0]; if (!line.trim()) continue;
    if (heading(line)) { ensureChapter(line.trim().replace(/^#{1,6}\s*/, ''), match.index, true); continue; }
    if (!chapter) ensureChapter('未分章正文', 0);
    let start = match.index + line.length - line.trimStart().length, end = match.index + line.trimEnd().length;
    while (start < end) {
      let next = Math.min(end, start + 1500);
      if (next < end && /[\uD800-\uDBFF]/.test(source.body[next - 1])) next--;
      paragraphs.push({ id: source.id + ':p' + (paragraphs.length + 1), sourceId: source.id, chapterId: chapter.id, chapterTitle: chapter.title, start, end: next, text: source.body.slice(start, next), positions: [] }); start = next;
    }
  }
  const grouped = new Map();
  for (const p of paragraphs) { if (!grouped.has(p.chapterId)) grouped.set(p.chapterId, []); grouped.get(p.chapterId).push(p); }
  for (const group of grouped.values()) {
    group.slice(0, 2).forEach(p => p.positions.push('opening'));
    group.slice(-2).forEach(p => p.positions.push('ending'));
  }
  const batches = []; let batch = [], size = 0;
  for (const paragraph of paragraphs) {
    if (batch.length && (size + paragraph.text.length > 9000 || batch.length >= 60)) { batches.push(batch); batch = []; size = 0; }
    batch.push(paragraph); size += paragraph.text.length;
  }
  if (batch.length) batches.push(batch);
  return { paragraphs, chapters, batches, recognizedChapters: chapters.filter(c => c.recognized).length };
}

export function parseSceneLabels(result, paragraphs) {
  if (!Array.isArray(result.paragraphs) || result.paragraphs.length !== paragraphs.length) throw new Error('场景识别须逐一返回本批所有段落编号');
  const ids = new Set(paragraphs.map(p => p.id)), seen = new Set();
  return result.paragraphs.map(p => {
    if (!p || !ids.has(p.id) || seen.has(p.id)) throw new Error('场景识别返回未知或重复的段落编号'); seen.add(p.id);
    if (!Array.isArray(p.tags) || p.tags.length > 5 || p.tags.some(t => !Object.hasOwn(CONTENT_TYPES, t)) || (p.excluded !== undefined && typeof p.excluded !== 'boolean')) throw new Error('场景标签无效，请按约定返回');
    if (!p.excluded && !p.tags.length) throw new Error('正文段落至少需要一个内容标签');
    return { id: p.id, tags: [...new Set(p.tags)], excluded: Boolean(p.excluded) };
  });
}

export function validateSceneIndexes(indexes) {
  if (!Array.isArray(indexes) || indexes.length > 50) throw new Error('场景索引数量无效');
  const seen = new Set();
  for (const index of indexes) {
    if (!index || typeof index.sourceId !== 'string' || seen.has(index.sourceId) || typeof index.sourceHash !== 'string' || !Array.isArray(index.paragraphs) || index.paragraphs.length > 50000 || !Number.isInteger(index.version) || index.version < 1) throw new Error('场景索引格式无效');
    seen.add(index.sourceId); const ids = new Set();
    for (const p of index.paragraphs) {
      if (typeof p.id !== 'string' || ids.has(p.id) || !Number.isInteger(p.start) || !Number.isInteger(p.end) || p.start < 0 || p.end <= p.start || !Array.isArray(p.tags) || p.tags.some(t => !Object.hasOwn(CONTENT_TYPES, t)) || !Array.isArray(p.positions) || p.positions.some(t => !['opening', 'ending'].includes(t))) throw new Error('场景段落编号、范围或标签无效');
      ids.add(p.id);
    }
  }
}

export function sceneSamples(sources, indexes, types = Object.keys(SCENE_TYPES), budget = 40000) {
  if (!Array.isArray(types) || !types.length || new Set(types).size !== types.length || types.some(t => !Object.hasOwn(SCENE_TYPES, t))) throw new Error('请选择有效的写作类型');
  if (!Number.isInteger(budget) || budget < 3000 || budget > 65000) throw new Error('专项样本总量须为 3000—65000 字符');
  const candidates = new Map(types.map(type => [type, []]));
  for (const source of sources) {
    const index = indexes.find(i => i.sourceId === source.id);
    if (!index) throw new Error('请先建立并保存场景索引');
    for (const p of index.paragraphs) {
      if (p.end > source.body.length) throw new Error('场景索引范围超出原文，请重新识别');
      if (!p.excluded) for (const type of types) if ([...p.positions, ...p.tags].includes(type)) candidates.get(type).push({ source, p });
    }
  }
  const nonempty = types.filter(t => candidates.get(t).length);
  const share = Math.floor(budget / Math.max(1, nonempty.length));
  const groups = types.map(type => {
    const available = candidates.get(type), chosen = [], chapters = new Set();
    for (const ratio of [0.5, 0, 1]) {
      const unused = available.filter(c => !chosen.includes(c)), diverse = unused.filter(c => !chapters.has(c.p.chapterId));
      const pool = diverse.length ? diverse : unused; if (!pool.length) continue;
      const entry = pool[Math.round((pool.length - 1) * ratio)]; chosen.push(entry); chapters.add(entry.p.chapterId);
    }
    const width = Math.min(2200, Math.floor(share / Math.max(1, chosen.length)));
    const samples = chosen.map(({ source, p }, i) => {
      // A bounded continuous window around the labelled paragraph, in its chapter.
      const index = indexes.find(x => x.sourceId === source.id), chapter = index.paragraphs.filter(x => x.chapterId === p.chapterId);
      let start = p.start, end = Math.min(p.end, start + width);
      for (const neighbor of chapter.filter(x => x.start >= p.end)) { if (neighbor.end - start > width || neighbor.excluded) break; end = neighbor.end; }
      if (end - start < width / 2) for (const neighbor of [...chapter].reverse().filter(x => x.end <= start)) { if (end - neighbor.start > width || neighbor.excluded) break; start = neighbor.start; }
      if (/[\uD800-\uDBFF]/.test(source.body[end - 1])) end--;
      return { id: source.id + ':' + type + ':' + (i + 1), name: source.name + ' · ' + SCENE_TYPES[type], originalSourceId: source.id, paragraphId: p.id, chapterTitle: p.chapterTitle, start, end, body: source.body.slice(start, end), focusStart: p.start - start, focusEnd: Math.min(p.end, end) - start, focus: source.body.slice(p.start, Math.min(p.end, end)), sceneType: type };
    });
    return { type, label: SCENE_TYPES[type], candidateCount: available.length, chapterCount: new Set(available.map(x => x.p.chapterId)).size, status: !available.length ? 'missing' : available.length < 3 ? 'limited' : 'available', samples };
  });
  return { version: SCENE_VERSION, budget, types, fullLength: sources.reduce((n, s) => n + s.body.length, 0), sampleLength: groups.reduce((n, g) => n + g.samples.reduce((m, s) => m + s.body.length, 0), 0), groups };
}

export function selectProfileScenes(profile, types) {
  const picked = new Set(types);
  const rules = profile.rules.filter(r => !r.sceneType || r.sceneType === 'general' || picked.has(r.sceneType));
  const examples = profile.examples.filter(e => !e.sceneType || e.sceneType === 'general' || picked.has(e.sceneType)).slice(0, 5);
  return { ...profile, rules, examples, appliedSceneTypes: [...picked] };
}
