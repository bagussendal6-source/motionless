import { useRef } from 'react';
import type { Layer, Project } from '../../shared/types.ts';
import { beat, fmtTime, glyphUnits, snapToBeat } from '../lib/engine.ts';
import { useSignal, type Signal } from '../lib/store.ts';
import { Icon } from '../components/ui.tsx';

interface Props {
  project: Project;
  time: Signal<number>;
  selected: string[];
  onSelect: (ids: string[]) => void;
  preview: (p: Project) => void;
  commit: (p: Project, label: string, coalesce?: string) => void;
  pxPerSec: number;
  setPxPerSec: (n: number) => void;
  snap: boolean;
  setSnap: (b: boolean) => void;
}

const ROW = 26;

function Playhead({ time, pxPerSec }: { time: Signal<number>; pxPerSec: number }) {
  const t = useSignal(time);
  return <div className="tl-playhead" style={{ left: t * pxPerSec }} />;
}

function motionWidth(l: Layer, which: 'enter' | 'exit') {
  const m = l[which];
  if (m.preset === 'none') return 0;
  if (m.preset === 'letters' || m.preset === 'words') return m.duration + (m.stagger ?? (m.preset === 'words' ? 0.08 : 0.03)) * Math.max(0, glyphUnits(l) - 1);
  return m.duration;
}

export function Timeline({ project, time, selected, onSelect, preview, commit, pxPerSec, setPxPerSec, snap, setSnap }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const width = Math.max(project.duration * pxPerSec + 80, 400);
  const rows = [...project.layers].reverse();
  const b = beat(project.bpm);

  function timeAt(clientX: number) {
    const r = scroller.current!.getBoundingClientRect();
    return Math.max(0, Math.min(project.duration, (clientX - r.left + scroller.current!.scrollLeft) / pxPerSec));
  }

  function scrub(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const move = (x: number, shift: boolean) => time.set(snap && !shift ? Math.min(project.duration, snapToBeat(timeAt(x), project.bpm, 4)) : timeAt(x));
    move(e.clientX, e.altKey);
    const el = e.currentTarget as HTMLElement;
    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.altKey);
    const onUp = () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }

  function barDown(e: React.PointerEvent, layer: Layer, mode: 'move' | 'l' | 'r') {
    e.stopPropagation();
    if (e.button !== 0) return;
    const ids = e.shiftKey
      ? (selected.includes(layer.id) ? selected.filter((x) => x !== layer.id) : [...selected, layer.id])
      : selected.includes(layer.id) ? selected : [layer.id];
    onSelect(ids);
    if (layer.locked) return;
    const moving = mode === 'move' ? ids : [layer.id];
    const base = project;
    const x0 = e.clientX;
    let moved = false;
    let next = base;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      let dt = (ev.clientX - x0) / pxPerSec;
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      const doSnap = snap && !ev.altKey;
      if (doSnap) {
        const anchor = mode === 'r' ? layer.end : layer.start;
        dt = snapToBeat(anchor + dt, project.bpm, 2) - anchor;
      }
      next = {
        ...base,
        layers: base.layers.map((l) => {
          if (!moving.includes(l.id)) return l;
          if (mode === 'move') return { ...l, start: l.start + dt, end: l.end + dt, keys: l.keys.map((k) => ({ ...k, t: k.t + dt })) };
          if (mode === 'l') return { ...l, start: Math.min(l.end - 0.1, Math.max(0, l.start + dt)) };
          return { ...l, end: Math.max(l.start + 0.1, l.end + dt) };
        }),
      };
      preview(next);
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      if (moved) commit(next, mode === 'move' ? `Retime ${moving.length > 1 ? `${moving.length} layers` : layer.name}` : `Trim ${layer.name}`);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }

  const ticks: React.ReactNode[] = [];
  const step = pxPerSec >= 120 ? 0.5 : pxPerSec >= 50 ? 1 : pxPerSec >= 25 ? 2 : 5;
  for (let s = 0; s <= project.duration + 1e-6; s += step) {
    ticks.push(<div key={s} className={`tick ${s % 1 ? 'minor' : ''}`} style={{ left: s * pxPerSec }}>{s % 1 ? '' : `${s}s`}</div>);
  }
  const beats: React.ReactNode[] = [];
  if (b * pxPerSec >= 10) for (let s = b, i = 1; s < project.duration; s += b, i++) beats.push(<div key={i} className="tl-beat" style={{ left: s * pxPerSec, opacity: i % 4 ? 0.5 : 1 }} />);

  return (
    <div className="timeline">
      <div className="tl-tools">
        <span className="pill">{fmtTime(project.duration)} · {project.bpm} BPM</span>
        <button className={`icon-btn ${snap ? 'on' : ''}`} title="Snap to beat (hold Alt to bypass)" onClick={() => setSnap(!snap)}><Icon name="magnet" /></button>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title="Zoom out" onClick={() => setPxPerSec(Math.max(12, pxPerSec / 1.4))}><Icon name="zoomOut" /></button>
        <input type="range" min={12} max={400} value={pxPerSec} onChange={(e) => setPxPerSec(Number(e.target.value))} style={{ width: 110 }} aria-label="Timeline zoom" />
        <button className="icon-btn" title="Zoom in" onClick={() => setPxPerSec(Math.min(400, pxPerSec * 1.4))}><Icon name="zoomIn" /></button>
        <button className="btn sm ghost" onClick={() => setPxPerSec(Math.max(12, (scroller.current!.clientWidth - 40) / project.duration))}>Fit</button>
      </div>
      <div className="tl-scroll" ref={scroller}>
        <div className="tl-inner" style={{ width }}>
          <div className="tl-ruler" onPointerDown={scrub}>{ticks}</div>
          {beats}
          <div className="tl-row sections" onPointerDown={scrub}>
            {project.sections.map((s) => (
              <div key={s.id} className="tl-sec" title={`${s.name} · ${fmtTime(s.start)}–${fmtTime(s.end)}`}
                style={{ left: s.start * pxPerSec + 1, width: Math.max(4, (s.end - s.start) * pxPerSec - 2), background: s.color }}
                onPointerDown={(e) => { e.stopPropagation(); time.set(s.start); }}>
                {s.name}
              </div>
            ))}
          </div>
          {project.camera.length > 0 && (
            <div className="tl-row" title="Camera keyframes" style={{ height: 18 }}>
              {project.camera.map((k, i) => <div key={i} className="cam-key" style={{ left: k.t * pxPerSec }} title={`Camera @ ${k.t.toFixed(2)}s`} />)}
            </div>
          )}
          {rows.map((l) => {
            const inW = motionWidth(l, 'enter'), outW = motionWidth(l, 'exit');
            const dur = l.end - l.start;
            return (
              <div className="tl-row" key={l.id} style={{ height: ROW }}>
                <div
                  className={`tl-bar ${selected.includes(l.id) ? 'sel' : ''} ${l.hidden ? 'hidden' : ''}`}
                  style={{ left: l.start * pxPerSec, width: Math.max(6, dur * pxPerSec) }}
                  onPointerDown={(e) => barDown(e, l, 'move')}
                  onDoubleClick={() => time.set(l.start)}
                  title={`${l.name} · ${fmtTime(l.start)}–${fmtTime(l.end)}`}
                >
                  {inW > 0 && <div className="mo" style={{ left: 0, width: Math.min(dur, inW) * pxPerSec }} />}
                  {outW > 0 && <div className="mo" style={{ right: 0, width: Math.min(dur, outW) * pxPerSec }} />}
                  {l.keys.map((k, i) => <div key={i} className="k" style={{ left: (k.t - l.start) * pxPerSec }} />)}
                  <span className="lbl">{l.name}</span>
                  <div className="h l" onPointerDown={(e) => barDown(e, l, 'l')} />
                  <div className="h r" onPointerDown={(e) => barDown(e, l, 'r')} />
                </div>
              </div>
            );
          })}
          {!rows.length && <div className="empty">No layers yet. Add one from the Layers panel, or ask Claude.</div>}
          <Playhead time={time} pxPerSec={pxPerSec} />
        </div>
      </div>
    </div>
  );
}
