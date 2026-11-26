// Numeric motion review. A still frame shows where things are; this shows how they got there:
// overshoot, settle time, bounces, speed and hard jumps, from the same maths the renderer uses.
import { cameraAt, layerState } from './motion.ts';
import type { Layer, Project } from './types.ts';

type Prop = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'sx' | 'sy' | 'zoom';
const PROPS: Prop[] = ['x', 'y', 'scale', 'rotation', 'opacity'];
const UNIT: Record<Prop, string> = { x: 'px', y: 'px', scale: '×', rotation: '°', opacity: '', sx: '×', sy: '×', zoom: '×' };
const TINY: Record<Prop, number> = { x: 1.5, y: 1.5, scale: 0.02, rotation: 0.5, opacity: 0.02, sx: 0.02, sy: 0.02, zoom: 0.01 };
const SPARK = '▁▂▃▄▅▆▇█';

export interface AnalyzeOptions {
  layerIds?: string[];
  /** Also review the camera path. */
  camera?: boolean;
  /** Print every segment. Default: only flagged ones plus a count of the clean ones. */
  verbose?: boolean;
  /** Print raw samples (every frame) for the selected layers. */
  samples?: boolean;
  /** Limit the review to a time range. */
  from?: number;
  to?: number;
}

interface Segment { label: string; from: number; to: number }

function segmentsOf(l: Layer, p: Project): Segment[] {
  const segs: Segment[] = [];
  if (l.enter.preset !== 'none') {
    const n = ['letters', 'words'].includes(l.enter.preset) ? 8 : 0;
    // Stop before the exit begins: a short-lived layer must not have its fade-out read as part of its entrance.
    const exitAt = l.exit.preset === 'none' ? Infinity : l.end - l.exit.duration;
    segs.push({ label: `enter ${l.enter.preset}`, from: l.start, to: Math.min(l.start + l.enter.duration + (l.enter.stagger ?? 0.03) * n + 0.35, exitAt) });
  }
  const ks = [...l.keys].sort((a, b) => a.t - b.t);
  for (let i = 1; i < ks.length; i++) segs.push({ label: `keys ${ks[i - 1].t.toFixed(2)}→${ks[i].t.toFixed(2)}${ks[i].ease ? ` ${ks[i].ease}` : ''}`, from: ks[i - 1].t, to: ks[i].t });
  if (l.exit.preset !== 'none') segs.push({ label: `exit ${l.exit.preset}`, from: Math.max(l.start, l.end - l.exit.duration - 0.1), to: l.end });
  return segs.map((s) => ({ ...s, to: Math.min(s.to, p.duration, l.end > l.start ? Math.max(l.end, s.from + 0.05) : s.to) })).filter((s) => s.to > s.from + 0.04);
}

function spark(vs: number[]): string {
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const step = Math.max(1, Math.ceil(vs.length / 28));
  const pick = vs.filter((_, i) => i % step === 0 || i === vs.length - 1);
  if (hi - lo < 1e-9) return SPARK[0].repeat(pick.length);
  return pick.map((v) => SPARK[Math.min(7, Math.floor(((v - lo) / (hi - lo)) * 7.999))]).join('');
}

const fmt = (prop: Prop, v: number) => (Math.abs(v) >= 100 || prop === 'x' || prop === 'y' ? Math.round(v).toString() : v.toFixed(2).replace(/\.?0+$/, '')) + UNIT[prop];

/** One-line verdict for a sampled series, or null when the property barely moves. */
function describe(prop: Prop, vs: number[], dt: number): string | null {
  const span = (vs.length - 1) * dt;
  const a = vs[0], b = vs[vs.length - 1];
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const tiny = TINY[prop];
  if (hi - lo < tiny) return null;
  const travel = Math.abs(b - a);
  const out: string[] = [];
  let peakStep = 0;
  for (let i = 1; i < vs.length; i++) peakStep = Math.max(peakStep, Math.abs(vs[i] - vs[i - 1]));
  if (travel < tiny * 2) {
    out.push(`out-and-back, peak ${fmt(prop, hi - lo)} from rest`);
  } else {
    const dir = b >= a ? 1 : -1;
    const over = dir > 0 ? hi - b : b - lo;
    const pre = dir > 0 ? a - lo : hi - a;
    const band = Math.max(travel * 0.02, tiny * 0.5);
    let settleIdx = 0;
    vs.forEach((v, i) => { if (Math.abs(v - b) > band) settleIdx = i + 1; });
    // Direction reversals that are bigger than the noise floor = visible bounces.
    let bounces = 0, last = 0;
    for (let i = 1; i < vs.length; i++) {
      const d = vs[i] - vs[i - 1];
      if (Math.abs(d) < tiny * 0.05) continue;
      const s = Math.sign(d);
      if (last && s !== last) bounces++;
      last = s;
    }
    out.push(`${fmt(prop, a)}→${fmt(prop, b)}`);
    out.push(over > travel * 0.01 ? `overshoot ${Math.round((over / travel) * 100)}%` : 'no overshoot');
    if (pre > travel * 0.03) out.push(`anticipation ${Math.round((pre / travel) * 100)}%`);
    out.push(`settles in ${(settleIdx * dt).toFixed(2)}s`);
    if (bounces > 1) out.push(`${bounces} reversals`);
    const over25 = over / travel > 0.25;
    const verdicts: string[] = [];
    if (peakStep > travel * 0.6 && travel > tiny * 4) verdicts.push('HARD JUMP: most of the move lands in one frame (reads as a cut, not motion)');
    else if (over25) verdicts.push('very bouncy');
    else if (settleIdx * dt > Math.max(1.2, span * 0.9)) verdicts.push('slow to settle (long tail after the move)');
    else if (prop !== 'opacity' && over / travel < 0.01 && settleIdx * dt < 0.2 && travel > tiny * 10) verdicts.push('abrupt (no ease-out)');
    if (bounces >= 5) verdicts.push('jittery: many small reversals');
    out.push(`peak ${fmt(prop, peakStep / dt).replace(UNIT[prop], '')}${UNIT[prop]}/s`);
    if (verdicts.length) out.push(`⚠ ${verdicts.join('; ')}`);
  }
  return `${out.join(' · ')}  ${spark(vs)}`;
}

export function analyzeMotion(p: Project, o: AnalyzeOptions = {}): string {
  const dt = 1 / p.fps;
  const lines: string[] = [];
  const ids = o.layerIds ? new Set(o.layerIds) : null;
  const layers = p.layers.filter((l) => !l.hidden && (!ids || ids.has(l.id)));
  const lo = o.from ?? 0, hi = o.to ?? p.duration;
  let flagged = 0;
  let clean = 0;
  for (const l of layers) {
    const segs = segmentsOf(l, p).filter((s) => s.to > lo && s.from < hi);
    const block: string[] = [];
    for (const seg of segs) {
      const from = Math.max(seg.from, lo), to = Math.min(seg.to, hi);
      const n = Math.max(2, Math.round((to - from) / dt) + 1);
      // Loops are a steady wobble, not part of the move being judged: leave them out here.
      const still = { ...l, loop: { ...l.loop, preset: 'none' as const } };
      const states = Array.from({ length: n }, (_, i) => layerState(still, Math.min(to, from + i * dt)));
      const series: Record<Prop, number[]> = {
        x: states.map((s) => s.x), y: states.map((s) => s.y), scale: states.map((s) => s.scale), rotation: states.map((s) => s.rotation),
        opacity: states.map((s) => s.opacity), sx: states.map((s) => s.scaleX), sy: states.map((s) => s.scaleY), zoom: [],
      };
      const props: Prop[] = [...PROPS, 'sx', 'sy'];
      for (const prop of props) {
        const d = describe(prop, series[prop], dt);
        if (d) { block.push(`    ${seg.label} · ${prop} ${d}`); if (d.includes('⚠')) flagged++; }
      }
    }
    const shown = o.verbose ? block : block.filter((b) => b.includes('⚠'));
    clean += block.length - shown.length;
    if (shown.length) lines.push(`  ${l.name} (${l.id}) ${l.start.toFixed(2)}–${l.end.toFixed(2)}s`, ...shown);
    if (o.samples && ids) {
      const n = Math.max(2, Math.round((Math.min(l.end, hi) - Math.max(l.start, lo)) / dt));
      lines.push(`    samples (t: x, y, scale, rot, opacity):`);
      for (let i = 0; i <= n; i++) {
        const t = Math.max(l.start, lo) + i * dt;
        const s = layerState(l, t);
        lines.push(`      ${t.toFixed(3)}: ${s.x.toFixed(1)}, ${s.y.toFixed(1)}, ${(s.scale * s.scaleX).toFixed(3)}/${(s.scale * s.scaleY).toFixed(3)}, ${s.rotation.toFixed(1)}, ${s.opacity.toFixed(2)}`);
      }
    }
  }
  if (o.camera && p.camera.length) {
    const ks = [...p.camera].sort((a, b) => a.t - b.t);
    for (let i = 1; i < ks.length; i++) {
      const from = Math.max(ks[i - 1].t, lo), to = Math.min(ks[i].t, hi, p.duration);
      if (to <= from) continue;
      const n = Math.max(2, Math.round((to - from) / dt) + 1);
      const cs = Array.from({ length: n }, (_, k) => cameraAt(p, Math.min(to, from + k * dt)));
      const rows: [string, number[], Prop][] = [['x', cs.map((c) => c.x), 'x'], ['y', cs.map((c) => c.y), 'y'], ['zoom', cs.map((c) => c.zoom), 'zoom'], ['rotation', cs.map((c) => c.rotation), 'rotation']];
      for (const [name, vs, prop] of rows) {
        const d = describe(prop, vs, dt);
        if (d) { const row = `  camera ${ks[i - 1].t.toFixed(2)}→${ks[i].t.toFixed(2)} · ${name} ${d}`; if (d.includes('⚠')) flagged++; if (o.verbose || d.includes('⚠')) lines.push(row); else clean++; }
      }
    }
  }
  if (!lines.length && !clean) return 'No animated segments found in that range (enter/exit presets and keyframes are what get reviewed).';
  return [`Motion review at ${p.fps} fps (own motion only, loops excluded; a parent's movement is not included). ${flagged} flagged, ${clean} clean segments${o.verbose ? '' : ' hidden (verbose: true shows them)'}.`, ...lines].join('\n');
}
