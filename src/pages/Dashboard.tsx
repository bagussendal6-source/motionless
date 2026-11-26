import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ProjectSummary } from '../../shared/types.ts';
import { ASPECTS } from '../../shared/catalog.ts';
import { Icon, Logo, ThemeToggle } from '../components/ui.tsx';
import { StatusPill } from '../components/StatusPill.tsx';
import { ConnectGuide } from '../components/ConnectGuide.tsx';
import { api, timeAgo } from '../lib/api.ts';
import { ImageCache, renderFrame } from '../lib/engine.ts';
import { loadProjectFonts } from '../lib/store.ts';

function Thumb({ id, width, height }: { id: string; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    api.get(id).then(async (p) => {
      const images = new ImageCache();
      await Promise.all([images.ready(p), loadProjectFonts(p.layers.map((l) => l.font ?? 'Inter'))]);
      if (!alive || !ref.current) return;
      // Poster frame: the busiest moment in the first third of the video.
      const candidates = [0.2, 0.3, 0.4, 0.5].map((f) => f * p.duration);
      const t = candidates.reduce((best, c) => (p.layers.filter((l) => c >= l.start && c < l.end).length > p.layers.filter((l) => best >= l.start && best < l.end).length ? c : best), candidates[0]);
      const box = 520;
      const s = Math.min(box / p.width, (box * 10) / 16 / p.height);
      ref.current.width = Math.round(p.width * s);
      ref.current.height = Math.round(p.height * s);
      renderFrame(ref.current.getContext('2d')!, p, t, { scale: s, images });
    }).catch(() => {});
    return () => { alive = false; };
  }, [id]);
  return <canvas ref={ref} width={width / 10} height={height / 10} />;
}

export function Dashboard({ startNew = false }: { startNew?: boolean }) {
  const nav = useNavigate();
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(startNew);
  const [guide, setGuide] = useState(false);
  const [name, setName] = useState('');
  const [aspect, setAspect] = useState(ASPECTS[0].id);
  const [duration, setDuration] = useState(15);

  const refresh = () => api.list().then(setList, (e: Error) => setError(e.message));
  useEffect(() => { refresh(); }, []);

  async function create() {
    const a = ASPECTS.find((x) => x.id === aspect)!;
    const p = await api.create({ name: name.trim() || 'Untitled video', width: a.width, height: a.height, duration });
    nav(`/p/${p.id}`);
  }

  return (
    <div className="dash">
      <div className="dash-head">
        <Link to="/"><Logo size={24} /></Link>
        <div style={{ flex: 1 }} />
        <StatusPill onGuide={() => setGuide(true)} />
        <ThemeToggle />
        <button className="btn candy" onClick={() => setCreating(true)}><Icon name="plus" /> New project</button>
      </div>
      <h1>Projects</h1>
      {error && (
        <div className="card" style={{ marginTop: 24 }}>
          <b>Can't reach the MotionLess API.</b>
          <p>Start it with <code>npm run dev</code> in the MotionLess folder, then reload. ({error})</p>
        </div>
      )}
      <div className="grid">
        <button className="new-card" onClick={() => setCreating(true)}>
          <Icon name="plus" size={28} />
          New project
        </button>
        {list?.map((p) => (
          <div className="proj" key={p.id}>
            <Link to={`/p/${p.id}`} className="thumb"><Thumb id={p.id} width={p.width} height={p.height} /></Link>
            <div className="meta">
              <div>
                <b>{p.name}</b>
                <small>{p.width}×{p.height} · {p.duration}s · {p.layers} layers · {timeAgo(p.updatedAt)}</small>
              </div>
              <button className="icon-btn" title="Duplicate" onClick={async () => { await api.create({ from: p.id }); refresh(); }}><Icon name="copy" /></button>
              <button className="icon-btn" title="Delete" onClick={async () => {
                if (!confirm(`Delete “${p.name}”? This can't be undone.`)) return;
                await api.remove(p.id);
                refresh();
              }}><Icon name="trash" /></button>
            </div>
          </div>
        ))}
      </div>

      {guide && <ConnectGuide onClose={() => setGuide(false)} />}
      {creating && (
        <div className="modal-back" onClick={() => { setCreating(false); if (startNew) nav('/dashboard'); }}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); create(); }}>
            <h2>New video</h2>
            <p className="muted">Start blank here, or ask Claude Code to create one with the MotionLess MCP.</p>
            <div className="field"><span>Name</span><input autoFocus className="input lg" placeholder="Launch trailer" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field" style={{ marginTop: 16 }}>
              <span>Format</span>
              <div className="aspects">
                {ASPECTS.map((a) => {
                  const k = 54 / Math.max(a.width, a.height);
                  return (
                    <button type="button" key={a.id} className={`aspect-opt ${aspect === a.id ? 'on' : ''}`} onClick={() => setAspect(a.id)}>
                      <i style={{ width: a.width * k, height: a.height * k }} />
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="field" style={{ marginTop: 16 }}>
              <span>Length (seconds)</span>
              <input className="input lg" type="number" min={1} max={300} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 15)} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => { setCreating(false); if (startNew) nav('/dashboard'); }}>Cancel</button>
              <button className="btn candy" type="submit">Create</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
