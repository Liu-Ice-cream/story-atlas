import { uid, sortChapters } from './domain.js';
import { DEFAULT_READER_PREFS, normalizeReaderPrefs, normalizeReadingRecord, readerBlocks, chapterSignature, readerVolumeTitle } from './reader-domain.js';

export function createReaderUI({ state, e, icon, navigate, closeModal, toast, themeSwitcher = () => '' }) {
  const $ = selector => document.querySelector(selector);
  const storage = { prefs: 'story-atlas.reader.preferences.v1', record: id => 'story-atlas.reader.record.v1.' + id };
  const local = { projectId: '', chapterId: '', prefs: { ...DEFAULT_READER_PREFS }, record: null, returnPage: 'home', panel: '', panelTab: 'toc', query: '', focus: false, timer: null, frame: null, restoring: false, mounted: '', warningShown: false };
  const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { if (!local.warningShown) { local.warningShown = true; toast('浏览器无法保存阅读位置，本次仍可阅读；请检查本地存储空间或隐私设置', true); } }
  }
  function ensure() {
    if (local.projectId !== state.project.projectId || !local.record) {
      local.projectId = state.project.projectId;
      local.prefs = normalizeReaderPrefs(read(storage.prefs));
      local.record = normalizeReadingRecord(read(storage.record(local.projectId)), state.project.chapters);
      local.chapterId = local.record.chapterId; local.panel = ''; local.query = ''; local.focus = false;
    } else local.record = normalizeReadingRecord(local.record, state.project.chapters);
    if (!state.project.chapters.some(c => c.id === local.chapterId)) local.chapterId = local.record.chapterId;
  }
  const chapter = () => state.project.chapters.find(c => c.id === local.chapterId);
  const act = (name, label, symbol, extra = '') => `<button type="button" data-reader="${name}" aria-label="${e(label)}" ${extra}>${symbol ? icon(symbol) : ''}<span>${label}</span></button>`;
  function continueLabel() {
    ensure(); return local.record.positions[local.record.chapterId] ? '继续阅读' : '开始阅读';
  }
  function position() {
    const scroll = $('#book-reader-scroll'), body = $('#book-reader-body');
    if (!scroll || !body || !chapter()) return null;
    const nodes = [...body.querySelectorAll('[data-reading-block]')], edge = scroll.getBoundingClientRect().top + 80;
    const node = nodes.find(node => node.getBoundingClientRect().bottom > edge) || nodes.at(-1);
    const rect = node?.getBoundingClientRect(), max = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    return { block: Number(node?.dataset.readingBlock || 0), offset: rect ? Math.max(0, Math.min(1, (edge - rect.top) / rect.height)) : 0, ratio: max ? scroll.scrollTop / max : 1, signature: chapterSignature(chapter()) };
  }
  function flush() {
    clearTimeout(local.timer); local.timer = null;
    if (state.page !== 'reader' || !local.record || local.mounted !== local.chapterId || local.restoring) return;
    const saved = position(); if (!saved) return;
    local.record.chapterId = local.chapterId; local.record.positions[local.chapterId] = saved;
    write(storage.record(local.projectId), local.record);
  }
  function progress() {
    const scroll = $('#book-reader-scroll'); if (!scroll) return;
    const max = scroll.scrollHeight - scroll.clientHeight, fraction = max > 0 ? scroll.scrollTop / max : 1;
    const text = $('#book-reader-percent'); if (text) text.textContent = '本章 ' + Math.round(fraction * 100) + '%';
    $('#book-reader-progress')?.style.setProperty('--read-progress', (fraction * 100) + '%');
  }
  function restore(saved, changed = false) {
    const scroll = $('#book-reader-scroll'), body = $('#book-reader-body'); if (!scroll || !body) return;
    local.restoring = true;
    requestAnimationFrame(() => {
      if (!scroll.isConnected) { local.restoring = false; return; }
      const node = saved && !changed ? body.querySelector(`[data-reading-block="${saved.block}"]`) : null;
      if (saved && saved.ratio <= 0.0001) scroll.scrollTop = 0;
      else if (node) {
        const rect = node.getBoundingClientRect();
        scroll.scrollTop += rect.top - scroll.getBoundingClientRect().top - 80 + rect.height * saved.offset;
      } else scroll.scrollTop = saved ? Math.max(0, scroll.scrollHeight - scroll.clientHeight) * saved.ratio : 0;
      local.restoring = false; progress(); flush();
    });
  }
  function applyPreferences() {
    const root = $('#book-reader'); if (!root) return;
    root.dataset.paper = local.prefs.paper; root.dataset.font = local.prefs.font;
    root.style.setProperty('--read-size', local.prefs.fontSize + 'px');
    root.style.setProperty('--read-leading', local.prefs.lineHeight);
    root.style.setProperty('--read-width', local.prefs.width + 'px');
  }
  function panelContent() {
    const chapters = sortChapters(state.project.chapters);
    if (local.panelTab === 'bookmarks') return local.record.bookmarks.length ? [...local.record.bookmarks].reverse().map(b => `<div class="book-bookmark"><button type="button" data-reader="jump-bookmark" data-id="${e(b.id)}"><strong>${e(chapters.find(c => c.id === b.chapterId)?.title)}</strong><p>${e(b.preview || '书签位置')}</p></button><button type="button" class="book-remove-mark" data-reader="remove-bookmark" data-id="${e(b.id)}" aria-label="移除此书签">${icon('close')}</button>${b.signature !== chapterSignature(chapters.find(c => c.id === b.chapterId)) ? '<small>原文已更新，位置仅供参考</small>' : ''}</div>`).join('') : '<p class="book-panel-empty">读到想停留的地方，<br>留下一枚书签。</p>';
    const query = local.query.trim().toLowerCase(); let previousVolume;
    return chapters.filter(c => (c.title + ' ' + c.volume).toLowerCase().includes(query)).map(c => {
      const title = c.volume || '未分卷', label = title !== previousVolume ? `<h3>${e(title)}</h3>` : ''; previousVolume = title;
      return label + `<button type="button" class="book-toc-item ${c.id === local.chapterId ? 'current' : ''}" data-reader="chapter" data-id="${e(c.id)}" ${c.id === local.chapterId ? 'aria-current="page"' : ''}><span>${e(c.title)}</span>${local.record.bookmarks.some(b => b.chapterId === c.id) ? '<i aria-label="有书签">◆</i>' : ''}</button>`;
    }).join('') || '<p class="book-panel-empty">没有找到对应篇目。</p>';
  }
  function settings() {
    const prefs = local.prefs;
    const options = (items, value) => items.map(([id, label]) => `<option value="${id}" ${id === value ? 'selected' : ''}>${label}</option>`).join('');
    return `<div class="book-settings" id="book-reader-settings" ${local.panel !== 'settings' ? 'hidden' : ''}><div class="book-panel-heading"><h2>纸页与排版</h2>${act('close-panel', '收起', 'close')}</div><label>字号 <output id="book-font-output">${prefs.fontSize}</output><input type="range" min="16" max="30" step="1" value="${prefs.fontSize}" data-reader-pref="fontSize" aria-label="阅读字号"/></label><label>行距 <output id="book-leading-output">${prefs.lineHeight.toFixed(1)}</output><input type="range" min="1.6" max="2.6" step="0.1" value="${prefs.lineHeight}" data-reader-pref="lineHeight" aria-label="阅读行距"/></label><label>正文宽度<select data-reader-pref="width" aria-label="正文宽度">${options([[700, '窄页'], [820, '适中'], [960, '宽页']], prefs.width)}</select></label><label>字体<select data-reader-pref="font" aria-label="阅读字体">${options([['serif', '宋体'], ['sans', '黑体']], prefs.font)}</select></label><label>纸色<select data-reader-pref="paper" aria-label="阅读纸色">${options([['warm', '暖纸'], ['white', '素白'], ['aged', '旧纸']], prefs.paper)}</select></label>${act('reset-prefs', '恢复默认版式', '')}<p>版式和阅读位置保存在当前浏览器。纸色随主题调整，字号、行距与进度不变。</p></div>`;
  }
  function renderPage() {
    ensure(); const ch = chapter(), chapters = sortChapters(state.project.chapters), index = chapters.findIndex(c => c.id === ch?.id);
    const blocks = ch ? readerBlocks(ch) : [];
    const body = blocks.map((b, i) => { const tag = { paragraph: 'p', heading: 'h2', quote: 'blockquote', pre: 'pre', break: 'div' }[b.type]; return `<${tag} class="book-text-${b.type}" data-reading-block="${i}">${e(b.text)}</${tag}>`; }).join('');
    return `<div id="book-reader" class="book-reader ${local.focus ? 'is-focused' : ''}" data-paper="${local.prefs.paper}" data-font="${local.prefs.font}"><header class="book-reader-bar"><div class="book-bar-start">${act('exit', '返回工作台', 'back')}<span class="book-bar-rule"></span><div class="book-bar-title"><strong>${e(state.project.title)}</strong><small>${e(ch?.volume || '卷中篇目')}</small></div></div><nav aria-label="阅读工具">${act('toc', '目录', 'chapters', `aria-expanded="${local.panel === 'toc'}" aria-controls="book-reader-toc"`)}${act('bookmark', '留书签', 'note')}${act('settings', '版式', 'settings', `aria-expanded="${local.panel === 'settings'}" aria-controls="book-reader-settings"`)}${act('focus', '专注', 'book', `aria-pressed="${local.focus}"`)}</nav>${themeSwitcher()}</header><div class="book-reader-stage"><aside id="book-reader-toc" class="book-reader-toc" ${local.panel !== 'toc' ? 'hidden' : ''}><div class="book-panel-heading"><h2>卷中篇目</h2>${act('close-panel', '收起', 'close')}</div><div class="book-panel-tabs"><button type="button" data-reader="toc-tab" data-id="toc" class="${local.panelTab === 'toc' ? 'active' : ''}">目录 · ${chapters.length}</button><button type="button" data-reader="toc-tab" data-id="bookmarks" class="${local.panelTab === 'bookmarks' ? 'active' : ''}">书签 · ${local.record.bookmarks.length}</button></div><input id="book-toc-search" type="search" placeholder="查找章节或分卷" aria-label="查找阅读篇目" value="${e(local.query)}" ${local.panelTab !== 'toc' ? 'hidden' : ''}/><div id="book-reader-toc-list">${panelContent()}</div></aside>${settings()}<main id="book-reader-scroll" class="book-reader-scroll" tabindex="0" aria-label="小说正文"><article class="book-paper"><div class="book-paper-running"><span>${e(state.project.title)}</span><span>${e(readerVolumeTitle(ch) || '拾章 · 卷中篇目')}</span></div>${ch ? `<header class="book-chapter-opening"><p>全 书 第 ${String(index + 1).padStart(2, '0')} 篇</p><h1 id="book-reader-title">${e(ch.title)}</h1><div class="book-opening-ornament" aria-hidden="true"><i></i>◆<i></i></div></header><div id="book-reader-body" class="book-reader-body" data-chapter-text="${e(ch.id)}" data-text-kind="paper">${body || '<p class="book-blank">这一章还没有正文。</p>'}</div><div class="book-chapter-end"><span>· 本章完 ·</span><div>${act('prev', '上一章', 'back', index <= 0 ? 'disabled' : '')}${act('next', index === chapters.length - 1 ? '已至卷末' : '下一章', 'arrow', index === chapters.length - 1 ? 'disabled' : '')}</div><small>${index === chapters.length - 1 ? '已读至当前收录的最后一章' : e(chapters[index + 1]?.title || '')}</small></div><footer class="book-paper-folio"><span>拾 章 · 私 人 藏 书</span><span>${String(index + 1).padStart(3, '0')}</span></footer>` : `<div class="book-no-chapters"><h1>尚未收录正文</h1><p>先导入章节，再来翻开这本书。</p>${act('exit', '返回工作台', 'back')}</div>`}</article></main></div><footer class="book-reader-footer"><div><span class="book-reader-current">${e(ch?.title || '尚无章节')}</span><small>${index >= 0 ? index + 1 : 0} / ${chapters.length} 章</small></div><div class="book-footer-progress"><span id="book-reader-percent">本章 0%</span><span id="book-reader-progress" role="presentation"></span></div><div class="book-footer-actions">${act('prev', '上一章', 'back', index <= 0 ? 'disabled' : '')}${act('next', '下一章', 'arrow', index >= chapters.length - 1 ? 'disabled' : '')}${act('show-controls', '显示工具', 'more')}</div></footer></div>`;
  }
  function refreshPanel() {
    const list = $('#book-reader-toc-list'); if (list) list.innerHTML = panelContent();
    const tabs = document.querySelectorAll('[data-reader="toc-tab"]');
    tabs.forEach(t => { t.classList.toggle('active', t.dataset.id === local.panelTab); if (t.dataset.id === 'bookmarks') t.textContent = '书签 · ' + local.record.bookmarks.length; });
    const search = $('#book-toc-search'); if (search) search.hidden = local.panelTab !== 'toc';
  }
  function togglePanel(panel) {
    local.panel = local.panel === panel ? '' : panel;
    const current = position();
    $('#book-reader-toc').hidden = local.panel !== 'toc'; $('#book-reader-settings').hidden = local.panel !== 'settings';
    for (const name of ['toc', 'settings']) document.querySelector(`[data-reader="${name}"]`).setAttribute('aria-expanded', local.panel === name);
    if (local.panel === 'toc') { refreshPanel(); $('#book-reader-toc-list .current')?.scrollIntoView({ block: 'nearest' }); }
    restore(current);
  }
  function bind() {
    if (state.page !== 'reader') { local.mounted = ''; return; }
    applyPreferences(); local.mounted = local.chapterId;
    const saved = local.record.positions[local.chapterId], changed = saved && saved.signature !== chapterSignature(chapter());
    restore(saved, changed);
    if (changed) toast('章节原文已更新，已按原进度定位，请核对阅读位置');
    const scroll = $('#book-reader-scroll');
    scroll.addEventListener('scroll', () => { if (local.frame) return; local.frame = requestAnimationFrame(() => { local.frame = null; progress(); if (!local.restoring) { clearTimeout(local.timer); local.timer = setTimeout(flush, 350); } }); }, { passive: true });
    scroll.focus({ preventScroll: true });
    $('#book-toc-search').addEventListener('input', event => { local.query = event.target.value; refreshPanel(); });
    document.querySelectorAll('[data-reader-pref]').forEach(input => input.addEventListener(input.tagName === 'INPUT' ? 'input' : 'change', event => {
      const saved = position(), key = input.dataset.readerPref;
      local.prefs = normalizeReaderPrefs({ ...local.prefs, [key]: ['fontSize', 'lineHeight', 'width'].includes(key) ? Number(event.target.value) : event.target.value });
      applyPreferences(); write(storage.prefs, local.prefs);
      $('#book-font-output').textContent = local.prefs.fontSize; $('#book-leading-output').textContent = local.prefs.lineHeight.toFixed(1); restore(saved);
    }));
  }
  function open(id = '', saved = null) {
    if (state.page === 'reader') flush(); else local.returnPage = state.page;
    ensure(); closeModal();
    const chapters = sortChapters(state.project.chapters);
    local.chapterId = chapters.some(c => c.id === id) ? id : local.record.chapterId;
    if (id && chapters.some(c => c.id === id)) local.record.positions[id] = saved || { block: 0, offset: 0, ratio: 0, signature: chapterSignature(chapters.find(c => c.id === id)) };
    local.record.chapterId = local.chapterId; local.panel = ''; navigate('reader');
  }
  function exit() { flush(); local.panel = ''; navigate(local.returnPage === 'reader' ? 'home' : local.returnPage); }
  function handleAction(name, id = '') {
    if (name === 'reader-open') { open(id); return true; }
    return false;
  }
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-reader]'); if (!target || target.disabled) return;
    const name = target.dataset.reader, id = target.dataset.id;
    if (name === 'exit') return exit();
    if (name === 'toc' || name === 'settings') return togglePanel(name);
    if (name === 'close-panel') return togglePanel(local.panel);
    if (name === 'toc-tab') { local.panelTab = id; return refreshPanel(); }
    if (name === 'chapter') return open(id);
    if (name === 'prev' || name === 'next') { const chapters = sortChapters(state.project.chapters), index = chapters.findIndex(c => c.id === local.chapterId) + (name === 'prev' ? -1 : 1); if (chapters[index]) open(chapters[index].id); }
    if (name === 'focus' || name === 'show-controls') { const saved = position(); local.focus = name === 'show-controls' ? false : !local.focus; if (local.focus && local.panel) togglePanel(local.panel); $('#book-reader').classList.toggle('is-focused', local.focus); document.querySelector('[data-reader="focus"]').setAttribute('aria-pressed', local.focus); restore(saved); }
    if (name === 'bookmark') {
      const saved = position(); if (!saved) return;
      const blocks = readerBlocks(chapter());
      if (local.record.bookmarks.some(b => b.chapterId === local.chapterId && b.block === saved.block && b.signature === saved.signature)) return toast('这个位置已经留有书签');
      if (local.record.bookmarks.length >= 100) return toast('书签已达 100 枚，请先移除不再需要的书签', true);
      local.record.bookmarks.push({ id: uid(), chapterId: local.chapterId, ...saved, preview: blocks[saved.block]?.text.slice(0, 90) || chapter().title, createdAt: new Date().toISOString() });
      flush(); refreshPanel(); toast('已在此处留下书签');
    }
    if (name === 'jump-bookmark') { const b = local.record.bookmarks.find(b => b.id === id); if (b) open(b.chapterId, b); }
    if (name === 'remove-bookmark') { local.record.bookmarks = local.record.bookmarks.filter(b => b.id !== id); write(storage.record(local.projectId), local.record); refreshPanel(); }
    if (name === 'reset-prefs') { const saved = position(); local.prefs = { ...DEFAULT_READER_PREFS }; write(storage.prefs, local.prefs); local.record.positions[local.chapterId] = saved; navigate('reader'); }
  });
  document.addEventListener('keydown', event => {
    if (state.page !== 'reader' || $('#modal').open || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (event.key === 'Escape') { event.preventDefault(); if (local.panel) togglePanel(local.panel); else if (local.focus) document.querySelector('[data-reader="show-controls"]').click(); else exit(); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); document.querySelector(`.book-reader-footer [data-reader="${event.key === 'ArrowLeft' ? 'prev' : 'next'}"]`).click(); }
    if (['PageDown', 'PageUp', 'Home', 'End'].includes(event.key) || (event.key === ' ' && !event.target.closest('button'))) {
      event.preventDefault(); const scroll = $('#book-reader-scroll');
      if (event.key === 'Home' || event.key === 'End') scroll.scrollTo({ top: event.key === 'Home' ? 0 : scroll.scrollHeight });
      else scroll.scrollBy({ top: scroll.clientHeight * 0.85 * (event.key === 'PageUp' || event.shiftKey ? -1 : 1) });
    }
  });
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  return { local, renderPage, bind, open, flush, handleAction, continueLabel };
}
