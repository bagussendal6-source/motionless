import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Project } from '../../shared/types.ts';
import { cameraAt, hitTest, ImageCache, layerCorners, renderFrame } from '../lib/engine.ts';
import { useSignal, type Signal } from '../lib/store.ts';

interface Props {
  project: Project;
  time: Signal<number>;
  images: ImageCache;
  selected: string[];
  zoom: number | 'fit';
  onSelect: (ids: string[]) => void;
  preview: (p: Project) => void;
  commit: (p: Project, label: string) => void;
  onEditText: (id: string) => void;
  fontsVersion: number;
}

function Selection({ project, time, selected, scale }: { project: Project; time: Signal<number>; selected: string[]; scale: number }) {
  const t = useSignal(time);
  return (
    <>
      {project.layers.filter((l) => selected.includes(l.id)).map((l) => {
        const visible = !l.hidden && t >= l.start && t < l.end;
        const pts = layerCorners(project, l, t).map((p) => `${p.x * scale},${p.y * scale}`).join(' ');
        return (
          <g key={l.id} opacity={visible ? 1 : 0.35}>
            <polygon points={pts} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray={visible ? undefined : '4 4'} />
            {layerCorners(project, l, t).map((p, i) => (
              <rect key={i} x={p.x * scale - 4} y={p.y * scale - 4} width={8} height={8} rx={2} fill="var(--bg)" stroke="var(--accent)" strokeWidth={1.5} />
            ))}
          </g>
        );
      })}
    </>
  );
}

export function Preview({ project, time, images, selected, zoom, onSelect, preview, commit, onEditText, fontsVersion }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 450 });
  const projectRef = useRef(project);
  projectRef.current = project;

  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);

  const fit = Math.max(0.05, Math.min((size.w - 48) / project.width, (size.h - 48) / project.height));
  const scale = zoom === 'fit' ? fit : zoom;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = Math.round(project.width * scale);
  const ch = Math.round(project.height * scale);

  useEffect(() => {
    const el = canvas.current!;
    el.width = Math.round(cw * dpr);
    el.height = Math.round(ch * dpr);
    const ctx = el.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => renderFrame(ctx, projectRef.current, time.get(), { scale: scale * dpr, images }));
    };
    draw();
    images.onLoad = draw;
    const off = time.subscribe(draw);
    return () => { off(); cancelAnimationFrame(raf); images.onLoad = null; };
  }, [project, cw, ch, dpr, scale, time, images, fontsVersion]);

  const drag = useRef<{ x: number; y: number; base: Project; ids: string[]; moved: boolean; latest?: Project } | null>(null);

  function toStage(e: React.PointerEvent) {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const p = toStage(e);
    const hit = hitTest(project, time.get(), p);
    if (!hit) { onSelect([]); return; }
    let ids = selected;
    if (e.shiftKey) ids = selected.includes(hit.id) ? selected.filter((x) => x !== hit.id) : [...selected, hit.id];
    else if (!selected.includes(hit.id)) ids = [hit.id];
    onSelect(ids);
    drag.current = { x: p.x, y: p.y, base: project, ids: ids.filter((id) => !project.layers.find((l) => l.id === id)?.locked), moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = toStage(e);
    const zoomC = cameraAt(d.base, time.get()).zoom || 1;
    let dx = (p.x - d.x) / zoomC, dy = (p.y - d.y) / zoomC;
    if (!d.moved && Math.hypot(dx, dy) * scale < 3) return;
    d.moved = true;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    dx = Math.round(dx); dy = Math.round(dy);
    d.latest = {
      ...d.base,
      layers: d.base.layers.map((l) => d.ids.includes(l.id)
        ? { ...l, x: l.x + dx, y: l.y + dy, keys: l.keys.map((k) => ({ ...k, x: k.x !== undefined ? k.x + dx : undefined, y: k.y !== undefined ? k.y + dy : undefined })) }
        : l),
    };
    preview(d.latest);
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && d.latest) {
      const names = d.base.layers.filter((l) => d.ids.includes(l.id)).map((l) => l.name);
      commit(d.latest, `Move ${names.length === 1 ? names[0] : `${names.length} layers`}`);
    }
  }

  function onDoubleClick(e: React.MouseEvent) {
    const r = canvas.current!.getBoundingClientRect();
    const hit = hitTest(project, time.get(), { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale });
    if (hit?.type === 'text') onEditText(hit.id);
  }

  return (
    <div className="stage" ref={box} onPointerDown={(e) => { if (e.target === box.current) onSelect([]); }}>
      <div
        style={{ position: 'relative', width: cw, height: ch, flex: 'none', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <canvas ref={canvas} style={{ width: cw, height: ch }} />
        <svg className="overlay" width={cw} height={ch} style={{ overflow: 'visible' }}>
          <Selection project={project} time={time} selected={selected} scale={scale} />
        </svg>
      </div>
    </div>
  );
}
