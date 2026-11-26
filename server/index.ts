// MotionLess API server. Stores projects as JSON files, keeps an undo history
// per project, and pushes every change to open editors over Server-Sent Events.
// Both the editor and the MCP server talk to it, so Claude's edits land live.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, readdir, rm, writeFile, copyFile, stat } from 'node:fs/promises';
import { existsSync, createReadStream, accessSync, readFileSync, constants as fsc } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { makeProject, uid } from '../shared/catalog.ts';
import { applyOps, normalize, type Op } from '../shared/ops.ts';
import { buildDemoProject } from '../shared/demo.ts';
import { formatLint, lintProject } from '../shared/lint.ts';
import { CATALOG_TEXT, planTool, ToolError } from './tools.ts';
import type { HistoryEntry, Project, ProjectSummary, ServerEvent } from '../shared/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.MOTIONLESS_DATA ?? join(ROOT, 'data');
const PROJECTS = join(DATA, 'projects');
const ASSETS = join(DATA, 'assets');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.MOTIONLESS_PORT ?? 4317);
const HOST = process.env.MOTIONLESS_HOST ?? '127.0.0.1';
const HISTORY_LIMIT = 80;

await mkdir(PROJECTS, { recursive: true });
await mkdir(ASSETS, { recursive: true });

// ---------- storage ----------
const cache = new Map<string, Project>();
const safeId = (id: string) => /^[\w-]{1,80}$/.test(id);
const file = (id: string) => join(PROJECTS, `${id}.json`);

async function load(id: string): Promise<Project | null> {
  if (!safeId(id)) return null;
  const hit = cache.get(id);
  if (hit) return hit;
  if (!existsSync(file(id))) {
    if (id === 'demo') return persist(buildDemoProject(), 'Demo created', 'system');
    return null;
  }
  const p = normalize(JSON.parse(await readFile(file(id), 'utf8')) as Project);
  cache.set(id, p);
  return p;
}

async function save(p: Project) {
  cache.set(p.id, p);
  await writeFile(file(p.id), JSON.stringify(p, null, 2));
}

// ---------- history ----------
interface Snap { meta: HistoryEntry; project: Project; key?: string; at: number }
const histories = new Map<string, { snaps: Snap[]; cursor: number }>();

function historyOf(p: Project) {
  let h = histories.get(p.id);
  if (!h) {
    h = { snaps: [{ meta: { id: uid('h'), label: 'Opened', source: 'system', at: new Date().toISOString() }, project: p, at: Date.now() }], cursor: 0 };
    histories.set(p.id, h);
  }
  return h;
}
const publicHistory = (id: string) => {
  const h = histories.get(id);
  return h ? { history: h.snaps.map((s) => s.meta), cursor: h.cursor } : { history: [], cursor: 0 };
};

async function persist(next: Project, label: string, source: HistoryEntry['source'], opts: { clientId?: string; coalesce?: string } = {}) {
  const prev = cache.get(next.id);
  next.rev = (prev?.rev ?? next.rev ?? 0) + 1;
  next.updatedAt = new Date().toISOString();
  if (prev) historyOf(prev);
  await save(next);
  const h = historyOf(next);
  const last = h.snaps[h.cursor];
  if (last && h.cursor > 0 && opts.coalesce && last.key === opts.coalesce && Date.now() - last.at < 1500 && h.cursor === h.snaps.length - 1) {
    last.project = next;
    last.at = Date.now();
  } else if (!(h.snaps.length === 1 && h.snaps[0].project === next)) {
    h.snaps = h.snaps.slice(0, h.cursor + 1);
    h.snaps.push({ meta: { id: uid('h'), label, source, at: next.updatedAt }, project: next, key: opts.coalesce, at: Date.now() });
    if (h.snaps.length > HISTORY_LIMIT) h.snaps.shift();
    h.cursor = h.snaps.length - 1;
  }
  broadcast({ type: 'project', project: next, label, source, clientId: opts.clientId }, next.id);
  broadcast({ type: 'history', projectId: next.id, ...publicHistory(next.id) }, next.id);
  return next;
}

async function travel(id: string, dir: -1 | 1) {
  const p = await load(id);
  if (!p) return null;
  const h = historyOf(p);
  const target = h.cursor + dir;
  if (target < 0 || target >= h.snaps.length) return { project: p, moved: false };
  const label = dir < 0 ? `Undo: ${h.snaps[h.cursor].meta.label}` : `Redo: ${h.snaps[target].meta.label}`;
  h.cursor = target;
  const snap = structuredClone(h.snaps[target].project);
  snap.rev = p.rev + 1;
  snap.updatedAt = new Date().toISOString();
  await save(snap);
  broadcast({ type: 'project', project: snap, label, source: 'system' }, id);
  broadcast({ type: 'history', projectId: id, ...publicHistory(id) }, id);
  return { project: snap, moved: true, label };
}

// ---------- live events ----------
const clients = new Map<ServerResponse, string | null>();
let claudeSeenAt: string | null = null;

// Where is the Claude Code binary, and is MotionLess registered with it? Both are read-only
// looks at the local machine; only the motionless entry is extracted from ~/.claude.json.
function findClaude(): string | null {
  const home = homedir();
  const dirs = [...(process.env.PATH ?? '').split(':'), `${home}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin', `${home}/.claude/local`, `${home}/.npm-global/bin`, `${home}/.bun/bin`];
  for (const d of dirs) {
    if (!d) continue;
    try { accessSync(`${d}/claude`, fsc.X_OK); return `${d}/claude`; } catch { /* next */ }
  }
  return null;
}
function readRegistration(): { user: boolean; folders: string[]; command: string | null } {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')) as {
      mcpServers?: Record<string, { command?: string; args?: string[] }>;
      projects?: Record<string, { mcpServers?: Record<string, { command?: string; args?: string[] }> }>;
    };
    const u = cfg.mcpServers?.motionless;
    const folders = Object.entries(cfg.projects ?? {}).filter(([, v]) => v.mcpServers?.motionless).map(([dir]) => dir);
    const any = u ?? Object.values(cfg.projects ?? {}).map((v) => v.mcpServers?.motionless).find(Boolean);
    return { user: !!u, folders, command: any ? [any.command, ...(any.args ?? [])].join(' ') : null };
  } catch {
    return { user: false, folders: [], command: null };
  }
}
// Live MCP sessions (one per Claude Code process). They beat every ~10 s; silent ones drop off.
const mcpSessions = new Map<string, { id: string; cwd: string; pid: number; since: string; lastSeen: number }>();
const liveMcp = () => {
  const now = Date.now();
  for (const [id, m] of mcpSessions) if (now - m.lastSeen > 25000) mcpSessions.delete(id);
  return [...mcpSessions.values()].map((m) => ({ id: m.id, cwd: m.cwd, pid: m.pid, since: m.since, lastSeen: new Date(m.lastSeen).toISOString() }));
};
let selection: { projectId: string; layerIds: string[]; time: number } | null = null;

function broadcast(ev: ServerEvent, projectId: string | null) {
  const data = `data: ${JSON.stringify(ev)}\n\n`;
  for (const [res, pid] of clients) if (!pid || !projectId || pid === projectId) res.write(data);
}
setInterval(() => { for (const res of clients.keys()) res.write(': ping\n\n'); }, 20000).unref();

// render_frames: the MCP asks, an open editor draws, the frames come back here.
const pendingRenders = new Map<string, (frames: string[]) => void>();

// ---------- http helpers ----------
async function body(req: IncomingMessage, limit = 50 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}
async function json<T>(req: IncomingMessage): Promise<T> {
  const b = await body(req);
  return (b.length ? JSON.parse(b.toString('utf8')) : {}) as T;
}
function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}
const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
};
async function sendFile(res: ServerResponse, path: string, cacheable = false) {
  const s = await stat(path);
  res.writeHead(200, { 'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream', 'content-length': s.size, 'cache-control': cacheable ? 'public, max-age=31536000, immutable' : 'no-cache' });
  createReadStream(path).pipe(res);
}

function summary(p: Project): ProjectSummary {
  return { id: p.id, name: p.name, width: p.width, height: p.height, duration: p.duration, layers: p.layers.length, updatedAt: p.updatedAt };
}

async function saveAsset(buf: Buffer, name: string) {
  const ext = extname(name).toLowerCase() || '.png';
  if (!MIME[ext] || ext === '.html' || ext === '.js') throw Object.assign(new Error(`Unsupported asset type ${ext}`), { status: 400 });
  const fname = `${basename(name, extname(name)).replace(/[^\w-]/g, '').slice(0, 40) || 'asset'}-${randomUUID().slice(0, 8)}${ext}`;
  await writeFile(join(ASSETS, fname), buf);
  return { url: `/api/assets/${fname}`, file: fname };
}

// ---------- routes ----------
async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const method = req.method ?? 'GET';
  if (req.headers['x-motionless-client'] === 'mcp') claudeSeenAt = new Date().toISOString();

  if (parts[0] !== 'api') return serveApp(url.pathname, res);
  const [, a, b, c, d] = parts;

  if (a === 'mcp' && b === 'heartbeat' && method === 'POST') {
    const { id, cwd, pid } = await json<{ id: string; cwd: string; pid: number }>(req);
    const prev = mcpSessions.get(id);
    mcpSessions.set(id, { id, cwd, pid, since: prev?.since ?? new Date().toISOString(), lastSeen: Date.now() });
    return send(res, 200, { ok: true });
  }
  if (a === 'mcp' && b === 'bye' && method === 'POST') {
    mcpSessions.delete((await json<{ id: string }>(req)).id);
    return send(res, 200, { ok: true });
  }
  if (a === 'catalog') return send(res, 200, { text: CATALOG_TEXT });
  if (a === 'status') return send(res, 200, { api: true, root: ROOT, port: PORT, editors: clients.size, mcp: liveMcp(), claudeSeenAt, claudePath: findClaude(), nodePath: process.execPath, registered: readRegistration() });
  if (a === 'health') return send(res, 200, { ok: true, name: 'motionless', claudeSeenAt, editors: clients.size, root: ROOT });

  if (a === 'events' && method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`data: ${JSON.stringify({ type: 'hello', claudeSeenAt } satisfies ServerEvent)}\n\n`);
    clients.set(res, url.searchParams.get('project'));
    req.on('close', () => clients.delete(res));
    return;
  }

  if (a === 'projects') {
    if (!b) {
      if (method === 'GET') {
        await load('demo');
        const files = (await readdir(PROJECTS)).filter((f) => f.endsWith('.json'));
        const list = (await Promise.all(files.map((f) => load(f.slice(0, -5))))).filter(Boolean) as Project[];
        return send(res, 200, list.map(summary).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)));
      }
      if (method === 'POST') {
        const input = await json<Partial<Project> & { from?: string }>(req);
        let p: Project;
        if (input.from) {
          const src = await load(input.from);
          if (!src) return send(res, 404, { error: 'Source project not found' });
          p = { ...structuredClone(src), id: uid('p'), name: input.name ?? `${src.name} copy`, createdAt: new Date().toISOString(), rev: 0 };
        } else {
          const { from: _from, ...rest } = input;
          p = normalize(makeProject({ ...rest, id: uid('p'), rev: 0 }));
        }
        await persist(p, 'Created', req.headers['x-motionless-client'] === 'mcp' ? 'claude' : 'user');
        return send(res, 201, p);
      }
    }
    const p = await load(b);
    if (!p) return send(res, 404, { error: `Project "${b}" not found` });

    if (!c) {
      if (method === 'GET') return send(res, 200, p);
      if (method === 'PUT') {
        const { project, label, source, clientId, coalesce } = await json<{ project: Project; label?: string; source?: HistoryEntry['source']; clientId?: string; coalesce?: string }>(req);
        const next = normalize({ ...project, id: p.id, createdAt: p.createdAt });
        await persist(next, label ?? 'Edit', source ?? 'user', { clientId, coalesce });
        return send(res, 200, { rev: next.rev });
      }
      if (method === 'DELETE') {
        if (p.id === 'demo') { cache.delete('demo'); histories.delete('demo'); }
        cache.delete(p.id);
        histories.delete(p.id);
        await rm(file(p.id), { force: true });
        return send(res, 200, { ok: true });
      }
    }
    if (c === 'ops' && method === 'POST') {
      const { ops, label, source } = await json<{ ops: Op[]; label?: string; source?: HistoryEntry['source'] }>(req);
      const out = applyOps(p, ops);
      const src = source ?? (req.headers['x-motionless-client'] === 'mcp' ? 'claude' : 'user');
      await persist(out.project, label ?? ops.map((o) => o.op).join(', '), src);
      return send(res, 200, { project: out.project, created: out.created });
    }
    if (c === 'undo' && method === 'POST') return send(res, 200, await travel(p.id, -1));
    if (c === 'redo' && method === 'POST') return send(res, 200, await travel(p.id, 1));
    if (c === 'history' && method === 'GET') { historyOf(p); return send(res, 200, publicHistory(p.id)); }
    if (c === 'lint' && method === 'GET') { const issues = lintProject(p); return send(res, 200, { issues, text: formatLint(issues) }); }
    // MCP tools: the server does the thinking (validate, resolve, lint, review), the MCP process only forwards.
    if (c === 'tool' && d && method === 'POST') {
      const args = await json<Record<string, unknown>>(req);
      let plan;
      try { plan = planTool(d, p, args); } catch (e) {
        if (e instanceof ToolError) return send(res, (e as ToolError).status, { error: e.message });
        throw e;
      }
      if (typeof plan === 'string') return send(res, 200, { text: plan, created: [] });
      const out = applyOps(p, plan.ops);
      if (!plan.dryRun) await persist(out.project, plan.label, req.headers['x-motionless-client'] === 'mcp' ? 'claude' : 'user');
      return send(res, 200, { text: plan.text(out.project, out.created), created: out.created });
    }
    if (c === 'render' && method === 'POST') {
      const { times, width, sheet } = await json<{ times: number[]; width?: number; sheet?: { cols: number } }>(req);
      const editors = [...clients.values()].filter((pid) => pid === p.id).length;
      if (!editors) return send(res, 409, { error: `Open the editor at http://localhost:5173/p/${p.id} so frames can be rendered.` });
      const requestId = randomUUID();
      const frames = await new Promise<string[] | null>((resolveFrames) => {
        const timer = setTimeout(() => { pendingRenders.delete(requestId); resolveFrames(null); }, 30000);
        pendingRenders.set(requestId, (f) => { clearTimeout(timer); pendingRenders.delete(requestId); resolveFrames(f); });
        broadcast({ type: 'render', projectId: p.id, requestId, times: times.slice(0, 48), width: Math.min(sheet ? 2400 : 1920, width ?? 960), sheet }, p.id);
      });
      if (!frames) return send(res, 504, { error: 'The editor did not answer in time.' });
      return send(res, 200, { frames });
    }
    if (c === 'claude' && method === 'POST') {
      const { status } = await json<{ status: string }>(req);
      broadcast({ type: 'claude', projectId: p.id, status, at: new Date().toISOString() }, p.id);
      return send(res, 200, { ok: true });
    }
  }

  if (a === 'render-result' && b && method === 'POST') {
    const { frames } = await json<{ frames: string[] }>(req);
    pendingRenders.get(b)?.(frames);
    return send(res, 200, { ok: true });
  }

  if (a === 'selection') {
    if (method === 'POST') { selection = await json(req); return send(res, 200, { ok: true }); }
    return send(res, 200, selection ?? { projectId: null, layerIds: [], time: 0 });
  }

  if (a === 'assets') {
    if (method === 'POST' && !b) {
      const name = url.searchParams.get('name') ?? 'upload.png';
      return send(res, 201, await saveAsset(await body(req), name));
    }
    if (method === 'POST' && b === 'import') {
      const { path, url: remote } = await json<{ path?: string; url?: string }>(req);
      if (path) {
        const ext = extname(path).toLowerCase();
        if (!MIME[ext]) return send(res, 400, { error: `Unsupported asset type ${ext}` });
        const fname = `${basename(path, ext).replace(/[^\w-]/g, '').slice(0, 40) || 'asset'}-${randomUUID().slice(0, 8)}${ext}`;
        await copyFile(path, join(ASSETS, fname));
        return send(res, 201, { url: `/api/assets/${fname}`, file: fname });
      }
      if (remote) {
        const r = await fetch(remote);
        if (!r.ok) return send(res, 502, { error: `Fetch failed: ${r.status}` });
        const type = r.headers.get('content-type') ?? '';
        const ext = Object.entries(MIME).find(([, m]) => type.startsWith(m))?.[0] ?? (extname(new URL(remote).pathname) || '.png');
        return send(res, 201, await saveAsset(Buffer.from(await r.arrayBuffer()), `remote${ext}`));
      }
      return send(res, 400, { error: 'Pass path or url' });
    }
    if (method === 'GET' && b) {
      const f = join(ASSETS, basename(b));
      if (!existsSync(f)) return send(res, 404, { error: 'Not found' });
      return sendFile(res, f, true);
    }
  }

  return send(res, 404, { error: 'Not found' });
}

async function serveApp(pathname: string, res: ServerResponse) {
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('MotionLess API is running. Start the editor with `npm run dev` and open http://localhost:5173');
  }
  const candidate = join(DIST, pathname);
  if (candidate.startsWith(DIST) && existsSync(candidate) && (await stat(candidate)).isFile()) return sendFile(res, candidate, pathname.startsWith('/assets/'));
  return sendFile(res, join(DIST, 'index.html'));
}

createServer((req, res) => {
  route(req, res).catch((err: Error & { status?: number }) => {
    if (!res.headersSent) send(res, err.status ?? 500, { error: err.message });
    else res.end();
  });
}).listen(PORT, HOST, () => {
  console.log(`MotionLess API on http://${HOST}:${PORT}`);
});
