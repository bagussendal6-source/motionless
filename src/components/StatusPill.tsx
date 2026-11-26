import { useState } from 'react';
import { timeAgo } from '../lib/api.ts';
import { isRegistered, useStatus } from '../lib/status.ts';

/** One glance: is the API up, and is Claude Code connected? Click for details. */
export function StatusPill({ projectId, onGuide }: { projectId?: string; onGuide?: () => void }) {
  const st = useStatus();
  const [open, setOpen] = useState(false);
  const level = st.api === null ? 'wait' : !st.api ? 'off' : st.mcp.length ? 'ok' : 'mid';
  const label = { wait: 'Checking…', off: 'API offline', mid: isRegistered(st.registered) ? 'Ready' : 'Not set up', ok: `Connected${st.mcp.length > 1 ? ` · ${st.mcp.length}` : ''}` }[level];
  const color = { wait: 'var(--faint)', off: 'var(--danger)', mid: 'var(--amber)', ok: 'var(--accent)' }[level];
  const rows: [string, boolean | null, string][] = [
    ['API server', st.api, st.api ? `localhost:${st.port}` : 'Run `npm run dev` in the MotionLess folder'],
    ['Editor live link', st.api ? st.editors > 0 : false, st.api ? `${st.editors} editor tab${st.editors === 1 ? '' : 's'} open` : '—'],
    ['Claude Code installed', st.api ? !!st.claudePath : false, st.claudePath ?? 'Not found on this Mac'],
    ['MotionLess registered', st.api ? isRegistered(st.registered) : false, isRegistered(st.registered) ? (st.registered.user ? 'All folders' : `${st.registered.folders.length} folder${st.registered.folders.length === 1 ? '' : 's'}`) : 'Run the add command (see guide)'],
    ['Claude session running', st.api ? st.mcp.length > 0 : false, st.mcp.length ? `${st.mcp.length} session${st.mcp.length === 1 ? '' : 's'}` : 'Open a new Claude Code session'],
  ];
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn sm" onClick={() => setOpen(!open)} title={level === 'ok' ? 'Claude Code is connected' : level === 'mid' ? (isRegistered(st.registered) ? 'Registered. Open a new Claude Code session.' : 'Claude Code is not set up yet') : 'Connection status'} style={{ gap: 8 }}>
        <span className={`live-dot ${level === 'ok' ? 'on' : ''}`} style={{ background: color }} />
        {label}
      </button>
      {open && (
        <div className="menu" style={{ right: 0, top: 40, width: 340, padding: 14 }} onMouseLeave={() => setOpen(false)}>
          <div style={{ display: 'grid', gap: 10 }}>
            {rows.map(([name, ok, detail]) => (
              <div key={name} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span className="live-dot" style={{ marginTop: 6, background: ok === null ? 'var(--faint)' : ok ? 'var(--accent)' : 'var(--danger)' }} />
                <div style={{ fontSize: 13 }}><b>{name}</b><div className="hint">{detail}</div></div>
              </div>
            ))}
            {st.mcp.map((m) => (
              <div key={m.id} style={{ background: 'var(--bg-2)', borderRadius: 10, padding: '8px 10px', fontSize: 12 }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>{m.cwd}</div>
                <div className="hint">connected {timeAgo(m.since)} · pid {m.pid}</div>
              </div>
            ))}
            {projectId && <div className="hint">Project id: <code>{projectId}</code></div>}
            {onGuide && (
              <button className={`btn sm ${level === 'ok' ? '' : 'candy'}`} onClick={() => { setOpen(false); onGuide(); }}>
                {level === 'ok' ? 'Setup guide' : 'Connect Claude: step by step'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
