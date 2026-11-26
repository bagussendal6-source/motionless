// Pure, deterministic animation maths shared by the renderer, the linter and the motion analyser.
// No DOM here: it runs in the browser and in Node.
import type { CameraKey, EaseName, Keyframe, KeyValues, Layer, Motion, Project } from './types.ts';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

function underdamped(p: number, zeta: number, w0: number) {
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w0 * p) * (Math.cos(wd * p) + ((zeta * w0) / wd) * Math.sin(wd * p));
}

export function ease(name: EaseName | undefined, p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  switch (name) {
    case 'linear': return p;
    case 'easeOut': return 1 - (1 - p) ** 3;
    case 'easeInOut': return p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
    case 'snap': return 1 - (1 - p) ** 5;
    case 'smooth': { const w = 8; return (1 - (1 + w * p) * Math.exp(-w * p)) / 0.997; }
    case 'bouncy': return underdamped(p, 0.3, 16);
    case 'spring':
    default: return underdamped(p, 0.5, 13);
  }
}

// ---------- colours ----------
type RGBA = [number, number, number, number];
const colorCache = new Map<string, RGBA>();
export function parseColor(c: string): RGBA {
  const hit = colorCache.get(c);
  if (hit) return hit;
  let out: RGBA = [0, 0, 0, 1];
  const s = c.trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16);
    out = [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      out = [r, g, b, a ?? 1];
    } else if (s === 'transparent') out = [0, 0, 0, 0];
  }
  colorCache.set(c, out);
  return out;
}
function mixColor(a: string, b: string, p: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  return `rgba(${Math.round(lerp(x[0], y[0], p))},${Math.round(lerp(x[1], y[1], p))},${Math.round(lerp(x[2], y[2], p))},${lerp(x[3], y[3], p).toFixed(3)})`;
}

// ---------- keyframes ----------
const NUM_KEYS = ['x', 'y', 'scale', 'rotation', 'opacity', 'width', 'height', 'sx', 'sy', 'strokeWidth'] as const;

function sampleKeys<K extends keyof KeyValues>(keys: (Keyframe | CameraKey)[], prop: K, t: number): KeyValues[K] | undefined {
  let prev: (Keyframe | CameraKey) | undefined;
  for (const k of keys) {
    const v = (k as KeyValues)[prop];
    if (v === undefined || v === null) continue;
    if (k.t <= t) { prev = k; continue; }
    if (!prev) return v;
    const p = ease(k.ease ?? 'smooth', (t - prev.t) / (k.t - prev.t || 1));
    const a = (prev as KeyValues)[prop];
    if (typeof v === 'number') return lerp(a as number, v, p) as KeyValues[K];
    return mixColor(a as string, v as string, clamp01(p)) as KeyValues[K];
  }
  return prev ? (prev as KeyValues)[prop] : undefined;
}

// ---------- layer state ----------
export interface GlyphFx { dy: number; dx: number; opacity: number; scale: number }
export interface LayerState {
  x: number; y: number; width: number; height: number;
  rotation: number; scale: number; scaleX: number; scaleY: number;
  opacity: number; blur: number; brightness: number; fill: string;
  stroke: string | undefined; strokeWidth: number;
  clip: number;
  /** Fraction of characters shown (typewriter). */
  reveal: number;
  glyph?: { unit: 'letters' | 'words'; fx: (i: number, n: number) => GlyphFx };
}

export function glyphUnits(layer: Layer): number {
  const text = (layer.text ?? '').replace(/\n/g, ' ');
  return layer.enter.preset === 'words' || layer.exit.preset === 'words'
    ? text.split(/\s+/).filter(Boolean).length
    : text.replace(/\s/g, '').length;
}

function motionWindow(m: Motion, layer: Layer): number {
  if (m.preset === 'none') return 0;
  if (m.preset === 'letters' || m.preset === 'words') {
    const n = Math.max(1, glyphUnits(layer));
    return m.duration + (m.stagger ?? 0.03) * (n - 1);
  }
  return m.duration;
}

function applyMotion(s: LayerState, m: Motion, elapsed: number, layer: Layer, exit: boolean) {
  const raw = clamp01(elapsed / (m.duration || 0.0001));
  const q = ease(m.ease, raw);
  const inv = 1 - q;
  const dir = exit ? -1 : 1;
  // `from` lifts the starting strength off zero so frame 0 is never empty.
  const lo = Math.max(0, Math.min(0.95, m.from ?? 0));
  const up = (v: number) => lo + (1 - lo) * v;
  switch (m.preset) {
    case 'fade': s.opacity *= up(raw); break;
    case 'rise': s.y += inv * (m.distance ?? 140) * (exit ? -0.6 : 1); s.opacity *= up(clamp01(raw * 2.5)); break;
    case 'drop': s.y -= inv * (m.distance ?? 140); s.opacity *= up(clamp01(raw * 2.5)); break;
    case 'slideLeft': s.x += inv * (m.distance ?? 420) * dir; s.opacity *= up(clamp01(raw * 2.5)); break;
    case 'slideRight': s.x -= inv * (m.distance ?? 420) * dir; s.opacity *= up(clamp01(raw * 2.5)); break;
    case 'pop': s.scale *= up(Math.max(0, q)); s.opacity *= up(clamp01(raw * 5)); break;
    case 'zoom': s.scale *= 1 + inv * 0.9; s.opacity *= up(raw); break;
    case 'spin': s.rotation += inv * -180 * dir; s.scale *= up(Math.max(0, q)); s.opacity *= up(clamp01(raw * 4)); break;
    case 'blur': s.blur += Math.max(0, inv) * 36; s.opacity *= up(clamp01(raw * 2)); break;
    case 'wipe': s.clip = Math.min(s.clip, Math.max(0, q)); break;
    case 'flip': s.scaleY *= Math.max(0.001, q); s.brightness *= 0.6 + 0.4 * raw; break;
    case 'typewriter': s.reveal = Math.min(s.reveal, up(raw)); break;
    case 'letters':
    case 'words': {
      const stagger = m.stagger ?? (m.preset === 'words' ? 0.08 : 0.03);
      const dist = m.distance ?? (layer.fontSize ?? 100) * 0.7;
      const prev = s.glyph?.fx;
      s.glyph = {
        unit: m.preset,
        fx: (i, n) => {
          const order = exit ? n - 1 - i : i;
          const local = clamp01((elapsed - order * stagger) / (m.duration || 0.0001));
          const g = ease(m.ease, local);
          const base = prev ? prev(i, n) : { dx: 0, dy: 0, opacity: 1, scale: 1 };
          return m.preset === 'letters'
            ? { dx: base.dx, dy: base.dy + (1 - g) * dist * (exit ? -0.5 : 1), opacity: base.opacity * up(clamp01(local * 3)), scale: base.scale }
            : { dx: base.dx, dy: base.dy + (1 - g) * dist * 0.4, opacity: base.opacity * up(clamp01(local * 4)), scale: base.scale * Math.max(0, 0.4 + 0.6 * g) };
        },
      };
      break;
    }
  }
}

export function layerState(layer: Layer, t: number): LayerState {
  const s: LayerState = {
    x: layer.x, y: layer.y, width: layer.width, height: layer.height,
    rotation: layer.rotation, scale: layer.scale, scaleX: 1, scaleY: 1,
    opacity: layer.opacity, blur: 0, brightness: 1, fill: layer.fill,
    stroke: layer.stroke, strokeWidth: layer.strokeWidth ?? 0,
    clip: 1, reveal: 1,
  };
  if (layer.keys.length) {
    for (const k of NUM_KEYS) {
      const v = sampleKeys(layer.keys, k, t);
      if (v === undefined) continue;
      if (k === 'sx') s.scaleX = v as number;
      else if (k === 'sy') s.scaleY = v as number;
      else (s as unknown as Record<string, number>)[k] = v as number;
    }
    const f = sampleKeys(layer.keys, 'fill', t);
    if (f !== undefined) s.fill = f;
    const sc = sampleKeys(layer.keys, 'stroke', t);
    if (sc !== undefined) s.stroke = sc;
  }
  const inWin = motionWindow(layer.enter, layer);
  if (inWin > 0 && t < layer.start + inWin) applyMotion(s, layer.enter, t - layer.start, layer, false);
  const outWin = motionWindow(layer.exit, layer);
  if (outWin > 0 && t > layer.end - outWin) applyMotion(s, layer.exit, layer.end - t, layer, true);

  const lp = layer.loop;
  if (lp.preset !== 'none' && lp.period > 0) {
    const local = t - layer.start;
    const ph = (local / lp.period) * Math.PI * 2;
    const a = lp.amount;
    switch (lp.preset) {
      case 'float': s.y += Math.sin(ph) * a * 24; break;
      case 'pulse': s.scale *= 1 + a * 0.08 * Math.sin(ph); break;
      case 'wiggle': s.rotation += Math.sin(ph) * a * 7; break;
      case 'spin': s.rotation += (local / lp.period) * 360; break;
      case 'breathe': s.opacity *= 1 - a * 0.45 * (0.5 + 0.5 * Math.sin(ph)); break;
      case 'shimmer': s.brightness *= 1 + a * 0.6 * Math.max(0, Math.sin(ph)) ** 6; break;
    }
  }
  return s;
}

export interface CameraState { x: number; y: number; zoom: number; rotation: number }
export function cameraAt(project: Project, t: number): CameraState {
  const c: CameraState = { x: project.width / 2, y: project.height / 2, zoom: 1, rotation: 0 };
  if (!project.camera?.length) return c;
  const keys = project.camera;
  const pick = (prop: 'x' | 'y' | 'zoom' | 'rotation') => {
    let prev: CameraKey | undefined;
    for (const k of keys) {
      const v = k[prop];
      if (v === undefined) continue;
      if (k.t <= t) { prev = k; continue; }
      if (!prev) return v;
      return lerp(prev[prop]!, v, ease(k.ease ?? 'smooth', (t - prev.t) / (k.t - prev.t || 1)));
    }
    return prev?.[prop];
  };
  c.x = pick('x') ?? c.x;
  c.y = pick('y') ?? c.y;
  c.zoom = pick('zoom') ?? 1;
  c.rotation = pick('rotation') ?? 0;
  return c;
}


export function isVisibleAt(layer: Layer, t: number) {
  return !layer.hidden && t >= layer.start && t < layer.end;
}

// ---------- parenting ----------
/** 2D affine matrix [a, b, c, d, e, f], same layout as CanvasRenderingContext2D.transform. */
export type Mat = [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
export const matMul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export function matInv(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
export const matApply = (m: Mat, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** Layer transform: translate to x/y, then rotate and scale about the pivot. */
export function layerMatrix(l: Pick<Layer, 'pivot'>, s: Pick<LayerState, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'scale' | 'scaleX' | 'scaleY'>): Mat {
  const px = (l.pivot?.x ?? 0) * s.width, py = (l.pivot?.y ?? 0) * s.height;
  const r = (s.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const sx = s.scale * s.scaleX, sy = s.scale * s.scaleY;
  const lin: Mat = [cos * sx, sin * sx, -sin * sy, cos * sy, 0, 0];
  return matMul(matMul([1, 0, 0, 1, s.x + px, s.y + py], lin), [1, 0, 0, 1, -px, -py]);
}

/** How far the ancestors have carried a child away from where it is authored (rest pose). */
export function parentDelta(project: Pick<Project, 'layers'>, layer: Layer, t: number, depth = 0): { m: Mat; opacity: number } | null {
  if (!layer.parent || depth > 8) return null;
  const par = project.layers.find((l) => l.id === layer.parent);
  if (!par || par.id === layer.id) return null;
  const cur = layerState(par, t);
  const rest = { x: par.x, y: par.y, width: par.width, height: par.height, rotation: par.rotation, scale: par.scale, scaleX: 1, scaleY: 1 };
  const own = matMul(layerMatrix(par, cur), matInv(layerMatrix(par, rest)));
  const up = parentDelta(project, par, t, depth + 1);
  const fade = Math.min(1, cur.opacity / (par.opacity || 1));
  return up ? { m: matMul(up.m, own), opacity: up.opacity * fade } : { m: own, opacity: fade };
}
