import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../shared/types.ts';
import { ImageCache, renderFrame } from '../lib/engine.ts';
import { loadProjectFonts } from '../lib/store.ts';

/** A looping, self-playing canvas for a project. Pauses when scrolled out of view. */
export function Player({ project, className, onTime, paused }: { project: Project; className?: string; onTime?: (t: number) => void; paused?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(true);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.05 });
    if (wrap.current) io.observe(wrap.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext('2d')!;
    const images = new ImageCache();
    let raf = 0;
    let start = performance.now();
    let fontsReady = false;
    loadProjectFonts(project.layers.map((l) => l.font ?? 'Inter')).then(() => { fontsReady = true; start = performance.now(); });
    const size = () => {
      const w = wrap.current!.clientWidth;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      el.width = Math.round(w * dpr);
      el.height = Math.round((w * project.height / project.width) * dpr);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(wrap.current!);
    const draw = (now: number) => {
      const t = fontsReady ? ((now - start) / 1000) % project.duration : 0;
      renderFrame(ctx, project, t, { scale: el.width / project.width, images });
      onTimeRef.current?.(t);
      if (visible && !paused) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [project, visible, paused]);

  return (
    <div ref={wrap} className={className} style={{ aspectRatio: `${project.width} / ${project.height}` }}>
      <canvas ref={canvas} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
