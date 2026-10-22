import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProject, demoProject, validateProject, validateIllustration, coverIllustration, mergeChapters, removeEntity, contextMarkdown, readingText, chapterTitle, extractionPrompt, parseSuggestions, applySuggestions } from '../public/domain.js';

test('示例项目完整且可往返序列化', () => {
  const p = demoProject();
  assert.equal(validateProject(JSON.parse(JSON.stringify(p))).characters.length, 5);
  assert.equal(validateProject(emptyProject()).chapters.length, 0);
});
test('作者资料保留独立来源，导出标明作者设定，删除文档解除引用', () => {
  const p = demoProject();
  p.documents = [{ id: 'd1', title: '幕后设定', kind: 'setting', body: '某人的身份仍为暂定。' }];
  p.characters[0].facts.push({ id: 'doc-fact', text: '幕后身份暂定', kind: 'author', chapterId: '', sourceDocumentId: 'd1', quote: '某人的身份仍为暂定。' });
  p.relationships[0].sourceDocumentId = 'd1';
  validateProject(p);
  const output = contextMarkdown(p);
  assert.ok(output.includes('[作者补充] 幕后身份暂定（幕后设定）'));
  const next = removeEntity(p, 'documents', 'd1'); validateProject(next);
  assert.equal(next.characters[0].facts.at(-1).kind, 'unverified');
  assert.equal(next.relationships[0].sourceDocumentId, '');
  p.characters[0].facts.at(-1).sourceDocumentId = 'missing';
  assert.throws(() => validateProject(p), /资料文档/);
});
const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ2kAAAAASUVORK5CYII=';
test('人物插图随完整项目备份恢复，可选择封面且不混入 AI 文本任务', () => {
  const p = demoProject(), c = p.characters[0];
  c.illustrations = [{ id: 'img1', name: '人物肖像.png', dataUrl: pngDataUrl }, { id: 'img2', name: '人物立绘.png', dataUrl: pngDataUrl }];
  c.coverImageId = 'img2';
  const restored = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(restored.characters[0].illustrations.length, 2);
  assert.equal(coverIllustration(restored.characters[0]).name, '人物立绘.png');
  assert.ok(!contextMarkdown(p).includes('data:image'));
  assert.ok(!extractionPrompt(p, ['ch1']).includes('data:image'));
  delete c.coverImageId;
  assert.equal(coverIllustration(c).id, 'img1');
  const old = demoProject(); validateProject(old);
  assert.deepEqual(old.characters[0].illustrations, []);
});
test('插图格式校验拒绝远程地址、SVG、伪造格式和不存在的封面', () => {
  for (const url of ['https://example.com/portrait.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/webp;base64,aGVsbG8=', 'data:image/png;base64,AAAA']) assert.throws(() => validateIllustration({ id: 'x', name: '图片', dataUrl: url }), /图片|插图/);
  const p = demoProject(); p.characters[0].coverImageId = 'missing';
  assert.throws(() => validateProject(p), /封面/);
});
test('识别 TXT 首行和 MD 标题，正文导出避免重复标题', () => {
  assert.equal(chapterTitle('07.txt', '第七章 · 旧信\n\n内容'), '第七章 · 旧信');
  assert.equal(chapterTitle('06.md', '# 第六章\n\n内容'), '第六章');
  assert.equal(chapterTitle('chapter.txt', '普通第一句，没有章节标题。\n正文'), 'chapter');
  const p = emptyProject(); p.chapters = [{ id: 'a', title: '第六章', body: '# 第六章\n\n正文', volume: '第一卷', order: 1 }];
  assert.equal(readingText(p).match(/第六章/g).length, 1);
});
test('重复导入更新原章节并提示关联设定复核，保留自定义标题', () => {
  const p = demoProject(), originalId = p.chapters[0].id;
  p.chapters[0].title = '作者自定标题';
  const result = mergeChapters(p, [{ filename: '01.md', title: '文件标题', body: '改过的正文', order: 100, volume: '新卷' }]);
  assert.equal(result.added, 0); assert.equal(result.updated, 1);
  assert.equal(result.project.chapters[0].id, originalId);
  assert.equal(result.project.chapters[0].title, '作者自定标题');
  assert.equal(result.project.chapters[0].status, 'changed');
  assert.equal(result.project.characters[0].facts[0].needsReview, true);
  assert.notEqual(p.chapters[0].body, '改过的正文');
});
test('删除人物清理关系与支线关联，删除章节保留设定但解除出处', () => {
  const p = removeEntity(demoProject(), 'characters', 'c1');
  validateProject(p);
  assert.equal(p.relationships.length, 0);
  assert.ok(p.threads.every(t => !t.characterIds.includes('c1')));
  const q = removeEntity(demoProject(), 'chapters', 'ch1');
  validateProject(q);
  assert.equal(q.characters[0].facts[0].kind, 'unverified');
  assert.equal(q.characters[0].facts[0].chapterId, '');
});
test('讨论导出区分计划，按人物和章节筛选，正文 TXT 去除 Markdown', () => {
  const p = demoProject();
  const normal = contextMarkdown(p, { characterId: 'c1' });
  assert.ok(!normal.includes('暂定不在第一卷'));
  assert.ok(!normal.includes('妹妹是否主动离开'));
  assert.ok(!normal.includes('卷末让寻人与账册两条线交汇'));
  const plans = contextMarkdown(p, { includePlans: true, includeIdeas: true });
  assert.ok(plans.includes('[未来计划] 暂定不在第一卷'));
  assert.ok(plans.includes('妹妹是否主动离开'));
  assert.ok(plans.includes('卷末让寻人与账册两条线交汇'));
  const cutoff = contextMarkdown(p, { cutoffId: 'ch1' });
  assert.ok(!cutoff.includes('为寻找妹妹沈月，已有三年未回山门'));
  p.chapters[0].body = '# 标题\n\n**粗体** 与 [链接](https://example.com)';
  const txt = readingText(p, ['ch1']);
  assert.ok(txt.includes('粗体 与 链接')); assert.ok(!txt.includes('**')); assert.ok(!txt.includes('夜审'));
});
test('AI 任务包含稳定章节编号；导回结果严格核对原文并阻止无证据入库', () => {
  const p = demoProject();
  assert.ok(extractionPrompt(p, ['ch1']).includes('<chapter id="ch1">'));
  const input = { schemaVersion: 1, suggestions: [{ type: 'character_fact', name: '沈舟', text: '握伞时手颤。', chapterId: 'ch1', quote: '他左手虎口有一道旧伤，握伞时微微发颤。' }, { type: 'character_fact', name: '沈舟', text: '会飞。', chapterId: 'ch1', quote: '不存在的原文' }] };
  const list = parseSuggestions(input, p);
  assert.equal(list[0].verified, true); assert.equal(list[1].verified, false);
  assert.throws(() => applySuggestions(p, list), /原文出处/);
  const next = applySuggestions(p, [list[0]]);
  assert.ok(next.characters[0].facts.some(f => f.text === '握伞时手颤。'));
  assert.equal(applySuggestions(next, [list[0]]).characters[0].facts.length, next.characters[0].facts.length);
});
test('AI 支线更新保留前文进展，人物关系和阵营保留出处', () => {
  const p = demoProject();
  const suggestions = parseSuggestions({ schemaVersion: 1, suggestions: [
    { type: 'thread', title: '寻找失踪的沈月', characters: ['沈舟'], text: '发现运货单。', chapterId: 'ch5', quote: '沈舟在灰烬里找到半张运货单' },
    { type: 'relationship', from: '沈舟', to: '陆霁', text: '重逢', chapterId: 'ch5', quote: '门口站着陆霁。' },
    { type: 'faction', name: '青岚门', character: '陆霁', text: '陆霁是青岚门的传信弟子。', chapterId: 'ch2', quote: '陆霁是青岚门最年轻的传信弟子' }
  ] }, p);
  const next = applySuggestions(p, suggestions); validateProject(next);
  assert.ok(next.threads[0].description.includes('尚未核实'));
  assert.ok(next.threads[0].description.includes('发现运货单'));
  assert.equal(next.relationships.at(-1).chapterId, 'ch5');
  assert.equal(next.characters.find(c => c.name === '陆霁').facts.at(-1).chapterId, 'ch2');
});
test('备份与 AI 输入拒绝重复编号、悬空引用和非法字段', () => {
  const p = demoProject(); p.characters[0].id = 'ch1';
  assert.throws(() => validateProject(p), /编号/);
  const q = demoProject(); q.characters[0].factionIds = ['missing'];
  assert.throws(() => validateProject(q), /阵营/);
  assert.throws(() => parseSuggestions({ schemaVersion: 1, suggestions: [{ type: 'character_fact', name: '甲', text: '乙', aliases: [123] }] }, demoProject()), /列表/);
  assert.throws(() => parseSuggestions('坏 JSON', demoProject()), /解析/);
});
