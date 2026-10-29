import { parseObject } from './studio-domain.js';
import { SCENE_TYPES } from './scene-domain.js';

export const jobLabels = { queued: '排队中', running: '正在处理', pausing: '完成当前请求后暂停', paused: '已暂停', ready: '结果待过目', failed: '未完成', cancelled: '已停止', outdated: '原文已更新' };
const names = { style: '分析文风', context: '整理前情', write: '生成初稿', continuity: '情节核对', styleReview: '文风核对', revise: '按意见修订', continuity2: '修订后情节核对', styleReview2: '修订后文风核对', 'scene-general': '通用习惯归纳' };
export const stepName = id => names[id] || (id.startsWith('index-') ? '场景识别批次 ' + (Number(id.split('-').at(-1)) + 1) : id.startsWith('specialty-') ? SCENE_TYPES[id.slice(10)] : id);
export function renderStudioJobs(local, e, button) {
  return `${local.error ? `<p class="error-message">${e(local.error)}</p>` : ''}${local.jobs.length ? local.jobs.map(j => {
    const steps = Object.entries(j.steps), done = steps.filter(([, s]) => s.status === 'done').length, failed = steps.filter(([, s]) => s.status === 'failed').length, reused = steps.filter(([, s]) => s.reused).length;
    const current = steps.filter(([, s]) => s.status === 'running').map(([id]) => stepName(id)).join('、');
    const eta = j.etaMs && ['running', 'pausing'].includes(j.status) ? ` · 预计剩余约 ${Math.max(1, Math.ceil(j.etaMs / 60000))} 分钟（按已完成批次估算）` : '';
    const usage = j.usageReported ? `输入 ${j.usage.promptTokens.toLocaleString()} / 输出 ${j.usage.completionTokens.toLocaleString()} tokens（接口已报告用量）` : '接口未报告 token 用量';
    return `<article class="studio-job"><div><strong>${e(j.title)}</strong><p>${e(j.outdated ? '原文或材料已变化' : j.collected && j.status === 'ready' ? '已完成并保存' : jobLabels[j.status])} · ${j.calls} 次请求${j.collected && j.status !== 'ready' ? ' · 已保存已有结果' : ''}</p>${j.totalBatches ? `<div class="studio-progress"><progress max="${j.totalBatches}" value="${j.status === 'ready' ? j.totalBatches : done}" aria-label="场景识别批次进度"></progress><span>${j.status === 'ready' ? j.totalBatches : done} / ${j.totalBatches} 批 · ${failed} 批待处理${reused ? ' · ' + reused + ' 批复用' : ''}</span></div>` : ''}<p>${e(current || (j.status === 'queued' ? `前面有 ${j.waitingBehind || 0} 个任务；片段写作优先，识别在批次间让出` : ''))}${e(eta)}</p><p class="studio-usage-note">${e(usage)}</p>${j.status === 'pausing' ? '<p>当前请求仍会完成并可能计费，保存后暂停，不中断或重发它。</p>' : ''}${j.error ? `<p class="job-error">${e(j.error)}</p>` : ''}${steps.length ? `<details class="studio-batch-details" data-job-details="${e(j.id)}"><summary>步骤详情 · ${done} 已完成 / ${failed} 待处理</summary><div class="studio-step-list">${steps.map(([id, s]) => `<span class="step-${e(s.status)}">${e(stepName(id))} ${s.status === 'done' ? s.repaired ? '已人工修复' : s.reused ? '已复用' : '✓' : s.status === 'failed' ? '待处理' : '…'}</span>`).join('')}</div></details>` : ''}</div><div class="job-actions">${button(j.status === 'failed' && j.type === 'analysis' ? '查看并修复' : '查看', 'studio-job', 'arrow', false, j.id)}${['failed', 'paused'].includes(j.status) && !j.outdated ? button(j.status === 'paused' ? '恢复任务' : '继续未完成步骤', 'studio-retry', 'clock', false, j.id) : ''}${['queued', 'running'].includes(j.status) ? button('暂停', 'studio-pause', 'clock', false, j.id) : ''}${['queued', 'running', 'pausing', 'paused'].includes(j.status) ? button('停止任务', 'studio-cancel', 'close', false, j.id) : ''}</div></article>`;
  }).join('') : '<p class="hint">分析或写作任务会保存在本机。关闭页面后，本机服务仍可继续处理。</p>'}`;
}

export function analysisRepairModal(ctx, job, repair, onSaved) {
  const { e, openModal, api } = ctx;
  let raw;
  try { raw = parseObject(repair.responseText); } catch {}
  const structured = raw && Array.isArray(raw.rules) && Array.isArray(raw.examples) && [...raw.rules, ...raw.examples].every(x => x && typeof x === 'object' && !Array.isArray(x) && (!x.evidence || Array.isArray(x.evidence) && x.evidence.every(v => v && typeof v === 'object' && !Array.isArray(v))));
  const sourceOptions = value => repair.sources.map((s, i) => `<option value="${e(s.id)}" ${s.id === value ? 'selected' : ''}>样本 ${i + 1} · ${e(s.chapterTitle || s.name)}</option>`).join('');
  const quoteLabel = prefix => prefix.replace(/^rules(\d+)/, (_, n) => '规则 ' + (Number(n) + 1)).replace(/^examples(\d+)/, (_, n) => '样例 ' + (Number(n) + 1)).replace(/ev(\d+)/, (_, n) => ' 支持依据 ' + (Number(n) + 1));
  const quoteEditor = (item, prefix) => `<label class="field"><span>引用来源</span><select class="select" data-quote-source="${prefix}" aria-label="${quoteLabel(prefix)}引用来源">${!repair.sources.some(s => s.id === item.sourceId) ? `<option value="${e(item.sourceId || '')}" selected>无效来源：${e(item.sourceId || '缺失')}</option>` : ''}${sourceOptions(item.sourceId)}</select></label><label class="field"><span>连续原文引用（保留标点和换行）</span><textarea data-quote-text="${prefix}" aria-label="${quoteLabel(prefix)}原文引用">${e(item.quote || '')}</textarea></label><button class="btn small" type="button" data-fill-focus="${prefix}">填入该样本的核心原文</button>`;
  const entries = structured ? ['rules', 'examples'].map(kind => raw[kind].map((item, i) => `<fieldset class="studio-repair-item" data-repair-kind="${kind}" data-repair-index="${i}"><legend>${kind === 'rules' ? '规则' : '样例'} ${i + 1}</legend><label class="checkbox-line"><input type="checkbox" data-keep-item checked/>保留此条；不保留则从本次结果移除</label>${kind === 'rules' ? `<label class="field"><span>规则内容</span><textarea data-rule-text>${e(item.rule || '')}</textarea></label>` : ''}${quoteEditor(item, kind + i)}${Array.isArray(item.evidence) ? item.evidence.map((ev, n) => `<details class="studio-details"><summary>跨类型支持依据 ${n + 1}</summary>${quoteEditor(ev, kind + i + 'ev' + n)}</details>`).join('') : ''}</fieldset>`).join('')).join('') : '';
  const dialog = openModal('修复分析引用 · ' + stepName(repair.stepId), `<p class="error-message">${e(repair.error)}</p><p class="hint">对照本次真正发送的样本修复引用，或移除没有依据的条目。保存只在本机校验，不调用 AI；仍需保留有效规则和样例，专项与通用证据要求保持不变。</p><div class="studio-repair-samples">${repair.sources.map((s, i) => `<details class="studio-sample"><summary>样本 ${i + 1} · ${e(s.chapterTitle || s.name)} · ${e(s.id)}</summary><pre>${s.focusStart == null ? e(s.body) : e(s.body.slice(0, s.focusStart)) + '<mark>' + e(s.body.slice(s.focusStart, s.focusEnd)) + '</mark>' + e(s.body.slice(s.focusEnd))}</pre></details>`).join('')}</div>${structured ? entries : `<p class="notice">${repair.responseText ? '返回内容无法组成规则列表，可在下面修正 JSON。' : '此旧任务没有保留失败返回，无法还原具体引用。可关闭后继续未完成步骤获取新结果；已保存索引无需重跑。也可自行填写符合约定的分析 JSON。'}</p><label class="field"><span>分析 JSON</span><textarea id="repair-json" class="studio-json-repair" aria-label="修复分析 JSON">${e(repair.responseText)}</textarea></label>`}<p id="repair-error" class="error-message" role="alert"></p>`, '<button class="btn" data-action="close-modal">关闭</button><button class="btn primary" id="repair-save">保存修复（不调用 AI）</button>', true);
  const readQuote = prefix => ({ sourceId: dialog.querySelector(`[data-quote-source="${prefix}"]`).value, quote: dialog.querySelector(`[data-quote-text="${prefix}"]`).value });
  for (const fill of dialog.querySelectorAll('[data-fill-focus]')) fill.onclick = () => {
    const prefix = fill.dataset.fillFocus, source = repair.sources.find(s => s.id === readQuote(prefix).sourceId);
    if (source) { dialog.querySelector(`[data-quote-text="${prefix}"]`).value = (source.focus || source.body).slice(0, 3000); dialog.querySelector('#repair-error').textContent = ''; }
  };
  const save = dialog.querySelector('#repair-save');
  save.onclick = async () => {
    save.disabled = true;
    try {
      let content;
      if (structured) {
        const next = structuredClone(raw);
        for (const kind of ['rules', 'examples']) next[kind] = [...dialog.querySelectorAll(`[data-repair-kind="${kind}"]`)].filter(row => row.querySelector('[data-keep-item]').checked).map(row => {
          const i = Number(row.dataset.repairIndex), item = { ...raw[kind][i], ...readQuote(kind + i) };
          if (kind === 'rules') item.rule = row.querySelector('[data-rule-text]').value;
          if (Array.isArray(item.evidence)) item.evidence = item.evidence.map((_, n) => readQuote(kind + i + 'ev' + n));
          return item;
        });
        content = JSON.stringify(next);
      } else content = dialog.querySelector('#repair-json').value;
      await api(`/api/studio/jobs/${job.id}/repair`, { method: 'POST', body: JSON.stringify({ stepId: repair.stepId, content }) });
      await onSaved();
    } catch (error) { dialog.querySelector('#repair-error').textContent = error.message; } finally { save.disabled = false; }
  };
}
