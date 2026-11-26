// Pure, deterministic renderer: (project, time) -> pixels. Preview, scrubbing,
// thumbnails, render_frames and video export all go through renderFrame.
import type { Layer, Project } from '../../shared/types.ts';
import { cameraAt, isVisibleAt, layerMatrix, layerState, matApply, matMul, parentDelta, type LayerState } from '../../shared/motion.ts';
export * from '../../shared/motion.ts';


// ---------- text layout ----------
interface Line { text: string; width: number; xs: number[] }
const measureCache = new Map<string, number>();
function measure(ctx: CanvasRenderingContext2D, font: string, s: string) {
  const key = font + '\u0000' + s;
  let w = measureCache.get(key);
  if (w === undefined) {
    w = ctx.measureText(s).width;
    if (measureCache.size > 20000) measureCache.clear();
    measureCache.set(key, w);
  }
  return w;
}
export function fontString(l: Layer) {
  return `${l.italic ? 'italic ' : ''}${l.fontWeight ?? 700} ${l.fontSize ?? 100}px "${l.font ?? 'Inter'}", system-ui, sans-serif`;
}
export function layoutText(ctx: CanvasRenderingContext2D, l: Layer, maxWidth: number): Line[] {
  const font = fontString(l);
  ctx.font = font;
  const ls = l.letterSpacing ?? 0;
  const wOf = (s: string) => measure(ctx, font, s) + ls * Math.max(0, [...s].length - 1);
  const out: Line[] = [];
  for (const para of (l.text ?? '').split('\n')) {
    const words = para.split(' ');
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && wOf(next) > maxWidth) { out.push(mkLine(cur)); cur = w; } else cur = next;
    }
    out.push(mkLine(cur));
  }
  function mkLine(text: string): Line {
    const chars = [...text];
    const xs = chars.map((_, i) => measure(ctx, font, chars.slice(0, i).join('')) + ls * i);
    return { text, width: wOf(text), xs };
  }
  return out;
}

// ---------- drawing ----------
export interface RenderOptions {
  /** Canvas pixels per stage pixel. */
  scale: number;
  images: ImageCache;
  /** Draw a transparent background (for thumbnails over a checkerboard). */
  transparent?: boolean;
}

export class ImageCache {
  private map = new Map<string, HTMLImageElement>();
  onLoad: (() => void) | null = null;
  get(src: string): HTMLImageElement | null {
    let img = this.map.get(src);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => this.onLoad?.();
      img.src = src;
      this.map.set(src, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }
  async ready(project: Project) {
    const srcs = project.layers.filter((l) => l.type === 'image' && l.src).map((l) => l.src!);
    await Promise.all(srcs.map((s) => new Promise<void>((res) => {
      const img = this.map.get(s) ?? (this.get(s), this.map.get(s)!);
      if (img.complete) res(); else { img.addEventListener('load', () => res(), { once: true }); img.addEventListener('error', () => res(), { once: true }); }
    })));
  }
}

function shapePath(ctx: CanvasRenderingContext2D, l: Layer, w: number, h: number) {
  const x = -w / 2, y = -h / 2;
  ctx.beginPath();
  switch (l.shape) {
    case 'ellipse': ctx.ellipse(0, 0, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); break;
    case 'pill': ctx.roundRect(x, y, w, h, Math.min(Math.abs(w), Math.abs(h)) / 2); break;
    case 'triangle': ctx.moveTo(0, y); ctx.lineTo(w / 2, h / 2); ctx.lineTo(x, h / 2); ctx.closePath(); break;
    case 'star': {
      const n = 5, R = Math.min(w, h) / 2, r = R * 0.45;
      for (let i = 0; i < n * 2; i++) {
        const a = (i * Math.PI) / n - Math.PI / 2;
        const rad = i % 2 ? r : R;
        const px = Math.cos(a) * rad * (w / Math.min(w, h)), py = Math.sin(a) * rad * (h / Math.min(w, h));
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'line': ctx.rect(x, -Math.max(1, h) / 2, w, Math.max(1, h)); break;
    case 'rect':
    default: ctx.roundRect(x, y, w, h, Math.max(0, Math.min(l.radius ?? 0, Math.abs(w) / 2, Math.abs(h) / 2)));
  }
}

function paint(ctx: CanvasRenderingContext2D, l: Layer, s: LayerState): string | CanvasGradient {
  if (!l.fill2) return s.fill;
  const g = ctx.createLinearGradient(-s.width / 2, -s.height / 2, s.width / 2, s.height / 2);
  g.addColorStop(0, s.fill);
  g.addColorStop(1, l.fill2);
  return g;
}

/** autoFit: the largest font size (never above the layer's own) at which the text fits. */
function fitted(ctx: CanvasRenderingContext2D, l: Layer, s: LayerState): Layer {
  if (!l.autoFit) return l;
  const base = l.fontSize ?? 100;
  const fits = (size: number) => {
    const k = size / base;
    const probe: Layer = { ...l, fontSize: size, letterSpacing: (l.letterSpacing ?? 0) * k };
    const lines = layoutText(ctx, probe, l.autoFit === 'width' ? 1e6 : s.width);
    const w = Math.max(...lines.map((ln) => ln.width));
    if (w > s.width + 0.5) return false;
    return l.autoFit === 'width' || lines.length * size * (l.lineHeight ?? 1.1) <= s.height + 0.5;
  };
  if (fits(base)) return l;
  let lo = base * 0.2, hi = base;
  for (let i = 0; i < 9; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  return { ...l, fontSize: lo, letterSpacing: (l.letterSpacing ?? 0) * (lo / base) };
}

function drawText(ctx: CanvasRenderingContext2D, layer: Layer, s: LayerState) {
  const l = fitted(ctx, layer, s);
  const lines = layoutText(ctx, l, l.autoFit === 'width' ? 1e6 : s.width);
  const size = l.fontSize ?? 100;
  const lh = size * (l.lineHeight ?? 1.1);
  const total = lines.length * lh;
  ctx.fillStyle = paint(ctx, l, s);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (s.stroke && s.strokeWidth > 0) { ctx.strokeStyle = s.stroke; ctx.lineWidth = s.strokeWidth; ctx.lineJoin = 'round'; }
  const totalChars = lines.reduce((n, ln) => n + [...ln.text].length, 0);
  const shown = s.reveal >= 1 ? Infinity : Math.floor(s.reveal * totalChars + 1e-6);
  const perGlyph = !!s.glyph || shown !== Infinity || (l.letterSpacing ?? 0) !== 0;
  const units = s.glyph ? (s.glyph.unit === 'words' ? (l.text ?? '').split(/\s+/).filter(Boolean).length : (l.text ?? '').replace(/\s/g, '').length) : 0;
  let charIndex = 0, unitIndex = 0, drawn = 0;
  const baseAlpha = ctx.globalAlpha;

  lines.forEach((ln, li) => {
    const y = -total / 2 + lh * (li + 0.5);
    const x0 = l.align === 'left' ? -s.width / 2 : l.align === 'right' ? s.width / 2 - ln.width : -ln.width / 2;
    if (!perGlyph) {
      if (s.stroke && s.strokeWidth > 0) ctx.strokeText(ln.text, x0, y);
      ctx.fillText(ln.text, x0, y);
      return;
    }
    const chars = [...ln.text];
    // `words` scales each word about its OWN centre; scaling every glyph about itself spreads the letters apart.
    const wordMid: number[] = [];
    if (s.glyph?.unit === 'words') {
      for (let i = 0; i < chars.length;) {
        if (/\s/.test(chars[i])) { i++; continue; }
        let j = i;
        while (j + 1 < chars.length && !/\s/.test(chars[j + 1])) j++;
        const mid = x0 + (ln.xs[i] + ln.xs[j] + ctx.measureText(chars[j]).width) / 2;
        for (let k = i; k <= j; k++) wordMid[k] = mid;
        i = j + 1;
      }
    }
    let inWord = false;
    chars.forEach((ch, i) => {
      const space = /\s/.test(ch);
      if (s.glyph?.unit === 'words') {
        if (!space && !inWord) inWord = true;
        if (space && inWord) { inWord = false; unitIndex++; }
      }
      if (drawn >= shown) return;
      drawn++;
      if (space) return;
      const cx = x0 + ln.xs[i];
      if (s.glyph) {
        const fx = s.glyph.fx(s.glyph.unit === 'letters' ? charIndex : unitIndex, Math.max(1, units));
        if (fx.opacity > 0.001 && fx.scale > 0.001) {
          ctx.save();
          ctx.globalAlpha = baseAlpha * fx.opacity;
          if (s.glyph.unit === 'words') {
            ctx.translate(wordMid[i] + fx.dx, y + fx.dy);
            ctx.scale(fx.scale, fx.scale);
            if (s.stroke && s.strokeWidth > 0) ctx.strokeText(ch, cx - wordMid[i], 0);
            ctx.fillText(ch, cx - wordMid[i], 0);
          } else {
            const cw = ctx.measureText(ch).width;
            ctx.translate(cx + cw / 2 + fx.dx, y + fx.dy);
            ctx.scale(fx.scale, fx.scale);
            if (s.stroke && s.strokeWidth > 0) ctx.strokeText(ch, -cw / 2, 0);
            ctx.fillText(ch, -cw / 2, 0);
          }
          ctx.restore();
        }
      } else {
        if (s.stroke && s.strokeWidth > 0) ctx.strokeText(ch, cx, y);
        ctx.fillText(ch, cx, y);
      }
      charIndex++;
    });
    if (s.glyph?.unit === 'words' && inWord) unitIndex++;
  });
}

function drawImage(ctx: CanvasRenderingContext2D, l: Layer, s: LayerState, images: ImageCache) {
  const w = s.width, h = s.height;
  ctx.save();
  shapePath(ctx, { ...l, shape: l.shape ?? 'rect' }, w, h);
  ctx.clip();
  const img = l.src ? images.get(l.src) : null;
  if (img) {
    const ir = img.naturalWidth / img.naturalHeight, br = w / h;
    let dw = w, dh = h;
    if ((l.fit ?? 'cover') === 'cover' ? ir > br : ir < br) dw = h * ir; else dh = w / ir;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  } else {
    ctx.fillStyle = 'rgba(128,128,128,0.25)';
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();
  if (s.stroke && s.strokeWidth > 0) {
    shapePath(ctx, { ...l, shape: l.shape ?? 'rect' }, w, h);
    ctx.strokeStyle = s.stroke; ctx.lineWidth = s.strokeWidth; ctx.stroke();
  }
}

export function drawLayer(ctx: CanvasRenderingContext2D, l: Layer, t: number, images: ImageCache, project?: Pick<Project, 'layers'>) {
  const s = layerState(l, t);
  const par = project ? parentDelta(project, l, t) : null;
  if (s.opacity * (par?.opacity ?? 1) <= 0.001 || s.clip <= 0) return;
  ctx.save();
  if (par) ctx.transform(...par.m);
  const px = (l.pivot?.x ?? 0) * s.width, py = (l.pivot?.y ?? 0) * s.height;
  ctx.translate(s.x + px, s.y + py);
  ctx.rotate((s.rotation * Math.PI) / 180);
  ctx.scale(s.scale * s.scaleX, s.scale * s.scaleY);
  ctx.translate(-px, -py);
  ctx.globalAlpha *= Math.min(1, s.opacity) * (par?.opacity ?? 1);
  if (l.blend) ctx.globalCompositeOperation = l.blend;
  const filters: string[] = [];
  if (s.blur > 0.05) filters.push(`blur(${s.blur.toFixed(2)}px)`);
  if (Math.abs(s.brightness - 1) > 0.005) filters.push(`brightness(${s.brightness.toFixed(3)})`);
  if (filters.length) ctx.filter = filters.join(' ');
  if (l.shadow) { ctx.shadowColor = l.shadow.color; ctx.shadowBlur = l.shadow.blur; ctx.shadowOffsetX = l.shadow.x; ctx.shadowOffsetY = l.shadow.y; }
  if (s.clip < 1) {
    const pad = Math.max(s.width, s.height);
    ctx.beginPath();
    ctx.rect(-s.width / 2 - pad, -s.height / 2 - pad, (s.width + pad * 2) * s.clip, s.height + pad * 2);
    ctx.clip();
  }
  if (l.type === 'text') drawText(ctx, l, s);
  else if (l.type === 'image') drawImage(ctx, l, s, images);
  else {
    shapePath(ctx, l, s.width, s.height);
    if (s.fill !== 'transparent') { ctx.fillStyle = paint(ctx, l, s); ctx.fill(); }
    if (s.stroke && s.strokeWidth > 0) { ctx.shadowColor = 'transparent'; ctx.strokeStyle = s.stroke; ctx.lineWidth = s.strokeWidth; ctx.stroke(); }
  }
  ctx.restore();
}

export function applyCamera(ctx: CanvasRenderingContext2D, project: Project, t: number) {
  const c = cameraAt(project, t);
  ctx.translate(project.width / 2, project.height / 2);
  ctx.rotate((c.rotation * Math.PI) / 180);
  ctx.scale(c.zoom, c.zoom);
  ctx.translate(-c.x, -c.y);
}

export function renderFrame(ctx: CanvasRenderingContext2D, project: Project, t: number, opts: RenderOptions) {
  const { width: W, height: H } = project;
  ctx.save();
  ctx.setTransform(opts.scale, 0, 0, opts.scale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!opts.transparent) {
    if (project.background2) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, project.background);
      g.addColorStop(1, project.background2);
      ctx.fillStyle = g;
    } else ctx.fillStyle = project.background;
    ctx.fillRect(0, 0, W, H);
  }
  applyCamera(ctx, project, t);
  for (const l of project.layers) if (isVisibleAt(l, t)) drawLayer(ctx, l, t, opts.images, project);
  ctx.restore();
}

// ---------- geometry for selection & hit testing ----------
type Pt = { x: number; y: number };
export function layerCorners(project: Project, l: Layer, t: number): Pt[] {
  const s = layerState(l, t);
  const c = cameraAt(project, t);
  const crot = (c.rotation * Math.PI) / 180;
  const own = layerMatrix(l, s);
  const par = parentDelta(project, l, t);
  const m = par ? matMul(par.m, own) : own;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
    const w = matApply(m, (u * s.width) / 2, (v * s.height) / 2);
    const x = (w.x - c.x) * c.zoom, y = (w.y - c.y) * c.zoom;
    return { x: x * Math.cos(crot) - y * Math.sin(crot) + project.width / 2, y: x * Math.sin(crot) + y * Math.cos(crot) + project.height / 2 };
  });
}

function inPoly(p: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function hitTest(project: Project, t: number, p: Pt): Layer | null {
  for (let i = project.layers.length - 1; i >= 0; i--) {
    const l = project.layers[i];
    if (!isVisibleAt(l, t) || l.locked) continue;
    if (inPoly(p, layerCorners(project, l, t))) return l;
  }
  return null;
}

export const beat = (bpm: number) => 60 / bpm;
export const snapToBeat = (t: number, bpm: number, div = 2) => Math.round((t / beat(bpm)) * div) / div * beat(bpm);
export const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};
