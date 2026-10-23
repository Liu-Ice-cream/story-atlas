import { SCENE_TYPES, CONTENT_TYPES, sceneDocument, sceneSamples } from './scene-domain.js';
import { uid } from './domain.js';

export function createSceneUI(ctx, local) {
  const { state, api, mutate, render, e, button, openModal, closeModal, modalError, toast } = ctx;
  const choices = { types: Object.keys(SCENE_TYPES), budget: 40000 };
  const selected = ids => state.project.studio.sources.filter(s => (ids || [...local.selectedSources]).includes(s.id));
  const controls = () => `<div class="scene-workflow"><h3>按写作场景深入分析</h3><p>先识别全文，再核对分类样本，最后形成通用习惯与专项写法。原文位置由程序保存，内容类型可多选。</p><div class="actions">${button('建立场景索引', 'studio-scene-index', 'book', true)}${button('分类样本与专项分析', 'studio-scene-preview', 'ai')}</div><small>${state.project.studio.sceneIndexes.filter(i => !local.indexMeta?.find(m => m.sourceId === i.sourceId)?.outdated).length} 份已保存索引 · 初次识别会分批发送全文，确认前显示总量与批次。</small></div>`;
  function summary(profile) {
    return profile.specialties ? `<div class="scene-specialties">${profile.specialties.map(s => `<span class="tag ${s.status === 'missing' ? 'gold' : ''}">${e(SCENE_TYPES[s.type])} · ${s.status === 'missing' ? '样本不足' : s.status === 'limited' ? '少量样本' : `${s.sampleCount} 段样本`}</span>`).join('')}</div>` : '';
  }
  async function enqueue(data, snapshot, submit) {
    if (local.submitting) return;
    local.submitting = true; submit.disabled = true;
    try {
      await state.saveQueue;
      if (state.project.projectId !== snapshot.projectId || state.project.revision !== snapshot.revision) throw new Error('预览期间资料已更新，请重新打开预览');
      await api('/api/studio/jobs', { method: 'POST', body: JSON.stringify({ ...data, projectId: snapshot.projectId, revision: snapshot.revision, clientRequestId: uid() }) });
      closeModal(); await ctx.refresh(); render(); toast('任务已加入队列，完成的批次会保留');
    } catch (error) { modalError(error); } finally { local.submitting = false; submit.disabled = false; }
  }
  async function preflight() {
    await state.saveQueue; const sources = selected();
    if (!sources.length) throw new Error('请先勾选参考材料');
    if (sources.length > 12) throw new Error('一次最多选择 12 份材料');
    const docs = sources.map(s => sceneDocument(s)), snapshot = { projectId: state.project.projectId, revision: state.project.revision };
    const batches = docs.reduce((n, d) => n + d.batches.length, 0), length = sources.reduce((n, s) => n + s.body.length, 0);
    const dialog = openModal('识别全文场景', `<p>将向已配置的接口分批发送 ${length.toLocaleString()} 字符，约 ${batches} 个识别批次；已完成的相同批次可复用。</p><p class="hint">本次建立场景索引，不自动分析所有专项。后续在分类预览里选择要分析的类型和样本量。模型按服务商规则计费；失败不自动重试。</p>${sources.map((s, i) => `<p><strong>${e(s.name)}</strong><br>${docs[i].paragraphs.length.toLocaleString()} 段 · ${docs[i].recognizedChapters} 个章节标题 · ${docs[i].batches.length} 批</p>`).join('')}<p class="hint">章首章末按每章前后两个段落定位，属于位置标记。未识别章节时，仅标记全文首尾。内容标签由 AI 初标，保存后可修改。</p>`, '<button class="btn" data-action="close-modal">取消</button><button class="btn primary" id="scene-index-confirm">开始分批识别全文</button>', true);
    dialog.querySelector('#scene-index-confirm').onclick = event => enqueue({ type: 'scene-index', sourceIds: sources.map(s => s.id) }, snapshot, event.target);
  }
  function editParagraph(sourceId, paragraphId, ids) {
    const index = state.project.studio.sceneIndexes.find(i => i.sourceId === sourceId), p = index.paragraphs.find(p => p.id === paragraphId), source = state.project.studio.sources.find(s => s.id === sourceId);
    const dialog = openModal('核对场景分类', `<p class="hint">${e(p.chapterTitle)} · 第 ${p.start + 1}—${p.end} 字符。位置标记：${p.positions.map(t => SCENE_TYPES[t]).join('、') || '章中'}。</p><pre class="scene-sample-text">${e(source.body.slice(p.start, p.end))}</pre><div class="scene-type-options">${Object.entries(CONTENT_TYPES).map(([id, label]) => `<label><input type="checkbox" name="scene-tag" value="${id}" ${p.tags.includes(id) ? 'checked' : ''}/> ${label}</label>`).join('')}</div><label><input type="checkbox" id="scene-excluded" ${p.excluded ? 'checked' : ''}/> 排除此段，不作为文风样本</label>`, '<button class="btn" id="scene-edit-back">返回样本</button><button class="btn primary" id="scene-edit-save">保存分类</button>', true);
    dialog.querySelector('#scene-edit-back').onclick = () => preview(ids);
    dialog.querySelector('#scene-edit-save').onclick = async () => {
      try {
        const tags = [...dialog.querySelectorAll('[name="scene-tag"]:checked')].map(x => x.value), excluded = dialog.querySelector('#scene-excluded').checked;
        if (!excluded && !tags.length) throw new Error('保留的正文至少勾选一个内容类型');
        await mutate(project => { const target = project.studio.sceneIndexes.find(i => i.sourceId === sourceId), paragraph = target.paragraphs.find(x => x.id === paragraphId); Object.assign(paragraph, { tags, excluded, authorEdited: true }); target.version++; }, '分类已保存');
        preview(ids);
      } catch (error) { modalError(error); }
    };
  }
  async function preview(ids) {
    await state.saveQueue; await ctx.refresh();
    const sources = selected(ids), indexes = sources.map(s => state.project.studio.sceneIndexes.find(i => i.sourceId === s.id));
    if (!sources.length) throw new Error('请先勾选参考材料');
    if (indexes.some(i => !i || local.indexMeta?.find(m => m.sourceId === i.sourceId)?.outdated)) throw new Error('请先建立并保存所选材料的最新场景索引');
    const snapshot = { projectId: state.project.projectId, revision: state.project.revision };
    let plan; const sourceIds = sources.map(s => s.id);
    const dialog = openModal('按写作类型预览样本', `<label class="field"><span>文风档案名称</span><input class="input" id="scene-profile-name" maxlength="200" value="${e(sources.length === 1 ? sources[0].name.replace(/\.(txt|md|markdown)$/i, '').slice(0, 180) + ' · 专项文风' : '专项文风档案')}"/></label><div class="scene-type-options">${Object.entries(SCENE_TYPES).map(([id, label]) => `<label><input type="checkbox" data-scene-type="${id}" ${choices.types.includes(id) ? 'checked' : ''}/> ${label}</label>`).join('')}</div><label class="field"><span>专项样本总量上限</span><select class="select" id="scene-sample-budget">${[20000, 40000, 65000].map(n => `<option value="${n}" ${n === choices.budget ? 'selected' : ''}>${n.toLocaleString()} 字符</option>`).join('')}</select></label><div id="scene-sample-plan"></div>`, '<button class="btn" data-action="close-modal">取消</button><button class="btn primary" id="scene-analysis-confirm">分析所选专项</button>', true);
    const update = () => {
      choices.types = [...dialog.querySelectorAll('[data-scene-type]:checked')].map(x => x.dataset.sceneType); choices.budget = Number(dialog.querySelector('#scene-sample-budget').value);
      if (!choices.types.length) { plan = null; dialog.querySelector('#scene-sample-plan').textContent = '请至少选择一种类型'; return; }
      plan = sceneSamples(sources, indexes, choices.types, choices.budget);
      const available = plan.groups.filter(g => g.samples.length).length, calls = available + (available >= 2 ? 1 : 0);
      dialog.querySelector('#scene-sample-plan').innerHTML = `<div class="notice">全文 ${plan.fullLength.toLocaleString()} 字符 · 专项样本合计 ${plan.sampleLength.toLocaleString()} 字符 · 预计 ${calls} 次分析请求。通用归纳会再次读取这些样本，调用总输入量高于样本合计。</div><p class="hint">每类最多选取 3 个片段，优先分布在不同章节。AI 初标可修改；“开场 / 收尾”是结构位置，可与内容类型重合。没有样本的类型保留为“样本不足”。</p>${plan.groups.map(g => `<section class="scene-sample-group"><h3>${e(g.label)} <small>${g.candidateCount} 个候选段落 · ${g.chapterCount} 章 · ${g.status === 'missing' ? '样本不足' : g.status === 'limited' ? '样本较少' : g.samples.length + ' 段样本'}</small></h3>${g.samples.map(s => `<details class="studio-sample"><summary>${e(s.chapterTitle)} · 第 ${(s.start + 1).toLocaleString()}—${s.end.toLocaleString()} 字符</summary><pre>${e(s.body.slice(0, s.focusStart))}<mark>${e(s.body.slice(s.focusStart, s.focusEnd))}</mark>${e(s.body.slice(s.focusEnd))}</pre><p class="hint">标亮为本次分类的核心段落，其余为相邻上下文。</p><button class="btn small" data-scene-edit="${e(s.paragraphId)}" data-source="${e(s.originalSourceId)}">修改该段分类 / 排除</button></details>`).join('')}</section>`).join('')}`;
      for (const edit of dialog.querySelectorAll('[data-scene-edit]')) edit.onclick = () => editParagraph(edit.dataset.source, edit.dataset.sceneEdit, sourceIds);
    };
    dialog.querySelector('#scene-sample-budget').onchange = update; for (const box of dialog.querySelectorAll('[data-scene-type]')) box.onchange = update; update();
    dialog.querySelector('#scene-analysis-confirm').onclick = event => {
      if (!plan?.sampleLength) return modalError(new Error('请选择有可用样本的类型'));
      return enqueue({ type: 'analysis', analysisMode: 'scenes', sourceIds, sceneTypes: plan.types, sampleBudget: plan.budget, profileName: dialog.querySelector('#scene-profile-name').value.trim() }, snapshot, event.target);
    };
  }
  function showJob(job) {
    if (job.type !== 'scene-index') return false;
    const indexes = job.result?.indexes || [];
    const dialog = openModal(job.title, `${indexes.length ? indexes.map(i => `<h3>${e(i.sourceName)}</h3><p>${i.paragraphs.length} 段 · ${i.recognizedChapters} 个章节标题 · 排除 ${i.paragraphs.filter(p => p.excluded).length} 段非正文</p>`).join('') : '<p>识别完成后可保存索引，再预览各类写作样本。</p>'}${job.error ? `<p class="error-message">${e(job.error)}</p>` : ''}<p class="hint">已发出 ${job.calls} 次请求。相同批次与已完成步骤会复用，不自动重复计费。</p>`, `${job.status === 'ready' && !job.outdated ? '<button class="btn primary" id="scene-index-collect">保存索引并查看分类样本</button>' : ''}<button class="btn" data-action="close-modal">关闭</button>`, true);
    const save = dialog.querySelector('#scene-index-collect');
    if (save) save.onclick = async () => {
      save.disabled = true;
      try {
        const task = state.saveQueue.then(async () => { const result = await api('/api/studio/jobs/' + job.id + '/collect', { method: 'POST', body: JSON.stringify({ revision: state.project.revision }) }); state.project = result.project; }); state.saveQueue = task.catch(() => {}); await task;
        closeModal(); await ctx.refresh(); render(); await preview(job.input.sourceManifest.map(s => s.id));
      } catch (error) { modalError(error); } finally { save.disabled = false; }
    };
    return true;
  }
  async function handleAction(act) {
    if (act === 'studio-scene-index') { await preflight(); return true; }
    if (act === 'studio-scene-preview') { await preview(); return true; }
    return false;
  }
  return { controls, summary, showJob, handleAction };
}
