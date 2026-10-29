import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, gitText, localConfig, validateManifest, checkBuffer, assertSeparate, plainFiles } from './publication-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = localConfig(root, 'development');
const target = realpathSync(config.target);
assertSeparate(root, target);
const targetConfig = localConfig(target, 'public');
if (realpathSync(targetConfig.source) !== realpathSync(root) || targetConfig.remote !== config.remote) throw new Error('Public checkout is not paired with this source');
if (gitText(target, 'rev-parse', '--show-toplevel').replaceAll('\\', '/').toLowerCase() !== target.replaceAll('\\', '/').toLowerCase()) throw new Error('Target must be a repository root');
if (gitText(target, 'remote', 'get-url', 'origin') !== config.remote) throw new Error('Unexpected public remote');
if (gitText(root, 'status', '--porcelain') || gitText(target, 'status', '--porcelain')) throw new Error('Commit/review local changes in both checkouts first');
const head = gitText(root, 'rev-parse', 'HEAD');
const manifest = validateManifest(JSON.parse(git(root, 'show', `${head}:publication-files.json`)));
const tracked = git(root, 'ls-tree', '-r', '-z', head).toString('utf8').split('\0').filter(Boolean);
const entries = new Map(tracked.map(row => { const at = row.indexOf('\t'); return [row.slice(at + 1), row.slice(0, at).split(' ')]; }));
const candidates = manifest.map(name => {
  const info = entries.get(name);
  if (!info || info[1] !== 'blob' || !['100644', '100755'].includes(info[0])) throw new Error(`Missing/unsupported approved source: ${name}`);
  const buffer = git(root, 'cat-file', 'blob', info[2]);
  checkBuffer(name, buffer, config.privateTerms);
  return [name, buffer];
});
const oldFiles = git(target, 'ls-files', '-z').toString('utf8').split('\0').filter(Boolean);
for (const name of plainFiles(target)) if (!oldFiles.includes(name)) throw new Error(`Untracked or ignored file in public checkout: ${name}`);
// Preflight the exact candidate bytes before writing anything to the public checkout.
execFileSync(config.gitleaks, ['stdin', '--redact', '--no-banner', '--no-color'], {
  input: Buffer.concat(candidates.filter(([name]) => !name.endsWith('.webp')).map(([name, buffer]) => Buffer.concat([Buffer.from(`\nFILE ${name}\n`), buffer]))),
  maxBuffer: 4 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']
});
for (const name of oldFiles) if (!manifest.includes(name)) git(target, 'rm', '--', name);
for (const [name, buffer] of candidates) {
  const destination = path.join(target, name);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, buffer);
}
git(target, 'add', '--', ...manifest);
execFileSync(process.execPath, [path.join(target, 'tools/publication-gate.mjs'), '--staged'], { cwd: target, stdio: 'inherit' });
console.log(`Prepared ${manifest.length} approved files from ${head.slice(0, 8)}. Review and commit in the public checkout; no history or private directories were copied, and nothing was pushed.`);
