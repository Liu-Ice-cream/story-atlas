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
export function readerBlocks(chapter) {
  const markdown = /\.(md|markdown)$/i.test(chapter.filename || '');
  const inline = text => markdown ? text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/`([^`]+)`/g, '$1') : text;
  const lines = chapter.body.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const titleKey = text => text.replace(/^#{1,6}\s+/, '').replace(/[\s·•:：—_-]/g, '').trim();
  const volumeTitle = readerVolumeTitle(chapter);
  while (lines.length) {
    if (!lines[0].trim()) { lines.shift(); continue; }
    const title = titleKey(lines[0]);
    if (title === titleKey(chapter.title) || (markdown && volumeTitle && /^#{1,6}\s/.test(lines[0]) && title === titleKey(volumeTitle))) lines.shift();
    else break;
  }
  const blocks = []; let fence = false, code = [];
  for (const line of lines) {
    const text = line.trim();
    if (markdown && /^\s*(```|~~~)/.test(line)) { if (fence) { blocks.push({ type: 'pre', text: code.join('\n') }); code = []; } fence = !fence; continue; }
    if (fence) { code.push(line); continue; }
    if (!text) continue;
    if (/^(?:\*\s*){3,}$|^(?:-\s*){3,}$|^(?:_\s*){3,}$|^[＊*·•]{3,}$/.test(text)) { blocks.push({ type: 'break', text: '＊ ＊ ＊' }); continue; }
    const heading = markdown && text.match(/^#{1,6}\s+(.+)/);
    if (heading) blocks.push({ type: 'heading', text: inline(heading[1]) });
    else if (markdown && text.startsWith('>')) blocks.push({ type: 'quote', text: inline(text.replace(/^>\s?/, '')) });
    else blocks.push({ type: 'paragraph', text: inline(text) });
  }
  if (fence && code.length) blocks.push({ type: 'pre', text: code.join('\n') });
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
