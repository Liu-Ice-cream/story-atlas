// One next action for the selected reference set; quick profiles can skip indexing.
export function styleWorkflow(project, local) {
  const studio = project.studio;
  const selected = [...local.selectedSources].filter(id => studio.sources.some(s => s.id === id));
  const ids = selected.length ? selected : studio.sources.length === 1 ? [studio.sources[0].id] : [];
  const output = (stage, message, label, action, id = '') => ({ stage, message, label, action, id, sourceIds: ids });
  if (!studio.sources.length) return output(0, '先放入一本参考书或一组片段。', '导入参考材料', 'studio-import');
  if (!ids.length) return output(1, '请勾选本次要整理的材料。不同文风建议分别准备。', '', '');
  const matches = manifest => manifest?.length === ids.length && ids.every(id => manifest.some(s => (s.id || s.sourceId) === id));
  const profiles = studio.profiles.filter(p => matches(p.sourceManifest) && !local.profileMeta?.find(m => m.id === p.id)?.outdated);
  const approved = [...profiles].reverse().find(p => p.approved);
  if (approved) return output(5, '文风档案已确认，改写和续写可反复使用。', '开始仿写 / 续写', 'studio-use-profile', approved.id);
  const draft = profiles.at(-1);
  if (draft) return output(4, '分析已保存为草案。核对规则与样例后确认，即可用于仿写。', '核对并确认文风', 'studio-profile', draft.id);
  const jobs = local.jobs.filter(j => !j.outdated && ids.length === j.sourceIds?.length && ids.every(id => j.sourceIds.includes(id)));
  const analysis = jobs.find(j => j.type === 'analysis' && !j.collected && j.status !== 'cancelled');
  if (analysis) return output(analysis.status === 'ready' ? 4 : 3, analysis.status === 'ready' ? '分析已完成，下一步保存草案并确认文风。' : analysis.status === 'failed' ? '专项分析尚未完成，请查看错误并修复或继续。已保存索引无需重跑。' : analysis.status === 'paused' ? '分析已暂停，完成的步骤已保存，可恢复任务。' : '正在准备文风档案，完成后保存草案并确认。', analysis.status === 'failed' ? '查看并处理分析错误' : '查看分析与下一步', 'studio-job', analysis.id);
  if (ids.every(id => studio.sceneIndexes.some(i => i.sourceId === id) && !local.indexMeta?.find(m => m.sourceId === id)?.outdated)) return output(3, '场景索引已保存。直接核对分类样本并分析，无需重新识别全文。', '继续专项分析', 'studio-scene-preview');
  const indexJob = jobs.find(j => j.type === 'scene-index' && !j.collected && j.status !== 'cancelled');
  if (indexJob) return output(2, indexJob.status === 'ready' ? '场景识别已完成，保存索引后选择分析样本。' : '场景识别进行中或尚未完成，已完成批次会保留。', '查看场景识别任务', 'studio-job', indexJob.id);
  return output(1, '快速试用可先做位置抽样；深度准备先建立场景索引，再分析专项。', '建立场景索引', 'studio-scene-index');
}
