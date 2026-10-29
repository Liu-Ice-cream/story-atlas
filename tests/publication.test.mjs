import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateManifest, checkBuffer, assertSeparate, plainFiles } from '../tools/publication-policy.mjs';

test('发布白名单拒绝私有目录、密钥、路径穿越与重复项', () => {
  const base = ['publication-files.json'];
  assert.deepEqual(validateManifest([...base, 'public/app.js']), [...base, 'public/app.js']);
  for (const name of ['data/project.json', 'library/book.txt', 'scripts/private.mjs', '.env.local', 'secret.key', '../x', '/x', 'a/../x', 'a\\x', 'snapshot.zip', 'preview.png']) assert.throws(() => validateManifest([...base, name]));
  assert.throws(() => validateManifest([...base, ...base]));
});
test('候选文件阻止私有标识、二进制与未经复核的主题插画', () => {
  assert.doesNotThrow(() => checkBuffer('public/app.js', Buffer.from('synthetic sample'), ['private-fixture']));
  assert.throws(() => checkBuffer('README.md', Buffer.from('private-fixture'), ['private-fixture']));
  assert.throws(() => checkBuffer('x.bin', Buffer.from([0, 1])));
  assert.throws(() => checkBuffer('public/assets/themes/maple.webp', Buffer.from('changed image')));
});
test('发布目录必须独立，并拒绝运行产生的私有目录及未审核文件类型', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'story-publication-'));
  try {
    const source = path.join(root, 'source'), target = path.join(root, 'public');
    mkdirSync(source); mkdirSync(target); mkdirSync(path.join(source, 'child'));
    assert.doesNotThrow(() => assertSeparate(source, target));
    assert.throws(() => assertSeparate(source, source));
    assert.throws(() => assertSeparate(source, path.join(source, 'child')));
    writeFileSync(path.join(target, 'README.md'), 'demo');
    assert.deepEqual(plainFiles(target), ['README.md']);
    mkdirSync(path.join(target, 'data'));
    assert.throws(() => plainFiles(target));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
