import { useEffect, useState } from 'react';
import type { Project } from '../../shared/types.ts';
import type { DocApi } from './useDoc.ts';
import { Icon } from '../components/ui.tsx';
import { api, timeAgo } from '../lib/api.ts';

const IDEAS = [
  'Make the hook hit harder',
  'Switch every headline to Unbounded',
  'Redo the end card, calmer',
  'Make this bigger and pink',
  'Adapt this to portrait',
  'Add a camera push-in on the first beat',
];

export function ClaudePanel({ project, doc, selected, connected, onGuide }: { project: Project; doc: DocApi; selected: string[]; connected: boolean; onGuide: () => void }) {
  const [root, setRoot] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [, tick] = useState(0);
  useEffect(() => {
    api.health().then((h) => setRoot(h.root ?? null), () => {});
    const i = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(i);
  }, []);

  const active = connected;
  const selNames = project.layers.filter((l) => selected.includes(l.id)).map((l) => l.name);

  function promptFor(text: string) {
    const target = selNames.length ? ` "This" = selected layer${selNames.length > 1 ? 's' : ''} ${selNames.map((n) => `“${n}”`).join(', ')} (call get_selection).` : '';
    return `In MotionLess project ${project.id}: ${text}.${target}`;
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(promptFor(text));
      doc.notify('Copied. Paste it into Claude Code.');
    } catch {
      doc.notify('Clipboard blocked by the browser');
    }
  }

  const h = doc.history;

  return (
    <div className="claude">
      <div className="status-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`live-dot ${active ? 'on' : ''}`} />
          <b style={{ fontSize: 13 }}>{active ? 'Claude Code is connected' : 'Claude Code not connected'}</b>
          <span className="hint" style={{ marginLeft: 'auto' }}>{doc.claudeSeenAt ? `last edit ${timeAgo(doc.claudeSeenAt)}` : ''}</span>
        </div>
        {doc.claude && <div style={{ fontSize: 13 }}>{doc.claude.status}</div>}
        {!active && (
          <>
            <p className="hint">Not set up yet? The guide walks you through it and checks each step live.</p>
            <button className="btn sm candy" onClick={onGuide}><Icon name="terminal" size={14} /> Connect Claude: step by step</button>
          </>
        )}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <b style={{ fontSize: 13 }}>What should change?</b>
        <p className="hint" style={{ marginTop: -4 }}>
          {selNames.length ? <>“This” means <b>{selNames.join(', ')}</b>.</> : 'Select a layer first if you want to say “this”.'} Copy a request and paste it into Claude Code.
        </p>
        <div className="chips">
          {IDEAS.map((i) => <button className="chip" key={i} onClick={() => copy(i)}>{i}</button>)}
        </div>
        <textarea className="textarea" rows={3} placeholder="Describe a change…" value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && draft.trim()) { copy(draft.trim()); setDraft(''); } }} />
        <button className="btn sm candy" disabled={!draft.trim()} onClick={() => { copy(draft.trim()); setDraft(''); }}><Icon name="copy" size={14} /> Copy for Claude Code</button>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <b style={{ fontSize: 13, flex: 1 }}>History</b>
          <button className="icon-btn" title="Undo (⌘Z)" disabled={h.cursor <= 0} onClick={doc.undo}><Icon name="undo" /></button>
          <button className="icon-btn" title="Redo (⇧⌘Z)" disabled={h.cursor >= h.history.length - 1} onClick={doc.redo}><Icon name="redo" /></button>
        </div>
        <div className="hist">
          {h.history.map((e, i) => ({ e, i })).reverse().slice(0, 40).map(({ e, i }) => (
            <div key={e.id} className={i === h.cursor ? 'cur' : i > h.cursor ? 'future' : ''}>
              <span className={`src ${e.source}`}>{e.source === 'claude' ? 'Claude' : e.source === 'user' ? 'You' : '·'}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</span>
              <span className="hint">{timeAgo(e.at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
