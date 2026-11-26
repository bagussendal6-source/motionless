import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Project, ServerEvent } from '../../shared/types.ts';
import { ASPECTS } from '../../shared/catalog.ts';
import { applyOps, resizeProject } from '../../shared/ops.ts';
import { Icon, ThemeToggle } from '../components/ui.tsx';
import { StatusPill } from '../components/StatusPill.tsx';
import { ConnectGuide } from '../components/ConnectGuide.tsx';
import { useStatus } from '../lib/status.ts';
import { useDoc } from '../editor/useDoc.ts';
import { Preview } from '../editor/Preview.tsx';
import { Timeline } from '../editor/Timeline.tsx';
import { LayersPanel } from '../editor/LayersPanel.tsx';
import { Inspector } from '../editor/Inspector.tsx';
import { ClaudePanel } from '../editor/ClaudePanel.tsx';
import { api } from '../lib/api.ts';
import { fmtTime, ImageCache } from '../lib/engine.ts';
import { contactSheet, download, exportVideo, frameToDataUrl, slug } from '../lib/export.ts';
import { AudioPlayer, audioKey, mixdown, toWav } from '../lib/audio.ts';
import { loadProjectFonts, Signal, useSignal } from '../lib/store.ts';

function TimeReadout({ time, duration }: { time: Signal<number>; duration: number }) {
  const t = useSignal(time);
  return <div className="time">{fmtTime(t)} <span>/ {fmtTime(duration)}</span></div>;
}

export function Editor() {
  const { id = 'demo' } = useParams();
  const time = useMemo(() => new Signal(0), [id]);
  const playing = useMemo(() => new Signal(false), [id]);
  const images = useMemo(() => new ImageCache(), [id]);
  const isPlaying = useSignal(playing);
  const projectRef = useRef<Project | null>(null);
  const audio = useMemo(() => new AudioPlayer(), [id]);
  const [muted, setMuted] = useState(false);

  // Claude's render_frames: draw the requested times here and send them back.
  const onRender = useCallback(async (e: Extract<ServerEvent, { type: 'render' }>) => {
    const p = projectRef.current;
    if (!p) return;
    await Promise.all([images.ready(p), loadProjectFonts(p.layers.map((l) => l.font ?? 'Inter'))]);
    if (e.sheet) {
      api.renderResult(e.requestId, [await contactSheet(p, e.times, e.width, e.sheet.cols, images)]).catch(() => {});
      return;
    }
    const frames = await Promise.all(e.times.map((t) => frameToDataUrl(p, Math.max(0, Math.min(p.duration - 1e-3, t)), e.width, images)));
    api.renderResult(e.requestId, frames).catch(() => {});
  }, [images]);

  const status = useStatus();
  const doc = useDoc(id, onRender);
  const { project } = doc;
  projectRef.current = project;

  // Open on a frame with something in it rather than the empty first frame.
  const loadedId = project?.id;
  useEffect(() => {
    if (loadedId && projectRef.current) time.set(Math.min(1, projectRef.current.duration / 2));
  }, [loadedId, time]);

  const [selected, setSelected] = useState<string[]>([]);
  const [leftTab, setLeftTab] = useState<'claude' | 'layers'>('layers');
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [pxPerSec, setPxPerSec] = useState(80);
  const [snap, setSnap] = useState(true);
  const [loop, setLoop] = useState(true);
  const [fontsVersion, setFontsVersion] = useState(0);
  const [exporting, setExporting] = useState<{ progress: number; abort: AbortController } | null>(null);
  const [exportMenu, setExportMenu] = useState(false);
  const [guide, setGuide] = useState(false);
  // First time in the editor with no Claude connected: offer the guide once.
  const offered = useRef(false);
  useEffect(() => {
    if (offered.current || status.api === null) return;
    offered.current = true;
    let seen = false;
    try { seen = localStorage.getItem('ml-guide-seen') === '1'; } catch { /* ignore */ }
    if (!seen && status.api && !status.mcp.length) { setGuide(true); try { localStorage.setItem('ml-guide-seen', '1'); } catch { /* ignore */ } }
  }, [status.api, status.mcp.length]);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Fonts: redraw once they arrive so text metrics are right.
  const fontKey = project ? [...new Set(project.layers.map((l) => l.font ?? 'Inter'))].sort().join('|') : '';
  useEffect(() => {
    if (!fontKey) return;
    loadProjectFonts(fontKey.split('|')).then(() => setFontsVersion((v) => v + 1));
  }, [fontKey]);

  // Drop selections that no longer exist (e.g. Claude deleted them).
  useEffect(() => {
    if (project && selected.some((s) => !project.layers.find((l) => l.id === s))) setSelected((sel) => sel.filter((s) => project.layers.find((l) => l.id === s)));
  }, [project, selected]);

  // Tell the server what "this" is, for get_selection.
  useEffect(() => {
    if (!project) return;
    const h = setTimeout(() => api.select(project.id, selected, time.get()), 150);
    return () => clearTimeout(h);
  }, [selected, project?.id, time, isPlaying]);

  // Sound: build the mix ahead of time, start it with playback, restart it when the audio changes.
  const aKey = project ? audioKey(project) : '';
  useEffect(() => {
    audio.muted = muted;
    if (muted) audio.stop();
  }, [audio, muted]);
  useEffect(() => {
    const p = projectRef.current;
    if (!p) return;
    audio.prepare(p);
    if (playing.get() && !muted) audio.play(p, time.get());
  }, [aKey]);
  useEffect(() => {
    const p = projectRef.current;
    if (isPlaying && p && !muted) audio.play(p, time.get());
    else audio.stop();
    return () => audio.stop();
  }, [isPlaying, audio, muted]);

  // Playback
  useEffect(() => {
    if (!isPlaying || !project) return;
    let raf = 0;
    let last = performance.now();
    if (time.get() >= project.duration - 0.01) time.set(0);
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let t = time.get() + dt;
      if (t >= project.duration) {
        if (loop) { t %= project.duration; if (!audio.muted) audio.play(project, t); }
        else { time.set(project.duration); playing.set(false); return; }
      }
      time.set(t);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, project?.duration, loop, time, playing, audio]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = projectRef.current;
      if (!p) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === 'Space') { e.preventDefault(); playing.set(!playing.get()); }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doc.redo(); else doc.undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doc.redo(); }
      else if (mod && e.key.toLowerCase() === 'd' && selected.length) {
        e.preventDefault();
        const out = applyOps(p, [{ op: 'duplicateLayers', ids: selected }]);
        doc.commit(out.project, 'Duplicate');
        setSelected(out.created);
      } else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelected(p.layers.map((l) => l.id)); }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && selected.length) {
        e.preventDefault();
        doc.commit(applyOps(p, [{ op: 'deleteLayers', ids: selected }]).project, `Delete ${selected.length > 1 ? `${selected.length} layers` : 'layer'}`);
        setSelected([]);
      } else if (e.key === 'Escape') setSelected([]);
      else if (e.key.startsWith('Arrow') && selected.length) {
        e.preventDefault();
        const n = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0;
        const dy = e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0;
        doc.commit({ ...p, layers: p.layers.map((l) => (selected.includes(l.id) && !l.locked ? { ...l, x: l.x + dx, y: l.y + dy, keys: l.keys.map((k) => ({ ...k, x: k.x !== undefined ? k.x + dx : undefined, y: k.y !== undefined ? k.y + dy : undefined })) } : l)) }, 'Nudge', `nudge:${selected.join(',')}`);
      } else if (e.key === 'Home') time.set(0);
      else if (e.key === 'End') time.set(p.duration);
      else if (e.key === ',' || e.key === '.') { const f = 1 / p.fps; time.set(Math.max(0, Math.min(p.duration, time.get() + (e.key === ',' ? -f : f)))); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, doc, playing, time]);

  // Claude announces itself: show the Claude tab the first time it acts.
  const claudeSeen = useRef(false);
  useEffect(() => {
    if (doc.claude && !claudeSeen.current) { claudeSeen.current = true; setLeftTab('claude'); }
  }, [doc.claude]);

  const onEditText = useCallback((lid: string) => {
    setSelected([lid]);
    setTimeout(() => { textRef.current?.focus(); textRef.current?.select(); }, 30);
  }, []);

  async function runExport(scale: number) {
    if (!project) return;
    setExportMenu(false);
    playing.set(false);
    const abort = new AbortController();
    setExporting({ progress: 0, abort });
    try {
      const out = await exportVideo(project, { scale, signal: abort.signal, onProgress: (progress) => setExporting((x) => (x ? { ...x, progress } : x)) });
      if (out) download(out.blob, `${slug(project.name)}.${out.ext}`);
    } catch (e) {
      doc.notify(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(null);
    }
  }

  async function exportPng() {
    if (!project) return;
    setExportMenu(false);
    await images.ready(project);
    const url = await frameToDataUrl(project, time.get(), project.width, images, 'image/png');
    download(await (await fetch(url)).blob(), `${slug(project.name)}-${time.get().toFixed(2)}s.png`);
  }

  if (doc.error) {
    return (
      <div className="loading" style={{ textAlign: 'center' }}>
        <div>
          <h2>Couldn't open this project</h2>
          <p>{doc.error}</p>
          <p className="hint">If the API isn't running, start it with <code>npm run dev</code>.</p>
          <Link className="btn" to="/dashboard">Back to projects</Link>
        </div>
      </div>
    );
  }
  if (!project) return <div className="loading">Loading…</div>;

  const aspect = ASPECTS.find((a) => a.width === project.width && a.height === project.height);

  return (
    <div className="editor">
      <header className="topbar">
        <Link className="btn sm" to="/dashboard"><Icon name="chevronLeft" size={14} /> Projects</Link>
        <input className="name" value={project.name} size={Math.max(8, project.name.length)} onChange={(e) => doc.commit({ ...project, name: e.target.value }, 'Rename project', 'project:name')} />
        <span className="pill hide-md" title={`${project.width}×${project.height}`}>{aspect?.id ?? `${project.width}×${project.height}`}</span>
        <div className="spacer" />
        <button className="icon-btn" title="Undo (⌘Z)" onClick={doc.undo} disabled={doc.history.cursor <= 0}><Icon name="undo" /></button>
        <button className="icon-btn" title="Redo (⇧⌘Z)" onClick={doc.redo} disabled={doc.history.cursor >= doc.history.history.length - 1}><Icon name="redo" /></button>
        <select className="select hide-md" style={{ width: 'auto' }} value={aspect?.id ?? ''} title="Adapt to another format"
          onChange={(e) => { const a = ASPECTS.find((x) => x.id === e.target.value); if (a) doc.commit(resizeProject(project, a.width, a.height), `Adapt to ${a.id}`); }}>
          {!aspect && <option value="">{project.width}×{project.height}</option>}
          {ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <StatusPill projectId={project.id} onGuide={() => setGuide(true)} />
        <ThemeToggle />
        <div style={{ position: 'relative' }}>
          <button className="btn sm candy" onClick={() => setExportMenu(!exportMenu)}><Icon name="export" size={14} /> Export <Icon name="chevronDown" size={14} /></button>
          {exportMenu && (
            <div className="menu" style={{ right: 0, top: 40 }} onMouseLeave={() => setExportMenu(false)}>
              <button onClick={() => runExport(1)}>Video · full size ({project.width}×{project.height})</button>
              <button onClick={() => runExport(0.5)}>Video · half size</button>
              <button onClick={exportPng}>PNG of this frame</button>
              {(project.audio?.length ?? 0) > 0 && <button onClick={async () => { setExportMenu(false); const b = await mixdown(project); if (b) download(toWav(b), `${slug(project.name)}.wav`); }}>Audio only · WAV</button>}
              <button onClick={() => download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${slug(project.name)}.json`)}>Project JSON</button>
            </div>
          )}
        </div>
      </header>

      <div className="workspace">
        <aside className="panel">
          <div className="tabs">
            <button className={leftTab === 'claude' ? 'on' : ''} onClick={() => setLeftTab('claude')}>
              <span className={`live-dot ${status.mcp.length ? 'on' : ''}`} /> Claude
            </button>
            <button className={leftTab === 'layers' ? 'on' : ''} onClick={() => setLeftTab('layers')}><Icon name="layers" size={14} /> Layers</button>
          </div>
          {leftTab === 'claude'
            ? <div className="panel-body"><ClaudePanel project={project} doc={doc} selected={selected} connected={status.mcp.length > 0} onGuide={() => setGuide(true)} /></div>
            : <LayersPanel project={project} selected={selected} onSelect={setSelected} commit={doc.commit} now={time.get} seek={time.set} notify={doc.notify} />}
        </aside>

        <main className="stage-wrap">
          {doc.claude && Date.now() - new Date(doc.claude.at).getTime() < 60000 && (
            <div className="claude-status"><span className="live-dot on" /> {doc.claude.status}</div>
          )}
          <Preview project={project} time={time} images={images} selected={selected} zoom={zoom} onSelect={setSelected}
            preview={doc.preview} commit={doc.commit} onEditText={onEditText} fontsVersion={fontsVersion} />
          <div className="transport">
            <button className="play-btn" onClick={() => playing.set(!isPlaying)} title="Play / pause (Space)"><Icon name={isPlaying ? 'pause' : 'play'} size={16} /></button>
            <TimeReadout time={time} duration={project.duration} />
            <button className={`icon-btn ${loop ? 'on' : ''}`} title="Loop playback" onClick={() => setLoop(!loop)}><Icon name="loop" /></button>
            {(project.audio?.length ?? 0) > 0 && (
              <button className={`btn sm ghost ${muted ? '' : 'on'}`} title="Sound on / off" onClick={() => setMuted(!muted)}>{muted ? 'Sound off' : `Sound · ${project.audio!.length}`}</button>
            )}
            <div style={{ flex: 1 }} />
            <button className="icon-btn" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.05, (z === 'fit' ? 0.5 : z) / 1.25))}><Icon name="zoomOut" /></button>
            <button className="btn sm ghost" onClick={() => setZoom('fit')} style={{ minWidth: 56 }}>{zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}</button>
            <button className="icon-btn" title="Zoom in" onClick={() => setZoom((z) => Math.min(4, (z === 'fit' ? 0.5 : z) * 1.25))}><Icon name="zoomIn" /></button>
          </div>
        </main>

        <aside className="panel right">
          <div className="panel-head"><h3>{selected.length ? 'Layer' : 'Project'}</h3></div>
          <div className="panel-body">
            <Inspector project={project} selected={selected} commit={doc.commit} now={time.get} textRef={textRef} />
          </div>
        </aside>
      </div>

      <Timeline project={project} time={time} selected={selected} onSelect={setSelected} preview={doc.preview} commit={doc.commit}
        pxPerSec={pxPerSec} setPxPerSec={setPxPerSec} snap={snap} setSnap={setSnap} />

      {exporting && (
        <div className="modal-back">
          <div className="modal">
            <h2>Exporting video…</h2>
            <p className="muted">Recording in real time, so this takes about {Math.ceil(project.duration)} seconds. Keep this tab in front.</p>
            <div className="progress"><div style={{ width: `${exporting.progress * 100}%` }} /></div>
            <div className="modal-actions"><button className="btn" onClick={() => exporting.abort.abort()}>Cancel</button></div>
          </div>
        </div>
      )}
      {guide && <ConnectGuide onClose={() => setGuide(false)} />}
      {doc.toast && <div className="toast">{doc.toast}</div>}
    </div>
  );
}
