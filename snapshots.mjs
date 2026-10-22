import { mkdir, readFile, writeFile, readdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { validateProject } from './public/domain.js';

export class Snapshots {
  constructor(dataDir) { this.dir = path.join(dataDir, 'snapshots'); }
  async create(project, reason = '手动快照', daily = false) {
    await mkdir(this.dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    if (daily && (await this.list(project.projectId)).some(s => s.daily && s.createdAt.startsWith(date))) return;
    const id = randomUUID(), createdAt = new Date().toISOString();
    const snapshot = { format: 'story-atlas-snapshot-1', id, createdAt, daily, reason, project: structuredClone(project) };
    const file = path.join(this.dir, id + '.snapshot.json');
    await writeFile(file + '.pending', JSON.stringify(snapshot), 'utf8'); await rename(file + '.pending', file);
    return { id, createdAt, daily, reason, title: project.title, chapterCount: project.chapters.length, revision: project.revision };
  }
  async list(projectId) {
    let names; try { names = await readdir(this.dir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const result = [];
    for (const name of names.filter(n => /^[a-f0-9-]{36}\.snapshot\.json$/.test(n))) {
      try {
        const s = JSON.parse(await readFile(path.join(this.dir, name), 'utf8'));
        if (s.format === 'story-atlas-snapshot-1' && s.project.projectId === projectId) result.push({ id: s.id, createdAt: s.createdAt, daily: s.daily, reason: s.reason, title: s.project.title, chapterCount: s.project.chapters.length, revision: s.project.revision });
      } catch { /* A damaged historical snapshot must not prevent use of the current project. */ }
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async read(id, projectId) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('快照编号无效');
    const s = JSON.parse(await readFile(path.join(this.dir, id + '.snapshot.json'), 'utf8'));
    if (s.format !== 'story-atlas-snapshot-1' || s.project.projectId !== projectId) throw new Error('此快照不属于当前作品');
    return validateProject(s.project);
  }
}
