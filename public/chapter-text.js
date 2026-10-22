import { readerBlocks } from './reader-domain.js';

export function resolveReadingSelection(blocks, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return null;
  let offset = 0, first, last;
  for (const block of blocks) {
    if (start >= offset && start < offset + block.text.length) first = block.sourceOffsets?.[start - offset];
    if (end - 1 >= offset && end - 1 < offset + block.text.length) last = block.sourceEnds?.[end - 1 - offset];
    offset += block.text.length;
  }
  return Number.isInteger(first) && Number.isInteger(last) && last > first ? { start: first, end: last } : null;
}

export function writingSelection(chapter, mode, start, end) {
  if (!['rewrite', 'continue'].includes(mode) || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > chapter.body.length) throw new Error('正文选区无效，请重新选择文字');
  if (mode === 'rewrite' && (start === end || end - start > 12000)) throw new Error('每次改写请选择 1—12000 字符');
  if (mode === 'continue' && end < 10) throw new Error('续写位置前至少需要 10 字符，请再选择一些前文');
  return { mode, start: mode === 'continue' ? end : start, end };
}

export function createChapterTextActions({ state, e, toast, onOpen }) {
  const registered = new WeakMap(); let current = null, menu = null, timer;
  function hide() { menu?.remove(); menu = null; current = null; }
  function capture() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
    const range = selection.getRangeAt(0), parent = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const root = parent?.closest('[data-chapter-text]'), source = root && registered.get(root);
    if (!source || !root.contains(range.endContainer) || !root.isConnected || source.projectId !== state.project.projectId) return null;
    const prefix = document.createRange(); prefix.selectNodeContents(root); prefix.setEnd(range.startContainer, range.startOffset);
    const visibleStart = prefix.toString().length, visibleEnd = visibleStart + range.toString().length;
    const offsets = source.kind === 'paper' ? resolveReadingSelection(source.blocks, visibleStart, visibleEnd) : { start: visibleStart, end: visibleEnd };
    if (!offsets || offsets.end > source.body.length || !source.body.slice(offsets.start, offsets.end).trim()) return null;
    const rects = [...range.getClientRects()], rect = rects.at(-1) || range.getBoundingClientRect();
    if (!rect || rect.bottom < 0 || rect.top > innerHeight) return null;
    return { ...source, ...offsets, root, selectedText: selection.toString(), rect };
  }
  function show(point) {
    const selected = capture(); if (!selected) return hide();
    hide(); current = selected;
    menu = document.createElement('div'); menu.className = 'chapter-selection-menu'; menu.setAttribute('role', 'toolbar'); menu.setAttribute('aria-label', '正文选区操作');
    const count = selected.end - selected.start;
    menu.innerHTML = `<div class="chapter-selection-caption">已选 ${count.toLocaleString()} 字符${count > 12000 ? ' · 改写最多 1.2 万字符' : ''}</div><div><button type="button" data-text-action="rewrite" ${count > 12000 ? 'disabled' : ''}>改写选中片段</button><button type="button" data-text-action="continue">从此处续写</button><button type="button" data-text-action="copy">复制</button><button type="button" data-text-action="close" aria-label="关闭选区操作">×</button></div>`;
    (selected.root.closest('dialog') || document.body).append(menu);
    const width = menu.getBoundingClientRect().width, height = menu.getBoundingClientRect().height;
    const left = point?.x ?? selected.rect.left, top = point?.y ?? selected.rect.bottom + 9;
    menu.style.left = Math.max(8, Math.min(left, innerWidth - width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(top, innerHeight - height - 8)) + 'px';
    // Clicking a tool must not collapse the source selection before it is captured.
    menu.addEventListener('pointerdown', event => event.preventDefault());
    menu.addEventListener('click', async event => {
      const action = event.target.closest('[data-text-action]')?.dataset.textAction;
      if (!action || event.target.closest('button').disabled) return;
      const saved = current; hide();
      if (action === 'close') return;
      try {
        if (action === 'copy') { await navigator.clipboard.writeText(saved.selectedText); return toast('所选文字已复制'); }
        await onOpen(saved.id, { ...writingSelection(saved, action, saved.start, saved.end), body: saved.body });
      } catch (error) { toast(error.message, true); }
    });
  }
  function bind() {
    for (const root of document.querySelectorAll('[data-chapter-text]')) {
      if (registered.has(root)) continue;
      const chapter = state.project.chapters.find(c => c.id === root.dataset.chapterText); if (!chapter) continue;
      const kind = root.dataset.textKind || 'raw';
      registered.set(root, { id: chapter.id, body: chapter.body, projectId: state.project.projectId, kind, ...(kind === 'paper' ? { blocks: readerBlocks(chapter, { withOffsets: true }) } : {}) });
    }
  }
  document.addEventListener('selectionchange', () => { clearTimeout(timer); if (!menu?.contains(document.activeElement)) timer = setTimeout(() => show(), 100); });
  document.addEventListener('pointerup', event => { if (!event.target.closest('.chapter-selection-menu')) { clearTimeout(timer); timer = setTimeout(() => show(), 0); } });
  document.addEventListener('contextmenu', event => { const selected = capture(); if (selected && (selected.root.contains(event.target) || (!event.clientX && !event.clientY))) { event.preventDefault(); show(event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined); } });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu) { event.preventDefault(); event.stopImmediatePropagation(); clearTimeout(timer); hide(); } }, true);
  document.addEventListener('scroll', event => { if (menu && !menu.contains(event.target)) hide(); }, true);
  window.addEventListener('resize', hide);
  return { bind, hide };
}
