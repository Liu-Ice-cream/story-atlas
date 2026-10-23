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

export async function requestChat(messages, config, signal, options = {}) {
  if (JSON.stringify(messages).length > 180000) throw new Error('本次材料过长，请缩短片段或减少参考资料');
  let upstream;
  try { upstream = await fetch(config.endpoint + '/chat/completions', {
    method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify({ model: config.model, messages, ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}) }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000)
  }); } catch (error) {
    const code = error.cause?.code;
    const reason = { EACCES: '本机运行环境拒绝联网，请在允许联网的终端启动拾章', ENOTFOUND: '无法解析接口域名，请检查地址和网络', ECONNREFUSED: '接口拒绝连接，请检查本地模型服务是否已启动', CERT_HAS_EXPIRED: '接口证书已过期', UNABLE_TO_VERIFY_LEAF_SIGNATURE: '接口证书校验失败，请检查系统证书配置', UND_ERR_CONNECT_TIMEOUT: '连接接口超时，请检查网络或代理设置' }[code];
    if (reason) throw new Error(reason + (code ? `（${code}）` : ''));
    throw error;
  }
  if (!upstream.ok) { await upstream.body?.cancel(); throw new Error(`AI 接口返回 HTTP ${upstream.status}，请检查接口、模型、密钥或额度后手动重试。`); }
  const result = await upstream.json();
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('接口未返回文本，请使用兼容 Chat Completions 的文本模型');
  return { content, usage: result.usage ? { promptTokens: Number(result.usage.prompt_tokens) || 0, completionTokens: Number(result.usage.completion_tokens) || 0 } : null };
}

export async function testAIConnection(config) {
  const start = Date.now();
  const result = await requestChat([{ role: 'system', content: '这是接口连通性与 JSON 格式测试。只返回 JSON 对象，不要解释。' }, { role: 'user', content: '请返回 {"ok":true}' }], config, undefined, { maxTokens: 128 });
  let jsonCompatible = false;
  try { jsonCompatible = JSON.parse(result.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')).ok === true; } catch {}
  return { ok: true, jsonCompatible, model: config.model, endpoint: config.endpoint, latencyMs: Date.now() - start, usage: result.usage, message: jsonCompatible ? '接口可用，已收到符合约定的 JSON。' : '接口能够返回文本，但本次未遵守 JSON 格式；资料分析可能需要手动重试或调整模型。' };
}
