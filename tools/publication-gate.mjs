import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, gitText, localConfig, validateManifest, checkBuffer, assertSeparate, plainFiles } from './publication-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = localConfig(root, 'public');
assertSeparate(config.source, root);
if (gitText(root, 'remote', 'get-url', 'origin') !== config.remote) throw new Error('Unexpected public remote');
const staged = process.argv.includes('--staged');
if (!staged && gitText(root, 'status', '--porcelain')) throw new Error('Review and commit public changes before pushing');
const manifest = validateManifest(JSON.parse(git(root, 'show', ':publication-files.json')));
const tracked = git(root, 'ls-files', '-z').toString('utf8').split('\0').filter(Boolean);
if (tracked.length !== manifest.length || tracked.some(name => !manifest.includes(name))) throw new Error('Public index differs from the explicit whitelist');
for (const name of plainFiles(root)) if (!manifest.includes(name)) throw new Error(`Unexpected public file: ${name}`);
for (const name of manifest) {
  checkBuffer(name, readFileSync(path.join(root, name)), config.privateTerms);
  checkBuffer(name, git(root, 'show', `:${name}`), config.privateTerms);
}
const env = { ...process.env, PUBLICATION_PRIVATE_TERMS: JSON.stringify(config.privateTerms) };
execFileSync(process.execPath, [path.join(root, 'tools/check-public.mjs')], { cwd: root, env, stdio: 'inherit' });
execFileSync(config.gitleaks, ['git', '--pre-commit', '--staged', '--redact', '--no-banner', '--no-color', '.'], { cwd: root, stdio: 'inherit' });
execFileSync(config.gitleaks, ['git', '--redact', '--no-banner', '--no-color', '.'], { cwd: root, stdio: 'inherit' });
console.log('Public publication gate passed.');
