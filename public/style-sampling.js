// Shared by the preview and server so the confirmed ranges are the ranges sent.
export const SOURCE_MAX_CHARS = 2000000;
export const SOURCE_TOTAL_CHARS = 12000000;
export const ANALYSIS_MAX_CHARS = 65000;
export const DEFAULT_SAMPLE_CHARS = 40000;
export const SAMPLING_VERSION = 1;

function rangesFor(body, budget) {
  if (body.length <= budget) return [{ start: 0, end: body.length }];
  const count = Math.min(5, Math.max(3, Math.floor(budget / 3000)));
  const width = Math.floor(budget / count), ranges = [];
  for (let i = 0; i < count; i++) {
    let start = Math.floor((body.length - width) * i / (count - 1));
    if (i && start < body.length - width) {
      const next = body.indexOf('\n', start);
      if (next >= start && next - start < Math.min(200, width / 4)) start = next + 1;
    }
    start = Math.max(start, ranges.at(-1)?.end || 0);
    if (start > 0 && /[\uDC00-\uDFFF]/.test(body[start])) start++;
    let end = Math.min(body.length, start + width);
    if (end < body.length) {
      const previous = body.lastIndexOf('\n', end);
      if (previous > start + width - Math.min(200, width / 4)) end = previous;
      if (/[\uD800-\uDBFF]/.test(body[end - 1])) end--;
    }
    while (start < end && /\s/.test(body[start])) start++;
    while (end > start && /\s/.test(body[end - 1])) end--;
    if (end > start) ranges.push({ start, end });
  }
  return ranges;
}

export function analysisSamples(sources, { budget = DEFAULT_SAMPLE_CHARS } = {}) {
  if (!Array.isArray(sources) || !sources.length || sources.length > 12) throw new Error('请选择 1—12 份参考材料');
  if (!Number.isInteger(budget) || budget < 3000 || budget > ANALYSIS_MAX_CHARS) throw new Error('分析样本总量须为 3000—65000 字符');
  if (new Set(sources.map(s => s.id)).size !== sources.length) throw new Error('参考材料编号重复');
  for (const s of sources) if (typeof s.body !== 'string' || s.body.trim().length < 30 || s.body.length > SOURCE_MAX_CHARS) throw new Error('每份参考材料须为 30—200 万字符');
  // Give small documents their full length; distribute remaining budget equally.
  const allocations = new Map(); let remaining = budget, pending = [...sources];
  while (pending.length) {
    const share = Math.floor(remaining / pending.length);
    const small = pending.filter(s => s.body.length <= share);
    if (!small.length) { for (const s of pending) allocations.set(s.id, share); break; }
    for (const s of small) { allocations.set(s.id, s.body.length); remaining -= s.body.length; }
    pending = pending.filter(s => !allocations.has(s.id));
  }
  const samples = sources.map(source => {
    const ranges = rangesFor(source.body, allocations.get(source.id));
    return { sourceId: source.id, name: source.name, fullLength: source.body.length, sampled: ranges.some(r => r.start !== 0 || r.end !== source.body.length), ranges,
      parts: ranges.map((range, i) => ({ id: source.id + ':sample:' + (i + 1), name: source.name + (ranges.length > 1 ? ' · 样本 ' + (i + 1) : ''), scene: source.scene || '', body: source.body.slice(range.start, range.end), originalSourceId: source.id, start: range.start, end: range.end })) };
  });
  return { version: SAMPLING_VERSION, budget, fullLength: sources.reduce((n, s) => n + s.body.length, 0), sampleLength: samples.reduce((n, s) => n + s.parts.reduce((m, part) => m + part.body.length, 0), 0), samples };
}
