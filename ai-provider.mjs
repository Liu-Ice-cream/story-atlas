import { extractionPrompt } from './public/domain.js';

export function normalizeAIConfig(data, fallback = {}) {
  const endpoint = new URL(data.endpoint || fallback.endpoint);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('接口地址不能包含用户名、密码、查询参数或片段');
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) throw new Error('远程接口需要 HTTPS；本地接口可使用 HTTP');
  const model = String(data.model || fallback.model || '').trim();
  if (!model || model.length > 200) throw new Error('请填写有效的模型名称');
  const apiKey = data.apiKey || '';
  if (typeof apiKey !== 'string' || apiKey.length > 4000) throw new Error('API Key 格式不正确');
  return { endpoint: endpoint.href.replace(/\/+$/, ''), model, apiKey };
}

export async function requestExtraction(project, chapterIds, config, signal) {
  if (!Array.isArray(chapterIds) || !chapterIds.length || chapterIds.some(id => !project.chapters.some(c => c.id === id))) throw new Error('请选择有效的章节');
  const prompt = extractionPrompt(project, chapterIds);
  if (prompt.length > 180000) throw new Error('本次材料过长，请减少选择的章节');
  return (await requestChat([{ role: 'system', content: '严格依据小说原文提取资料。只输出要求的 JSON，不续写小说。' }, { role: 'user', content: prompt }], config, signal)).content;
}

export async function requestChat(messages, config, signal) {
  if (JSON.stringify(messages).length > 180000) throw new Error('本次材料过长，请缩短片段或减少参考资料');
  const upstream = await fetch(config.endpoint + '/chat/completions', {
    method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify({ model: config.model, messages }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000)
  });
  if (!upstream.ok) { await upstream.body?.cancel(); throw new Error(`AI 接口返回 HTTP ${upstream.status}，请检查接口、模型、密钥或额度后手动重试。`); }
  const result = await upstream.json();
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('接口未返回文本，请使用兼容 Chat Completions 的文本模型');
  return { content, usage: result.usage ? { promptTokens: Number(result.usage.prompt_tokens) || 0, completionTokens: Number(result.usage.completion_tokens) || 0 } : null };
}
