import http from 'node:http';
import { readFile, writeFile, mkdir, rename, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyProject, validateProject } from './public/domain.js';
import { normalizeAIConfig, requestExtraction } from './ai-provider.mjs';
import { AIQueue } from './ai-queue.mjs';
import { Snapshots } from './snapshots.mjs';
import { SourceDirectory } from './source-directory.mjs';
import { invalidateChapterReferences, acknowledgeReview, reviewItems } from './public/maintenance.js';
import { uid } from './public/domain.js';
import { StudioQueue } from './studio-queue.mjs';
import { AGENTS, PROMPT_VERSION, resolvedPrompts } from './public/studio-domain.js';
import { digest, profileStale } from './studio-engine.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const MAX_BYTES = 80 * 1024 * 1024;
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

export async function createApp({ dataDir = path.join(root, 'data'), port = 4317 } = {}) {
  await mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, 'project.json');
  let project, needsIdentitySave = false;
  try { const saved = JSON.parse(await readFile(file, 'utf8')); needsIdentitySave = !saved.projectId; project = validateProject(saved); }
  catch (error) {
    if (error.code === 'ENOENT') { project = emptyProject(); needsIdentitySave = true; }
    else throw new Error(`项目文件无法读取，原文件已保留。请检查 ${file}，或使用 project.previous.json 恢复。原因：${error.message}`);
  }
  // Persist the stable identity even before the first edit so that snapshots and
  // directory bindings remain attached to legacy and empty projects after restart.
  if (needsIdentitySave) {
    try { await copyFile(file, path.join(dataDir, 'project.previous.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const migration = path.join(dataDir, 'project.identity.pending.json');
    await writeFile(migration, JSON.stringify(project, null, 2), 'utf8'); await rename(migration, file);
  }
  let saveQueue = Promise.resolve();
  const ai = new AIQueue(dataDir, () => project);
  await ai.load();
  const studio = new StudioQueue(dataDir, () => project, () => ai.session);
  await studio.load();
  const snapshots = new Snapshots(dataDir), source = new SourceDirectory(dataDir);
  await source.load();
  await snapshots.create(project, '每日自动保护', true);
  const persistProject = async next => {
    await snapshots.create(project, '每日自动保护', true);
    const temp = path.join(dataDir, 'project.pending.json');
    await writeFile(temp, JSON.stringify(next, null, 2), 'utf8');
    try { await copyFile(file, path.join(dataDir, 'project.previous.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(temp, file); project = next; return next;
  };
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
  const body = async req => {
    if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('请求需要使用 JSON'), { status: 415 });
    let bytes = 0;
    const chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) throw Object.assign(new Error('请求超过 80 MB，请分批导入章节'), { status: 413 });
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw Object.assign(new Error('请求 JSON 格式错误'), { status: 400 }); }
  };
  const server = http.createServer(async (req, res) => {
    const allowedHost = `127.0.0.1:${server.address()?.port || port}`;
    const allowedHosts = [allowedHost, allowedHost.replace('127.0.0.1', 'localhost')];
    if (!allowedHosts.includes(req.headers.host)) return json(res, 403, { error: '仅接受本机地址访问' });
    if (req.headers.origin && !allowedHosts.some(host => req.headers.origin === `http://${host}`)) return json(res, 403, { error: '拒绝跨站请求' });
    try {
      const url = new URL(req.url, `http://${allowedHost}`);
      if (url.pathname === '/api/project' && req.method === 'GET') return json(res, 200, project);
      if (url.pathname === '/api/studio' && req.method === 'GET') return json(res, 200, { ...studio.list(), agents: AGENTS, promptVersion: PROMPT_VERSION, promptRevision: project.studio.promptRevision, prompts: resolvedPrompts(project), profiles: project.studio.profiles.map(p => ({ id: p.id, outdated: profileStale(p, project) })) });
      if (url.pathname === '/api/studio/chapter' && req.method === 'GET') {
        const chapter = project.chapters.find(c => c.id === url.searchParams.get('id'));
        if (!chapter) throw new Error('章节不存在');
        return json(res, 200, { id: chapter.id, body: chapter.body, bodyHash: digest(chapter.body) });
      }
      if (url.pathname === '/api/studio/jobs' && req.method === 'POST') return json(res, 200, await studio.enqueue(await body(req)));
      const studioRoute = url.pathname.match(/^\/api\/studio\/jobs\/([a-f0-9-]+)(?:\/(retry|cancel|collect))?$/);
      if (studioRoute) {
        const [, id, operation] = studioRoute;
        if (req.method === 'GET' && !operation) return json(res, 200, studio.detail(id));
        if (req.method === 'POST' && operation) {
          const data = await body(req);
          if (operation === 'retry') return json(res, 200, await studio.retry(id));
          if (operation === 'cancel') return json(res, 200, await studio.cancel(id));
          const collect = async () => {
            if (data.revision !== project.revision) throw Object.assign(new Error('作品已在其他窗口更新，请刷新后保存结果'), { status: 409 });
            const next = studio.collect(id, structuredClone(project));
            next.revision++; next.updatedAt = new Date().toISOString(); validateProject(next); await persistProject(next);
            await studio.collected(id); return { project, studio: studio.list() };
          };
          const result = saveQueue.then(collect); saveQueue = result.catch(() => {}); return json(res, 200, await result);
        }
      }
      if (url.pathname === '/api/snapshots' && req.method === 'GET') return json(res, 200, await snapshots.list(project.projectId));
      if (url.pathname === '/api/snapshots' && req.method === 'POST') {
        await body(req);
        const operation = () => snapshots.create(project, '手动快照');
        const result = saveQueue.then(operation); saveQueue = result.catch(() => {});
        return json(res, 200, await result);
      }
      if (url.pathname === '/api/snapshots/restore' && req.method === 'POST') {
        const data = await body(req);
        const operation = async () => {
          if (data.revision !== project.revision) throw Object.assign(new Error('作品已更新，请刷新后恢复'), { status: 409 });
          const restored = await snapshots.read(data.id, project.projectId);
          await snapshots.create(project, '恢复快照前保护');
          await ai.setPaused(true); await ai.clearSession();
          restored.revision = project.revision + 1; restored.updatedAt = new Date().toISOString();
          await persistProject(restored);
          return { project, queue: ai.list() };
        };
        const result = saveQueue.then(operation); saveQueue = result.catch(() => {});
        return json(res, 200, await result);
      }
      if (url.pathname === '/api/source' && req.method === 'GET') return json(res, 200, { config: source.config(project.projectId) });
      if (url.pathname === '/api/source' && req.method === 'POST') {
        const data = await body(req);
        if (data.projectId !== project.projectId) throw new Error('作品已切换，请重新选择目录');
        return json(res, 200, { config: await source.configure(project.projectId, data.directory, data.recursive) });
      }
      if (url.pathname === '/api/source/check' && req.method === 'GET') return json(res, 200, await source.scan(project));
      if (url.pathname === '/api/source/import' && req.method === 'POST') {
        const data = await body(req);
        const operation = async () => {
          if (data.revision !== project.revision) throw Object.assign(new Error('作品已更新，请重新检查目录'), { status: 409 });
          const files = await source.selected(project, data.scanId, data.tokens);
          await snapshots.create(project, '目录导入前保护');
          const next = structuredClone(project);
          let order = Math.max(0, ...next.chapters.map(c => c.order));
          for (const f of files) {
            let chapter = next.chapters.find(c => c.id === f.chapterId);
            if (!chapter) {
              const volume = typeof data.volume === 'string' ? data.volume.trim().slice(0, 500) : '';
              chapter = { id: uid(), filename: f.filename, title: f.title, body: f.body, volume, order: ++order, summary: '', status: 'unprocessed' };
              next.chapters.push(chapter);
              if (volume && !next.volumes.some(v => v.title === volume)) next.volumes.push({ id: uid(), title: volume, summary: '', outline: '' });
            }
            chapter.body = f.body; chapter.sourceFile = f.relative; chapter.sourceDirectory = f.directory; chapter.updatedAt = new Date().toISOString();
          }
          invalidateChapterReferences(project, next); validateProject(next);
          next.revision++; next.updatedAt = new Date().toISOString();
          const before = project; await persistProject(next);
          try { await ai.enqueueChanged(before, next); } catch { ai.lastError = '章节已保存，自动整理排队失败，请手动加入任务'; }
          return { project, count: files.length };
        };
        const result = saveQueue.then(operation); saveQueue = result.catch(() => {});
        return json(res, 200, await result);
      }
      if (url.pathname === '/api/maintenance/review' && req.method === 'POST') {
        const data = await body(req);
        const operation = async () => {
          if (data.revision !== project.revision) throw Object.assign(new Error('作品已更新，请刷新后复核'), { status: 409 });
          const item = reviewItems(project).find(x => x.type === data.type && x.id === data.id && x.personId === data.personId);
          if (!item) throw new Error('待复核记录已不存在');
          const next = structuredClone(project); acknowledgeReview(next, item); next.revision++;
          next.updatedAt = new Date().toISOString(); validateProject(next); await persistProject(next); return project;
        };
        const result = saveQueue.then(operation); saveQueue = result.catch(() => {});
        return json(res, 200, await result);
      }
      if (url.pathname === '/api/ai/jobs' && req.method === 'GET') return json(res, 200, ai.list());
      if (url.pathname === '/api/ai/session' && req.method === 'POST') return json(res, 200, await ai.setSession(await body(req)));
      if (url.pathname === '/api/ai/session' && req.method === 'DELETE') return json(res, 200, await ai.clearSession());
      if (url.pathname === '/api/ai/paused' && req.method === 'POST') return json(res, 200, await ai.setPaused((await body(req)).paused));
      if (url.pathname === '/api/ai/jobs' && req.method === 'POST') {
        const data = await body(req);
        if (!Array.isArray(data.chapterIds) || !data.chapterIds.length) throw new Error('请选择要整理的章节');
        await ai.setSession(data);
        return json(res, 200, await ai.enqueue(data.chapterIds));
      }
      const jobRoute = url.pathname.match(/^\/api\/ai\/jobs\/([a-zA-Z0-9-]+)\/(retry|collect)$/);
      if (jobRoute && req.method === 'POST') {
        const data = await body(req), [, id, operation] = jobRoute;
        if (operation === 'retry') return json(res, 200, await ai.retry(id));
        const collect = async () => {
          const job = ai.result(id);
          if (!project.aiCollectedJobIds?.includes(id)) {
            if (data.revision !== project.revision) throw Object.assign(new Error('作品在其他窗口更新，请刷新后再领取结果'), { status: 409 });
            const next = structuredClone(project);
            next.review = [...(next.review || []), ...job.result.map(s => ({ ...s, sourceJobId: id }))];
            next.aiCollectedJobIds = [...(next.aiCollectedJobIds || []), id];
            next.chapters.find(c => c.id === job.chapterId).status = 'pending';
            next.chapters.find(c => c.id === job.chapterId).aiExtractedAt = new Date().toISOString();
            next.revision++; next.updatedAt = new Date().toISOString(); validateProject(next);
            await persistProject(next);
          }
          await ai.collected(id);
          return { project, queue: ai.list() };
        };
        const result = saveQueue.then(collect); saveQueue = result.catch(() => {});
        return json(res, 200, await result);
      }
      if (url.pathname === '/api/shutdown' && req.method === 'POST') {
        const request = await body(req);
        if (request.confirm !== true) throw new Error('停止服务需要明确确认');
        await saveQueue;
        await studio.close();
        await ai.close();
        json(res, 200, { stopped: true });
        setTimeout(() => { server.close(); server.closeIdleConnections(); }, 100);
        return;
      }
      if (url.pathname === '/api/project' && req.method === 'PUT') {
        const incoming = validateProject(await body(req));
        // Never persist provider credentials from an imported backup or a modified client.
        incoming.settings = { endpoint: String(incoming.settings.endpoint || ''), model: String(incoming.settings.model || ''), autoOrganize: Boolean(incoming.settings.autoOrganize) };
        const operation = async () => {
          if (incoming.revision !== project.revision) throw Object.assign(new Error('资料已在其他窗口更新。请刷新页面后重试；本次更改未覆盖已有资料。'), { status: 409 });
          const next = { ...incoming, revision: project.revision + 1, updatedAt: new Date().toISOString() };
          const before = project;
          invalidateChapterReferences(before, next);
          if (before.projectId !== next.projectId || before.chapters.some(c => !next.chapters.some(n => n.id === c.id && n.body === c.body))) await snapshots.create(before, before.projectId !== next.projectId ? '切换作品前保护' : '章节变更前保护');
          await persistProject(next);
          try { await ai.enqueueChanged(before, next); } catch { ai.lastError = '正文已保存，但自动整理任务未能建立，请手动加入任务。'; }
          return next;
        };
        const result = saveQueue.then(operation);
        saveQueue = result.catch(() => {});
        return json(res, 200, await result);
      }
      if (url.pathname === '/api/ai' && req.method === 'POST') {
        const data = await body(req);
        const config = normalizeAIConfig(data, project.settings);
        return json(res, 200, { content: await requestExtraction(project, data.chapterIds, config) });
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: '接口不存在' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: '不支持的请求方法' });
      const staticName = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!['index.html', 'app.js', 'styles.css', 'domain.js', 'maintenance.js', 'features.js', 'studio-domain.js', 'studio-ui.js', 'reader-domain.js', 'reader-ui.js', 'reader.css', 'chapter-text.js'].includes(staticName)) return json(res, 404, { error: '文件不存在' });
      const contents = await readFile(path.join(root, 'public', staticName));
      res.writeHead(200, {
        'Content-Type': contentTypes[path.extname(staticName)], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer'
      });
      res.end(req.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 400, { error: error.name === 'TimeoutError' ? 'AI 请求超时，尚未修改资料，可以减少章节后重试' : error.message || '操作失败' });
    }
  });
  server.once('close', () => { void ai.close(); void studio.close(); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.STORY_ATLAS_PORT || 4317);
  const server = await createApp({ port });
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。如果拾章已经启动，请访问 http://127.0.0.1:${port} 。` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`拾章已启动：http://127.0.0.1:${port}\n资料保存位置：${path.join(root, 'data')}\n关闭此窗口或按 Ctrl+C 停止服务。`));
}
