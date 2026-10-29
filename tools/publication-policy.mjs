import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 32 * 1024 * 1024 });
export const gitText = (root, ...args) => git(root, ...args).toString('utf8').trim();
const artwork = {
  'public/assets/themes/maple.webp': 'f82a4914e68704d24793af29546cd001bc520211611181e136ca2acf4d2c4df3',
  'public/assets/themes/snow.webp': '70fba0c6bea74a7e2b1096e1e65b009ad3fd1b3f854e9145759f56739e865cf9',
  'public/assets/themes/sword.webp': '76d4870d27dc20a4296733d3dacf4a7cd4395a4efd3a8b52d89bbb7c40bbec02'
};
export function validateManifest(files) {
  if (!Array.isArray(files) || !files.length || new Set(files).size !== files.length) throw new Error('Invalid publication whitelist');
  for (const name of files) {
    if (typeof name !== 'string' || !name || name.includes('\\') || name.startsWith('/')
      || name.split('/').some(part => !part || part === '.' || part === '..')
      || /[:\x00-\x1f]/.test(name)
      || /^(data|library|scripts|node_modules|\.git)(\/|$)/i.test(name)
      || /(^|\/)\.env(?:\.|$)|\.(pem|key|zip|log|sqlite|db|pdf|docx)$/i.test(name)
      || /^preview/i.test(name)) throw new Error('Unsafe entry in publication whitelist');
  }
  if (!files.includes('publication-files.json')) throw new Error('Whitelist must include itself');
  return files;
}
export function checkBuffer(name, buffer, terms = []) {
  if (artwork[name]) {
    if (createHash('sha256').update(buffer).digest('hex') !== artwork[name]) throw new Error(`Artwork needs explicit review: ${name}`);
    return;
  }
  if (buffer.includes(0)) throw new Error(`Unreviewed binary: ${name}`);
  const text = buffer.toString('utf8');
  if (terms.some(term => text.includes(term))) throw new Error(`Private identifier found: ${name}`);
  if (/[A-Z]:[\\/]Users[\\/][^\s'"`<>]+/i.test(text) || /\/(?:Users|home)\/[a-z][^/\s]+\//i.test(text)) throw new Error(`Personal path found: ${name}`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) throw new Error(`Private key found: ${name}`);
}
export function localConfig(root, role) {
  const dir = gitText(root, 'rev-parse', '--absolute-git-dir');
  const config = JSON.parse(readFileSync(path.join(dir, 'story-atlas-publication.json'), 'utf8'));
  if (config.role !== role || !Array.isArray(config.privateTerms) || config.privateTerms.some(t => typeof t !== 'string' || !t)
    || typeof config.gitleaks !== 'string' || !config.gitleaks || config.remote !== 'https://github.com/Liu-Ice-cream/story-atlas.git') throw new Error('Publication role/configuration mismatch');
  return config;
}
export function assertSeparate(source, target) {
  const a = realpathSync(source), b = realpathSync(target);
  const contains = (parent, child) => { const rel = path.relative(parent, child); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
  if (contains(a, b) || contains(b, a)) throw new Error('Public checkout must be separate from the development checkout');
}
export function plainFiles(root, relative = '') {
  const names = [];
  for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (!relative && entry.name === '.git') continue;
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    const stat = lstatSync(path.join(root, name));
    if (stat.isSymbolicLink()) throw new Error(`Symlink/reparse point is forbidden: ${name}`);
    if (stat.isDirectory()) {
      if (/^(data|library|scripts|node_modules)(\/|$)/i.test(name)) throw new Error('Private/runtime directory in public checkout');
      names.push(...plainFiles(root, name));
    } else if (stat.isFile()) names.push(name);
    else throw new Error(`Unsupported file: ${name}`);
  }
  return names;
}
