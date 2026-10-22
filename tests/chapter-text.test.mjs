import test from 'node:test';
import assert from 'node:assert/strict';
import { readerBlocks } from '../public/reader-domain.js';
import { resolveReadingSelection, writingSelection } from '../public/chapter-text.js';

test('选中重复句的第二次出现时，映射到原稿的第二处位置', () => {
  const chapter = { title: '第一章', filename: '01.md', body: '# 第一章\r\n\r\n同一句。\r\n\r\n同一句。\r\n\r\n尾声。' };
  const blocks = readerBlocks(chapter, { withOffsets: true });
  const firstLength = blocks[0].text.length;
  const selected = resolveReadingSelection(blocks, firstLength, firstLength + blocks[1].text.length);
  assert.equal(selected.start, chapter.body.lastIndexOf('同一句。'));
  assert.equal(chapter.body.slice(selected.start, selected.end), '同一句。');
});

test('纸页去掉 MD 标记和缩进后，跨段选区仍保留准确原始字符范围', () => {
  const chapter = { title: '章名', filename: '02.md', body: '\uFEFF# 章名\r\n\r\n　　甲说：**他回来了**。\r\n\r\n> [乙](https://example.test)回答：`知道了`。' };
  const blocks = readerBlocks(chapter, { withOffsets: true });
  const all = blocks.map(b => b.text).join(''), start = all.indexOf('回来了'), end = all.indexOf('知道了') + 3;
  const selected = resolveReadingSelection(blocks, start, end);
  assert.equal(chapter.body.slice(selected.start, selected.end), '回来了**。\r\n\r\n> [乙](https://example.test)回答：`知道了');
  const quoteOnly = resolveReadingSelection(blocks, blocks[0].text.length, blocks[0].text.length + 1);
  assert.equal(chapter.body.slice(quoteOnly.start, quoteOnly.end), '乙');
});

test('中文、Emoji 和含空行的代码片段保留 UTF-16 与 CRLF 位置', () => {
  const chapter = { title: '章名', filename: '03.md', body: '# 章名\r\n```txt\r\n  甲😀乙\r\n\r\n尾行\r\n```' };
  const blocks = readerBlocks(chapter, { withOffsets: true });
  assert.equal(blocks[0].text, '  甲😀乙\n\n尾行');
  const whole = resolveReadingSelection(blocks, 0, blocks[0].text.length);
  assert.equal(chapter.body.slice(whole.start, whole.end), '  甲😀乙\r\n\r\n尾行');
  const emojiStart = blocks[0].text.indexOf('😀'), emoji = resolveReadingSelection(blocks, emojiStart, emojiStart + 2);
  assert.equal(chapter.body.slice(emoji.start, emoji.end), '😀');
  assert.equal(resolveReadingSelection(blocks, 0, 999), null);
});

test('改写限定选区，续写定位到选区末尾，长选区也可作为续写位置', () => {
  const chapter = { body: '前文。'.repeat(6000) };
  assert.deepEqual(writingSelection(chapter, 'rewrite', 3, 12), { mode: 'rewrite', start: 3, end: 12 });
  assert.deepEqual(writingSelection(chapter, 'continue', 3, 12), { mode: 'continue', start: 12, end: 12 });
  assert.throws(() => writingSelection(chapter, 'rewrite', 3, 3), /请选择/);
  assert.throws(() => writingSelection(chapter, 'rewrite', 0, 12001), /12000/);
  assert.deepEqual(writingSelection(chapter, 'continue', 0, chapter.body.length), { mode: 'continue', start: chapter.body.length, end: chapter.body.length });
  assert.throws(() => writingSelection(chapter, 'continue', 0, 3), /至少/);
});
