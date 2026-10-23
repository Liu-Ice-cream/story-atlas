import { uid, now, sortChapters } from './domain.js';
import { AGENTS, PROMPT_VERSION, ruleCategories, sentenceDiff } from './studio-domain.js';
import { writingSelection } from './chapter-text.js';
import { createSceneUI } from './scene-ui.js';
import { SCENE_TYPES } from './scene-domain.js';
import { analysisSamples, SOURCE_MAX_CHARS, DEFAULT_SAMPLE_CHARS, SAMPLING_VERSION } from './style-sampling.js';

export function createStudioUI(ctx) {
  const { state, api, mutate, render, navigate, e, tag, button, openModal, closeModal, modalError, toast, chooseFiles, decodeFile, download } = ctx;
  const local = { tab: 'sources', jobs: [], configured: false, profileMeta: [], error: '', form: { mode: 'rewrite', sourceKind: 'chapter', profileId: '', chapterId: '', text: '', instructions: '', lockedFacts: '', stopAt: '', length: 600, intensity: 'light', referenceLevel: 'light', sceneType: 'auto', revise: true, characterIds: [], cutoffId: '' }, chapter: null, selection: null, selectedSources: new Set(), submitting: false, dirty: false, currentCandidate: null };
  const sceneUI = createSceneUI({ ...ctx, refresh }, local);
  const jobLabels = { queued: '排队中', running: '正在处理', ready: '结果待过目', failed: '未完成', cancelled: '已停止', outdated: '原文已更新' };
  const stepLabels = { style: '分析文风', context: '整理前情', write: '生成初稿', continuity: '情节核对', styleReview: '文风核对', revise: '按意见修订', continuity2: '修订后情节核对', styleReview2: '修订后文风核对' };
  const date = value => new Date(value).toLocaleString('zh-CN', { hour12: false });
  const $ = selector => document.querySelector(selector);
  const profile = id => state.project.studio.profiles.find(x => x.id === id);
  function captureForm() {
    const form = $('#studio-writing-form'); if (!form) return;
    const values = Object.fromEntries(new FormData(form));
    local.form = { ...local.form, ...values, revise: Boolean(form.querySelector('[name="revise"]').checked), characterIds: [...form.querySelectorAll('[name="characterIds"]:checked')].map(x => x.value) };
  }
  function sourceList() {
    return state.project.studio.sources.length ? state.project.studio.sources.map(s => `<article class="studio-source"><label><input type="checkbox" data-studio-source="${e(s.id)}" ${local.selectedSources.has(s.id) ? 'checked' : ''}/><span><strong>${e(s.name)}</strong><small>${s.body.length.toLocaleString()} 字符 · ${e(s.scene || '综合场景')}</small></span></label><div class="actions">${button('查看', 'studio-source-view', 'book', false, s.id)}${button('移除', 'studio-delete-source', 'trash', false, s.id)}</div></article>`).join('') : '<div class="studio-empty"><p>放入你希望参考的书或片段。</p><small>支持整本 MD / TXT；分析前会自动抽样并展示范围。</small></div>';
  }
  function profileList() {
    return state.project.studio.profiles.length ? state.project.studio.profiles.map(p => `<article class="studio-profile"><div class="studio-profile-top"><h3>${e(p.name)}</h3>${tag(p.approved ? '已确认' : '待确认', p.approved ? 'green' : 'gold')}${local.profileMeta.find(x => x.id === p.id)?.outdated ? tag('参考材料已变化', 'gold') : ''}</div><p>${e(p.overview.slice(0, 220))}</p>${sceneUI.summary(p)}${p.usage ? `<p class="studio-usage">适合：${e(p.usage)}</p>` : ''}${p.sampling ? `<small>基于 ${p.sampling.sampleLength.toLocaleString()} / ${p.sampling.fullLength.toLocaleString()} 字符的样本</small>` : ''}<small>版本 ${p.version} · ${p.rules.filter(r => r.weight !== 'off').length} 条启用规则 · ${p.examples.filter(x => x.enabled !== false).length} 个样例</small><div class="actions">${button('查看与编辑', 'studio-profile', 'edit', false, p.id)}${p.approved ? button('用于片段写作', 'studio-use-profile', 'arrow', true, p.id) : ''}${button('移除', 'studio-delete-profile', 'trash', false, p.id)}</div></article>`).join('') : '<p class="hint">分析参考材料后，将结果保存为草案；确认规则和样例后即可使用。</p>';
  }
  function renderJobs() {
    return `${local.error ? `<p class="error-message">${e(local.error)}</p>` : ''}${local.jobs.length ? local.jobs.map(j => `<div class="studio-job"><div><strong>${e(j.title)}</strong><p>${e(j.outdated ? '原文或材料已变化' : jobLabels[j.status])} · ${j.calls} 次请求${j.totalBatches ? ` · ${j.status === 'ready' ? j.totalBatches : Object.values(j.steps).filter(s => s.status === 'done').length} / ${j.totalBatches} 批${j.calls === 0 && j.status === 'ready' ? '（复用已有索引）' : ''}` : ''}${j.collected ? ' · 已保存到档案' : ''}</p>${j.error ? `<p class="job-error">${e(j.error)}</p>` : ''}<div class="studio-step-list">${Object.entries(j.steps).map(([id, s]) => `<span class="step-${e(s.status)}">${e(stepLabels[id] || (id.startsWith('index-') ? '场景识别批次' : id.startsWith('specialty-') ? SCENE_TYPES[id.slice(10)] : id === 'scene-general' ? '通用习惯归纳' : id))} ${s.status === 'done' ? '✓' : s.status === 'failed' ? '待继续' : '…'}</span>`).join('')}</div></div><div class="job-actions">${button('查看', 'studio-job', 'arrow', false, j.id)}${j.status === 'failed' && !j.outdated ? button('继续未完成步骤', 'studio-retry', 'clock', false, j.id) : ''}${['queued', 'running'].includes(j.status) ? button('停止', 'studio-cancel', 'close', false, j.id) : ''}</div></div>`).join('') : '<p class="hint">分析或写作任务会保存在本机。关闭页面后，本机服务仍可继续处理。</p>'}`;
  }
  function writingForm() {
    const f = local.form, profiles = state.project.studio.profiles.filter(p => p.approved), chapters = sortChapters(state.project.chapters);
    if (!f.profileId || !profiles.some(p => p.id === f.profileId)) f.profileId = profiles[0]?.id || '';
    if (!['auto', 'general', ...Object.keys(SCENE_TYPES)].includes(f.sceneType) || (!['auto', 'general'].includes(f.sceneType) && !profile(f.profileId)?.rules.some(r => r.sceneType === f.sceneType && r.weight !== 'off'))) f.sceneType = 'auto';
    if (!f.chapterId || !chapters.some(c => c.id === f.chapterId)) f.chapterId = chapters.at(-1)?.id || '';
    const options = (items, value) => items.map(([id, label]) => `<option value="${e(id)}" ${id === value ? 'selected' : ''}>${e(label)}</option>`).join('');
    return `<form id="studio-writing-form"><div class="field-row"><label class="field"><span>任务</span><select class="select" name="mode">${options([['rewrite', '改写已有片段'], ['continue', '按指引续写']], f.mode)}</select></label><label class="field"><span>使用文风</span><select class="select" name="profileId" required><option value="">请选择已确认的档案</option>${options(profiles.map(p => [p.id, p.name + (p.usage ? ' · ' + p.usage.slice(0, 40) : '') + ' · v' + p.version]), f.profileId)}</select></label></div>${profiles.length ? `<div class="studio-style-choice"><strong>本次使用：${e(profile(f.profileId)?.name || '未选择')}</strong><p>${e(profile(f.profileId)?.usage || '可为每个片段选择不同文风，选择会随本次任务保存。')}</p><label class="field"><span>本次写作场景</span><select class="select" name="sceneType">${options([['auto', '自动建议（最多两类）'], ['general', '仅通用习惯'], ...Object.entries(SCENE_TYPES).filter(([id]) => profile(f.profileId)?.rules.some(r => r.sceneType === id && r.weight !== 'off'))], f.sceneType)}</select></label><label class="field"><span>文风参考程度</span><select class="select" name="referenceLevel">${options([['light', '轻度参考 · 保留原本表达'], ['strong', '明显参考 · 充分采用所选写法']], f.referenceLevel)}</select></label></div>` : ''}${!profiles.length ? '<p class="notice">先在“参考与文风”中分析材料，并确认一份文风档案。</p>' : ''}<div class="field-row"><label class="field"><span>正文来源</span><select class="select" name="sourceKind">${options([['chapter', '从已导入章节选择'], ['paste', '粘贴片段']], f.sourceKind)}</select></label>${f.sourceKind === 'chapter' ? `<label class="field"><span>章节</span><select class="select" name="chapterId"><option value="">请选择章节</option>${options(chapters.map(c => [c.id, c.title]), f.chapterId)}</select></label>` : `<label class="field"><span>作品资料截止章节</span><select class="select" name="cutoffId"><option value="">最新章节</option>${options(chapters.map(c => [c.id, c.title]), f.cutoffId)}</select></label>`}</div>${f.sourceKind === 'chapter' ? `<div class="studio-selection"><div class="actions">${button('载入章节', 'studio-load-chapter', 'book')}${button(f.mode === 'rewrite' ? '使用选中片段' : '从选区末尾续写', 'studio-use-selection', 'check')}${button('从本章末尾续写', 'studio-use-end', 'arrow')}</div><textarea id="studio-chapter-body" readonly aria-label="选择正文范围" placeholder="载入章节后，用鼠标选择需要处理的文字。">${e(local.chapter?.id === f.chapterId ? local.chapter.body : '')}</textarea><div id="studio-selection-status" class="hint">${selectionDescription()}</div>${selectionPreview()}</div>` : `<label class="field"><span>${f.mode === 'rewrite' ? '待改写片段' : '续写前文'}</span><textarea name="text" class="studio-input-text" maxlength="12000" placeholder="粘贴原始片段，保留段落。">${e(f.text)}</textarea></label>`}<label class="field"><span>${f.mode === 'rewrite' ? '本次改写要求（可选）' : '接下来要发生什么（必填）'}</span><textarea name="instructions" maxlength="6000" placeholder="例如：保留两人的试探，只调整对白和停顿；或指定接下来发生的事件。">${e(f.instructions)}</textarea></label><div class="field-row"><label class="field"><span>目标篇幅（约，字）</span><input class="input" name="length" type="number" min="100" max="3000" value="${e(f.length)}"/></label><label class="field"><span>表达调整程度</span><select class="select" name="intensity">${options([['light', '轻度润色'], ['medium', '明显调整'], ['strong', '重塑表达，保留指定事实']], f.intensity)}</select></label></div><label class="field"><span>${f.mode === 'continue' ? '写到哪里停止（必填）' : '范围与停止要求（可选）'}</span><input class="input" name="stopAt" maxlength="6000" value="${e(f.stopAt)}" placeholder="例如：写到对方离开，不揭露真实身份"/></label><details class="studio-details"><summary>作品约束与关联人物</summary><label class="field"><span>本次不可改变的事实 / 信息边界</span><textarea name="lockedFacts" maxlength="6000" placeholder="例如：甲尚不知道乙的真实身份；不新增关键人物或反转。">${e(f.lockedFacts)}</textarea></label><div class="field"><span>关联人物（不选则按片段姓名匹配，最多 12 人）</span><div class="check-options">${state.project.characters.map(c => `<label class="check-option"><input type="checkbox" name="characterIds" value="${e(c.id)}" ${f.characterIds.includes(c.id) ? 'checked' : ''}/>${e(c.name)}</label>`).join('')}</div></div></details><label class="check-option"><input type="checkbox" name="revise" ${f.revise ? 'checked' : ''}/>根据审查意见最多修订一轮，并再次核对</label><p class="hint">使用当前同一个模型分工处理前情、写作、情节核对和文风核对。一次任务最多 ${f.revise ? '7' : '4'} 次请求；失败不自动重试。所选片段、相关作品资料与文风样例会发送到你配置的接口。</p><button class="btn primary" type="submit" ${local.submitting ? 'disabled' : ''}>生成候选稿</button></form>`;
  }
  function selectionDescription() {
    if (!local.selection) return '尚未确认范围。改写先选中文字；续写可选择位置或从章末开始。';
    const s = local.selection;
    return `${s.mode === 'rewrite' ? `已选 ${s.end - s.start} 字符` : `从第 ${s.end} 字符后续写`} · 基于载入时的正文版本`;
  }
  function selectionPreview() {
    if (!local.selection || !local.chapter || local.selection.mode !== local.form.mode) return '';
    const { start, end, mode } = local.selection;
    const text = mode === 'rewrite' ? local.chapter.body.slice(start, end) : local.chapter.body.slice(Math.max(0, end - 600), end);
    return `<details class="studio-selected-preview" open><summary>${mode === 'rewrite' ? '本次改写的原文' : '续写位置前的文字'}</summary><pre>${e(text)}</pre><p class="hint">${mode === 'rewrite' ? '仅处理以上选区。' : '从以上文字之后接写，后面的原文不包含在续写前文中。'}</p></details>`;
  }
  function draftList() {
    return state.project.studio.drafts.length ? [...state.project.studio.drafts].reverse().map(d => `<article class="studio-draft"><div><h3>${e(d.title)}</h3><p>${e(d.profileSnapshot?.name || '历史文风')} · ${date(d.createdAt)} · ${d.versions.length} 个版本${d.incomplete ? ' · 审查未完成' : ''}</p><p class="draft-excerpt">${e(d.versions.at(-1).text.slice(0, 170))}</p></div><div class="actions">${button('对照与导出', 'studio-draft', 'book', true, d.id)}${button('移除', 'studio-delete-draft', 'trash', false, d.id)}</div></article>`).join('') : '<div class="studio-empty"><p>还没有保存的候选稿。</p><small>任务完成后先查看，再保存到这里。候选稿独立于正式正文。</small></div>';
  }
  function promptPanel() {
    return `<p class="hint">每个角色独立调用同一模型，工具权限限于读取本次资料和返回结果。修改提示词会产生新版本；已开始的任务保留当时的提示词。内置版本 ${PROMPT_VERSION}，自定义版本 ${state.project.studio.promptRevision}。</p>${Object.entries(AGENTS).map(([id, agent]) => `<details class="studio-agent"><summary>${e(agent.name)} <small>${e(agent.responsibility)}</small></summary><textarea data-studio-prompt="${id}" aria-label="${e(agent.name)}提示词" maxlength="12000">${e(state.project.studio.promptOverrides[id] || agent.prompt)}</textarea><div class="actions">${button('保存提示词', 'studio-prompt-save', 'check', false, id)}${button('恢复内置提示词', 'studio-prompt-reset', 'back', false, id)}</div></details>`).join('')}`;
  }
  function renderPage() {
    return `<div class="page-heading"><div><div class="eyebrow">摹其笔意，写自己的故事</div><h1>文风工作台</h1><p>从参考文字中整理写法，在你指定的片段里尝试。</p></div><div class="heading-actions">${tag(local.configured ? '接口会话已配置' : '接口尚未配置', local.configured ? 'green' : 'gold')}<button class="btn" data-page="ai">接口设置</button></div></div><div class="studio-tabs">${[['sources', '参考与文风'], ['writing', '片段写作'], ['drafts', '候选稿'], ['prompts', 'Agent 职责与提示词']].map(([id, title]) => `<button class="${local.tab === id ? 'active' : ''}" data-action="studio-tab" data-id="${id}">${title}</button>`).join('')}</div>${local.tab === 'sources' ? `<div class="studio-columns"><section class="panel form-panel"><div class="detail-title"><h2>参考材料</h2><div class="actions">${button('导入文档', 'studio-import', 'upload')}${button('粘贴文字', 'studio-paste', 'plus')}</div></div><p class="hint">支持整本导入，每份最多 200 万字符。深度分析先建立全文场景索引，再核对分类样本；也可使用一次请求的位置抽样快捷分析。不同文风请分别分析并保存。</p>${sourceList()}${sceneUI.controls()}<div class="studio-analyze">${button('位置抽样分析（快捷）', 'studio-analyze', 'ai', true)}<small>一次分析请求，结果需你编辑确认。</small></div></section><section class="panel form-panel"><h2>我的文风库</h2><p class="hint">每份档案可命名、备注适用场景。不同片段切换使用，一次任务采用一份文风。</p>${profileList()}</section></div>` : local.tab === 'writing' ? `<div class="studio-compose"><section class="panel form-panel"><h2>片段与要求</h2>${writingForm()}</section><aside class="studio-writing-note"><h3>你掌握情节走向</h3><p>文风负责表达。不可改变的事实、角色知情范围与停止位置，应在本次要求中写清楚。</p><ol><li>准备相关前情</li><li>生成候选稿</li><li>分别核对情节与文风</li><li>按设置修订，再交给你选择</li></ol><p>候选稿可复制或导出。采用到原始正文文件后，再通过章节目录同步更新资料。</p></aside></div>` : local.tab === 'drafts' ? draftList() : `<section class="panel form-panel">${promptPanel()}</section>`}<section class="section studio-jobs"><div class="section-head"><h2>本机任务记录</h2>${button('刷新进度', 'studio-refresh', 'clock')}</div><div class="panel" id="studio-job-list">${renderJobs()}</div></section>`;
  }
  async function refresh() {
    const projectId = state.project.projectId;
    const result = await api('/api/studio'); if (state.project.projectId !== projectId) return;
    local.jobs = result.jobs; local.configured = result.configured; local.profileMeta = result.profiles; local.indexMeta = result.sceneIndexes || []; local.error = result.error;
    const node = $('#studio-job-list'); if (node) node.innerHTML = renderJobs();
  }
  async function serverMutation(operation) {
    const task = state.saveQueue.then(operation); state.saveQueue = task.catch(error => toast(error.message, true)); return task;
  }
  async function loadChapter() {
    captureForm(); const id = local.form.chapterId;
    if (!id) throw new Error('请选择章节');
    local.chapter = await api('/api/studio/chapter?id=' + encodeURIComponent(id)); local.selection = null;
    if (state.page === 'studio') render();
  }
  async function analysisPreview() {
    await state.saveQueue;
    const sources = state.project.studio.sources.filter(s => local.selectedSources.has(s.id));
    const projectId = state.project.projectId, revision = state.project.revision;
    let plan = analysisSamples(sources);
    const defaultName = sources.length === 1 ? sources[0].name.replace(/\.(md|txt|markdown)$/i, '').slice(0, 190) + ' · 文风' : '';
    const dialog = openModal('分析前预览', `<label class="field"><span>文风档案名称</span><input class="input" id="sample-profile-name" maxlength="200" value="${e(defaultName)}" placeholder="例如：日常对白、紧张叙述"/></label><label class="field"><span>本次分析总量上限</span><select class="select" id="sample-budget"><option value="20000">约 2 万字符 · 精简</option><option value="40000" selected>约 4 万字符 · 默认</option><option value="65000">约 6.5 万字符 · 更多样本</option></select></label><p class="hint">自动从前、中、后分布抽样，尽量沿换行切分。你可以展开查看每段实际文字。所选材料将归纳为一份文风；不同文风请分别分析。</p><div id="sample-preview"></div>`, '<button class="btn" data-action="close-modal">取消</button><button class="btn primary" id="sample-confirm">确认样本并分析</button>', true);
    const update = () => {
      plan = analysisSamples(sources, { budget: Number(dialog.querySelector('#sample-budget').value) });
      dialog.querySelector('#sample-preview').innerHTML = `<div class="notice">已导入 ${plan.fullLength.toLocaleString()} 字符 · 本次发送 ${plan.sampleLength.toLocaleString()} 字符 · ${plan.samples.length} 份材料。一次分析请求，使用已保存的接口配置。</div>${plan.samples.map(s => `<section class="studio-sample-source"><h3>${e(s.name)}</h3><p class="hint">${s.sampled ? '分布抽样' : '完整分析'} · ${s.ranges.length} 段 · 全文 ${s.fullLength.toLocaleString()} 字符</p>${s.parts.map((part, i) => `<details class="studio-sample"><summary>样本 ${i + 1} · 第 ${(part.start + 1).toLocaleString()}—${part.end.toLocaleString()} 字符 · 约 ${Math.round(part.start / s.fullLength * 100)}% 位置</summary><pre>${e(part.body)}</pre></details>`).join('')}</section>`).join('')}`;
    };
    dialog.querySelector('#sample-budget').onchange = update; update();
    dialog.querySelector('#sample-confirm').onclick = async event => {
      if (local.submitting) return;
      local.submitting = true; event.target.disabled = true;
      try {
        await state.saveQueue;
        if (state.project.projectId !== projectId || state.project.revision !== revision) throw new Error('预览期间作品资料已改变，请关闭后重新预览');
        await api('/api/studio/jobs', { method: 'POST', body: JSON.stringify({ type: 'analysis', projectId, revision, sourceIds: sources.map(s => s.id), sampleBudget: plan.budget, samplingVersion: SAMPLING_VERSION, profileName: dialog.querySelector('#sample-profile-name').value.trim(), clientRequestId: uid() }) });
        closeModal(); await refresh(); toast('样本已加入文风分析队列');
      } catch (error) { modalError(error); } finally { local.submitting = false; event.target.disabled = false; }
    };
  }
  function sourceForm() {
    const dialog = openModal('添加文风参考', '<form id="studio-source-form"><label class="field"><span>材料名称</span><input class="input" name="name" required maxlength="500"/></label><label class="field"><span>场景标签（可选）</span><input class="input" name="scene" maxlength="100" placeholder="例如：日常对话、紧张行动、情绪描写"/></label><label class="field"><span>参考文本</span><textarea name="body" required maxlength="2000000" class="studio-input-text"></textarea></label></form>', '<button class="btn" data-action="close-modal">取消</button><button class="btn primary" type="submit" form="studio-source-form">保存参考材料</button>');
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
      if (data.body.trim().length < 30) return modalError(new Error('请至少提供一段完整文字（30 字符）'));
      try { await mutate(p => { const id = uid(); p.studio.sources.push({ id, name: data.name.trim(), scene: data.scene.trim(), body: data.body.trim(), createdAt: now() }); local.selectedSources.add(id); }, '参考材料已保存'); closeModal(); } catch (error) { modalError(error); }
    };
  }
  function renderRuleEvidence(rule) {
    return rule.evidence?.length ? '<details class="studio-details"><summary>跨场景支持依据</summary>' + rule.evidence.map(x => '<p>' + e(SCENE_TYPES[x.sceneType] || '通用') + ' · ' + e(state.project.studio.sources.find(s => s.id === x.sourceId)?.name || '历史材料') + '</p><blockquote>' + e(x.quote) + '</blockquote>').join('') + '</details>' : '';
  }
  function profileForm(id) {
    const p = profile(id); if (!p) throw new Error('文风档案不存在');
    const dialog = openModal('确认文风 · ' + p.name, `<form id="studio-profile-form"><label class="field"><span>档案名称</span><input class="input" name="name" maxlength="200" required value="${e(p.name)}"/></label><label class="field"><span>适用场景（可选）</span><input class="input" name="usage" maxlength="500" placeholder="例如：日常对话、紧张追逐、克制的心理描写" value="${e(p.usage || '')}"/></label><label class="field"><span>概览</span><textarea name="overview" maxlength="10000">${e(p.overview)}</textarea></label>${sceneUI.summary(p)}${p.uncertainty ? `<div class="notice">样本局限：${e(p.uncertainty)}</div>` : ''}<h3>逐条确认写法</h3>${p.rules.map((rule, i) => `<div class="studio-rule"><div class="studio-rule-top">${tag(ruleCategories[rule.category])}${tag(rule.scope === 'scene' ? rule.scene || '特定场景' : '共同习惯')}<select class="select" data-rule-weight="${i}" aria-label="规则 ${i + 1} 采用程度">${[['keep', '保留'], ['soften', '弱化'], ['off', '不采用']].map(([value, label]) => `<option value="${value}" ${rule.weight === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><textarea data-rule-text="${i}" maxlength="2000" aria-label="规则 ${i + 1}">${e(rule.rule)}</textarea><details><summary>查看依据 · ${e(rule.sourceName || '参考材料')}</summary><blockquote>${e(rule.quote)}</blockquote></details>${renderRuleEvidence(rule)}</div>`).join('')}<h3>生成时参考的样例</h3><p class="hint">生成时按本次场景选择已勾选样例，最多 5 个。</p>${p.examples.map((example, i) => `<div class="studio-example"><label><input type="checkbox" data-example-check="${i}" ${example.enabled !== false ? 'checked' : ''}/>采用此样例 · ${e(example.sourceName || '参考材料')} · ${e(example.scene || '综合场景')}</label><blockquote>${e(example.quote)}</blockquote></div>`).join('')}<p class="hint">改写后的规则按你的要求使用，原文证据保留供对照。至少保留一条规则与一个样例。</p></form>`, '<button class="btn" id="studio-profile-save">保存草案</button><button class="btn primary" id="studio-profile-approve">确认并保存文风档案</button>', true);
    const save = async approved => {
      try {
        const form = dialog.querySelector('form'), data = Object.fromEntries(new FormData(form));
        const rules = p.rules.map((r, i) => ({ ...r, rule: form.querySelector(`[data-rule-text="${i}"]`).value.trim(), weight: form.querySelector(`[data-rule-weight="${i}"]`).value, authorEdited: r.authorEdited || form.querySelector(`[data-rule-text="${i}"]`).value.trim() !== r.rule }));
        const examples = p.examples.map((x, i) => ({ ...x, enabled: form.querySelector(`[data-example-check="${i}"]`).checked }));
        if (!data.name.trim() || rules.some(r => !r.rule)) throw new Error('档案名称与规则内容不能为空');
        await mutate(project => { const target = project.studio.profiles.find(x => x.id === id); Object.assign(target, { name: data.name.trim(), overview: data.overview.trim(), usage: data.usage.trim(), rules, examples, approved, version: target.version + 1, updatedAt: now() }); }, approved ? '文风档案已确认，可以用于片段写作' : '文风草案已保存');
        closeModal();
      } catch (error) { modalError(error); }
    };
    dialog.querySelector('#studio-profile-save').onclick = () => save(false);
    dialog.querySelector('#studio-profile-approve').onclick = () => save(true);
  }
  function reviewHtml(review, title) {
    if (!review) return `<section class="studio-review"><h4>${title}</h4><p class="hint">此版本的核对尚未完成。</p></section>`;
    return `<section class="studio-review"><h4>${title} ${tag(review.status === 'pass' ? '未发现问题' : review.status === 'uncertain' ? '需要作者判断' : '有核对意见', review.status === 'pass' ? 'green' : 'gold')}</h4>${review.issues.map(x => `<div class="studio-review-issue">${tag({ blocking: '优先核对', suggestion: '修改建议', uncertain: '无法确定' }[x.severity], x.severity === 'blocking' ? 'red' : '')}<p>${e(x.message)}</p>${x.quote ? `<blockquote>${e(x.quote)}</blockquote>` : ''}<p>建议：${e(x.suggestion)}</p>${x.referenceIds.length ? `<small>依据：${e(x.referenceIds.join('、'))}</small>` : ''}</div>`).join('')}${review.notes ? `<p class="hint">${e(review.notes)}</p>` : ''}</section>`;
  }
  function candidateModal(draft, jobId = '', index = draft.versions.length - 1, view = 'parallel', outdated = false) {
    const v = draft.versions[index]; local.currentCandidate = { draft, jobId, index, view, outdated };
    const original = draft.mode === 'continue' ? draft.before || draft.source?.preceding || '' : draft.original;
    const difference = sentenceDiff(draft.mode === 'continue' ? '' : original, v.text);
    const dialog = openModal(draft.title || '候选稿对照', `<div class="notice">这是候选稿。复制或导出后，在原始正文文件中选择采用；目录同步后再更新作品资料。</div>${draft.incomplete ? '<p class="error-message">此任务部分步骤未完成，请结合已有记录自行核对，或继续未完成步骤。</p>' : ''}${outdated ? '<p class="error-message">原始章节已更新，此稿基于旧版，请重新核对。</p>' : ''}<div class="studio-candidate-toolbar"><select class="select" id="studio-candidate-version" aria-label="候选稿版本">${draft.versions.map((x, i) => `<option value="${i}" ${i === index ? 'selected' : ''}>${e(x.label)}</option>`).join('')}</select><select class="select" id="studio-candidate-view" aria-label="对照方式"><option value="parallel" ${view === 'parallel' ? 'selected' : ''}>原文与候选并排</option><option value="diff" ${view === 'diff' ? 'selected' : ''}>按句查看变化</option></select><span class="hint">${v.text.length} 字符 · ${e(draft.profileSnapshot?.name || '')}${draft.profileSnapshot?.appliedSceneTypes ? ' · ' + e(draft.profileSnapshot.appliedSceneTypes.map(t => SCENE_TYPES[t]).join('、') || '仅通用习惯') : ''}</span></div>${view === 'parallel' ? `<div class="studio-comparison"><section><h4>${draft.mode === 'continue' ? '续写前文' : '原片段'}</h4><pre>${e(original)}</pre></section><section><h4>${draft.mode === 'continue' ? '新增内容' : '候选稿'}</h4><textarea id="studio-candidate-text" readonly aria-label="候选稿正文">${e(v.text)}</textarea></section></div>` : `<div class="studio-diff">${difference.map(x => `<${x.type === 'add' ? 'ins' : x.type === 'remove' ? 'del' : 'span'}>${e(x.text)}</${x.type === 'add' ? 'ins' : x.type === 'remove' ? 'del' : 'span'}>`).join('')}</div>`}${v.notes ? `<p class="hint">生成说明：${e(v.notes)}</p>` : ''}${v.unresolved?.length ? `<div class="notice">待你决定：${v.unresolved.map(e).join('；')}</div>` : ''}${draft.warnings?.length ? `<div class="notice">${draft.warnings.map(e).join('<br>')}</div>` : ''}<div class="studio-review-grid">${reviewHtml(v.reviews?.continuity, '情节核对')}${reviewHtml(v.reviews?.style, '文风核对')}</div><details class="studio-details"><summary>任务依据与复现信息</summary><p>模型：${e(draft.model || '当前模型')} · 请求 ${draft.calls || 0} 次 · 内置提示词 ${e(draft.audit?.promptVersion || PROMPT_VERSION)} · 自定义版本 ${draft.audit?.promptRevision || 0}</p><p>不可改变的事实：${e(draft.lockedFacts || '未单独填写')}</p><p>本次要求：${e(draft.instructions || '保留事件，调整表达')}</p><p>截止章节：${e(draft.cutoffTitle || '未指定')}</p>${draft.facts?.map(f => `<p>${e(f.person || '')} ${e(f.text)} <small>${e(f.kind === 'author' ? '作者标注' : '正文记录')}</small></p>`).join('') || '<p>未找到相关已确认资料，须作者自行核对。</p>'}${draft.missing?.length ? `<p>缺失资料：${draft.missing.map(e).join('；')}</p>` : ''}<details><summary>当时使用的提示词</summary>${Object.entries(draft.promptSnapshot || {}).map(([role, text]) => `<h4>${e(AGENTS[role]?.name || role)}</h4><pre class="studio-audit-prompt">${e(text)}</pre>`).join('')}</details></details>`, `${jobId ? button('保存到候选稿', 'studio-collect', 'check', true, jobId) : ''}<button class="btn" id="studio-copy-selection">复制选中文字</button><button class="btn primary" id="studio-copy-candidate">复制此版本</button><button class="btn" id="studio-export-candidate">导出 TXT</button><button class="btn" id="studio-export-report">导出核对记录</button><button class="btn" data-action="close-modal">关闭</button>`, true);
    dialog.querySelector('#studio-candidate-version').onchange = event => candidateModal(draft, jobId, Number(event.target.value), view, outdated);
    dialog.querySelector('#studio-candidate-view').onchange = event => candidateModal(draft, jobId, index, event.target.value, outdated);
    dialog.querySelector('#studio-copy-candidate').onclick = async () => { try { await navigator.clipboard.writeText(v.text); toast('此版本已复制，请到原始正文文件中选择采用'); } catch (error) { modalError(error); } };
    dialog.querySelector('#studio-copy-selection').onclick = async () => { const text = dialog.querySelector('#studio-candidate-text'); if (!text || text.selectionStart === text.selectionEnd) return modalError(new Error('请在并排视图的候选稿中选择文字')); try { await navigator.clipboard.writeText(text.value.slice(text.selectionStart, text.selectionEnd)); toast('所选文字已复制'); } catch (error) { modalError(error); } };
    dialog.querySelector('#studio-export-candidate').onclick = () => download(v.text, (draft.title || '候选稿') + '-' + v.label + '.txt');
    dialog.querySelector('#studio-export-report').onclick = () => download(`# ${draft.title}\n\n文风：${draft.profileSnapshot?.name}\n模型：${draft.model}\n提示词版本：${draft.audit?.promptVersion} / ${draft.audit?.promptRevision}\n\n## 候选稿\n\n${v.text}\n\n## 核对结果\n\n${JSON.stringify(v.reviews || { notice: '核对未完成' }, null, 2)}\n\n## 本次任务\n\n${draft.instructions || ''}\n${draft.lockedFacts || ''}\n`, (draft.title || '候选稿') + '-核对记录.md', 'text/markdown;charset=utf-8');
  }
  async function showJob(id) {
    const job = await api('/api/studio/jobs/' + id);
    if (sceneUI.showJob(job)) return;
    if (job.type === 'analysis') {
      const result = job.result;
      openModal(job.title, `${result ? `<h3>${e(result.name)}</h3><p>${e(result.overview)}</p>${result.rules.map(r => `<div class="studio-rule">${r.sceneType ? tag(SCENE_TYPES[r.sceneType] || '通用习惯') : ''}<p>${e(r.rule)}</p><blockquote>${e(r.quote)}</blockquote>${renderRuleEvidence(r)}<small>${e(r.sourceName)}</small></div>`).join('')}` : '<p>尚无分析结果。</p>'}${job.error ? `<p class="error-message">${e(job.error)}</p>` : ''}<p class="hint">${job.calls} 次请求 · ${e(job.model)} · 保存为草案后可逐条编辑确认。</p>`, `${result && !job.outdated && !['queued', 'running'].includes(job.status) ? button('保存为文风草案', 'studio-collect', 'check', true, id) : ''}<button class="btn" data-action="close-modal">关闭</button>`, true);
    } else if (job.result?.versions?.length) candidateModal({ ...job.result, title: job.title, original: job.input.original, before: job.input.before, profileSnapshot: job.result.profileSnapshot || job.input.profile, source: job.input.source, mode: job.mode, instructions: job.input.instructions, lockedFacts: job.input.lockedFacts, cutoffTitle: job.input.cutoffTitle, incomplete: job.status !== 'ready', model: job.model, audit: job.audit, promptSnapshot: job.input.prompts, calls: job.calls }, ['queued', 'running'].includes(job.status) || job.outdated ? '' : id, undefined, 'parallel', job.outdated);
    else openModal(job.title, `<p>${e(jobLabels[job.status])}</p>${job.error ? `<p class="error-message">${e(job.error)}</p>` : ''}<p class="hint">完成的步骤会保留在本机。当前已发出 ${job.calls} 次请求。</p>`, '<button class="btn" data-action="close-modal">关闭</button>');
  }
  async function collect(id) {
    let result;
    await serverMutation(async () => { result = await api('/api/studio/jobs/' + id + '/collect', { method: 'POST', body: JSON.stringify({ revision: state.project.revision }) }); state.project = result.project; });
    await refresh(); render();
    const savedProfile = state.project.studio.profiles.find(x => x.sourceJobId === id);
    if (savedProfile) { local.tab = 'sources'; render(); profileForm(savedProfile.id); }
    else { local.tab = 'drafts'; render(); closeModal(); toast('候选稿已保存，正式正文保持原样'); }
  }
  async function submitWriting(event) {
    event.preventDefault(); if (local.submitting) return;
    captureForm(); const f = local.form;
    if (f.sourceKind === 'chapter' && (!local.chapter || local.chapter.id !== f.chapterId || !local.selection || local.selection.mode !== f.mode)) return toast('请先载入章节，并确认本次处理范围', true);
    local.submitting = true; event.submitter.disabled = true;
    try {
      await state.saveQueue;
      const data = { ...f, projectId: state.project.projectId, revision: state.project.revision, type: 'writing', clientRequestId: uid(), ...(f.sourceKind === 'chapter' ? { bodyHash: local.chapter.bodyHash, start: local.selection.start, end: local.selection.end } : {}) };
      await api('/api/studio/jobs', { method: 'POST', body: JSON.stringify(data) }); local.dirty = false; await refresh(); toast('已开始处理，候选稿和核对结果会保存在本机');
    } catch (error) { toast(error.message, true); } finally { local.submitting = false; if (event.submitter.isConnected) event.submitter.disabled = false; }
  }
  function bind() {
    for (const checkbox of document.querySelectorAll('[data-studio-source]')) checkbox.onchange = () => { if (checkbox.checked) local.selectedSources.add(checkbox.dataset.studioSource); else local.selectedSources.delete(checkbox.dataset.studioSource); };
    const form = $('#studio-writing-form');
    if (form) {
      form.onsubmit = submitWriting;
      form.oninput = () => { captureForm(); local.dirty = true; };
      form.querySelector('[name="profileId"]')?.addEventListener('change', () => { captureForm(); render(); });
      for (const name of ['mode', 'sourceKind', 'chapterId']) form.querySelector(`[name="${name}"]`)?.addEventListener('change', () => { captureForm(); local.selection = null; render(); });
      if (local.selection && local.chapter?.id === local.form.chapterId) {
        const textarea = $('#studio-chapter-body'); textarea?.setSelectionRange(local.selection.start, local.selection.end);
      }
    }
  }
  async function handleAction(act, id) {
    if (!act.startsWith('studio-')) return false;
    if (await sceneUI.handleAction(act)) return true;
    if (act === 'studio-open-chapter') await openForChapter(id);
    if (act === 'studio-tab') { captureForm(); local.tab = id; render(); }
    if (act === 'studio-refresh') await refresh();
    if (act === 'studio-paste') sourceForm();
    if (act === 'studio-import') {
      const files = await chooseFiles('.md,.txt,.markdown', true); if (!files.length) return true;
      if (files.some(f => !/\.(md|txt|markdown)$/i.test(f.name)) || files.reduce((n, f) => n + f.size, 0) > 8 * 1024 * 1024) throw new Error('请选择合计 8 MB 以内的 MD / TXT 文件');
      const sources = []; for (const file of files) { const body = (await decodeFile(file)).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim(); if (body.length < 30 || body.length > SOURCE_MAX_CHARS) throw new Error('每份参考材料须为 30—200 万字符：' + file.name); sources.push({ id: uid(), name: file.name, body, scene: '', createdAt: now() }); }
      await mutate(p => { p.studio.sources.push(...sources); sources.forEach(s => local.selectedSources.add(s.id)); }, '文风参考材料已保存');
    }
    if (act === 'studio-source-view') { const s = state.project.studio.sources.find(s => s.id === id); if (!s) throw new Error('材料不存在'); openModal(s.name, `<p class="hint">文风参考材料 · 与本书正文独立</p><article class="reader">${e(s.body)}</article>`, '<button class="btn" data-action="close-modal">关闭</button>', true); }
    if (act === 'studio-analyze') await analysisPreview();
    if (act === 'studio-profile') profileForm(id);
    if (act === 'studio-use-profile') { local.form.profileId = id; local.tab = 'writing'; render(); }
    if (act === 'studio-load-chapter') await loadChapter();
    if (act === 'studio-use-selection' || act === 'studio-use-end') {
      captureForm(); if (!local.chapter || local.chapter.id !== local.form.chapterId) throw new Error('请先载入章节');
      const textarea = $('#studio-chapter-body');
      if (act === 'studio-use-end') { local.form.mode = 'continue'; local.selection = { mode: 'continue', start: local.chapter.body.length, end: local.chapter.body.length }; render(); }
      else { const start = textarea.selectionStart, end = textarea.selectionEnd; local.selection = writingSelection(local.chapter, local.form.mode, start, end); render(); }
      local.dirty = true;
    }
    if (act === 'studio-job') await showJob(id);
    if (act === 'studio-collect') await collect(id);
    if (act === 'studio-retry' || act === 'studio-cancel') { await api('/api/studio/jobs/' + id + (act === 'studio-retry' ? '/retry' : '/cancel'), { method: 'POST', body: '{}' }); await refresh(); toast(act === 'studio-retry' ? '将从未完成步骤继续，可能产生接口费用' : '已停止任务，已有结果保留'); }
    if (act === 'studio-draft') {
      const draft = state.project.studio.drafts.find(d => d.id === id); if (!draft) throw new Error('候选稿不存在');
      let outdated = false;
      if (draft.source?.kind === 'chapter') { try { const chapter = await api('/api/studio/chapter?id=' + encodeURIComponent(draft.source.chapterId)); outdated = chapter.bodyHash !== draft.source.bodyHash; } catch { outdated = true; } }
      candidateModal(draft, '', undefined, 'parallel', outdated);
    }
    if (act === 'studio-prompt-save' || act === 'studio-prompt-reset') {
      const text = $(`[data-studio-prompt="${id}"]`)?.value.trim();
      if (act === 'studio-prompt-save' && !text) throw new Error('提示词不能为空');
      await mutate(p => { if (act === 'studio-prompt-reset' || text === AGENTS[id].prompt) delete p.studio.promptOverrides[id]; else p.studio.promptOverrides[id] = text; p.studio.promptRevision++; }, '提示词版本已保存，适用于新任务');
    }
    if (act.startsWith('studio-delete-')) {
      const kind = { source: 'sources', profile: 'profiles', draft: 'drafts' }[act.replace('studio-delete-', '')];
      if (!kind) throw new Error('未知资料类型');
      const dialog = openModal('移除工作台资料', '<p>操作前会保存保护快照。已有候选稿保留当时的文风和任务依据，原始文件不会被修改。</p>', '<button class="btn" data-action="close-modal">取消</button><button class="btn danger" id="studio-delete-confirm">保存快照并移除</button>');
      dialog.querySelector('#studio-delete-confirm').onclick = async () => { try { await serverMutation(() => api('/api/snapshots', { method: 'POST', body: '{}' })); await mutate(p => { p.studio[kind] = p.studio[kind].filter(x => x.id !== id); if (kind === 'sources') p.studio.sceneIndexes = p.studio.sceneIndexes.filter(i => i.sourceId !== id); }, '已移除'); local.selectedSources.delete(id); await refresh(); closeModal(); } catch (error) { modalError(error); } };
    }
    return true;
  }
  async function openForChapter(id, options = {}) {
    const chapter = await api('/api/studio/chapter?id=' + encodeURIComponent(id));
    if (options.body !== undefined && options.body !== chapter.body) throw new Error('章节原文已更新，请重新打开章节并选择文字');
    const selected = options.mode ? writingSelection(chapter, options.mode, options.start, options.end) : null;
    local.tab = 'writing'; local.form.sourceKind = 'chapter'; local.form.chapterId = id;
    if (selected) local.form.mode = selected.mode;
    local.chapter = chapter; local.selection = selected; local.dirty = Boolean(selected);
    closeModal(); navigate('studio');
    if (selected) {
      document.querySelector('[name="instructions"]')?.focus({ preventScroll: true });
      document.querySelector('.studio-selected-preview')?.scrollIntoView({ block: 'center', behavior: 'instant' });
      toast(selected.mode === 'rewrite' ? '已带入选中片段，填写要求后生成候选稿' : '已带入续写位置，请填写情节方向和停止位置');
    }
  }
  function reset() { local.jobs = []; local.configured = false; local.profileMeta = []; local.indexMeta = []; local.error = ''; local.chapter = null; local.selection = null; local.selectedSources.clear(); local.form.profileId = ''; local.form.text = ''; local.form.instructions = ''; local.form.lockedFacts = ''; local.form.stopAt = ''; local.form.characterIds = []; local.dirty = false; }
  return { renderPage, refresh, bind, handleAction, openForChapter, reset, local };
}
