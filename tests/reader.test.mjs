import test from 'node:test';
import assert from 'node:assert/strict';
import { readerBlocks, normalizeReadingRecord, normalizeReaderPrefs, chapterSignature, readerVolumeTitle } from '../public/reader-domain.js';

test('阅读排版去除重复章名、识别 MD 场景分隔，保留正文且不改原稿', () => {
  const chapter = { id: 'c1', title: '第一章 · 归来', filename: '01.md', body: '\uFEFF# 第一章 · 归来\r\n\r\n　　他回来了。\r\n\r\n她说：“别走。”\r\n\r\n***\r\n\r\n## 第二天\r\n> 信上的字\r\n**门**开了。' };
  const before = structuredClone(chapter);
  assert.deepEqual(readerBlocks(chapter), [
    { type: 'paragraph', text: '他回来了。' }, { type: 'paragraph', text: '她说：“别走。”' },
    { type: 'break', text: '＊ ＊ ＊' }, { type: 'heading', text: '第二天' },
    { type: 'quote', text: '信上的字' }, { type: 'paragraph', text: '门开了。' }
  ]);
  assert.deepEqual(chapter, before);
  const volumeChapter = { ...chapter, volume: '第一卷', body: '# 第一卷·归来\n\n## 第一章·归来\n\n真正的正文。' };
  assert.equal(readerVolumeTitle(volumeChapter), '第一卷·归来');
  assert.deepEqual(readerBlocks(volumeChapter), [{ type: 'paragraph', text: '真正的正文。' }]);
});

test('TXT 保留字面标记，HTML 和脚本作为普通文本交给转义显示', () => {
  const result = readerBlocks({ title: '章节', filename: '01.txt', body: '章节\n\n# 井号是正文\n**这不是 MD**\n<script>alert(1)</script>' });
  assert.deepEqual(result.map(x => x.text), ['# 井号是正文', '**这不是 MD**', '<script>alert(1)</script>']);
  assert.ok(result.every(x => x.type === 'paragraph'));
  const code = readerBlocks({ title: '代码', filename: '02.md', body: '# 代码\n```txt\n  保留缩进\n\n下一行\n```\n结尾。' });
  assert.deepEqual(code[0], { type: 'pre', text: '  保留缩进\n\n下一行' });
  assert.equal(code[1].text, '结尾。');
});

test('继续阅读按章节顺序回退，删除章节不留下不可跳转的进度或书签', () => {
  const chapters = [{ id: 'c2', title: '第二章', order: 2 }, { id: 'c1', title: '第一章', order: 1 }];
  const restored = normalizeReadingRecord({ chapterId: 'deleted', positions: { deleted: { block: 9 }, c2: { block: 3, offset: .4, ratio: .5, signature: 'old' } }, bookmarks: [{ id: 'b1', chapterId: 'deleted' }, { id: 'b2', chapterId: 'c2', block: 3, preview: '一段话' }] }, chapters);
  assert.equal(restored.chapterId, 'c1');
  assert.deepEqual(Object.keys(restored.positions), ['c2']);
  assert.equal(restored.positions.c2.offset, .4);
  assert.equal(restored.bookmarks.length, 1);
  assert.equal(restored.bookmarks[0].chapterId, 'c2');
  assert.equal(normalizeReadingRecord(null, []).chapterId, '');
});

test('异常本地版式或进度数据退回可读范围，正文中段变化可被检测', () => {
  assert.deepEqual(normalizeReaderPrefs(null), { fontSize: 21, lineHeight: 2.1, width: 820, font: 'serif', paper: 'warm' });
  assert.deepEqual(normalizeReaderPrefs({ fontSize: 5000, lineHeight: .1, width: -1, paper: 'invalid', font: 'remote-font' }), { fontSize: 30, lineHeight: 1.6, width: 820, font: 'serif', paper: 'warm' });
  const record = normalizeReadingRecord({ positions: { c1: { block: -2, offset: 100, ratio: -1 } } }, [{ id: 'c1', order: 1, title: '章' }]);
  assert.deepEqual(record.positions.c1, { block: 0, offset: 1, ratio: 0, signature: '' });
  const a = { body: '头' + '甲'.repeat(1000) + '尾' }, b = { body: '头' + '甲'.repeat(500) + '乙' + '甲'.repeat(499) + '尾' };
  assert.notEqual(chapterSignature(a), chapterSignature(b));
  assert.equal(chapterSignature(a), chapterSignature({ ...a }));
});
