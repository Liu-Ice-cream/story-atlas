import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseSuggestions } from './public/domain.js';
import { normalizeAIConfig, requestExtraction } from './ai-provider.mjs';

const digest = body => createHash('sha256').update(body).digest('hex');
const stamp = () => new Date().toISOString();

export class AIQueue {
  constructor(dataDir, getProject) {
    this.file = path.join(dataDir, 'ai-jobs.json'); this.getProject = getProject;
    this.jobs = []; this.session = null; this.paused = false; this.closing = false;
    this.active = null; this.abort = null; this.writes = Promise.resolve(); this.lastError = '';
  }
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.jobs)) throw new Error('任务文件格式无效');
      this.jobs = saved.jobs; this.paused = Boolean(saved.paused);
      for (const job of this.jobs) {
        if (job.status === 'running') { job.status = 'failed'; job.error = '服务重启中断了整理，未自动重复调用。请核对后手动重试。'; }
        else if (job.status === 'queued') job.status = 'waiting_config';
      }
    } catch (error) { if (error.code !== 'ENOENT') throw new Error(`AI 任务记录无法读取，文件已保留：${error.message}`); }
  }
  async persist() {
    const text = JSON.stringify({ version: 1, paused: this.paused, jobs: this.jobs }, null, 2);
    const task = this.writes.then(async () => { await writeFile(this.file + '.pending', text, 'utf8'); await rename(this.file + '.pending', this.file); });
    this.writes = task.catch(() => { this.lastError = 'AI 任务记录保存失败，请检查本机磁盘后重试。'; });
    return task;
  }
  current(job) {
    const p = this.getProject();
    const chapter = p.projectId === job.projectId && p.chapters.find(c => c.id === job.chapterId);
    return Boolean(chapter && digest(chapter.body) === job.sourceHash);
  }
  list() {
    const project = this.getProject();
    return {
      configured: Boolean(this.session), paused: this.paused, error: this.lastError,
      endpoint: this.session?.endpoint || '', model: this.session?.model || '',
      jobs: this.jobs.filter(j => j.projectId === project.projectId).map(({ result, ...job }) => ({ ...job, suggestionCount: result?.length || 0, outdated: !this.current(job) })).reverse()
    };
  }
  async setSession(data) {
    const fallback = this.getProject().settings;
    const key = data.useExistingKey && this.session && data.endpoint === this.session.endpoint && data.model === this.session.model ? this.session.apiKey : data.apiKey;
    if (data.useExistingKey && key == null) throw new Error('会话密钥已清除，请重新填写');
    this.session = normalizeAIConfig({ ...data, apiKey: key }, fallback);
    for (const job of this.jobs) if (job.status === 'waiting_config' && this.current(job)) job.status = 'queued';
    await this.persist(); this.kick(); return this.list();
  }
  async clearSession() {
    this.session = null;
    for (const job of this.jobs) if (job.status === 'queued') job.status = 'waiting_config';
    await this.persist(); return this.list();
  }
  async enqueue(chapterIds, automatic = false) {
    const p = this.getProject();
    if (!Array.isArray(chapterIds) || chapterIds.length > 1000) throw new Error('章节选择无效或数量过多');
    const result = [];
    for (const chapterId of new Set(chapterIds)) {
      const chapter = p.chapters.find(c => c.id === chapterId);
      if (!chapter) throw new Error('待整理章节不存在');
      const hash = digest(chapter.body);
      let job = this.jobs.find(j => j.projectId === p.projectId && j.chapterId === chapterId && j.sourceHash === hash && j.status !== 'cancelled');
      if (!job) {
        job = { id: randomUUID(), projectId: p.projectId, chapterId, chapterTitle: chapter.title, sourceHash: hash, automatic, status: this.session ? 'queued' : 'waiting_config', attempts: 0, createdAt: stamp(), updatedAt: stamp(), error: '' };
        this.jobs.push(job);
      }
      result.push(job.id);
    }
    if (result.length) await this.persist();
    this.kick(); return { ...this.list(), enqueuedIds: result };
  }
  async enqueueChanged(before, after) {
    if (!after.settings.autoOrganize || before.projectId !== after.projectId) return;
    const changed = after.chapters.filter(c => !before.chapters.some(old => old.id === c.id && old.body === c.body)).map(c => c.id);
    if (changed.length) await this.enqueue(changed, true);
  }
  async retry(id) {
    const job = this.jobs.find(j => j.id === id);
    if (!job || !this.current(job)) throw new Error('原文或作品已变更，请对当前章节重新建立任务');
    if (!['failed', 'waiting_config'].includes(job.status)) throw new Error('此任务不需要重试');
    job.status = this.session ? 'queued' : 'waiting_config'; job.error = ''; job.updatedAt = stamp();
    await this.persist(); this.kick(); return this.list();
  }
  async setPaused(value) { this.paused = Boolean(value); await this.persist(); if (!this.paused) this.kick(); return this.list(); }
  result(id) {
    const job = this.jobs.find(j => j.id === id);
    if (!job || !this.current(job)) throw new Error('原文或作品已变更，此结果不能确认入库，请重新整理');
    if (!['ready', 'collected'].includes(job.status)) throw new Error('此任务尚未产生可确认结果');
    return job;
  }
  async collected(id) {
    const job = this.jobs.find(j => j.id === id); if (!job) return;
    job.status = 'collected'; job.updatedAt = stamp(); await this.persist();
  }
  kick() {
    if (this.active || this.closing || this.paused || !this.session) return;
    this.active = this.drain().catch(() => { this.lastError = 'AI 任务处理失败，已有结果保留，请检查任务状态。'; }).finally(() => { this.active = null; });
  }
  async drain() {
    while (!this.closing && !this.paused && this.session) {
      const job = this.jobs.find(j => j.status === 'queued' && j.projectId === this.getProject().projectId);
      if (!job) break;
      if (!this.current(job)) { job.status = 'outdated'; await this.persist(); continue; }
      const snapshot = structuredClone(this.getProject());
      const config = { ...this.session };
      job.status = 'running'; job.attempts++; job.updatedAt = stamp(); job.error = '';
      await this.persist(); this.abort = new AbortController();
      try {
        const content = await requestExtraction(snapshot, [job.chapterId], config, this.abort.signal);
        if (!this.current(job)) { job.status = 'outdated'; job.error = '整理期间原文已改变，本结果未入库。'; }
        else {
          const suggestions = parseSuggestions(content, snapshot);
          if (suggestions.some(s => s.chapterId !== job.chapterId)) throw new Error('AI 返回了本次未选择章节的记录，请修正后重试');
          job.result = suggestions; job.status = suggestions.length ? 'ready' : 'empty';
        }
      } catch (error) {
        job.status = this.current(job) ? 'failed' : 'outdated';
        job.error = this.closing ? '服务停止，本次请求未确认完成。不会自动重发，请手动重试。' : error.name === 'TimeoutError' ? '请求超时，不会自动重试，请检查后手动重试。' : error.message;
        if (config.apiKey) job.error = job.error.replaceAll(config.apiKey, '[密钥已隐藏]');
      } finally { this.abort = null; job.updatedAt = stamp(); await this.persist(); }
    }
  }
  async close() {
    this.closing = true; this.session = null; this.abort?.abort();
    if (this.active) await this.active;
    await this.writes;
  }
}
