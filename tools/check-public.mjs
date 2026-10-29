// Repository publication guard. No application data is read.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const lines = text => text.trim().split('\n').filter(Boolean);
const problems = new Set();
const artwork = new Set(['maple', 'snow', 'sword'].map(name => `public/assets/themes/${name}.webp`));
const privateTerms = JSON.parse(process.env.PUBLICATION_PRIVATE_TERMS || '[]');
if (!Array.isArray(privateTerms) || privateTerms.some(term => typeof term !== 'string' || !term)) throw new Error('PUBLICATION_PRIVATE_TERMS must be an array of nonempty strings');

function checkPath(name, where) {
  if (/^(data|library|scripts|node_modules|\.git)(\/|$)/i.test(name)
    || /(^|\/)\.env(?:\.|$)/i.test(name)
    || /\.(?:pem|key|zip|log|sqlite|db|pdf|docx)$/i.test(name)
    || /^preview.*\.png$/i.test(name)) problems.add(`${where}: private or generated path ${name}`);
}
function checkContent(buffer, name, where) {
  if (artwork.has(name)) return;
  if (buffer.includes(0)) { problems.add(`${where}: unreviewed binary ${name}`); return; }
  const text = buffer.toString('utf8');
  if (/[A-Z]:[\\/]Users[\\/][^\s'"`<>]+/i.test(text)
    || /\/(?:Users|home)\/[a-z][^/\s]+\//i.test(text)) problems.add(`${where}: personal directory ${name}`);
  if (privateTerms.some(term => text.includes(term))) problems.add(`${where}: private identifier ${name}`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) problems.add(`${where}: private key ${name}`);
}

const current = git('ls-files', '-z').split('\0').filter(Boolean);
for (const name of current) {
  checkPath(name, 'working tree');
  checkContent(readFileSync(path.join(root, name)), name, 'working tree');
}
// Inspect the index separately: an unstaged edit must not conceal staged material.
const index = git('ls-files', '--stage', '-z').split('\0').filter(Boolean);
const seen = new Set();
for (const row of index) {
  const [info, name] = row.split('\t');
  const [mode, sha, stage] = info.split(' ');
  if (stage !== '0' || !['100644', '100755'].includes(mode)) problems.add(`index: unsupported entry ${name}`);
  checkPath(name, 'index');
  checkContent(execFileSync('git', ['cat-file', 'blob', sha], { cwd: root, maxBuffer: 32 * 1024 * 1024 }), name, 'index');
  seen.add(`${sha}:${name}`);
}
const commits = lines(git('rev-list', '--all'));
for (const commit of commits) {
  const where = commit.slice(0, 8);
  const metadata = git('show', '-s', '--format=%ae%n%ce%n%B', commit);
  const [author, committer] = metadata.split('\n');
  for (const email of [author, committer]) {
    if (!/^[^\s@]+@users\.noreply\.github\.com$/.test(email)) problems.add(`${where}: non-noreply commit email`);
  }
  checkContent(Buffer.from(metadata), 'commit metadata', where);
  for (const row of git('ls-tree', '-r', '-z', commit).split('\0').filter(Boolean)) {
    const tab = row.indexOf('\t');
    const [mode, type, sha] = row.slice(0, tab).split(' ');
    const name = row.slice(tab + 1);
    checkPath(name, where);
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) { problems.add(`${where}: unsupported entry ${name}`); continue; }
    const key = `${sha}:${name}`;
    if (!seen.has(key)) {
      checkContent(execFileSync('git', ['cat-file', 'blob', sha], { cwd: root, maxBuffer: 32 * 1024 * 1024 }), name, where);
      seen.add(key);
    }
  }
}
if (problems.size) {
  for (const problem of problems) console.error(problem);
  process.exitCode = 1;
} else console.log(`Publication guard passed: ${current.length} tracked files, ${commits.length} commits, ${seen.size} file versions. Run Gitleaks and review remote records separately.`);
