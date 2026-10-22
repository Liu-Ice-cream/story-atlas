import { readFile, writeFile, rename, readdir, realpath, lstat, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { chapterTitle } from './public/domain.js';

const hash = text => createHash('sha256').update(text).digest('hex');
const normalize = text => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
const inside = (root, target) => { const rel = path.relative(root, target); return rel === '' || !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); };
const decode = buffer => { try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { return new TextDecoder('gb18030', { fatal: true }).decode(buffer); } };

export class SourceDirectory {
  constructor(dataDir) { this.file = path.join(dataDir, 'chapter-source.json'); this.configs = {}; this.scans = new Map(); this.writes = Promise.resolve(); }
  persist() {
    const text = JSON.stringify(this.configs, null, 2);
    const task = this.writes.then(async () => { await writeFile(this.file + '.pending', text); await rename(this.file + '.pending', this.file); });
    this.writes = task.catch(() => {}); return task;
  }
  async load() {
    try { const data = JSON.parse(await readFile(this.file, 'utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('目录记录格式无效'); this.configs = data; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  config(projectId) { return this.configs[projectId] || null; }
  async configure(projectId, directory, recursive = false) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('请填写本机章节文件夹的完整路径');
    const resolved = await realpath(directory);
    if (!(await stat(resolved)).isDirectory()) throw new Error('所选位置不是文件夹');
    this.configs[projectId] = { directory: resolved, recursive: Boolean(recursive), bindings: {} };
    await this.persist();
    this.scans.delete(projectId);
    return this.config(projectId);
  }
  async scan(project) {
    const config = this.config(project.projectId);
    if (!config) return { configured: false, entries: [], checkedAt: new Date().toISOString() };
    if (await realpath(config.directory) !== config.directory) throw new Error('目录位置已改变，请重新选择');
    const disk = [], errors = []; let bytes = 0;
    const walk = async (dir, depth) => {
      if (depth > 8) throw new Error('目录层级超过 8 层，请选择更具体的章节目录');
      const names = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
      for (const item of names) {
        if (item.isSymbolicLink() || item.name.startsWith('.')) continue;
        const file = path.join(dir, item.name);
        if (item.isDirectory()) { if (config.recursive) await walk(file, depth + 1); continue; }
        if (!item.isFile() || !/\.(md|txt|markdown)$/i.test(item.name)) continue;
        if (disk.length >= 1000) throw new Error('目录超过 1000 个文本文件，请按卷选择文件夹');
        if (!inside(config.directory, await realpath(file))) throw new Error('文件位置超出章节目录');
        const info = await stat(file); bytes += info.size;
        if (bytes > 50 * 1024 * 1024) throw new Error('目录文本超过 50 MB，请按卷选择文件夹');
        try {
          const body = normalize(decode(await readFile(file)));
          const relative = path.relative(config.directory, file).split(path.sep).join('/');
          disk.push({ relative, name: item.name, hash: hash(body), body, title: chapterTitle(item.name, body), directory: config.directory });
        } catch (error) { errors.push({ filename: item.name, error: error.message }); }
      }
    };
    await walk(config.directory, 0);
    const entries = [], internals = new Map();
    config.bindings ||= {};
    let bindingsChanged = false;
    for (const file of disk) {
      const exact = project.chapters.find(c => c.sourceFile === file.relative && c.sourceDirectory === config.directory || config.bindings[c.id] === file.relative);
      const possible = project.chapters.filter(c => c.filename === file.relative || c.filename === file.name);
      const matches = exact ? [exact] : possible;
      const duplicateDisk = disk.filter(f => f.name === file.name).length > 1;
      const existing = matches.length === 1 && (exact || !duplicateDisk) ? matches[0] : null;
      const conflict = matches.length > 1 || !exact && duplicateDisk && possible.length > 0;
      const status = conflict ? 'conflict' : !existing ? 'new' : normalize(existing.body) === file.body ? 'unchanged' : 'changed';
      if (existing && config.bindings[existing.id] !== file.relative) { config.bindings[existing.id] = file.relative; bindingsChanged = true; }
      const token = randomUUID();
      const entry = { token, filename: file.relative, title: existing?.title || file.title, chapterId: existing?.id || '', status, hash: file.hash, chars: file.body.length };
      entries.push(entry); internals.set(token, { ...file, ...entry });
    }
    const mapped = new Set(entries.filter(e => e.chapterId).map(e => e.chapterId));
    for (const chapter of project.chapters) if ((chapter.sourceDirectory === config.directory || config.bindings[chapter.id]) && !mapped.has(chapter.id)) entries.push({ filename: chapter.sourceDirectory === config.directory ? chapter.sourceFile : config.bindings[chapter.id], title: chapter.title, chapterId: chapter.id, status: 'missing', token: '', chars: 0 });
    if (bindingsChanged) await this.persist();
    const scanId = randomUUID(), checkedAt = new Date().toISOString();
    this.scans.set(project.projectId, { scanId, revision: project.revision, entries: internals, config: { ...config } });
    return { configured: true, ...config, scanId, checkedAt, entries, errors };
  }
  async selected(project, scanId, tokens) {
    const scan = this.scans.get(project.projectId);
    if (!scan || scan.scanId !== scanId || scan.revision !== project.revision) throw new Error('作品或目录检查结果已变化，请重新检查目录');
    if (!Array.isArray(tokens) || !tokens.length || tokens.length > 1000) throw new Error('请勾选需要导入的文件');
    const files = [];
    for (const token of new Set(tokens)) {
      const entry = scan.entries.get(token);
      if (!entry || !['new', 'changed'].includes(entry.status)) throw new Error('选择包含不可导入的文件，请重新检查');
      const target = path.resolve(scan.config.directory, entry.relative);
      if (!inside(scan.config.directory, target) || !inside(scan.config.directory, await realpath(target)) || (await lstat(target)).isSymbolicLink()) throw new Error('文件位置已变化，请重新检查');
      if ((await stat(target)).size > 50 * 1024 * 1024) throw new Error('文件大小已变化，请重新检查');
      const body = normalize(decode(await readFile(target)));
      if (hash(body) !== entry.hash) throw new Error('检查之后文件又有修改，请重新检查后导入');
      files.push({ ...entry, body });
    }
    return files;
  }
}
