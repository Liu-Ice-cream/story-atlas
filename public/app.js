import { uid, now, emptyProject, demoProject, validateProject, validateIllustration, coverIllustration, sortChapters, countWords, stripMarkdown, chapterTitle, mergeChapters, removeEntity, contextMarkdown, readingText, extractionPrompt, parseSuggestions, applySuggestions } from './domain.js';

import { createStudioUI } from './studio-ui.js';
import { createReaderUI } from './reader-ui.js';
import { createChapterTextActions } from './chapter-text.js';
import { createFeatures } from './features.js';
import { chapterProgress, reviewItems } from './maintenance.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const e = escape;
const noteDrafts = new Map();
const state = { project: null, page: 'home', characterId: '', query: '', factionFilter: '', threadFilter: 'all', storyTab: 'threads', chapterQuery: '', exportType: 'context', saveQueue: Promise.resolve(), apiKey: '', aiBusy: false, aiQueue: {jobs: [], configured: false, paused: false}, selectedChapters: new Set(), exportOptions: {} };
const names = { home: '故事概览', chapters: '章节原文', volumes: '分卷大纲', documents: '设定与笔记', characters: '人物档案', network: '阵营与关系', threads: '支线与灵感', ai: 'AI 资料整理', export: '导出与备份', settings: '作品设置', maintenance: '资料维护', studio: '文风工作台', reader: '沉浸阅读' };
const statusLabels = { unprocessed: '已导入 · 未核对', pending: '待确认', done: '已核对', changed: '原文更新 · 需复核' };
const kindLabels = { canon: '正文记录', author: '作者设定', plan: '未来计划', unverified: '待核实' };
const typeLabels = { character_fact: '人物设定', faction: '阵营归属', relationship: '人物关系', thread: '支线进展', summary: '章节摘要' };
const threadLabels = { active: '进行中', paused: '暂缓', done: '已结束' };
const ideaLabels = { inbox: '待考虑', adopted: '已采用', archived: '已归档' };
const paths = {
  book: '<path d="M4 4h6c2 0 3 1 3 3v14c-1-2-3-3-5-3H4zM20 4h-3c-2 0-4 1-4 3v14c1-2 3-3 5-3h2z"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7"/>',
  chapters: '<path d="M7 3h10l3 3v15H4V3h3m7 0v5h6M8 12h8M8 16h6"/>',
  volumes: '<path d="M3 4h6v16H3zM10 4h5v16h-5zM17 5l4-1 3 15-4 1z"/>',
  characters: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  network: '<circle cx="12" cy="5" r="3"/><circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="m10 8-4 7m8-7 4 7M8 18h8"/>',
  threads: '<path d="M5 3v12a5 5 0 0 0 5 5h8M5 8h8a5 5 0 0 1 5 5v7M15 17l3 3 3-3"/>',
  ai: '<path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8zM19 2v4m-2-2h4"/>',
  export: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  settings: '<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>', back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  note: '<path d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h4"/>',
  check: '<path d="m5 12 4 4L19 6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  idea: '<path d="M9 18h6m-6 3h6M8 14a7 7 0 1 1 8 0l-1 4H9z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  folder: '<path d="M3 5h7l2 3h9v13H3z"/>', up: '<path d="m6 14 6-6 6 6"/>', down: '<path d="m6 10 6 6 6-6"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.book}</svg>`;
const action = (name, id = '') => `data-action="${name}"${id ? ` data-id="${e(id)}"` : ''}`;
const button = (label, name, ico, primary = false, id = '') => `<button type="button" class="btn${primary ? ' primary' : ''}" ${action(name, id)}>${ico ? icon(ico) : ''}${e(label)}</button>`;
const tag = (text, kind = '') => `<span class="tag ${kind}">${e(text)}</span>`;
const empty = (message, label = '', act = '') => `<div class="empty">${icon('book')}<p>${e(message)}</p>${label ? button(label, act, 'plus') : ''}</div>`;
const personName = id => state.project.characters.find(c => c.id === id)?.name || '未关联';
const chapterName = id => state.project.chapters.find(c => c.id === id)?.title || state.project.documents?.find(d => d.id === id)?.title || '作者笔记';
const factionNames = c => c.factionIds.map(id => state.project.factions.find(f => f.id === id)?.name).filter(Boolean);
const sourceButton = (id, quote = '') => id ? `<button class="source-link" data-action="source" data-id="${e(id)}" data-quote="${e(quote)}">${e(chapterName(id))} ↗</button>` : '<span class="muted">作者笔记</span>';
const personChip = id => `<button class="linked-item" ${action('person', id)}>${e(personName(id))}</button>`;
const formatCount = number => number >= 10000 ? `${(number / 10000).toFixed(1)}万` : number.toLocaleString('zh-CN');
const statusTag = c => tag(statusLabels[c.status], c.status === 'done' ? 'green' : c.status === 'changed' ? 'red' : 'gold');
function avatar(character, classes = '') {
  const image = coverIllustration(character);
  return `<span class="avatar ${classes}${image ? ' with-image' : ''}">${image ? `<img src="${e(image.dataUrl)}" alt="${e(character.name)}的人物插图" loading="lazy"/>` : e(character.name.slice(0, 1))}</span>`;
}
function renderIllustrations(character) {
  const images = character.illustrations || [], cover = coverIllustration(character);
  return `<div class="detail-section illustrations"><div class="detail-title"><h3>人物插图 <span class="muted">/ ${images.length}</span></h3><button class="btn small" ${action('import-illustrations', character.id)}>${icon('upload')}导入图片</button></div>${images.length ? `<div class="illustration-grid">${images.map(image => `<button class="illustration-card" data-action="view-illustration" data-person="${e(character.id)}" data-id="${e(image.id)}"><span class="illustration-frame"><img src="${e(image.dataUrl)}" alt="${e(image.name)}" loading="lazy"/>${image.id === cover?.id ? '<span class="illustration-cover-label">人物封面</span>' : ''}</span><span class="illustration-name">${e(image.name)}</span></button>`).join('')}</div>` : `<button class="illustration-empty" ${action('import-illustrations', character.id)}>${icon('upload')}<span>导入人物立绘、肖像或设定参考图<small>支持 JPG、PNG、WebP，可一次选择多张。</small></span><span class="illustration-empty-arrow">↗</span></button>`}</div>`;
}

function toast(message, error = false) {
  const el = document.createElement('div'); el.className = `toast${error ? ' error' : ''}`; el.textContent = message;
  $('#toasts').append(el); setTimeout(() => el.remove(), error ? 8000 : 4000);
}
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}
function mutate(fn, message = '', redraw = true, restoring = false) {
  const task = async () => {
    const copy = structuredClone(state.project);
    const result = fn(copy) || copy;
    validateProject(result);
    const status = $('#save-status'); if (status) status.textContent = '正在保存…';
    const previousProjectId = state.project.projectId;
    state.project = await api(restoring ? '/api/project/restore' : '/api/project', { method: restoring ? 'POST' : 'PUT', body: JSON.stringify(result) });
    if (restoring) { noteDrafts.delete(state.project.projectId); state.exportOptions = {}; }
    if (restoring || previousProjectId !== state.project.projectId) { features.reset(); studioUI.reset(); await features.refresh(); await studioUI.refresh(); }
    if (redraw) render();
    else if (status) status.textContent = '已保存到本机';
    if (message) toast(message);
    return state.project;
  };
  const result = state.saveQueue.then(task);
  state.saveQueue = result.catch(error => { toast(error.message, true); const el = $('#save-status'); if (el) el.textContent = '保存失败，请保留当前窗口'; });
  return result;
}
function navigate(page) { readerUI.flush(); state.page = page; render(); window.scrollTo({ top: 0, behavior: 'instant' }); if (page === 'studio') void studioUI.refresh(); if (page === 'maintenance') void features.refresh().then(() => { if (state.page === 'maintenance' && !document.querySelector('#modal').open) render(); }); }
function heading(title, subtitle, right = '', eyebrow = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${e(eyebrow || 'YOUR STORY, CONNECTED')}</div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div><div class="heading-actions">${right}</div></div>`;
}
function render() {
  chapterTextActions.hide();
  if (state.page === 'reader') { $('#app').innerHTML = readerUI.renderPage(); readerUI.bind(); chapterTextActions.bind(); return; }
  const p = state.project;
  const nav = [['home', '故事概览', ''], ['chapters', '章节原文', p.chapters.length], ['reader', '沉浸阅读', ''], ['volumes', '分卷大纲', p.volumes.length], ['documents', '设定与笔记', p.documents.length], ['characters', '人物档案', p.characters.length], ['network', '阵营与关系', ''], ['threads', '支线与灵感', p.threads.filter(t => t.status !== 'done').length], ['ai', 'AI 资料整理', p.review?.length || ''], ['studio', '文风工作台', ''], ['maintenance', '资料维护', reviewItems(p).length || '']];
  $('#app').innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">${icon('book')}</span><div><strong>拾章</strong><small>STORY ATLAS</small></div></div><button class="book-switch" ${action('project-settings')}>${icon('book')}<div><strong>${e(p.title)}</strong><small>${p.isDemo ? '示例作品 · 可自由体验' : e(p.genre || '我的故事档案')}</small></div></button><div class="nav-label">写作工作台</div><nav class="nav">${nav.map(([key, label, count]) => `<button class="${state.page === key ? 'active' : ''}" data-page="${key}">${icon(key)}${label}${count !== '' ? `<span class="count">${count}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><nav class="nav">${['export', 'settings'].map(key => `<button class="${state.page === key ? 'active' : ''}" data-page="${key}">${icon(key)}${names[key]}</button>`).join('')}</nav><div class="local-status"><span class="dot"></span><span id="save-status">已保存到本机</span><div style="padding-left:13px;margin-top:3px">每一个故事，都有迹可循。</div></div><div class="sidebar-foot">STORY ATLAS / LOCAL EDITION 0.6.2</div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">${icon('book')}<span>${e(p.title)}</span><span>/</span><b>${names[state.page]}</b></div><div class="top-actions"><button class="global-search" ${action('search')}>${icon('search')}搜索人物、设定、原文<kbd>Ctrl K</kbd></button>${button('导入章节', 'import', 'plus', true)}</div></header><main class="content">${p.isDemo ? `<div class="demo-banner"><span>当前为示例作品《雾渡》，所有记录都可修改。开始使用自己的作品时，请新建作品。</span><button class="btn small ghost" ${action('new-project')}>新建我的作品 ${icon('arrow')}</button></div>` : ''}<div id="maintenance-alert">${features.alert()}</div><div id="ai-status-strip">${renderQueueStrip()}</div>${({ home: renderHome, chapters: renderChapters, volumes: renderVolumes, documents: renderDocuments, characters: renderCharacters, network: renderNetwork, threads: renderThreads, ai: renderAI, export: renderExport, settings: renderSettings, maintenance: features.renderMaintenance, studio: studioUI.renderPage }[state.page] || renderHome)()}</main></div></div>`;
  bindPageEvents(); features.bind(); studioUI.bind();
  chapterTextActions.bind();
}

function renderHome() {
  const p = state.project, chapters = sortChapters(p.chapters);
  if (!p.chapters.length && !p.characters.length) return `${heading('让故事里的每个人，都有迹可循。', '把散落在章节里的设定、关系和未完故事，收回到手边。', '', 'WELCOME TO STORY ATLAS')}<div class="welcome"><div class="eyebrow">从你写下的第一章开始</div><h2>写到后来，<br>依然记得最初的细节。</h2><p>拾章是放在写作软件旁边的资料助手。导入章节，记住人物设定，追踪没写完的支线；需要讨论时，再把相关资料交给 AI。</p><div class="actions">${button('导入我的章节', 'import', 'upload', true)}${button('体验示例作品', 'load-demo', 'book')}${button('恢复已有备份', 'restore', 'folder')}</div><div class="welcome-steps"><div><b>01</b><strong>导入章节原文</strong><p>一章一个 MD 或 TXT 文件，批量导入。</p></div><div><b>02</b><strong>积累人物档案</strong><p>手动记录或 AI 提取，保留原文出处。</p></div><div><b>03</b><strong>接住未完的故事</strong><p>人物支线、临时灵感，随时找回。</p></div></div></div>`;
  const facts = p.characters.reduce((n, c) => n + c.facts.length, 0);
  const active = p.threads.filter(t => t.status === 'active');
  return `<div class="book-opening"><div class="book-spine" aria-hidden="true"><span>拾章</span><small>私人写作档案</small></div><div class="book-opening-text"><p class="book-kicker">长篇手记 <span>／</span> ${e(p.genre || '故事创作档案')}</p><h1>${e(p.title)}</h1><p class="book-subtitle">写至「${e(chapters.at(-1)?.title || '尚无章节')}」<span> · </span> 每一处伏笔，每一个未完的故事。</p></div><div class="book-opening-action">${button(readerUI.continueLabel(), 'reader-open', 'book', true)}${button('随手记一笔', 'new-idea', 'edit')}</div></div>
    <div class="stats">${[
      ['已收录章节', chapters.length, '章', `${formatCount(chapters.reduce((n, c) => n + countWords(c.body), 0))} 字正文`, 'chapters'],
      ['故事中的人物', p.characters.length, '人', `${facts} 条设定，随时查阅`, 'characters'],
      ['进行中的支线', active.length, '条', `${p.threads.filter(t => t.status === 'paused').length} 条暂缓，${p.threads.filter(t => t.status === 'done').length} 条已结束`, 'threads'],
      ['需核对章节', chapters.filter(c => !chapterProgress(p, c.id, state.aiQueue.jobs).reviewed).length, '章', `${p.review?.length || 0} 条待确认 · ${reviewItems(p).length} 条需复核`, 'maintenance']
    ].map(([label, value, unit, caption, ico]) => `<div class="stat"><div class="stat-label">${label}${icon(ico)}</div><div class="stat-value">${value}<span>${unit}</span></div><div class="stat-caption">${e(caption)}</div></div>`).join('')}</div>
    <div class="dashboard-grid"><div><section class="section"><div class="section-head"><h2><span class="index">01</span>最近的章节</h2><button class="btn ghost small" data-page="chapters">全部章节 ${icon('arrow')}</button></div><div class="panel">${chapters.slice(-4).reverse().map(c => `<div class="chapter-row"><span class="chapter-number">${String(chapters.indexOf(c) + 1).padStart(2, '0')}</span><div class="chapter-info"><h3><button class="table-title" ${action('reader-open', c.id)}>${e(c.title)}</button></h3><p>${e(c.summary || '尚无摘要，可以手动记录或通过 AI 整理。')}</p></div>${statusTag(c)}<button class="icon-btn" title="查看原文" ${action('reader-open', c.id)}>${icon('arrow')}</button></div>`).join('') || empty('还没有章节', '导入章节', 'import')}</div></section>
    <section class="section"><div class="section-head"><h2><span class="index">02</span>回到人物身边</h2><button class="btn ghost small" data-page="characters">人物档案 ${icon('arrow')}</button></div><div class="people-strip">${p.characters.slice(0, 6).map((c, i) => `<button class="person-mini" ${action('person', c.id)}>${avatar(c, i % 3 === 1 ? 'alt' : '')}<div><h3>${e(c.name)}</h3><small>${e(factionNames(c).join(' · ') || '阵营未记录')}</small></div></button>`).join('') || empty('先建立第一位人物', '新建人物', 'new-character')}</div></section>
    <div class="inline-note">${icon('search')} 想起一个人物，却忘了前文怎么写的？<p>搜索姓名、别名或设定关键词，找到记录后，可以直接展开对应原文。按 Ctrl + K 开始搜索。</p></div></div>
    <aside class="dashboard-aside"><section class="section"><div class="note-panel"><div class="note-top"><h2>${icon('note')} 停笔备忘</h2><span class="eyebrow">PICK UP HERE</span></div><textarea id="home-note" aria-label="停笔备忘" placeholder="上次停在哪里？接下来想写什么？">${e(noteDrafts.get(p.projectId) ?? p.note)}</textarea><div style="display:flex;align-items:center;justify-content:space-between"><small id="home-note-hint">${noteDrafts.has(p.projectId) && noteDrafts.get(p.projectId) !== p.note ? '备忘尚未保存，切换页面会保留草稿。' : '留几句话，给下次打开文档的自己。'}</small><button class="btn small ghost" ${action('save-note')}>保存备忘 ${icon('check')}</button></div></div></section><section class="section"><div class="section-head"><h2><span class="index">03</span>还没写完的故事</h2><span class="tag">${active.length} 条进行中</span></div><div class="panel">${active.slice(0, 4).map(t => `<div class="thread-mini"><div class="thread-mini-top"><h3><button class="table-title" ${action('edit-thread', t.id)}>${e(t.title)}</button></h3>${icon('threads')}</div><p>${e(t.description.slice(0, 78))}${t.description.length > 78 ? '…' : ''}</p><div class="linked-list" style="margin-top:8px">${t.characterIds.slice(0, 3).map(personChip).join('')}</div></div>`).join('') || empty('没有进行中的支线', '记录支线', 'new-thread')}</div></section></aside></div>`;
}

function renderChapters() {
  const p = state.project;
  const chapters = sortChapters(p.chapters).filter(c => `${c.title} ${c.filename} ${c.volume}`.toLowerCase().includes(state.chapterQuery.toLowerCase()));
  return `${heading('章节原文', '每一条人物记录，都从这里找到出处。', button(readerUI.continueLabel(), 'reader-open', 'book') + button('批量导入', 'import', 'upload', true), '卷中篇目')}<div class="toolbar"><input class="input" id="chapter-search" type="search" placeholder="搜索章节标题或文件名" value="${e(state.chapterQuery)}" aria-label="搜索章节"/><span class="spacer"></span><span class="muted" style="font-size:11px">${p.chapters.length} 章 · ${formatCount(p.chapters.reduce((n, c) => n + countWords(c.body), 0))} 字</span>${button('整理所选章节', 'ai-selected', 'ai')}</div><div class="panel table-scroll"><table class="table"><thead><tr><th><input type="checkbox" id="select-all-chapters" aria-label="选择全部可见章节" ${chapters.length && chapters.every(c => state.selectedChapters.has(c.id)) ? 'checked' : ''}/></th><th>章节 / 来源文件</th><th>所属卷</th><th>字数</th><th>资料整理</th><th>操作</th></tr></thead><tbody>${chapters.map(c => `<tr><td><input type="checkbox" data-chapter-check="${e(c.id)}" aria-label="选择${e(c.title)}" ${state.selectedChapters.has(c.id) ? 'checked' : ''}/></td><td><button class="table-title" ${action('reader-open', c.id)}>${e(c.title)}</button><div class="filename">${e(c.filename)}</div></td><td class="muted">${e(c.volume || '未分卷')}</td><td class="muted">${countWords(c.body).toLocaleString()}</td><td>${features.progress(c)}</td><td class="actions-cell"><button class="icon-btn" title="上移章节" ${action('chapter-up', c.id)}>${icon('up')}</button><button class="icon-btn" title="下移章节" ${action('chapter-down', c.id)}>${icon('down')}</button><button class="icon-btn" title="编辑章节资料" ${action('edit-chapter', c.id)}>${icon('edit')}</button><button class="icon-btn" title="删除章节" data-action="delete" data-kind="chapters" data-id="${e(c.id)}">${icon('trash')}</button></td></tr>`).join('')}</tbody></table>${!chapters.length ? empty(p.chapters.length ? '没有匹配的章节' : '导入 MD 或 TXT，开始收录正文', '导入章节', 'import') : ''}</div><p class="hint">阅读正文时选中文字，即可改写选区或从选区末尾续写；也可右键打开操作。重复导入同名文件会更新原章节，并提示复核相关设定。章节顺序可通过上下箭头调整；“字数”统计为非空白字符数。</p>`;
}

function renderDocuments() {
  const p = state.project;
  return `${heading('设定与笔记', '保留原始大纲、作者设定和讨论记录，与章节正文分开查阅。', button('新建文档', 'new-document', 'plus', true), '案头参考')}<div class="notice">作者资料可能早于当前正文。计划、暂定与幕后信息保留原标记，后续进展以对应章节为准。</div><div class="cards-grid">${p.documents.map(d => `<article class="story-card"><div class="story-card-top">${tag(d.kind === 'outline' ? '作者大纲' : d.kind === 'setting' ? '设定文档' : '作者笔记', 'gold')}<small class="muted">${formatCount(countWords(d.body))} 字</small></div><h3>${e(d.title)}</h3><p class="description">${e(d.description || d.body.replace(/^#+\s*/gm, '').slice(0, 160))}</p><div class="story-card-bottom"><small class="muted">${e(d.sourcePath || '项目资料')}</small><div class="actions">${button('编辑', 'edit-document', 'edit', false, d.id)}${button('查看全文', 'read', 'arrow', false, d.id)}</div></div></article>`).join('') || empty('尚无资料文档', '新建文档', 'new-document')}</div>`;
}
function renderVolumes() {
  const p = state.project;
  return `${heading('分卷大纲', '把计划中的走向，与已经写到的进展放在一起。', button('新建分卷', 'new-volume', 'plus', true), '分卷与谋篇')}<div class="cards-grid">${p.volumes.map(v => {
    const chapters = sortChapters(p.chapters).filter(c => c.volume === v.title);
    return `<article class="story-card"><div class="story-card-top">${tag(`${chapters.length} 章 · ${formatCount(chapters.reduce((n, c) => n + countWords(c.body), 0))} 字`, 'green')}<button class="icon-btn" title="编辑卷纲" ${action('edit-volume', v.id)}>${icon('edit')}</button></div><h3>${e(v.title)}</h3><p class="hint" style="margin-bottom:5px">实际进展 · 已写到哪里</p><p class="description">${e(v.summary || '还没有整理本卷的实际进展。')}</p><div class="next">卷纲 · 作者计划<br>${e(v.outline || '还没有记录本卷大纲。')}</div><div class="story-card-bottom"><small class="muted">${chapters.length ? `最近章节：${e(chapters.at(-1).title)}` : '导入章节或编辑章节资料时，可填写此卷名称。'}</small><button class="btn small ghost" ${action('edit-volume', v.id)}>编辑 ${icon('arrow')}</button></div></article>`;
  }).join('')}</div>${!p.volumes.length ? empty('先建立一卷，或在导入章节时填写所属卷', '新建分卷', 'new-volume') : ''}`;
}
function renderCharacters() {
  const p = state.project;
  const characters = p.characters.filter(c => `${c.name} ${c.aliases.join(' ')} ${c.description} ${c.facts.map(f => f.text).join(' ')}`.toLowerCase().includes(state.query.toLowerCase()) && (!state.factionFilter || c.factionIds.includes(state.factionFilter)));
  let selected = characters.find(c => c.id === state.characterId) || characters[0];
  if (selected) state.characterId = selected.id;
  return `${heading('人物档案', '记住他们的来处、牵绊，和未走完的路。', button('新建人物', 'new-character', 'plus', true), '故事中的人')}<div class="toolbar"><input id="character-search" class="input" type="search" placeholder="搜索姓名、别名或设定" value="${e(state.query)}" aria-label="搜索人物与设定"/><select class="select" id="character-faction" aria-label="按阵营筛选"><option value="">全部阵营</option>${p.factions.map(f => `<option value="${e(f.id)}" ${state.factionFilter === f.id ? 'selected' : ''}>${e(f.name)}</option>`).join('')}</select><span class="spacer"></span><small class="muted">${characters.length} 位人物</small></div><div class="split"><div class="character-list">${characters.map((c, i) => `<button class="character-card ${selected?.id === c.id ? 'active' : ''}" ${action('person', c.id)}>${avatar(c, i % 3 === 1 ? 'alt' : '')}<div><strong>${e(c.name)}</strong><p>${e(factionNames(c).join(' · ') || '阵营未记录')}</p><div class="fact-count">${c.facts.length} 条记录 · ${p.threads.filter(t => t.characterIds.includes(c.id) && t.status !== 'done').length} 条未完支线</div></div></button>`).join('') || empty('没有匹配的人物')}</div><div class="character-detail">${selected ? renderProfile(selected) : empty('建立人物档案，积累正文里的每一个细节', '新建人物', 'new-character')}</div></div>`;
}
function renderProfile(c) {
  const p = state.project;
  const appearances = sortChapters(p.chapters).filter(ch => [c.name, ...c.aliases].filter(Boolean).some(n => ch.body.includes(n)));
  const relations = p.relationships.filter(r => r.fromId === c.id || r.toId === c.id);
  const threads = p.threads.filter(t => t.characterIds.includes(c.id));
  const ideas = p.ideas.filter(t => t.characterIds.includes(c.id) && t.status !== 'archived');
  return `<div class="profile-header"><button class="portrait-button" title="${coverIllustration(c) ? '查看人物插图' : '导入人物插图'}" ${coverIllustration(c) ? `data-action="view-illustration" data-person="${e(c.id)}" data-id="${e(coverIllustration(c).id)}"` : action('import-illustrations', c.id)}>${avatar(c, 'large')}<span class="portrait-caption">${coverIllustration(c) ? '查看插图 ↗' : '添加插图 +'}</span></button><div class="profile-info"><h2>${e(c.name)}${c.aliases.length ? `<span class="aliases">${e(c.aliases.join(' / '))}</span>` : ''}</h2><p>${e(c.description || '尚无人物简介')}</p><div class="profile-tags">${factionNames(c).map(n => tag(n, 'green')).join('') || tag('阵营未记录')}${tag(`${appearances.length} 章出现`)}</div></div><div class="heading-actions"><button class="icon-btn" title="编辑人物" ${action('edit-character', c.id)}>${icon('edit')}</button><button class="icon-btn" title="删除人物" data-action="delete" data-kind="characters" data-id="${e(c.id)}">${icon('trash')}</button></div></div><div class="profile-body">${features.timeline(c)}${renderIllustrations(c)}<div class="detail-section"><div class="detail-title"><h3>设定与状态 <span class="muted">/ ${c.facts.length}</span></h3><button class="btn small" ${action('new-fact', c.id)}>${icon('plus')}添加记录</button></div>${c.facts.map(f => `<div class="fact ${e(f.kind)}"><div class="fact-top"><p>${e(f.text)}</p><button class="icon-btn" title="编辑设定" data-action="edit-fact" data-person="${e(c.id)}" data-id="${e(f.id)}">${icon('edit')}</button></div><div class="fact-meta">${tag(kindLabels[f.kind], f.kind === 'plan' ? 'gold' : f.kind === 'unverified' ? 'red' : 'green')}${sourceButton(f.chapterId || f.sourceDocumentId, f.quote)}${f.needsReview ? tag('原文变更，待复核', 'red') : ''}</div>${f.quote ? `<blockquote>${e(f.quote)}</blockquote>` : ''}</div>`).join('') || '<p class="hint">可以手动记录，也可以通过 AI 从章节中提取资料。</p>'}</div><div class="detail-section"><div class="detail-title"><h3>最近出现</h3></div>${appearances.length ? `<div class="linked-list">${appearances.slice(-4).reverse().map(ch => `<button class="linked-item" ${action('read', ch.id)}>${e(ch.title)} ↗</button>`).join('')}</div><p class="hint">按姓名和别名在正文中查找，仅作定位参考。</p>` : '<p class="hint">尚未在导入的正文中匹配到姓名或别名。</p>'}</div><div class="detail-section"><div class="detail-title"><h3>人物关系</h3><button class="btn small ghost" ${action('new-relationship', c.id)}>${icon('plus')}记录关系</button></div>${relations.map(r => `<div class="relationship-row" style="padding:9px 0"><div><strong>${e(personName(r.fromId))} → ${e(personName(r.toId))}</strong> ${tag(r.name)}<p>${e(r.description)}</p>${sourceButton(r.chapterId || r.sourceDocumentId, r.quote)}</div><button class="icon-btn" title="编辑关系" ${action('edit-relationship', r.id)}>${icon('edit')}</button></div>`).join('') || '<p class="hint">尚未记录关系。</p>'}</div><div class="detail-section"><div class="detail-title"><h3>人物支线</h3><button class="btn small ghost" ${action('new-thread', c.id)}>${icon('plus')}记录支线</button></div>${threads.map(t => `<div class="thread-mini" style="padding-left:0;padding-right:0"><div class="thread-mini-top"><button class="table-title" ${action('edit-thread', t.id)}>${e(t.title)}</button>${tag(threadLabels[t.status], t.status === 'active' ? 'green' : '')}</div><p>${e(t.description)}</p></div>`).join('') || '<p class="hint">还没有关联的人物支线。</p>'}</div>${ideas.length ? `<div class="detail-section"><div class="detail-title"><h3>关联灵感</h3>${tag('尚未成为正文事实', 'gold')}</div>${ideas.map(i => `<button class="linked-item" style="margin:0 6px 6px 0" ${action('edit-idea', i.id)}>${icon('idea')} ${e(i.title)}</button>`).join('')}</div>` : ''}<div style="border-top:1px solid var(--line);padding-top:18px">${button('导出此人物的讨论资料', 'export-person', 'export', false, c.id)}</div></div>`;
}

function renderNetwork() {
  const p = state.project;
  const visible = p.characters.filter(c => !state.factionFilter || c.factionIds.includes(state.factionFilter));
  const nodes = visible.slice(0, 30);
  const positions = new Map(nodes.map((c, i) => { const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2; const radius = nodes.length <= 1 ? 0 : Math.min(175, 85 + nodes.length * 12); return [c.id, { x: 350 + Math.cos(angle) * radius * 1.4, y: 230 + Math.sin(angle) * radius }]; }));
  const edges = p.relationships.filter(r => positions.has(r.fromId) && positions.has(r.toId));
  return `${heading('阵营与关系', '从一个人物出发，看见整个故事的牵绊。', button('记录关系', 'new-relationship', 'plus', true) + button('新建阵营', 'new-faction', 'folder'), '人物与牵绊')}<div class="toolbar"><select class="select" id="network-faction" aria-label="关系图阵营筛选"><option value="">全部阵营</option>${p.factions.map(f => `<option value="${e(f.id)}" ${state.factionFilter === f.id ? 'selected' : ''}>${e(f.name)}</option>`).join('')}</select><small class="muted">点击人物进入档案 · 箭头表示关系方向</small></div><div class="network-layout"><div class="panel network">${nodes.length ? `<svg viewBox="0 0 700 470" role="group" aria-label="人物关系图"><defs><marker id="arrowhead" markerWidth="7" markerHeight="7" refX="7" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="#809bdb"/></marker></defs>${edges.map(r => { const a = positions.get(r.fromId), b = positions.get(r.toId); const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 1; const x1 = a.x + dx / dist * 32, y1 = a.y + dy / dist * 32, x2 = b.x - dx / dist * 36, y2 = b.y - dy / dist * 36; return `<g><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#a9bce7" stroke-width="1.3" marker-end="url(#arrowhead)"/><rect x="${(a.x + b.x) / 2 - 32}" y="${(a.y + b.y) / 2 - 10}" width="64" height="20" rx="4" fill="#fafbff"/><text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 + 4}" text-anchor="middle" font-size="10" fill="#7386b1">${e(r.name.slice(0, 6))}</text><title>${e(r.name)}</title></g>`; }).join('')}${nodes.map(c => { const pos = positions.get(c.id); return `<g class="node" data-action="person" data-id="${e(c.id)}" tabindex="0" role="button" aria-label="查看${e(c.name)}"><circle cx="${pos.x}" cy="${pos.y}" r="30" fill="#eaf0ff" stroke="#8ca8e8"/><text x="${pos.x}" y="${pos.y + 6}" text-anchor="middle" font-size="17" font-family="SimSun,serif" fill="#002fa7">${e(c.name.slice(0, 3))}</text><text x="${pos.x}" y="${pos.y + 49}" text-anchor="middle" font-size="10" fill="#7d90ba">${e(factionNames(c).join(' / ').slice(0, 20) || '阵营未记录')}</text></g>`; }).join('')}</svg><div class="network-caption">${nodes.length} 位人物 · ${edges.length} 条关系${visible.length > 30 ? ' · 图中最多展示 30 人，请按阵营筛选' : ''}</div>` : empty('建立人物与关系后，在这里看见故事网络', '新建人物', 'new-character')}</div><div class="panel network-factions">${p.factions.map(f => `<div class="faction-card"><div class="faction-card-head"><h3>${e(f.name)}</h3><button class="icon-btn" title="编辑阵营" ${action('edit-faction', f.id)}>${icon('edit')}</button></div><p>${e(f.description || '尚无阵营说明')}</p><div class="faction-members">${p.characters.filter(c => c.factionIds.includes(f.id)).map(c => personChip(c.id)).join('') || '<small class="muted">尚无关联人物</small>'}</div></div>`).join('') || empty('尚无阵营', '新建阵营', 'new-faction')}</div></div><section class="relationship-list"><div class="section-head"><h2>关系记录</h2><small class="muted">保留方向、说明和章节出处</small></div><div class="panel">${p.relationships.filter(r => !state.factionFilter || visible.some(c => c.id === r.fromId || c.id === r.toId)).map(r => `<div class="relationship-row"><div><strong>${e(personName(r.fromId))} → ${e(personName(r.toId))}</strong> ${tag(r.name, 'green')}<p>${e(r.description)}</p>${sourceButton(r.chapterId || r.sourceDocumentId, r.quote)}</div><button class="icon-btn" title="编辑关系" ${action('edit-relationship', r.id)}>${icon('edit')}</button><button class="icon-btn" title="删除关系" data-action="delete" data-kind="relationships" data-id="${e(r.id)}">${icon('trash')}</button></div>`).join('') || empty('尚未记录人物关系')}</div></section>`;
}

function renderThreads() {
  const p = state.project, isIdea = state.storyTab === 'ideas', kind = isIdea ? 'ideas' : 'threads';
  const labels = isIdea ? ideaLabels : threadLabels;
  const items = p[kind].filter(t => state.threadFilter === 'all' || t.status === state.threadFilter);
  return `${heading('支线与灵感', '已经展开的故事，和还没落笔的可能。', button(isIdea ? '记个灵感' : '记录支线', isIdea ? 'new-idea' : 'new-thread', 'plus', true), '未完之事')}<div class="toolbar"><div class="tabs"><button data-tab="threads" class="${!isIdea ? 'active' : ''}">人物支线 ${p.threads.length}</button><button data-tab="ideas" class="${isIdea ? 'active' : ''}">灵感收件箱 ${p.ideas.length}</button></div><span class="spacer"></span><select class="select" id="thread-filter" aria-label="按状态筛选"><option value="all">全部状态</option>${Object.entries(labels).map(([k, v]) => `<option value="${k}" ${state.threadFilter === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>${isIdea ? '<div class="notice">灵感是尚未采用的可能性。可以随时记下一句话，决定采用时再转成支线计划。</div>' : ''}<div class="cards-grid">${items.map(t => `<article class="story-card"><div class="story-card-top">${tag(labels[t.status], t.status === 'active' ? 'green' : isIdea ? 'gold' : '')}<div><button class="icon-btn" title="编辑${isIdea ? '灵感' : '支线'}" ${action(isIdea ? 'edit-idea' : 'edit-thread', t.id)}>${icon('edit')}</button><button class="icon-btn" title="删除记录" data-action="delete" data-kind="${kind}" data-id="${e(t.id)}">${icon('trash')}</button></div></div><h3>${e(t.title)}</h3><p class="description">${e(t.description || '尚无详细说明')}</p>${!isIdea && t.next ? `<div class="next">后续计划 · ${e(t.next)}</div>` : ''}<div class="story-card-bottom"><div class="linked-list">${t.characterIds.map(personChip).join('') || '<small class="muted">未关联人物</small>'}</div>${isIdea && t.status !== 'adopted' ? `<button class="btn small ghost" ${action('adopt-idea', t.id)}>转为支线 ${icon('arrow')}</button>` : sourceButton(t.chapterId || t.sourceDocumentId)}</div></article>`).join('')}</div>${!items.length ? empty('这里还没有符合条件的记录', isIdea ? '记个灵感' : '记录支线', isIdea ? 'new-idea' : 'new-thread') : ''}`;
}

function chapterChecklist(selected, name = 'ai-chapter') {
  return `<div class="checklist">${sortChapters(state.project.chapters).map(c => `<label class="checkbox-line"><input type="checkbox" name="${name}" value="${e(c.id)}" ${selected.has(c.id) ? 'checked' : ''}/><span>${e(c.title)} <small>${e(c.volume || '未分卷')} · ${statusLabels[c.status]}</small></span></label>`).join('') || '<p class="hint">先导入章节正文。</p>'}</div>`;
}
const jobStatusLabels = { waiting_config: '等待接口配置', queued: '排队中', running: '正在整理', ready: '等待你确认', collected: '已领取', failed: '整理失败', empty: '未提取到新资料', outdated: '原文已变更' };
function renderQueueStrip() {
  const queue = state.aiQueue;
  const running = queue.jobs.find(j => j.status === 'running' && !j.outdated);
  const ready = queue.jobs.filter(j => j.status === 'ready' && !j.outdated).length;
  const waiting = queue.jobs.filter(j => ['queued', 'waiting_config'].includes(j.status) && !j.outdated).length;
  if (!running && !ready && !waiting && !queue.error) return '';
  return `<div class="ai-status-line"><span>${running ? '<span class="busy-indicator"></span>' : icon('ai')} ${running ? '正在读：' + e(running.chapterTitle) : ready ? `有 ${ready} 章整理结果，等你过目` : queue.paused ? '整理队列已暂停' : queue.configured ? `${waiting} 章正在排队` : `${waiting} 章等待你配置接口`}</span><button class="btn small ghost" data-page="ai">查看整理进度 ${icon('arrow')}</button></div>`;
}
function renderJobList() {
  const queue = state.aiQueue;
  const jobs = queue.jobs.slice(0, 30);
  return `<div class="queue-controls"><span class="tag ${queue.configured ? 'green' : ''}">${queue.configured ? '接口会话已配置' : '接口尚未配置'}</span><button class="btn small ghost" data-action="toggle-ai-pause">${queue.paused ? '继续队列' : '暂停后续任务'}</button></div>${queue.error ? `<p class="error-message">${e(queue.error)}</p>` : ''}${jobs.length ? jobs.map(job => `<div class="job-row"><div><strong>${e(job.chapterTitle)}</strong><p>${job.automatic ? '导入后自动整理' : '手动整理'} · ${job.status === 'running' ? '正在阅读原文…' : job.suggestionCount ? `${job.suggestionCount} 条建议` : `已尝试 ${job.attempts} 次`}</p>${job.error ? `<p class="job-error">${e(job.error)}</p>` : ''}</div><div class="job-actions">${tag(job.outdated ? '原文已变更' : jobStatusLabels[job.status] || job.status, job.status === 'failed' ? 'red' : job.status === 'ready' ? 'green' : '')}${job.status === 'ready' && !job.outdated ? button('查看建议', 'collect-ai-job', 'check', false, job.id) : job.status === 'failed' && !job.outdated ? button('重试', 'retry-ai-job', 'arrow', false, job.id) : ''}</div></div>`).join('') : '<p class="hint">开启自动整理后，新导入或更新的章节会出现在这里。也可以勾选旧章节，手动加入队列。</p>'}<p class="hint">一次整理一章；失败后不会自动重发。关闭浏览器后本机服务可继续处理，停止服务会中断当前请求；重启后需重新配置会话密钥。</p>`;
}
function renderAI() {
  const p = state.project, review = p.review || [];
  return `${heading('与故事共读', '让 AI 把新章节里的细节收进档案，最后由你定稿。', review.length ? button(`过目 ${review.length} 条待确认资料`, 'review', 'check', true) : '', 'AI 资料整理')}<div class="ai-workflow"><span><b>一</b> 配置你的接口</span><i>→</i><span><b>二</b> 导入新章，自动整理</span><i>→</i><span><b>三</b> 核对出处，确认入档</span></div><div class="settings-grid"><div><section class="panel form-panel section"><h2>接入你的 AI</h2><label class="field"><span>接口基础地址</span><input class="input" id="ai-endpoint" type="url" value="${e(p.settings.endpoint)}" placeholder="https://服务商地址/v1"/><small>兼容 Chat Completions 的基础地址，末尾不含 /chat/completions。</small></label><label class="field"><span>模型名称</span><input class="input" id="ai-model" value="${e(p.settings.model)}" placeholder="服务商提供的模型 ID"/></label><label class="field"><span>API Key</span><input class="input" id="ai-key" type="password" autocomplete="off" value="${e(state.apiKey)}" placeholder="${state.aiQueue.configured ? '已配置会话；留空沿用，也可输入新密钥' : '输入密钥；本地免密接口可留空'}"/><small>密钥仅留在本机服务内存，停止服务后清除，不写入项目或备份。</small></label><label class="auto-organize-option"><input type="checkbox" id="ai-auto" ${p.settings.autoOrganize ? 'checked' : ''}/><span><strong>导入新章节后自动整理</strong><small>只处理新增或正文有变化的章节，识别人物、设定、阵营、关系、支线和章节摘要。</small></span></label><p class="hint">开启后，导入的正文及相关既有正文记录会发送至你配置的服务商，按其规则计费。提取结果先等你确认。</p><div class="heading-actions">${button('保存配置', 'save-ai-settings', 'check', true)}${state.aiQueue.configured ? button('清除会话密钥', 'clear-ai-session', '') : ''}</div></section><section class="panel form-panel"><h2>补整已有章节</h2><p class="hint">旧章节不会因为开启开关而全部重跑，可手动选择需要补整的部分。</p><div class="toolbar"><button class="btn small" ${action('select-unprocessed')}>选择前 5 章待整理内容</button><button class="btn small ghost" ${action('clear-ai-selection')}>清空</button></div>${chapterChecklist(state.selectedChapters)}<p class="hint">已选 <b id="ai-selected-count">${state.selectedChapters.size}</b> 章</p><button class="btn primary" ${action('run-ai')} ${state.aiBusy ? 'disabled' : ''}>${icon('ai')}${state.aiBusy ? '正在加入队列…' : '加入整理队列'}</button></section></div><div><section class="panel form-panel section"><div class="section-head"><h2>整理进度</h2>${button('刷新', 'refresh-ai-jobs', 'clock')}</div><div id="ai-job-list">${renderJobList()}</div></section><section class="panel form-panel section"><h2>交给外部 AI 整理</h2><p class="hint">选择左侧章节，导出任务交给外部 AI；将它返回的 JSON 导回，在同一份确认列表里核对。</p><div class="heading-actions" style="margin:18px 0">${button('导出任务 TXT', 'export-task', 'export')}${button('导入结果 JSON', 'import-ai-file', 'upload')}</div><label class="field"><span>或粘贴整理结果</span><textarea id="ai-result" style="min-height:130px;font-family:Consolas,monospace;font-size:11px" placeholder='{"schemaVersion":1,"suggestions":[…]}'></textarea></label>${button('检查并加入待确认列表', 'parse-ai', 'check')}<p class="hint">原文片段或章节编号不匹配时，需要先修正。</p></section><section class="note-panel"><div class="note-top"><h2>等你过目的资料</h2>${tag(`${review.length} 条`, 'green')}</div><p class="hint">AI 只提出记录建议。人物关系的变化会保留出处，不直接覆盖旧设定。</p>${review.length ? button('打开确认列表', 'review', 'arrow') : '<small>确认的资料会进入人物档案与关系记录。</small>'}</section></div></div>`;
}

function getExportText() {
  const p = state.project, opts = state.exportOptions;
  if (state.exportType === 'backup') return JSON.stringify(p, null, 2);
  if (state.exportType === 'text') return readingText(p, opts.chapterIds?.length ? opts.chapterIds : undefined);
  return contextMarkdown(p, { characterId: opts.characterId || '', includePlans: Boolean(opts.includePlans), includeIdeas: Boolean(opts.includeIdeas), includeBody: Boolean(opts.includeBody), bodyIds: opts.chapterIds?.length ? opts.chapterIds : undefined });
}
function getExportPreviewText() {
  if (state.exportType !== 'backup') return getExportText();
  const preview = structuredClone(state.project);
  for (const c of preview.characters) for (const image of c.illustrations || []) image.dataUrl = '[图片内容随备份保存，此处省略编码]';
  return JSON.stringify(preview, null, 2);
}
function renderExport() {
  const opts = state.exportOptions, p = state.project;
  return `${heading('导出与备份', '留给自己阅读，也把恰当的背景交给 AI。', button('恢复项目备份', 'restore', 'upload'), '带走你的故事')}<div class="export-grid"><section class="panel form-panel"><label class="field"><span>导出用途</span><select id="export-type" class="select"><option value="context" ${state.exportType === 'context' ? 'selected' : ''}>讨论资料 · TXT / MD</option><option value="text" ${state.exportType === 'text' ? 'selected' : ''}>章节正文 · TXT</option><option value="backup" ${state.exportType === 'backup' ? 'selected' : ''}>完整项目备份 · JSON</option></select></label>${state.exportType === 'context' ? `<label class="field"><span>讨论对象</span><select id="export-person" class="select"><option value="">整部作品</option>${p.characters.map(c => `<option value="${e(c.id)}" ${opts.characterId === c.id ? 'selected' : ''}>${e(c.name)} · 人物资料</option>`).join('')}</select></label><label class="checkbox-line"><input type="checkbox" id="export-plans" ${opts.includePlans ? 'checked' : ''}/><span>包含未来计划与停笔备忘<small>明确标注为作者计划。</small></span></label><label class="checkbox-line"><input type="checkbox" id="export-ideas" ${opts.includeIdeas ? 'checked' : ''}/><span>包含灵感<small>尚未成为正文事实的备选想法。</small></span></label><label class="checkbox-line"><input type="checkbox" id="export-body" ${opts.includeBody ? 'checked' : ''}/><span>附带正文<small>讨论语言、场景和节奏时可以勾选。</small></span></label>` : ''}${state.exportType === 'text' || (state.exportType === 'context' && opts.includeBody) ? `<label class="field"><span>正文范围</span><select id="export-volume" class="select"><option value="">全书 / 手动选择章节</option>${[...new Set(p.chapters.map(c => c.volume).filter(Boolean))].map(v => `<option value="${e(v)}">${e(v)}</option>`).join('')}</select><small>不勾选时包含全部章节，勾选后只导出所选正文。</small></label>${chapterChecklist(new Set(opts.chapterIds || []), 'export-chapter')}` : ''}${state.exportType === 'backup' ? '<div class="notice">备份包含章节正文、人物、关系、支线、灵感和待确认建议。恢复时会替换当前作品；API Key 不包含在备份中。</div>' : ''}<div class="heading-actions" style="margin-top:22px">${state.exportType === 'backup' ? button('下载项目 JSON', 'download-json', 'export', true) : state.exportType === 'text' ? button('下载正文 TXT', 'download-txt', 'export', true) : button('下载 MD', 'download-md', 'export', true) + button('下载 TXT', 'download-txt', 'export')}${button('复制', 'copy-export', 'note')}</div><p class="hint">资料保存在本机。完整项目 JSON 可另存到你的备份目录，并在其他电脑恢复。</p></section><section class="panel"><div class="preview-head"><span>导出预览</span><span class="muted" id="export-size">${formatCount(getExportText().length)} 字符</span></div><pre class="preview-text" id="export-preview">${e(getExportPreviewText())}</pre></section></div>`;
}
function renderSettings() {
  const p = state.project;
  return `${heading('作品设置', '为这部长篇留一个清晰的起点。', '', '我的书斋')}<div class="settings-grid"><section class="panel form-panel"><h2>作品信息</h2><form id="project-form"><label class="field"><span>作品名称</span><input name="title" class="input" value="${e(p.title)}" required maxlength="200"/></label><label class="field"><span>题材 / 标签</span><input name="genre" class="input" value="${e(p.genre)}" maxlength="200" placeholder="例如：奇幻 · 群像 · 悬疑"/></label><label class="field"><span>停笔备忘</span><textarea name="note">${e(p.note)}</textarea></label><button class="btn primary" type="submit">${icon('check')}保存作品信息</button></form></section><div><section class="panel form-panel section"><h2>资料保存</h2><p class="hint">本版本使用本机文件存储，不需要注册账号。资料保存在软件目录的 <b>data/project.json</b>，每次成功保存会保留上一份文件 <b>project.previous.json</b>。</p><p class="hint">可以在“导出与备份”下载完整项目 JSON。应用一次打开一部作品；切换作品前先备份。</p><div class="heading-actions">${button('导出完整备份', 'quick-backup', 'export')}${button('恢复项目', 'restore', 'upload')}</div></section><section class="panel form-panel"><h2>开始另一部作品</h2><p class="hint">新建作品会替换当前工作区，当前作品先下载为备份。你也可以载入示例来体验完整流程。</p><div class="heading-actions">${button('新建作品', 'new-project', 'plus')}${button('载入示例', 'load-demo', 'book')}</div></section><p class="hint">拾章 0.6.1 · 本地版<br>内置 AI 支持兼容 Chat Completions 的接口；也支持外部 AI 整理结果导回。</p></div></div>`;
}

function openModal(title, content, footer = '', wide = false) {
  const dialog = $('#modal');
  if (dialog.open) dialog.close();
  dialog.className = wide ? 'wide' : '';
  dialog.innerHTML = `<div class="modal-head"><h2>${e(title)}</h2><button class="icon-btn" data-action="close-modal" title="关闭">${icon('close')}</button></div><div class="modal-content">${content}</div>${footer ? `<div class="modal-actions">${footer}</div>` : ''}`;
  dialog.showModal();
  return dialog;
}
function modalError(error) {
  const content = $('#modal .modal-content'); if (!content) return toast(error.message, true);
  $('.error-message', content)?.remove();
  const el = document.createElement('div'); el.className = 'error-message'; el.textContent = error.message; content.prepend(el); el.scrollIntoView({ block: 'nearest' });
}
function closeModal() { chapterTextActions.hide(); $('#modal').close(); }
const field = (label, name, value = '', options = {}) => `<label class="field"><span>${e(label)}</span>${options.textarea ? `<textarea name="${name}" ${options.required ? 'required' : ''} ${options.placeholder ? `placeholder="${e(options.placeholder)}"` : ''}>${e(value)}</textarea>` : `<input class="input" name="${name}" value="${e(value)}" ${options.required ? 'required' : ''} maxlength="${options.max || 500}" ${options.placeholder ? `placeholder="${e(options.placeholder)}"` : ''}/>`}${options.hint ? `<small>${e(options.hint)}</small>` : ''}</label>`;
function selectField(label, name, items, value = '', allowNone = true) { return `<label class="field"><span>${e(label)}</span><select class="select" name="${name}">${allowNone ? '<option value="">不关联</option>' : ''}${items.map(([id, label]) => `<option value="${e(id)}" ${id === value ? 'selected' : ''}>${e(label)}</option>`).join('')}</select></label>`; }
function multiField(label, name, items, selected = []) { return `<div class="field"><span>${e(label)}</span><div class="check-options">${items.map(([id, text]) => `<label class="check-option"><input type="checkbox" name="${name}" value="${e(id)}" ${selected.includes(id) ? 'checked' : ''}/>${e(text)}</label>`).join('') || '<small class="muted">暂无可关联记录，可以稍后补充。</small>'}</div></div>`; }

function entityForm(kind, id = '', defaults = {}) {
  const p = state.project;
  const existing = p[kind].find(x => x.id === id);
  const item = existing || { ...defaults };
  let fields = '', title = '';
  const characters = p.characters.map(c => [c.id, c.name]), chapters = sortChapters(p.chapters).map(c => [c.id, c.title]);
  if (kind === 'documents') {
    title = existing ? '编辑资料文档' : '新建资料文档';
    fields = field('文档标题', 'title', item.title, { required: true }) + selectField('文档类型', 'kind', [['note', '作者笔记'], ['setting', '设定文档'], ['outline', '作者大纲']], item.kind || 'note', false) + field('简要说明（可选）', 'description', item.description, { textarea: true }) + field('文档内容', 'body', item.body, { textarea: true, hint: '支持保存 Markdown 或纯文本，与章节正文分开。原始导入文件不会被修改。' });
  } else if (kind === 'volumes') {
    title = existing ? '编辑分卷大纲' : '新建分卷';
    fields = field('分卷名称', 'title', item.title, { required: true }) + field('实际进展 · 已经写到哪里', 'summary', item.summary, { textarea: true }) + field('卷纲 · 作者计划', 'outline', item.outline, { textarea: true, hint: '与正文进展分开保存，导出讨论资料时可选择是否包含计划。' });
  } else if (kind === 'characters') {
    title = existing ? '编辑人物' : '新建人物';
    fields = field('姓名', 'name', item.name, { required: true }) + field('别名 / 称呼', 'aliases', item.aliases?.join('、'), { hint: '用顿号或逗号分隔，用于搜索与出场定位。' }) + field('简短介绍', 'description', item.description, { textarea: true }) + multiField('关联阵营', 'factionIds', p.factions.map(f => [f.id, f.name]), item.factionIds);
  } else if (kind === 'factions') {
    title = existing ? '编辑阵营' : '新建阵营';
    fields = field('阵营名称', 'name', item.name, { required: true }) + field('阵营说明', 'description', item.description, { textarea: true });
  } else if (kind === 'relationships') {
    title = existing ? '编辑人物关系' : '记录人物关系';
    fields = `<div class="field-row">${selectField('关系起点', 'fromId', characters, item.fromId, false)}${selectField('关系指向', 'toId', characters, item.toId, false)}</div>` + field('关系名称', 'name', item.name, { required: true, placeholder: '例如：同门、怀疑、暂时合作' }) + field('关系说明 / 变化过程', 'description', item.description, { textarea: true }) + selectField('关联章节', 'chapterId', chapters, item.chapterId) + field('支持原文（可选）', 'quote', item.quote, { textarea: true });
  } else if (kind === 'threads' || kind === 'ideas') {
    const idea = kind === 'ideas'; title = `${existing ? '编辑' : '记录'}${idea ? '灵感' : '支线'}`;
    fields = field(idea ? '灵感标题' : '支线名称', 'title', item.title, { required: true }) + field(idea ? '先记下这个想法' : '已经写到的进展 / 尚未解决的问题', 'description', item.description, { textarea: true }) + (!idea ? field('后续计划（尚未发生）', 'next', item.next, { textarea: true }) : '') + multiField('关联人物', 'characterIds', characters, item.characterIds) + `<div class="field-row">${selectField('状态', 'status', Object.entries(idea ? ideaLabels : threadLabels), item.status || (idea ? 'inbox' : 'active'), false)}${selectField('关联章节', 'chapterId', chapters, item.chapterId)}</div>`;
  } else if (kind === 'chapters') {
    title = '编辑章节资料';
    fields = field('章节标题', 'title', item.title, { required: true }) + field('所属卷', 'volume', item.volume) + field('章节摘要', 'summary', item.summary, { textarea: true }) + selectField('整理状态', 'status', Object.entries(statusLabels), item.status, false) + '<p class="hint">正文通过重新导入同名文件更新。这里编辑的标题不会修改原始文件名。</p>';
  }
  const dialog = openModal(title, `<form id="entity-form">${fields}</form>`, `${existing ? `<button class="btn danger left" data-action="delete" data-kind="${kind}" data-id="${e(id)}">${icon('trash')}删除</button>` : ''}<button class="btn" data-action="close-modal">取消</button><button class="btn primary" type="submit" form="entity-form">${icon('check')}保存</button>`);
  $('#entity-form', dialog).addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(event.target);
    const next = { ...item, id: id || uid(), updatedAt: now() };
    for (const [key, val] of data) if (!['aliases', 'factionIds', 'characterIds'].includes(key)) next[key] = String(val).trim();
    if (kind === 'documents') { next.body = String(data.get('body') || ''); next.createdAt ||= now(); }
    if (kind === 'characters') {
      next.aliases = String(data.get('aliases') || '').split(/[、,，;；\n]/).map(s => s.trim()).filter(Boolean);
      next.factionIds = data.getAll('factionIds'); next.facts = existing?.facts || [];
      if (p.characters.some(c => c.id !== id && (c.name === next.name || c.aliases.includes(next.name)))) return modalError(new Error('此姓名已属于已有的人物或别名，请先检查档案'));
    }
    if (kind === 'threads' || kind === 'ideas') next.characterIds = data.getAll('characterIds');
    if (kind === 'relationships' && (!next.fromId || !next.toId || next.fromId === next.toId)) return modalError(new Error('请选择两个不同的人物'));
    if (kind === 'factions' && p.factions.some(f => f.id !== id && f.name === next.name)) return modalError(new Error('此阵营已经存在'));
    if (kind === 'volumes' && p.volumes.some(v => v.id !== id && v.title === next.title)) return modalError(new Error('此分卷已经存在'));
    try {
      await mutate(project => { const at = project[kind].findIndex(x => x.id === id); if (at >= 0) project[kind][at] = next; else project[kind].push(next); if (kind === 'volumes' && existing && existing.title !== next.title) for (const ch of project.chapters) if (ch.volume === existing.title) ch.volume = next.title; if (kind === 'chapters' && next.volume && !project.volumes.some(v => v.title === next.volume)) project.volumes.push({ id: uid(), title: next.volume, outline: '', summary: '' }); if (kind === 'characters') state.characterId = next.id; if (kind === 'threads' && next.originIdeaId) { const idea = project.ideas.find(i => i.id === next.originIdeaId); if (idea) idea.status = 'adopted'; } }, '已保存');
      closeModal();
    } catch (error) { modalError(error); }
  });
}

function factForm(characterId, factId = '') {
  const c = state.project.characters.find(c => c.id === characterId), f = c?.facts.find(f => f.id === factId) || { kind: 'author' };
  if (!c) return;
  const dialog = openModal(factId ? '编辑人物记录' : `为 ${c.name} 添加记录`, `<form id="fact-form">${field('设定 / 状态描述', 'text', f.text, { textarea: true, required: true })}${selectField('记录类型', 'kind', Object.entries(kindLabels), f.kind, false)}${selectField('关联章节', 'chapterId', sortChapters(state.project.chapters).map(ch => [ch.id, ch.title]), f.chapterId)}${field('原文片段', 'quote', f.quote, { textarea: true, hint: '正文记录需提供能在所选章节中匹配的连续原文。其他类型可以不填。' })}${f.needsReview ? '<div class="notice">原文已更新。核对内容后保存，会清除本条记录的待复核标记。</div>' : ''}</form>`, `${factId ? `<button class="btn danger left" data-action="delete-fact" data-person="${e(c.id)}" data-id="${e(factId)}">删除记录</button>` : ''}<button class="btn" data-action="close-modal">取消</button><button type="submit" form="fact-form" class="btn primary">确认保存</button>`);
  $('#fact-form', dialog).addEventListener('submit', async event => {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
    for (const key of Object.keys(data)) data[key] = data[key].trim();
    const chapter = state.project.chapters.find(ch => ch.id === data.chapterId);
    if (data.kind === 'canon' && (!chapter || !data.quote || !chapter.body.includes(data.quote))) return modalError(new Error('正文记录需要有效的关联章节和可匹配的原文片段；作者补充内容可选择“作者设定”'));
    try { await mutate(p => { const character = p.characters.find(c => c.id === characterId); const index = character.facts.findIndex(f => f.id === factId); const record = { ...f, ...data, id: factId || uid(), needsReview: false }; if (index >= 0) character.facts[index] = record; else character.facts.push(record); character.updatedAt = now(); }, '人物记录已保存'); closeModal(); } catch (error) { modalError(error); }
  });
}

function readChapter(id, quote = '', returnReview = false) {
  const doc = state.project.documents?.find(d => d.id === id);
  if (doc) {
    const index = quote ? doc.body.indexOf(quote) : -1;
    const body = index >= 0 ? e(doc.body.slice(0, index)) + `<mark id="source-mark">${e(quote)}</mark>` + e(doc.body.slice(index + quote.length)) : e(doc.body);
    openModal(doc.title, `<div class="reader-meta">${tag(doc.kind === 'outline' ? '作者大纲 · 含计划' : doc.kind === 'setting' ? '作者设定 · 含幕后信息' : '作者笔记', 'gold')}<small class="muted">${e(doc.sourcePath || '')}</small></div><div class="notice">这是作者资料文档，包含计划、暂定或保密信息，不能整体当作已写入正文的事实。</div><article class="reader">${body}</article>`, `${button('编辑文档', 'edit-document', 'edit', false, doc.id)}<button class="btn primary" data-action="close-modal">返回资料</button>`, true);
    if (index >= 0) requestAnimationFrame(() => $('#source-mark')?.scrollIntoView({ block: 'center', behavior: 'instant' }));
    return;
  }
  const ch = state.project.chapters.find(c => c.id === id);
  if (!ch) return toast('关联章节不存在', true);
  const body = ch.body, index = quote ? body.indexOf(quote) : -1;
  openModal(ch.title, `<div class="reader-meta">${tag(ch.volume || '未分卷')}${statusTag(ch)}<small class="muted">${countWords(ch.body).toLocaleString()} 字 · ${e(ch.filename)}</small></div>${quote && index < 0 ? '<div class="notice">原文中未匹配到这段出处，请核对是否重新导入过章节。</div>' : ''}${ch.summary ? `<div class="inline-note" style="margin-bottom:22px">章节摘要 · ${e(ch.summary)}</div>` : ''}<p class="hint chapter-selection-hint">选中文字后可直接改写或从选区末尾续写，也可右键打开操作。</p><article class="reader" data-chapter-text="${e(ch.id)}" data-text-kind="raw"></article>`, `${button('在阅读器中打开', 'reader-open', 'book', false, id)}${button('编辑章节资料', 'edit-chapter', 'edit', false, id)}${button('文风改写 / 续写', 'studio-open-chapter', 'edit', false, id)}<button class="btn primary" data-action="${returnReview ? 'review' : 'close-modal'}">${returnReview ? '返回确认列表' : '返回档案'}</button>`, true);
  const source = document.querySelector('#modal [data-chapter-text]');
  if (index >= 0) {
    const mark = document.createElement('mark'); mark.id = 'source-mark'; mark.textContent = quote;
    source.replaceChildren(document.createTextNode(body.slice(0, index)), mark, document.createTextNode(body.slice(index + quote.length)));
  } else source.textContent = body;
  chapterTextActions.bind();
  if (index >= 0) requestAnimationFrame(() => $('#source-mark')?.scrollIntoView({ block: 'center', behavior: 'instant' }));
}

function confirmDelete(kind, id) {
  const item = state.project[kind].find(x => x.id === id); if (!item) return;
  const notes = { documents: '删除后，关联记录会保留，文档出处会解除；原始导入文件不变。', volumes: '本卷章节会解除分卷归属，章节原文会保留。', characters: '相关关系会同时删除，支线和灵感会解除对此人物的关联。', factions: '人物会解除对此阵营的关联。', chapters: '关联设定会保留并标为待核实，相关记录的章节出处会解除。', threads: '删除后，这条支线不会再出现在人物档案中。', ideas: '删除这条灵感记录。', relationships: '删除这条人物关系。' };
  const dialog = openModal('删除记录', `<p>确定删除「${e(item.name || item.title)}」？</p><p class="hint">${notes[kind]}</p>`, '<button class="btn" data-action="close-modal">取消</button><button class="btn danger" id="confirm-delete">确认删除</button>');
  $('#confirm-delete', dialog).onclick = async () => {
    try { await mutate(p => removeEntity(p, kind, id), '记录已删除'); state.selectedChapters.delete(id); closeModal(); } catch (error) { modalError(error); }
  };
}

function download(content, filename, mime = 'text/plain;charset=utf-8', bom = true) {
  const blob = new Blob([bom ? '\uFEFF' : '', content], { type: mime });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function backup() { download(JSON.stringify(state.project, null, 2), `${state.project.title}-完整备份-${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })}.json`, 'application/json', false); }
async function chooseFiles(accept, multiple = false) {
  return new Promise(resolve => { const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.multiple = multiple; input.addEventListener('change', () => resolve([...input.files])); input.addEventListener('cancel', () => resolve([])); input.click(); });
}
async function decodeFile(file) {
  const bytes = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { return new TextDecoder('gb18030').decode(bytes).replace(/^\uFEFF/, ''); }
}
async function imageFileToIllustration(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} 超过 10 MB，请先缩小图片`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = String.fromCharCode(...bytes.slice(0, 12));
  const mime = header.startsWith('\x89PNG\r\n\x1a\n') ? 'image/png' : header.startsWith('\xff\xd8\xff') ? 'image/jpeg' : header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP' ? 'image/webp' : '';
  if (!mime) throw new Error(`${file.name} 不是支持的 JPG、PNG 或 WebP 图片`);
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 50000000) throw new Error('图片尺寸过大，请先缩小');
    const canvas = document.createElement('canvas');
    let longest = Math.min(2048, Math.max(bitmap.width, bitmap.height)), dataUrl = '';
    do {
      const ratio = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL('image/webp', 0.86);
      longest = Math.floor(longest * 0.8);
    } while (dataUrl.length > 2000000 && longest >= 400);
    return validateIllustration({ id: uid(), name: file.name.slice(0, 500), dataUrl, width: canvas.width, height: canvas.height, createdAt: now() });
  } catch (error) { throw new Error(`无法导入 ${file.name}：${error.message || '图片可能已损坏'}`); }
  finally { bitmap?.close(); }
}
async function importIllustrations(characterId, replaceId = '') {
  const character = state.project.characters.find(c => c.id === characterId);
  if (!character) throw new Error('人物不存在');
  const files = await chooseFiles('.jpg,.jpeg,.png,.webp', !replaceId);
  if (!files.length) return;
  if (!replaceId && (character.illustrations?.length || 0) + files.length > 20) throw new Error('每个人物最多保存 20 张插图');
  toast('正在处理图片，完成后会自动保存…');
  const images = [];
  for (const file of files) images.push(await imageFileToIllustration(file));
  await mutate(p => {
    const c = p.characters.find(c => c.id === characterId);
    if (!c) throw new Error('人物已被删除，未保存图片');
    c.illustrations ||= [];
    if (replaceId) {
      const index = c.illustrations.findIndex(image => image.id === replaceId);
      if (index < 0) throw new Error('原插图不存在');
      c.illustrations[index] = { ...images[0], id: replaceId };
    } else c.illustrations.push(...images);
    c.coverImageId ||= c.illustrations[0]?.id || '';
    c.updatedAt = now();
  }, replaceId ? '人物插图已更换' : `已保存 ${images.length} 张人物插图`);
  closeModal();
}
function viewIllustration(characterId, imageId) {
  const c = state.project.characters.find(c => c.id === characterId), image = c?.illustrations?.find(i => i.id === imageId);
  if (!image) throw new Error('插图不存在');
  const cover = coverIllustration(c);
  const dialog = openModal(`${c.name} · 人物插图`, `<div class="illustration-viewer"><img src="${e(image.dataUrl)}" alt="${e(image.name)}"/></div><div class="illustration-meta"><span>${e(image.name)}</span><small>${image.width && image.height ? `${image.width} × ${image.height}` : ''} · 保存在本机项目中</small></div>`, `<button class="btn danger left" id="remove-illustration">移除插图</button><button class="btn" data-action="replace-illustration" data-person="${e(c.id)}" data-id="${e(image.id)}">${icon('upload')}更换图片</button>${cover?.id === image.id ? '<span class="tag green">当前人物封面</span>' : '<button class="btn primary" id="cover-illustration">设为人物封面</button>'}<button class="btn" data-action="close-modal">关闭</button>`, true);
  $('#cover-illustration', dialog)?.addEventListener('click', async () => {
    try { await mutate(p => { p.characters.find(person => person.id === characterId).coverImageId = imageId; }, '已设为人物封面'); viewIllustration(characterId, imageId); } catch (error) { modalError(error); }
  });
  $('#remove-illustration', dialog).onclick = () => {
    const confirm = openModal('移除人物插图', `<p>确定移除「${e(image.name)}」？</p><p class="hint">只移除项目里的图片，原始图片文件会保留。</p>`, '<button class="btn" id="cancel-remove-illustration">返回插图</button><button class="btn danger" id="confirm-remove-illustration">确认移除</button>');
    $('#cancel-remove-illustration', confirm).onclick = () => viewIllustration(characterId, imageId);
    $('#confirm-remove-illustration', confirm).onclick = async () => {
      try { await mutate(p => { const person = p.characters.find(c => c.id === characterId); person.illustrations = person.illustrations.filter(image => image.id !== imageId); if (person.coverImageId === imageId) person.coverImageId = person.illustrations[0]?.id || ''; }, '插图已移除'); closeModal(); } catch (error) { modalError(error); }
    };
  };
}
async function importChapters() {
  const files = await chooseFiles('.md,.txt,.markdown', true); if (!files.length) return;
  if (files.some(f => !/\.(md|txt|markdown)$/i.test(f.name))) throw new Error('请选择 MD 或 TXT 文件');
  if (files.reduce((n, f) => n + f.size, 0) > 50 * 1024 * 1024) throw new Error('每批导入请控制在 50 MB 以内');
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  if (new Set(sorted.map(f => f.name)).size !== sorted.length) throw new Error('本批包含同名文件，请先使用不同文件名区分章节');
  const entries = await Promise.all(sorted.map(async file => { const body = await decodeFile(file); if (!body.trim()) throw new Error(`${file.name} 是空文件`); if (body.includes('\u0000')) throw new Error(`${file.name} 可能不是支持的文本文件`); return { filename: file.name, body, title: chapterTitle(file.name, body), volume: '', order: 0 }; }));
  const maxOrder = Math.max(0, ...state.project.chapters.map(c => c.order));
  const dialog = openModal('导入章节 · 预览', `<p class="hint">按文件名自然排序。一章一个文件，可在导入后调整章节顺序。重复文件保留已有标题、分卷和编号。</p>${field('新章节所属卷', 'import-volume', '', { placeholder: '例如：第一卷 · 渡口' })}<div class="panel import-preview"><table class="table"><thead><tr><th>标题（可修改）</th><th>来源文件</th><th>操作</th></tr></thead><tbody>${entries.map((ch, i) => `<tr><td><input class="input" data-import-title="${i}" value="${e(ch.title)}" maxlength="500"/></td><td><small class="muted">${e(ch.filename)}<br>${countWords(ch.body).toLocaleString()} 字</small></td><td>${tag(state.project.chapters.some(c => c.filename === ch.filename) ? '更新已有' : '新增章节', 'green')}</td></tr>`).join('')}</tbody></table></div><p class="hint">自动识别 UTF-8；不符合 UTF-8 时尝试 GB18030。导入后请检查原文是否正常。</p>`, '<button class="btn" data-action="close-modal">取消</button><button class="btn primary" id="confirm-import">确认导入</button>', true);
  $('#confirm-import', dialog).onclick = async event => {
    event.target.disabled = true;
    try {
      const volume = $('[name="import-volume"]', dialog).value.trim();
      entries.forEach((ch, i) => { ch.title = $(`[data-import-title="${i}"]`, dialog).value.trim(); ch.volume = volume; ch.order = maxOrder + i + 1; if (!ch.title) throw new Error('章节标题不能为空'); });
      let result;
      await mutate(p => { result = mergeChapters(p, entries); return result.project; });
      closeModal(); navigate('chapters'); await refreshAIQueue(); toast(`导入完成：新增 ${result.added} 章，更新 ${result.updated} 章${state.project.settings.autoOrganize ? '；有变化的章节已加入 AI 队列' : ''}`);
    } catch (error) { event.target.disabled = false; modalError(error); }
  };
}

async function restoreProject() {
  const [file] = await chooseFiles('.json'); if (!file) return;
  if (file.size > 70 * 1024 * 1024) throw new Error('备份文件超过 70 MB，无法通过本版界面恢复');
  const imported = validateProject(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
  const dialog = openModal('恢复项目备份', `<p>将恢复「${e(imported.title)}」。</p><p class="hint">包含 ${imported.chapters.length} 章、${imported.characters.length} 位人物、${imported.threads.length} 条支线。当前作品会先下载备份并建立本机保护快照，再由恢复内容替换；AI 队列会暂停，会话密钥会清除。</p>`, '<button class="btn" data-action="close-modal">取消</button><button class="btn primary" id="confirm-restore">备份当前作品并恢复</button>');
  $('#confirm-restore', dialog).onclick = async () => {
    try { backup(); await mutate(p => ({ ...imported, revision: p.revision, settings: { endpoint: imported.settings.endpoint, model: imported.settings.model, autoOrganize: Boolean(imported.settings.autoOrganize) } }), '项目已恢复，AI 队列已暂停', true, true); await refreshAIQueue(); state.selectedChapters.clear(); state.characterId = ''; state.apiKey = ''; closeModal(); navigate('home'); } catch (error) { modalError(error); }
  };
}
function replaceProject(demo = false) {
  const hasContent = state.project.chapters.length || state.project.characters.length || state.project.ideas.length || state.project.threads.length || state.project.note;
  const dialog = openModal(demo ? '载入示例作品' : '新建作品', `${demo ? '<p>载入示例长篇《雾渡》，体验人物、关系与支线。</p>' : `<form id="new-project-form">${field('作品名称', 'new-title', '', { required: true, placeholder: '给你的故事起一个名字' })}</form>`}<p class="hint">${hasContent ? '当前作品会先下载完整备份，再替换工作区。' : '导入章节后，就可以开始积累自己的资料。'}</p>`, '<button class="btn" data-action="close-modal">取消</button><button class="btn primary" id="confirm-replace">确认' + (demo ? '载入' : '新建') + '</button>');
  $('#confirm-replace', dialog).onclick = async () => {
    const title = $('[name="new-title"]', dialog)?.value.trim();
    if (!demo && !title) return modalError(new Error('请填写作品名称'));
    try { if (hasContent) backup(); const next = demo ? demoProject() : { ...emptyProject(), title }; await mutate(p => ({ ...next, revision: p.revision }), demo ? '示例作品已载入' : '作品已创建'); state.selectedChapters.clear(); state.characterId = ''; state.query = ''; state.factionFilter = ''; state.exportOptions = {}; closeModal(); navigate('home'); } catch (error) { modalError(error); }
  };
}

function openSearch() {
  const dialog = openModal('搜索故事档案', '<input class="input" id="global-query" type="search" placeholder="输入姓名、别名、设定或正文关键词…" aria-label="全局搜索"/><div class="search-results" id="global-results"><p class="hint">搜索人物、设定、章节原文、人物支线与灵感。</p></div>');
  const input = $('#global-query', dialog); input.focus();
  input.addEventListener('input', () => {
    const q = input.value.trim(), lower = q.toLowerCase(), p = state.project;
    if (!q) { $('#global-results').innerHTML = '<p class="hint">搜索人物、设定、章节原文、人物支线与灵感。</p>'; return; }
    const people = p.characters.filter(c => `${c.name} ${c.aliases.join(' ')} ${c.description} ${c.facts.map(f => f.text).join(' ')}`.toLowerCase().includes(lower));
    const chapters = sortChapters(p.chapters).filter(c => `${c.title} ${c.body}`.toLowerCase().includes(lower));
    const items = [...p.threads.map(t => ({ ...t, kind: 'thread' })), ...p.ideas.map(t => ({ ...t, kind: 'idea' }))].filter(t => `${t.title} ${t.description}`.toLowerCase().includes(lower));
    const snippet = text => { const i = text.toLowerCase().indexOf(lower); return text.slice(Math.max(0, i - 25), Math.max(0, i) + 90).replace(/\n/g, ' '); };
    $('#global-results').innerHTML = (people.length ? `<div class="search-group">人物与设定 · ${people.length}</div>${people.slice(0, 30).map(c => `<button class="search-result" ${action('search-person', c.id)}>${e(c.name)}<small>${e(snippet(c.facts.map(f => f.text).join('；') || c.description))}</small></button>`).join('')}` : '') + (chapters.length ? `<div class="search-group">章节原文 · ${chapters.length}</div>${chapters.slice(0, 30).map(c => `<button class="search-result" data-action="source" data-id="${e(c.id)}" data-quote="${e(c.body.includes(q) ? q : '')}">${e(c.title)}<small>${e(snippet(c.body))}</small></button>`).join('')}` : '') + (items.length ? `<div class="search-group">支线与灵感 · ${items.length}</div>${items.slice(0, 20).map(t => `<button class="search-result" ${action(`edit-${t.kind}`, t.id)}>${e(t.title)}<small>${e(snippet(t.description))}</small></button>`).join('')}` : '') || empty('没有找到相关记录，试试人物别名或更短的关键词');
  });
}

async function ingestSuggestions(input) {
  const suggestions = parseSuggestions(input, state.project);
  if (!suggestions.length) return toast('AI 返回了空建议列表，未修改资料');
  await mutate(p => {
    p.review = [...(p.review || []), ...suggestions];
    for (const c of p.chapters) if (suggestions.some(s => s.chapterId === c.id)) c.status = 'pending';
  }, `收到 ${suggestions.length} 条建议，等待你确认`);
  openReview();
}
function readReviewEdits() {
  const items = state.project.review || [];
  return items.map(item => {
    const row = $(`[data-review-id="${CSS.escape(item.id)}"]`);
    if (!row) return item;
    const read = key => $(`[data-review-field="${key}"]`, row)?.value.trim();
    return { ...item, text: read('text') ?? item.text, chapterId: read('chapterId') ?? item.chapterId, quote: read('quote') ?? item.quote };
  });
}
function openReview(items = state.project.review || []) {
  const p = state.project;
  if (!items.length) return toast('暂时没有待确认建议');
  const checked = items.map(s => ({ ...s, verified: Boolean(p.chapters.some(c => c.id === s.chapterId && s.quote?.trim() && c.body.includes(s.quote.trim()))) }));
  const dialog = openModal('确认 AI 整理建议', `<div class="notice">带出处并不代表内容一定准确，请核对人物身份、推测语气和关系变化。只会将你勾选的建议写入正式档案；未勾选的建议继续保留。</div><div class="toolbar"><button class="btn small" id="select-verified">选中原文匹配项</button><button class="btn small ghost" id="clear-review-selection">取消勾选</button><span class="muted" style="font-size:11px">${checked.filter(s => s.verified).length} / ${checked.length} 条原文匹配</span></div>${checked.map(s => {
    const who = s.name || s.title || (s.from ? `${s.from} → ${s.to}` : chapterName(s.chapterId));
    const similar = s.type === 'character_fact' ? p.characters.find(c => c.name === s.name || c.aliases.includes(s.name))?.facts.filter(f => f.text === s.text || f.quote === s.quote) : [];
    return `<div class="review-item ${s.verified ? '' : 'rejected'}" data-review-id="${e(s.id)}"><div class="review-item-head"><input type="checkbox" data-review-check="${e(s.id)}" aria-label="确认${e(who)}" ${s.verified && !s.needsReview ? 'checked' : ''}/><strong>${e(who)}</strong>${tag(typeLabels[s.type])}${tag(s.needsReview ? '原文已修改，请重新核对后勾选' : s.verified ? '原文匹配' : '出处待修正', s.needsReview || !s.verified ? 'red' : 'green')}</div>${similar?.length ? '<p class="hint">已有相似记录，请检查是重复信息，还是需要保留的状态变化。</p>' : ''}<label class="field" style="margin:0"><span style="margin-top:10px;font-size:10px;color:var(--muted)">提取内容（可修改）</span><textarea data-review-field="text" aria-label="提取内容">${e(s.text)}</textarea></label><label class="field" style="margin:10px 0"><span style="font-size:10px;color:var(--muted)">关联章节</span><select class="select" data-review-field="chapterId"><option value="">请选择章节</option>${sortChapters(p.chapters).map(c => `<option value="${e(c.id)}" ${s.chapterId === c.id ? 'selected' : ''}>${e(c.title)}</option>`).join('')}</select></label><label class="field" style="margin:0"><span style="font-size:10px;color:var(--muted)">支持这条记录的连续原文</span><textarea data-review-field="quote" aria-label="原文证据">${e(s.quote)}</textarea></label><div style="margin-top:7px">${sourceButton(s.chapterId, s.quote)}</div></div>`;
  }).join('')}`, '<button class="btn danger left" id="discard-review">放弃全部建议</button><button class="btn" id="save-review">保存修改，稍后确认</button><button class="btn primary" id="accept-review">确认勾选项入库</button>', true);
  $('#select-verified', dialog).onclick = () => $$('[data-review-check]', dialog).forEach(input => { input.checked = checked.some(s => s.id === input.dataset.reviewCheck && s.verified && !s.needsReview); });
  $('#clear-review-selection', dialog).onclick = () => $$('[data-review-check]', dialog).forEach(input => { input.checked = false; });
  $('#save-review', dialog).onclick = async () => {
    try { const edits = readReviewEdits(); parseSuggestions({ schemaVersion: 1, suggestions: edits }, state.project); await mutate(p => { p.review = edits; }, '修改已保存'); closeModal(); } catch (error) { modalError(error); }
  };
  $('#discard-review', dialog).onclick = () => {
    openModal('放弃待确认建议', '<p>确定放弃全部 AI 建议？正式档案不会被删除。</p>', '<button class="btn" id="back-review">返回确认列表</button><button class="btn danger" id="discard-confirm">确认放弃</button>');
    $('#back-review').onclick = () => openReview();
    $('#discard-confirm').onclick = async () => {
      try { await mutate(p => { for (const c of p.chapters) if (c.status === 'pending') c.status = 'unprocessed'; p.review = []; }, '已放弃待确认建议'); closeModal(); } catch (error) { modalError(error); }
    };
  };
  $('#accept-review', dialog).onclick = async event => {
    const selectedIds = new Set($$('[data-review-check]:checked', dialog).map(x => x.dataset.reviewCheck));
    if (!selectedIds.size) return modalError(new Error('请勾选要确认的建议'));
    event.target.disabled = true;
    try {
      const edits = readReviewEdits();
      parseSuggestions({ schemaVersion: 1, suggestions: edits }, state.project);
      await mutate(p => {
        const selected = edits.filter(s => selectedIds.has(s.id));
        const next = applySuggestions(p, selected);
        next.review = edits.filter(s => !selectedIds.has(s.id));
        for (const c of next.chapters) if (selected.some(s => s.chapterId === c.id) && !next.review.some(s => s.chapterId === c.id)) c.status = 'done';
        return next;
      }, `${selectedIds.size} 条建议已确认入库`);
      if (state.project.review.length) openReview(); else closeModal();
    } catch (error) { event.target.disabled = false; modalError(error); }
  };
}

async function refreshAIQueue() {
  const queue = await api('/api/ai/jobs');
  state.aiQueue = queue;
  const strip = $('#ai-status-strip'); if (strip) strip.innerHTML = renderQueueStrip();
  const list = $('#ai-job-list'); if (list) list.innerHTML = renderJobList();
  for (const node of $$('[data-chapter-progress]')) { const chapter = state.project.chapters.find(c => c.id === node.dataset.chapterProgress); if (chapter) node.outerHTML = features.progress(chapter); }
  return queue;
}
async function saveAISettings(message = true, redraw = true) {
  const endpoint = $('#ai-endpoint').value.trim().replace(/\/+$/, ''), model = $('#ai-model').value.trim(), apiKey = $('#ai-key').value.trim();
  const autoOrganize = $('#ai-auto').checked;
  const useExistingKey = !apiKey && state.aiQueue.configured && endpoint === state.aiQueue.endpoint && model === state.aiQueue.model;
  const queue = await api('/api/ai/session', { method: 'POST', body: JSON.stringify({ endpoint, model, apiKey, useExistingKey }) });
  state.aiQueue = queue; state.apiKey = '';
  await mutate(p => { p.settings = { endpoint: queue.endpoint, model: queue.model, autoOrganize }; }, message ? (autoOrganize ? '已开启：新导入或更新的章节将自动加入整理队列' : '接口已配置，可手动整理章节') : '', redraw);
  return { endpoint: queue.endpoint, model: queue.model, apiKey: '', useExistingKey: true };
}
async function runAI() {
  if (state.aiBusy) return;
  const chapterIds = [...state.selectedChapters].filter(id => state.project.chapters.some(c => c.id === id));
  if (!chapterIds.length) throw new Error('请至少选择一章');
  state.aiBusy = true;
  try {
    const config = await saveAISettings(false, false);
    state.aiQueue = await api('/api/ai/jobs', { method: 'POST', body: JSON.stringify({ ...config, chapterIds }) });
    toast('章节已加入队列，结果会等你确认；你可以继续查阅资料');
  } finally { state.aiBusy = false; render(); }
}
async function collectAIJob(id) {
  const operation = async () => {
    const result = await api(`/api/ai/jobs/${id}/collect`, { method: 'POST', body: JSON.stringify({ revision: state.project.revision }) });
    state.project = result.project; state.aiQueue = result.queue; render(); openReview();
  };
  const result = state.saveQueue.then(operation);
  state.saveQueue = result.catch(error => toast(error.message, true));
  return result;
}

function refreshExportPreview() {
  const opts = state.exportOptions;
  if ($('#export-person')) opts.characterId = $('#export-person').value;
  if ($('#export-plans')) opts.includePlans = $('#export-plans').checked;
  if ($('#export-ideas')) opts.includeIdeas = $('#export-ideas').checked;
  if ($('#export-body')) opts.includeBody = $('#export-body').checked;
  const text = getExportText(); $('#export-preview').textContent = getExportPreviewText(); $('#export-size').textContent = `${formatCount(text.length)} 字符`;
}
function bindPageEvents() {
  $('#home-note')?.addEventListener('input', event => { noteDrafts.set(state.project.projectId, event.target.value); const hint = $('#home-note-hint'); if (hint) hint.textContent = event.target.value !== state.project.note ? '备忘尚未保存，切换页面会保留草稿。' : '留几句话，给下次打开文档的自己。'; });
  const reRenderInput = (id, key) => {
    const el = $(id); if (!el) return;
    el.addEventListener('input', event => { const selection = event.target.selectionStart; state[key] = event.target.value; render(); const fresh = $(id); fresh?.focus(); fresh?.setSelectionRange(selection, selection); });
  };
  reRenderInput('#character-search', 'query'); reRenderInput('#chapter-search', 'chapterQuery');
  for (const id of ['#character-faction', '#network-faction']) $(id)?.addEventListener('change', event => { state.factionFilter = event.target.value; render(); });
  $('#thread-filter')?.addEventListener('change', event => { state.threadFilter = event.target.value; render(); });
  $('#select-all-chapters')?.addEventListener('change', event => { $$('[data-chapter-check]').forEach(input => { input.checked = event.target.checked; if (input.checked) state.selectedChapters.add(input.dataset.chapterCheck); else state.selectedChapters.delete(input.dataset.chapterCheck); }); });
  $$('[data-chapter-check]').forEach(input => input.addEventListener('change', () => { if (input.checked) state.selectedChapters.add(input.dataset.chapterCheck); else state.selectedChapters.delete(input.dataset.chapterCheck); }));
  $$('[name="ai-chapter"]').forEach(input => input.addEventListener('change', () => { if (input.checked) state.selectedChapters.add(input.value); else state.selectedChapters.delete(input.value); $('#ai-selected-count').textContent = state.selectedChapters.size; }));
  $('#ai-key')?.addEventListener('input', event => { state.apiKey = event.target.value; });
  $('#export-type')?.addEventListener('change', event => { state.exportType = event.target.value; render(); });
  for (const id of ['#export-person', '#export-plans', '#export-ideas']) $(id)?.addEventListener('change', refreshExportPreview);
  $('#export-body')?.addEventListener('change', () => { refreshExportPreview(); render(); });
  $$('[name="export-chapter"]').forEach(input => input.addEventListener('change', () => { state.exportOptions.chapterIds = $$('[name="export-chapter"]:checked').map(x => x.value); refreshExportPreview(); }));
  $('#export-volume')?.addEventListener('change', event => { state.exportOptions.chapterIds = event.target.value ? state.project.chapters.filter(c => c.volume === event.target.value).map(c => c.id) : []; $$('[name="export-chapter"]').forEach(x => { x.checked = state.exportOptions.chapterIds.includes(x.value); }); refreshExportPreview(); });
  $('#project-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
    try { await mutate(p => { p.title = data.title.trim() || p.title; p.genre = data.genre.trim(); p.note = data.note.trim(); }, '作品信息已保存'); } catch { /* mutate displays the error */ }
  });
}

document.addEventListener('click', async event => {
  const page = event.target.closest('[data-page]'); if (page) { if (page.dataset.page === 'reader') readerUI.open(); else navigate(page.dataset.page); return; }
  const tab = event.target.closest('[data-tab]'); if (tab) { state.storyTab = tab.dataset.tab; state.threadFilter = 'all'; render(); return; }
  const target = event.target.closest('[data-action]'); if (!target) return;
  const { action: act, id, kind, person, quote } = target.dataset;
  try {
    if (readerUI.handleAction(act, id)) return;
    if (await studioUI.handleAction(act, id)) return;
    if (await features.handleAction(act, id, target)) return;
    if (act === 'close-modal') return closeModal();
    if (act === 'import') return await importChapters();
    if (act === 'load-demo') return replaceProject(true);
    if (act === 'new-project') return replaceProject(false);
    if (act === 'restore') return await restoreProject();
    if (act === 'project-settings') return navigate('settings');
    if (act === 'search') return openSearch();
    if (act === 'source' || act === 'read') { const fromReview = Boolean(target.closest('[data-review-id]')); if (fromReview) { const edits = readReviewEdits(); await mutate(p => { p.review = edits; }, '', false); } return readChapter(id, quote || '', fromReview); }
    if (act === 'person' || act === 'search-person') { closeModal(); state.characterId = id; state.query = ''; state.factionFilter = ''; return navigate('characters'); }
    if (act === 'delete') return confirmDelete(kind, id);
    if (act === 'new-document' || act === 'edit-document') return entityForm('documents', id);
    if (act === 'new-character' || act === 'edit-character') return entityForm('characters', id);
    if (act === 'import-illustrations') return await importIllustrations(id);
    if (act === 'view-illustration') return viewIllustration(person, id);
    if (act === 'replace-illustration') return await importIllustrations(person, id);
    if (act === 'new-volume' || act === 'edit-volume') return entityForm('volumes', id);
    if (act === 'new-faction' || act === 'edit-faction') return entityForm('factions', id);
    if (act === 'new-relationship' || act === 'edit-relationship') return entityForm('relationships', act === 'edit-relationship' ? id : '', { fromId: id });
    if (act === 'new-thread' || act === 'edit-thread') return entityForm('threads', act === 'edit-thread' ? id : '', { characterIds: id ? [id] : [] });
    if (act === 'new-idea' || act === 'edit-idea') return entityForm('ideas', act === 'edit-idea' ? id : '', { characterIds: id ? [id] : [] });
    if (act === 'edit-chapter') return entityForm('chapters', id);
    if (act === 'new-fact') return factForm(id);
    if (act === 'edit-fact') return factForm(person, id);
    if (act === 'delete-fact') { await mutate(p => { const c = p.characters.find(c => c.id === person); c.facts = c.facts.filter(f => f.id !== id); }, '人物记录已删除'); return closeModal(); }
    if (act === 'save-note') { const note = $('#home-note').value, projectId = state.project.projectId; await mutate(p => { p.note = note; }, '停笔备忘已保存', false); if (noteDrafts.get(projectId) === note) { noteDrafts.delete(projectId); const hint = $('#home-note-hint'); if (hint && state.project.projectId === projectId) hint.textContent = '留几句话，给下次打开文档的自己。'; } return; }
    if (act === 'ai-selected') { if (!state.selectedChapters.size) throw new Error('请先勾选需要整理的章节'); return navigate('ai'); }
    if (act === 'select-unprocessed') { state.selectedChapters = new Set(sortChapters(state.project.chapters).filter(c => c.status !== 'done').slice(0, 5).map(c => c.id)); return render(); }
    if (act === 'clear-ai-selection') { state.selectedChapters.clear(); return render(); }
    if (act === 'save-ai-settings') return await saveAISettings();
    if (act === 'run-ai') return await runAI();
    if (act === 'refresh-ai-jobs') return await refreshAIQueue();
    if (act === 'collect-ai-job') return await collectAIJob(id);
    if (act === 'retry-ai-job') { state.aiQueue = await api(`/api/ai/jobs/${id}/retry`, { method: 'POST', body: '{}' }); await refreshAIQueue(); return toast(state.aiQueue.configured ? '已安排手动重试' : '请先配置接口会话'); }
    if (act === 'toggle-ai-pause') { state.aiQueue = await api('/api/ai/paused', { method: 'POST', body: JSON.stringify({ paused: !state.aiQueue.paused }) }); return await refreshAIQueue(); }
    if (act === 'clear-ai-session') { state.aiQueue = await api('/api/ai/session', { method: 'DELETE' }); state.apiKey = ''; render(); return toast('会话密钥已清除，后续任务等待重新配置'); }
    if (act === 'export-task') { download(extractionPrompt(state.project, [...state.selectedChapters]), `${state.project.title}-AI整理任务.txt`); return toast('整理任务已下载，交给外部 AI 后导回 JSON'); }
    if (act === 'parse-ai') return await ingestSuggestions($('#ai-result').value);
    if (act === 'import-ai-file') { const [file] = await chooseFiles('.json'); if (!file) return; if (file.size > 8 * 1024 * 1024) throw new Error('整理结果超过 8 MB，请分批导入'); return await ingestSuggestions((await file.text()).replace(/^\uFEFF/, '')); }
    if (act === 'review') return openReview();
    if (act === 'export-person') { state.exportType = 'context'; state.exportOptions = { characterId: id }; return navigate('export'); }
    if (act === 'quick-backup') { backup(); return toast('完整项目备份已下载'); }
    if (act === 'download-json') { backup(); return toast('完整项目备份已下载'); }
    if (act === 'download-md') { download(getExportText(), `${state.project.title}-讨论资料.md`, 'text/markdown;charset=utf-8'); return toast('MD 资料已下载'); }
    if (act === 'download-txt') { download(state.exportType === 'context' ? stripMarkdown(getExportText()) : getExportText(), `${state.project.title}-${state.exportType === 'context' ? '讨论资料' : '正文'}.txt`); return toast('TXT 文件已下载'); }
    if (act === 'copy-export') { await navigator.clipboard.writeText(getExportText()); return toast('已复制到剪贴板'); }
    if (act === 'adopt-idea') {
      const idea = state.project.ideas.find(i => i.id === id);
      return entityForm('threads', '', { title: idea.title, description: '', next: idea.description, characterIds: [...idea.characterIds], status: 'active', chapterId: '', originIdeaId: id });
    }
    if (act === 'chapter-up' || act === 'chapter-down') {
      return await mutate(p => { const sorted = sortChapters(p.chapters); const index = sorted.findIndex(c => c.id === id); const other = index + (act === 'chapter-up' ? -1 : 1); if (other < 0 || other >= sorted.length) return; [sorted[index], sorted[other]] = [sorted[other], sorted[index]]; sorted.forEach((c, i) => { c.order = i + 1; }); });
    }
  } catch (error) { toast(error.message || '操作失败', true); }
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (state.project) openSearch(); }
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('g[role="button"]')) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});
window.addEventListener('beforeunload', event => {
  readerUI.flush();
  if ((noteDrafts.has(state.project?.projectId) && noteDrafts.get(state.project.projectId) !== state.project.note) || studioUI.local.dirty) { event.preventDefault(); event.returnValue = ''; }
});

const chapterTextActions = createChapterTextActions({ state, e, toast, onOpen: (id, options) => studioUI.openForChapter(id, options) });
const readerUI = createReaderUI({ state, e, icon, navigate, closeModal, toast });
const studioUI = createStudioUI({ state, api, mutate, render, navigate, e, tag, button, openModal, closeModal, modalError, toast, chooseFiles, decodeFile, download });
const features = createFeatures({ state, api, mutate, render, e, button, tag, sourceButton, openModal, closeModal, toast, modalError, field, selectField, factForm, entityForm });
try {
  state.project = await api('/api/project'); validateProject(state.project);
  await refreshAIQueue(); await features.refresh(); await studioUI.refresh(); render();
  if (features.local.config) await features.checkDirectory(false);
  setInterval(() => { void refreshAIQueue().catch(() => {}); if (state.page === 'studio') void studioUI.refresh().catch(() => {}); }, 3000);
  setInterval(() => { if (features.local.config && state.page !== 'maintenance' && !document.querySelector('#modal').open) void features.checkDirectory(false); }, 60000);
}
catch (error) { $('#app').innerHTML = `<div class="boot">拾章暂时无法打开<span>${e(error.message)}。请确认本地服务正在运行，再刷新页面。</span></div>`; }
