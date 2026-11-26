import { useState } from 'react';
import { Icon } from './ui.tsx';
import { isRegistered, useStatus } from '../lib/status.ts';

const q = (s: string) => (/[\s"'$]/.test(s) ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : s);

function CopyBlock({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="copyrow">
      <code>{text}</code>
      <button className="btn sm" onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1600); }, () => {})}>
        <Icon name={done ? 'check' : 'copy'} size={14} /> {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

type State = 'done' | 'active' | 'todo';
function Step({ n, title, state, note, children }: { n: number; title: string; state: State; note?: string; children?: React.ReactNode }) {
  return (
    <div className={`gstep ${state}`}>
      <div className="gnum">{state === 'done' ? <Icon name="check" size={16} /> : n}</div>
      <div className="gbody">
        <div className="ghead">
          <b>{title}</b>
          {note && <span className="hint" style={{ margin: 0 }}>{note}</span>}
          {state === 'active' && <span className="pill">now</span>}
        </div>
        {state === 'active' && children}
      </div>
    </div>
  );
}

const norm = (p: string) => p.trim().replace(/\/+$/, '');

export function ConnectGuide({ onClose }: { onClose: () => void }) {
  const st = useStatus(1500);
  const root = st.root ?? '/path/to/MotionLess';
  const [folder, setFolder] = useState(() => { try { return localStorage.getItem('ml-folder') ?? ''; } catch { return ''; } });
  const [scope, setScope] = useState<'user' | 'local'>('user');
  const saveFolder = (v: string) => { setFolder(v); try { localStorage.setItem('ml-folder', v); } catch { /* ignore */ } };

  const claude = st.claudePath ? q(st.claudePath) : 'claude';
  const node = q(st.nodePath);
  // With one registered folder and nothing typed, use it so the commands are copy-ready.
  const dir = norm(folder) || (!st.registered.user && st.registered.folders.length === 1 ? norm(st.registered.folders[0]) : '');
  const mcpPath = `${root}/mcp/index.ts`;
  const reg = st.registered;
  const folderOk = !dir || reg.user || reg.folders.map(norm).includes(dir);
  const wrongPath = isRegistered(reg) && !!reg.command && !reg.command.includes(mcpPath);
  const registeredOk = isRegistered(reg) && folderOk && !wrongPath;
  const connected = st.mcp.length > 0;
  const edited = !!st.claudeSeenAt;

  const done = [st.api === true, !!st.claudePath, registeredOk, connected, edited];
  const firstOpen = done.findIndex((d) => !d);
  const state = (i: number): State => (done[i] ? 'done' : i === firstOpen ? 'active' : 'todo');
  const doneCount = done.filter(Boolean).length;

  const addCmd = scope === 'user'
    ? `${claude} mcp add motionless --scope user -- ${node} ${q(mcpPath)}`
    : `cd ${q(dir || '/path/to/your/project')} && ${claude} mcp add motionless --scope local -- ${node} ${q(mcpPath)}`;
  const openCmd = `cd ${q(dir || '/path/to/your/project')} && ${claude}`;
  const prompt = 'Use the MotionLess MCP to make a 15 second launch video for this project. Read the README and styles for the real colours, fonts and copy first. Plan sections, build it, run lint_project and fix what it reports, then review it with render_frames and tell me the editor URL.';

  const summary = st.api === null ? 'Checking…'
    : st.api === false ? 'MotionLess server is offline.'
    : !st.claudePath ? 'Claude Code was not found on this Mac.'
    : !registeredOk ? 'Claude Code found. MotionLess is not registered yet.'
    : !connected ? 'Registered. Now open a new Claude Code session.'
    : `Connected: ${st.mcp.map((m) => m.cwd.split('/').pop()).join(', ')}`;
  const tone = connected ? 'ok' : st.api === false ? 'bad' : 'wait';

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal guide" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0, flex: 1 }}>Connect Claude Code</h2>
          <span className="pill">{doneCount} / 5</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="progress" style={{ marginTop: 12 }}><div style={{ width: `${(doneCount / 5) * 100}%` }} /></div>
        <div className={`gbanner ${tone}`}>
          <span className="live-dot" style={{ background: tone === 'ok' ? 'var(--accent)' : tone === 'bad' ? 'var(--danger)' : 'var(--amber)' }} />
          {summary}
        </div>

        <label className="field" style={{ marginTop: 14 }}>
          <span>Your project folder (the repo you want a video about)</span>
          <input className="input" placeholder="/Users/you/my-project" value={folder} onChange={(e) => saveFolder(e.target.value)} />
        </label>
        {reg.folders.length > 0 && (
          <div className="chips" style={{ marginTop: 8 }}>
            {reg.folders.map((f) => <button key={f} className="chip" onClick={() => saveFolder(f)}>{f}</button>)}
          </div>
        )}

        <div className="gsteps">
          <Step n={1} title="MotionLess is running" state={state(0)} note={st.api ? `port ${st.port}` : undefined}>
            <p className="hint">Start the app and keep that terminal open.</p>
            <CopyBlock text={`cd ${q(root)} && npm run dev`} />
          </Step>

          <Step n={2} title="Claude Code is installed" state={state(1)} note={st.claudePath ?? undefined}>
            <p className="hint">Not found in your PATH, <code>~/.local/bin</code>, <code>/opt/homebrew/bin</code> or <code>/usr/local/bin</code>. Install Claude Code first (claude.com/claude-code), then this page ticks by itself.</p>
          </Step>

          <Step n={3} title="MotionLess is registered in Claude Code" state={state(2)}
            note={registeredOk ? (reg.user ? 'all folders' : `${reg.folders.length} folder${reg.folders.length === 1 ? '' : 's'}`) : undefined}>
            {wrongPath && <p className="hint" style={{ color: 'var(--amber)' }}>Registered, but it points at a different copy: <code>{reg.command}</code>. Run the command below to fix it (remove the old one first with <code>{claude} mcp remove motionless</code>).</p>}
            {!wrongPath && isRegistered(reg) && !folderOk && <p className="hint" style={{ color: 'var(--amber)' }}>It is registered, but not for <code>{dir}</code>. Register it for all folders, or for this one.</p>}
            <div className="seg" style={{ margin: '4px 0 10px' }}>
              <button className={scope === 'user' ? 'on' : ''} onClick={() => setScope('user')}>All my folders</button>
              <button className={scope === 'local' ? 'on' : ''} onClick={() => setScope('local')}>Only the folder above</button>
            </div>
            <p className="hint">Run this in any terminal. It uses full paths, so it works even if <code>claude</code> isn't on your PATH. Nothing is added to your repo.</p>
            <CopyBlock text={addCmd} />
          </Step>

          <Step n={4} title="A Claude Code session is open" state={state(3)} note={connected ? st.mcp.map((m) => m.cwd.split('/').pop()).join(', ') : undefined}>
            <p className="hint">Start a <b>new</b> session in your project. Sessions that were already open don't load new servers. This ticks within a few seconds of the session starting.</p>
            <CopyBlock text={openCmd} />
            <p className="hint" style={{ marginTop: 8 }}>If Claude Code asks whether to trust <code>motionless</code>, say yes.</p>
          </Step>

          <Step n={5} title="Ask for your first video" state={state(4)}>
            <p className="hint">Paste this into that Claude Code session. Edits appear in the editor as Claude makes them.</p>
            <CopyBlock text={prompt} />
          </Step>
        </div>

        {doneCount === 5 && <div className="gbanner ok" style={{ marginTop: 14 }}>All set. Claude is editing live.</div>}

        <details className="gtrouble">
          <summary>Something not working?</summary>
          {[
            { q: 'Step 4 never ticks', a: `In the Claude Code session, type /mcp and look for “motionless”. If it says failed, check that MotionLess is running (step 1) and that ${st.nodePath} exists.` },
            { q: 'I want to type plain `claude` in the terminal', a: 'Add its folder to your PATH, then open a new terminal tab.', code: `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc` },
            { q: 'Connected, but edits never show up here', a: 'Keep this editor tab open on the project Claude is editing. Ask Claude for the project id, or pick the newest one under Projects.' },
          ].map((t) => (
            <div key={t.q} style={{ marginTop: 12 }}>
              <b style={{ fontSize: 13 }}>{t.q}</b>
              <p className="hint" style={{ margin: '4px 0 6px' }}>{t.a}</p>
              {t.code && <CopyBlock text={t.code} />}
            </div>
          ))}
        </details>

        <div className="modal-actions"><button className="btn" onClick={onClose}>{connected ? 'Done' : 'Close'}</button></div>
      </div>
    </div>
  );
}
