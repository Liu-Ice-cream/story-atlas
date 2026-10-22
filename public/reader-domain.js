import { sortChapters } from './domain.js';

export const DEFAULT_READER_PREFS = { fontSize: 21, lineHeight: 2.1, width: 820, font: 'serif', paper: 'warm' };
const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
export function normalizeReaderPrefs(value = {}) {
  return { fontSize: Math.round(clamp(value?.fontSize, 16, 30, 21)), lineHeight: Math.round(clamp(value?.lineHeight, 1.6, 2.6, 2.1) * 10) / 10, width: [700, 820, 960].includes(value?.width) ? value.width : 820, font: value?.font === 'sans' ? 'sans' : 'serif', paper: ['warm', 'white', 'aged'].includes(value?.paper) ? value.paper : 'warm' };
}
export function readerVolumeTitle(chapter) {
  if (!chapter?.volume || !/\.(md|markdown)$/i.test(chapter.filename || '')) return chapter?.volume || '';
  const heading = chapter.body.replace(/^\uFEFF/, '').split(/\r?\n/).filter(s => s.trim()).slice(0, 2).map(s => s.match(/^#{1,6}\s+(.+)/)?.[1]?.trim()).find(s => s?.replace(/\s/g, '').startsWith(chapter.volume.replace(/\s/g, '')));
  return heading || chapter.volume;
}
export function readerBlocks(chapter, { withOffsets = false } = {}) {
  const markdown = /\.(md|markdown)$/i.test(chapter.filename || '');
  const trace = (text, start) => ({ text, lineStart: start, offsets: Array.from({ length: text.length }, (_, i) => start + i), ends: Array.from({ length: text.length }, (_, i) => start + i + 1) });
  const slice = (t, start, end = t.text.length) => ({ text: t.text.slice(start, end), offsets: t.offsets.slice(start, end), ends: t.ends.slice(start, end) });
  const trim = t => slice(t, t.text.length - t.text.trimStart().length, t.text.trimEnd().length);
  const inline = input => {
    if (!markdown) return input;
    for (const pattern of [/!\[([^\]]*)\]\([^)]*\)/g, /\[([^\]]+)\]\([^)]*\)/g, /\*\*([^*]+)\*\*/g, /__([^_]+)__/g, /`([^`]+)`/g]) {
      let previous = 0; const parts = [];
      for (const match of input.text.matchAll(pattern)) {
        parts.push(slice(input, previous, match.index));
        const at = match.index + match[0].indexOf(match[1]);
        parts.push(slice(input, at, at + match[1].length)); previous = match.index + match[0].length;
      }
      parts.push(slice(input, previous));
      input = { text: parts.map(p => p.text).join(''), offsets: parts.flatMap(p => p.offsets), ends: parts.flatMap(p => p.ends) };
    }
    return input;
  };
  const lines = []; let start = 0;
  for (const match of chapter.body.matchAll(/\r\n|\r|\n/g)) { lines.push(trace(chapter.body.slice(start, match.index), start)); start = match.index + match[0].length; }
  lines.push(trace(chapter.body.slice(start), start));
  const titleKey = text => text.replace(/^#{1,6}\s+/, '').replace(/[\s·•:：—_-]/g, '').trim();
  const volumeTitle = readerVolumeTitle(chapter);
  while (lines.length) {
    if (!lines[0].text.trim()) { lines.shift(); continue; }
    const title = titleKey(lines[0].text.replace(/^\uFEFF/, ''));
    if (title === titleKey(chapter.title) || (markdown && volumeTitle && /^#{1,6}\s/.test(lines[0].text) && title === titleKey(volumeTitle))) lines.shift();
    else break;
  }
  const blocks = []; let fence = false, code = [];
  const emit = (type, t) => blocks.push({ type, text: t.text, ...(withOffsets ? { sourceOffsets: t.offsets, sourceEnds: t.ends } : {}) });
  const emitCode = () => {
    const combined = { text: '', offsets: [], ends: [] };
    code.forEach((line, i) => {
      if (i) { combined.text += '\n'; combined.offsets.push(code[i - 1].ends.at(-1) ?? code[i - 1].lineStart); combined.ends.push(line.lineStart); }
      combined.text += line.text; combined.offsets.push(...line.offsets); combined.ends.push(...line.ends);
    });
    emit('pre', combined); code = [];
  };
  for (const line of lines) {
    const t = trim(line), text = t.text;
    if (markdown && /^\s*(```|~~~)/.test(line.text)) { if (fence) emitCode(); fence = !fence; continue; }
    if (fence) { code.push(line); continue; }
    if (!text) continue;
    if (/^(?:\*\s*){3,}$|^(?:-\s*){3,}$|^(?:_\s*){3,}$|^[＊*·•]{3,}$/.test(text)) { blocks.push({ type: 'break', text: '＊ ＊ ＊' }); continue; }
    const heading = markdown && text.match(/^#{1,6}\s+(.+)/);
    if (heading) emit('heading', inline(slice(t, heading[0].length - heading[1].length)));
    else if (markdown && text.startsWith('>')) emit('quote', inline(slice(t, text.match(/^>\s?/)[0].length)));
    else emit('paragraph', inline(t));
  }
  if (fence && code.length) emitCode();
  return blocks;
}
export function normalizeReadingRecord(value, chapters) {
  const validIds = new Set(chapters.map(c => c.id));
  const position = raw => ({ block: Math.floor(clamp(raw?.block, 0, 1000000, 0)), offset: clamp(raw?.offset, 0, 1, 0), ratio: clamp(raw?.ratio, 0, 1, 0), signature: typeof raw?.signature === 'string' ? raw.signature.slice(0, 200) : '' });
  const positions = {};
  for (const [id, raw] of Object.entries(value?.positions || {}).slice(-2000)) if (validIds.has(id) && raw && typeof raw === 'object') positions[id] = position(raw);
  const bookmarks = (Array.isArray(value?.bookmarks) ? value.bookmarks : []).filter(b => b && typeof b.id === 'string' && validIds.has(b.chapterId)).slice(-100).map(b => ({ id: b.id.slice(0, 100), chapterId: b.chapterId, ...position(b), preview: String(b.preview || '').slice(0, 160), createdAt: typeof b.createdAt === 'string' ? b.createdAt : '' }));
  const chapterId = validIds.has(value?.chapterId) ? value.chapterId : sortChapters(chapters)[0]?.id || '';
  return { chapterId, positions, bookmarks };
}
export const chapterSignature = chapter => {
  // Lightweight local change detection; this is not a security hash.
  let hash = 2166136261;
  for (let i = 0; i < chapter.body.length; i++) hash = Math.imul(hash ^ chapter.body.charCodeAt(i), 16777619);
  return chapter.body.length + ':' + (hash >>> 0).toString(16);
};
