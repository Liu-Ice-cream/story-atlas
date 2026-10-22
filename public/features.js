import { uid, now, sortChapters } from './domain.js';
import { stateCategories, characterTimeline, chapterProgress, reviewItems } from './maintenance.js';

export function createFeatures(ctx) {
  const { state, api, mutate, render, e, button, tag, sourceButton, openModal, closeModal, toast, modalError, field, selectField, factForm, entityForm } = ctx;
  const local = { cutoff: {}, snapshots: [], config: null, scan: null, error: '', refreshing: false, scanInFlight: false };
  const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未记录';
  const statusNames = { new: '新增', changed: '正文有修改', unchanged: '未变化', missing: '源文件已缺失', conflict: '同名冲突' };
  function progress(chapter) {
    const p = chapterProgress(state.project, chapter.id, state.aiQueue.jobs);
    return `<div class="chapter-progress" data-chapter-progress="${e(chapter.id)}">${tag('正文已导入')}${tag(p.extraction)}${tag(p.review, p.stale ? 'red' : p.reviewed ? 'green' : 'gold')}${p.records ? `<small>${p.records} 条关联资料</small>` : ''}</div>`;
  }
  const reviewSources = item => [item.chapterId, ...(item.relatedChapterIds || [])].filter((id, index, ids) => id && ids.indexOf(id) === index).map(id => sourceButton(id, id === item.chapterId ? item.quote : '')).join(' ');
  function alert() {
    const count = reviewItems(state.project).length;
    const changes = local.scan?.entries.filter(x => ['new', 'changed', 'missing', 'conflict'].includes(x.status)).length || 0;
    if (!count && !changes) return '';
    return `<div class="maintenance-alert"><span>${count ? `${count} 条资料需复核` : ''}${count && changes ? ' · ' : ''}${changes ? `章节目录有 ${changes} 处变更` : ''}</span><button class="btn small ghost" data-page="maintenance">打开资料维护 →</button></div>`;
  }
  function timeline(character) {
    const remembered = local.cutoff[character.id] || '';
    const cutoff = state.project.chapters.some(ch => ch.id === remembered) ? remembered : '';
    local.cutoff[character.id] = cutoff;
    const data = characterTimeline(state.project, character.id, cutoff);
    const grouped = new Map();
    for (const event of data.events) { if (!grouped.has(event.chapterId)) grouped.set(event.chapterId, []); grouped.get(event.chapterId).push(event); }
    return `<section class="detail-section state-timeline"><div class="detail-title"><h3>状态时间线</h3>${button('记录状态变化', 'state-new', 'plus', false, character.id)}</div><label class="timeline-cutoff">查看至<select class="select" id="timeline-cutoff" data-person="${e(character.id)}"><option value="">最新章节</option>${sortChapters(state.project.chapters).map(ch => `<option value="${e(ch.id)}" ${cutoff === ch.id ? 'selected' : ''}>${e(ch.title)}</option>`).join('')}</select></label><p class="hint">以下按故事章节排序；“截至此章的状态”只汇总你明确记录的状态变化。没有后续记录时，不推断状态已经恢复或改变。</p><div class="state-current"><h4>截至「${e(data.cutoffChapter?.title || '当前')}」的已记录状态</h4>${data.current.length ? data.current.map(s => `<div class="state-current-row"><span>${e(stateCategories[s.category])} / ${e(s.label)}</span><strong>${e(s.value)}</strong><small>${s.kind === 'author' ? '作者标注 · ' : ''}${s.needsReview ? '原文变更，待复核 · ' : ''}${sourceButton(s.chapterId, s.quote)}</small></div>`).join('') : '<p class="hint">尚未单独记录状态变化。下方仍可按章节回看已有正文设定与关系。</p>'}</div><details class="timeline-history" open><summary>章节记录 · ${data.events.length} 条</summary>${[...grouped].reverse().map(([chapterId, events]) => `<div class="timeline-chapter"><h4>${sourceButton(chapterId)}</h4>${events.map(event => `<div class="timeline-event"><div class="timeline-event-meta">${tag(event.type === 'state' ? `${stateCategories[event.category]} / ${event.label}` : event.type === 'fact' ? '正文设定' : '人物关系')}${event.kind === 'author' ? tag('作者标注', 'gold') : ''}${event.needsReview ? tag('待复核', 'red') : ''}${event.type === 'state' ? `<button class="btn small ghost" data-action="state-edit" data-person="${e(character.id)}" data-id="${e(event.id)}">编辑</button>` : ''}</div><p>${e(event.text)}</p>${event.quote ? `<details><summary>查看支持原文</summary><blockquote>${e(event.quote)}</blockquote>${sourceButton(event.chapterId, event.quote)}</details>` : ''}</div>`).join('')}</div>`).join('') || '<p class="hint">所选范围内暂无带章节出处的记录。</p>'}</details><p class="hint">本区的截止章节筛选仅作用于时间线；人物简介、别名与下方档案仍为当前记录。</p></section>`;
  }
  function stateForm(personId, id = '') {
    const character = state.project.characters.find(c => c.id === personId);
    if (!character) throw new Error('人物不存在');
    const existing = character.states?.find(s => s.id === id);
    const item = existing || { category: 'condition', kind: 'canon', chapterId: local.cutoff[personId] || sortChapters(state.project.chapters).at(-1)?.id || '' };
    const dialog = openModal(`${character.name} · ${existing ? '编辑状态变化' : '记录状态变化'}`, `<form id="state-form">${selectField('状态类别', 'category', Object.entries(stateCategories), item.category, false)}${field('状态名称', 'label', item.label || '', { required: true, max: 200, placeholder: '例如：左肩伤势、当前藏身处、对真实身份的了解' })}${field('此时的状态', 'value', item.value || '', { required: true, textarea: true })}${selectField('从哪一章起', 'chapterId', sortChapters(state.project.chapters).map(ch => [ch.id, ch.title]), item.chapterId, false)}${selectField('依据类型', 'kind', [['canon', '正文明确写出'], ['author', '作者标注']], item.kind, false)}${field('支持原文', 'quote', item.quote || '', { textarea: true, hint: '正文状态须提供能在本章找到的连续原文；作者标注可以留空。' })}<p class="hint">同一类别、同一状态名称的后续记录会成为新的状态，旧记录保留。只修正录入错误时使用“编辑”。</p></form>`, `${existing ? '<button class="btn danger left" id="state-delete">删除此记录</button>' : ''}<button class="btn" data-action="close-modal">取消</button><button class="btn primary" type="submit" form="state-form">保存状态变化</button>`);
    dialog.querySelector('#state-form').onsubmit = async event => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.target));
      for (const key of Object.keys(values)) values[key] = values[key].trim();
      const chapter = state.project.chapters.find(ch => ch.id === values.chapterId);
      if (!chapter) return modalError(new Error('请选择有效章节'));
      if (values.kind === 'canon' && (!values.quote || !chapter.body.includes(values.quote))) return modalError(new Error('正文状态需要匹配本章的原文证据'));
      try {
        await mutate(p => { const c = p.characters.find(c => c.id === personId); c.states ||= []; const index = c.states.findIndex(s => s.id === id); const record = { ...existing, ...values, id: id || uid(), needsReview: false, updatedAt: now() }; if (index >= 0) c.states[index] = record; else c.states.push(record); }, '状态时间线已保存');
        closeModal();
      } catch (error) { modalError(error); }
    };
    dialog.querySelector('#state-delete')?.addEventListener('click', () => {
      openModal('删除状态记录', '<p>删除后会重新显示此前的已记录状态。操作前会保存保护快照。</p>', '<button class="btn" data-action="close-modal">取消</button><button class="btn danger" id="state-delete-confirm">确认删除</button>');
      document.querySelector('#state-delete-confirm').onclick = async () => {
        try { await api('/api/snapshots', { method: 'POST', body: '{}' }); await mutate(p => { const c = p.characters.find(c => c.id === personId); c.states = c.states.filter(s => s.id !== id); }, '状态记录已删除'); closeModal(); } catch (error) { modalError(error); }
      };
    });
  }
  function renderMaintenance() {
    const p = state.project, needsReview = reviewItems(p);
    const chapters = sortChapters(p.chapters), statuses = chapters.map(ch => chapterProgress(p, ch.id, state.aiQueue.jobs));
    const scan = local.scan;
    return `<div class="page-heading"><div><div class="eyebrow">案头常理</div><h1>资料维护</h1><p>检查章节变更，补齐整理进度，让旧记录继续可信。</p></div><div class="heading-actions">${button('刷新维护信息', 'maintenance-refresh', 'clock')}</div></div>${local.error ? `<p class="error-message">${e(local.error)}</p>` : ''}<div class="maintenance-summary"><span>正文已导入 <b>${chapters.length}</b> 章</span><span>有资料记录 <b>${statuses.filter(x => x.records).length}</b> 章</span><span>待确认 <b>${p.review?.length || 0}</b> 条</span><span>已核对 <b>${statuses.filter(x => x.reviewed).length}</b> 章</span><span>需复核 <b>${needsReview.length}</b> 条</span></div><div class="maintenance-columns"><section class="panel form-panel"><h2>章节目录</h2><p class="hint">粘贴正文文件夹路径。在其他页面每分钟检查一次，本页可手动检查；发现变化后由你勾选导入。原始文件始终只读。</p><label class="field"><span>本机章节文件夹</span><input id="source-directory" class="input" value="${e(local.config?.directory || '')}" placeholder="例如 D:\\小说\\第一卷"/></label><label class="check-option"><input type="checkbox" id="source-recursive" ${local.config?.recursive ? 'checked' : ''}/>包含子文件夹</label><div class="actions">${button('保存目录', 'source-save', 'folder')}${button('检查目录变更', 'source-check', 'search', true)}</div><p class="hint">${scan ? `上次检查：${date(scan.checkedAt)}` : '尚未检查目录'}。支持 MD / TXT；汇总稿、作者笔记等文件请勿勾选。同名冲突须先处理，不会自动删除缺失文件对应的章节。</p><div id="source-change-list">${renderChanges()}</div></section><section class="panel form-panel"><div class="detail-title"><h2>快照与恢复</h2>${button('立即保存快照', 'snapshot-create', 'plus')}</div><p class="hint">每日自动保留一份；更新正文、切换作品和目录导入前另存保护快照。恢复前也会保存当前资料，AI 队列会暂停、会话密钥清除。</p><p class="hint">快照保存在本机 data/snapshots，包含正文、插图、档案、时间线与已领取的待确认建议；未领取的 AI 任务仍在独立队列中。快照不会自动删除，请定期导出完整 JSON 做异地备份。</p><div id="snapshot-list">${renderSnapshots()}</div></section></div><section class="section"><div class="section-head"><h2>正文变更后的复核清单</h2>${tag(needsReview.length + ' 条', needsReview.length ? 'red' : 'green')}</div><div class="panel">${needsReview.length ? needsReview.map(item => `<div class="maintenance-review-row"><div><strong>${e(item.title)}</strong><p>${e(item.text)}</p>${reviewSources(item)}</div><div class="actions"><button class="btn small" data-action="maintenance-edit" data-id="${e(item.id)}" data-kind="${e(item.type)}" data-person="${e(item.personId || '')}">编辑核对</button><button class="btn small" data-action="maintenance-ack" data-id="${e(item.id)}" data-kind="${e(item.type)}" data-person="${e(item.personId || '')}">内容仍有效</button></div></div>`).join('') : '<p class="hint" style="padding:20px">没有因正文变更而待复核的资料。</p>'}</div></section><section class="section"><div class="section-head"><h2>各章整理进度</h2><span class="hint">有资料不等于已经完整核对</span></div><div class="panel">${chapters.map(ch => { const s = chapterProgress(p, ch.id, state.aiQueue.jobs); return `<div class="maintenance-chapter-row"><div><strong>${sourceButton(ch.id)}</strong>${progress(ch)}</div>${s.pending ? '<button class="btn small" data-action="review">查看待确认建议</button>' : s.stale ? '<span class="tag red">先复核关联资料</span>' : !s.reviewed ? button('本章已核对', 'chapter-reviewed', 'check', false, ch.id) : '<span class="tag green">已核对</span>'}</div>`; }).join('') || '<p class="hint" style="padding:20px">导入章节后会显示分阶段进度。</p>'}</div></section>`;
  }
  function renderChanges() {
    if (!local.scan) return '';
    const changed = local.scan.entries.filter(x => x.status !== 'unchanged');
    return `${local.scan.errors?.length ? `<p class="error-message">${local.scan.errors.map(x => e(x.filename + '：' + x.error)).join('<br>')}</p>` : ''}${changed.length ? `<div class="source-changes">${changed.map(entry => `<label class="source-change-row"><input type="checkbox" data-source-token="${e(entry.token)}" ${['new', 'changed'].includes(entry.status) ? '' : 'disabled'}/><span><strong>${e(entry.title)}</strong><small>${e(entry.filename)}</small></span>${tag(statusNames[entry.status], entry.status === 'changed' || entry.status === 'missing' || entry.status === 'conflict' ? 'red' : 'green')}</label>`).join('')}</div><label class="field"><span>新增章节所属卷（已有章节保持原卷）</span><input class="input" id="source-volume" list="source-volumes" placeholder="可不填"/><datalist id="source-volumes">${state.project.volumes.map(v => `<option value="${e(v.title)}"></option>`).join('')}</datalist></label>${button('导入勾选的变更', 'source-import', 'upload', true)}` : '<p class="hint">目录中没有待导入变更。</p>'}`;
  }
  function renderSnapshots() {
    return local.snapshots.length ? `<div class="snapshot-list">${local.snapshots.map(s => `<div class="snapshot-row"><div><strong>${e(s.reason)}</strong><p>${date(s.createdAt)} · ${s.chapterCount} 章 · 版本 ${s.revision}</p></div>${button('恢复', 'snapshot-restore', 'back', false, s.id)}</div>`).join('')}</div>` : '<p class="hint">下一次保存会建立保护快照，也可立即手动保存。</p>';
  }
  async function refresh() {
    if (local.refreshing) return;
    local.refreshing = true; const projectId = state.project.projectId;
    try {
      const [source, snapshots] = await Promise.all([api('/api/source'), api('/api/snapshots')]);
      if (state.project.projectId !== projectId) return;
      local.config = source.config; local.snapshots = snapshots; local.error = '';
    } catch (error) { local.error = error.message; } finally { local.refreshing = false; }
  }
  async function checkDirectory(redraw = true) {
    if (local.scanInFlight) return;
    local.scanInFlight = true; const projectId = state.project.projectId;
    try { const result = await api('/api/source/check'); if (state.project.projectId !== projectId) return; local.scan = result; local.error = ''; }
    catch (error) { local.error = error.message; if (redraw) toast(error.message, true); }
    finally { local.scanInFlight = false; }
    if (redraw) render();
    else { const node = document.querySelector('#maintenance-alert'); if (node) node.innerHTML = alert(); }
  }
  async function serverMutation(operation) {
    const task = state.saveQueue.then(operation);
    state.saveQueue = task.catch(error => toast(error.message, true));
    return task;
  }
  async function handleAction(act, id, target) {
    if (!['state-new', 'state-edit', 'maintenance-refresh', 'source-save', 'source-check', 'source-import', 'snapshot-create', 'snapshot-restore', 'maintenance-edit', 'maintenance-ack', 'chapter-reviewed'].includes(act)) return false;
    if (act === 'state-new') stateForm(id);
    if (act === 'state-edit') stateForm(target.dataset.person, id);
    if (act === 'maintenance-refresh') { await refresh(); render(); }
    if (act === 'source-save') {
      const directory = document.querySelector('#source-directory').value.trim().replace(/^"|"$/g, '');
      const recursive = document.querySelector('#source-recursive').checked;
      const result = await api('/api/source', { method: 'POST', body: JSON.stringify({ projectId: state.project.projectId, directory, recursive }) });
      local.config = result.config; local.scan = null; await checkDirectory(); toast('章节目录已保存，勾选需要同步的文件');
    }
    if (act === 'source-check') { if (!local.config) throw new Error('请先填写并保存章节目录'); await checkDirectory(); }
    if (act === 'source-import') {
      const tokens = [...document.querySelectorAll('[data-source-token]:checked')].map(x => x.dataset.sourceToken);
      if (!tokens.length) throw new Error('请勾选要导入的变更文件');
      const volume = document.querySelector('#source-volume')?.value || '';
      await serverMutation(async () => { const result = await api('/api/source/import', { method: 'POST', body: JSON.stringify({ revision: state.project.revision, scanId: local.scan.scanId, tokens, volume }) }); state.project = result.project; toast(`已导入 ${result.count} 个文件，原始文件保持不变`); });
      await refresh(); await checkDirectory();
    }
    if (act === 'snapshot-create') { await serverMutation(() => api('/api/snapshots', { method: 'POST', body: '{}' })); await refresh(); render(); toast('本机快照已保存'); }
    if (act === 'snapshot-restore') {
      const snapshot = local.snapshots.find(s => s.id === id);
      if (!snapshot) throw new Error('快照不存在，请刷新列表');
      const dialog = openModal('恢复历史快照', `<p>恢复到 ${date(snapshot.createdAt)} 的“${e(snapshot.reason)}”，共 ${snapshot.chapterCount} 章。</p><p class="hint">会先保存当前版本的保护快照。恢复的是本机资料，原始章节文件不会被改写；AI 队列暂停，需重新配置会话。</p>`, '<button class="btn" data-action="close-modal">取消</button><button class="btn primary" id="snapshot-confirm">保存当前版本并恢复</button>');
      dialog.querySelector('#snapshot-confirm').onclick = async () => {
        try { await serverMutation(async () => { const result = await api('/api/snapshots/restore', { method: 'POST', body: JSON.stringify({ id, revision: state.project.revision }) }); state.project = result.project; state.aiQueue = result.queue; }); local.scan = null; await refresh(); render(); closeModal(); toast('已恢复快照，当前版本也已另存保护'); } catch (error) { modalError(error); }
      };
    }
    if (act === 'maintenance-edit' || act === 'maintenance-ack') {
      const item = reviewItems(state.project).find(x => x.id === id && x.type === target.dataset.kind && (x.personId || '') === (target.dataset.person || ''));
      if (!item) throw new Error('待复核记录已变化，请刷新');
      if (act === 'maintenance-edit') {
        if (item.type === 'fact') factForm(item.personId, item.id);
        else if (item.type === 'state') stateForm(item.personId, item.id);
        else entityForm(item.type === 'summary' ? 'chapters' : item.type, item.id);
      } else {
        const dialog = openModal('复核这条资料', `<p>${e(item.title)}</p><p>${e(item.text)}</p>${item.quote ? `<blockquote>${e(item.quote)}</blockquote>` : ''}${reviewSources(item)}<p class="hint">请核对新版正文。这次确认只清除此条资料的复核标记。</p>`, '<button class="btn" data-action="close-modal">返回</button><button class="btn primary" id="maintenance-ack-confirm">已核对，内容仍有效</button>');
        dialog.querySelector('#maintenance-ack-confirm').onclick = async () => {
          try { await serverMutation(async () => { state.project = await api('/api/maintenance/review', { method: 'POST', body: JSON.stringify({ ...item, revision: state.project.revision }) }); }); render(); closeModal(); toast('复核完成'); } catch (error) { modalError(error); }
        };
      }
    }
    if (act === 'chapter-reviewed') {
      const p = chapterProgress(state.project, id, state.aiQueue.jobs);
      if (p.pending || p.stale) throw new Error('请先处理本章的待确认建议和复核资料');
      await mutate(project => { const ch = project.chapters.find(c => c.id === id); ch.status = 'done'; ch.reviewedAt = now(); }, '本章已标记为核对完成');
    }
    return true;
  }
  function bind() {
    document.querySelector('#timeline-cutoff')?.addEventListener('change', event => { local.cutoff[event.target.dataset.person] = event.target.value; render(); });
  }
  function reset() { local.config = null; local.scan = null; local.snapshots = []; local.cutoff = {}; local.error = ''; local.refreshing = false; local.scanInFlight = false; }
  return { progress, alert, timeline, renderMaintenance, refresh, checkDirectory, handleAction, bind, reset, local };
}
