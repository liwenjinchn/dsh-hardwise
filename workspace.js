/** Authenticated host catalog. Directories come from DSH session headers, never browser paths. */
import { readFile, access } from 'node:fs/promises';
import { join, basename } from 'node:path';

export function registerWorkspaceRoutes(ctx, pool) {
  const origin = ctx.webServer.getOrigin();
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) return;
  pool.config.frameOrigin = origin;
  const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  const route = (path, fetch) => ctx.connection.fetch.register({ path, methods: ['GET'], requestBody: 'buffered', fetch });
  route('/api/hardwise.style', async () => new Response(await readFile(new URL('./workspace.css', import.meta.url)), {
    headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' },
  }));
  route('/api/hardwise.projects', async request => {
    try {
      const records = await ctx.sessionQuery.listSessions(request.signal);
      const projects = new Map();
      for (const { header } of records) {
        if (!header.cwd || projects.has(header.cwd)) continue;
        projects.set(header.cwd, { session_id: header.id, workspace: header.cwd,
          name: basename(header.cwd), created_at: header.createdAt, runs: [], status: 'empty' });
      }
      // Read existing review stores only. Merely listing DSH directories never creates a review store.
      for (const project of projects.values()) {
        try { await access(join(project.workspace, '.hardwise-dsh', 'reviews.sqlite3')); }
        catch { continue; }
        try {
          const backend = await pool.get(project.workspace, request.signal);
          project.runs = (await backend.request('/api/runs', undefined, request.signal)).runs;
          project.status = 'ready';
        } catch { project.status = 'unavailable'; }
      }
      return json({ projects: [...projects.values()] });
    } catch { return json({ detail: '工程列表暂时无法读取，请稍后重试。' }, 503); }
  });
  route('/api/hardwise.workspace', async request => {
    const id = new URL(request.url).searchParams.get('session_id');
    if (!id || id.length > 200) return json({ detail: '请先选择工程会话。' }, 400);
    try {
      const { session } = await ctx.sessionQuery.readTitleSnapshot(id, request.signal);
      if (!session.cwd) return json({ detail: '此会话没有工程目录。' }, 409);
      const backend = await pool.get(session.cwd, request.signal);
      const { runs } = await backend.request('/api/runs', undefined, request.signal);
      return json({ session_id: id, workspace: session.cwd, origin: backend.origin,
        review_url: `${backend.origin}/?embed=1&parent_origin=${encodeURIComponent(origin)}`, runs });
    } catch { return json({ detail: '无法打开工程记录。请确认会话与 Python 环境可用后重试。' }, 503); }
  });
}
