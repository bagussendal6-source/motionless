import { useEffect, useState } from 'react';

export interface McpSession { id: string; cwd: string; pid: number; since: string; lastSeen: string }
export interface Registration { user: boolean; folders: string[]; command: string | null }
export interface Status { api: boolean | null; editors: number; port?: number; root?: string; mcp: McpSession[]; claudeSeenAt: string | null; claudePath: string | null; nodePath: string; registered: Registration }
export const isRegistered = (r: Registration) => r.user || r.folders.length > 0;

/** Polls the API: is it up, and are any Claude Code sessions connected through MCP? */
export function useStatus(intervalMs = 3000): Status {
  const [s, setS] = useState<Status>({ api: null, editors: 0, mcp: [], claudeSeenAt: null, claudePath: null, nodePath: 'node', registered: { user: false, folders: [], command: null } });
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/status', { cache: 'no-store' });
        const d = await r.json();
        if (alive) setS({ api: true, editors: d.editors, port: d.port, root: d.root, mcp: d.mcp, claudeSeenAt: d.claudeSeenAt, claudePath: d.claudePath ?? null, nodePath: d.nodePath ?? 'node', registered: d.registered ?? { user: false, folders: [], command: null } });
      } catch {
        if (alive) setS((x) => ({ ...x, api: false, mcp: [] }));
      }
    };
    tick();
    const i = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(i); };
  }, [intervalMs]);
  return s;
}
