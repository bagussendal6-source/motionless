// Server-side design checks. No canvas here, so text is measured with a rough
// glyph-width estimate: good enough to catch real overflow, overlap and contrast
// problems, and Claude confirms the borderline ones with render_frames.
import { FONTS, glyphAdvance } from './catalog.ts';
import { cameraAt, layerState, matApply, parentDelta, type LayerState, type Mat } from './motion.ts';
import type { Layer, Project } from './types.ts';

export interface LintIssue {
  severity: 'error' | 'warn' | 'info';
  code: string;
  message: string;
  layerIds?: string[];
  time?: number;
}

interface Rect { x0: number; y0: number; x1: number; y1: number }
const area = (r: Rect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
const inter = (a: Rect, b: Rect): Rect => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });

function lum(hex: string): number | null {
  const m = hex.trim().match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$|^#([0-9a-f]{3})$/i);
  if (!m) return null;
  let h = m[1] ?? m[2];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Estimated glyph advance for a font size. */
const glyphWidth = (l: Layer, size: number) => size * glyphAdvance(l.font, l.fontWeight) + (l.letterSpacing ?? 0);
const longestWord = (l: Layer) => Math.max(0, ...(l.text ?? '').split(/\s+/).map((w) => w.length));

/** Estimated on-stage bounds of a layer at its resting position (or at a sampled animation state). */
export function bounds(l: Layer, st?: Pick<LayerState, 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'width' | 'height'>): Rect {
  if (st) {
    const r = boundsRest({ ...l, width: st.width, height: st.height });
    const dx = st.x - l.x, dy = st.y - l.y;
    const k = (st.scale * st.scaleX) / (l.scale || 1), kv = (st.scale * st.scaleY) / (l.scale || 1);
    const cx = (r.x0 + r.x1) / 2 + dx, cy = (r.y0 + r.y1) / 2 + dy;
    const hw = ((r.x1 - r.x0) / 2) * k, hh = ((r.y1 - r.y0) / 2) * kv;
    return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
  }
  return boundsRest(l);
}

function boundsRest(l: Layer): Rect {
  const sc = l.scale || 1;
  if (l.type !== 'text') return { x0: l.x - (l.width * sc) / 2, y0: l.y - (l.height * sc) / 2, x1: l.x + (l.width * sc) / 2, y1: l.y + (l.height * sc) / 2 };
  let size = l.fontSize ?? 100;
  if (l.autoFit) {
    // The renderer shrinks the font until the text fits; mirror that with the same rough glyph estimate.
    const one = (l.text ?? '').split('\n').reduce((m, para) => Math.max(m, para.length), 0) * glyphWidth(l, size);
    const word = longestWord(l) * glyphWidth(l, size);
    const need = l.autoFit === 'width' ? one : word;
    if (need > l.width) size *= Math.max(0.2, l.width / need);
  }
  const glyph = glyphWidth(l, size);
  let lines = 0;
  let widest = 0;
  for (const para of (l.text ?? '').split('\n')) {
    let cur = 0;
    let rows = 1;
    for (const word of para.split(' ')) {
      const w = (word.length + 1) * glyph;
      if (cur && cur + w - glyph > l.width) { rows++; cur = w; } else cur += w;
      widest = Math.max(widest, Math.min(l.width, cur - glyph));
    }
    lines += rows;
  }
  const w = Math.max(size, widest) * sc;
  const h = lines * size * (l.lineHeight ?? 1.1) * sc;
  const cx = l.align === 'left' ? l.x - l.width / 2 + w / 2 : l.align === 'right' ? l.x + l.width / 2 - w / 2 : l.x;
  return { x0: cx - w / 2, y0: l.y - h / 2, x1: cx + w / 2, y1: l.y + h / 2 };
}


/** Axis-aligned box of a rect after a 2D matrix. */
function rectAfter(r: Rect, m: Mat): Rect {
  const pts = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].map(([x, y]) => matApply(m, x, y));
  return { x0: Math.min(...pts.map((q) => q.x)), y0: Math.min(...pts.map((q) => q.y)), x1: Math.max(...pts.map((q) => q.x)), y1: Math.max(...pts.map((q) => q.y)) };
}

/** Stage rect -> frame pixels through a camera state. */
function rectToScreen(p: Pick<Project, 'width' | 'height'>, r: Rect, c: { x: number; y: number; zoom: number; rotation: number }): Rect {
  const cr = (c.rotation * Math.PI) / 180;
  const pts = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].map(([x, y]) => {
    const dx = (x - c.x) * c.zoom, dy = (y - c.y) * c.zoom;
    return [dx * Math.cos(cr) - dy * Math.sin(cr) + p.width / 2, dx * Math.sin(cr) + dy * Math.cos(cr) + p.height / 2];
  });
  return { x0: Math.min(...pts.map((q) => q[0])), y0: Math.min(...pts.map((q) => q[1])), x1: Math.max(...pts.map((q) => q[0])), y1: Math.max(...pts.map((q) => q[1])) };
}

const visibleAt = (l: Layer, t: number) => !l.hidden && t >= l.start && t < l.end;
const settledAt = (l: Layer, t: number) => visibleAt(l, t) && t >= l.start + (l.enter.preset === 'none' ? 0 : l.enter.duration) && t < l.end - (l.exit.preset === 'none' ? 0 : l.exit.duration);

export function lintProject(p: Project): LintIssue[] {
  const out: LintIssue[] = [];
  const frame: Rect = { x0: 0, y0: 0, x1: p.width, y1: p.height };
  const minDim = Math.min(p.width, p.height);
  const f1 = (n: number) => n.toFixed(1);

  for (const l of p.layers) {
    if (l.start >= p.duration) out.push({ severity: 'error', code: 'never-visible', message: `"${l.name}" starts at ${f1(l.start)}s, after the video ends (${f1(p.duration)}s).`, layerIds: [l.id] });
    else if (l.end > p.duration + 0.01) out.push({ severity: 'info', code: 'past-end', message: `"${l.name}" ends at ${f1(l.end)}s, after the video (${f1(p.duration)}s). Harmless, but its exit never plays.`, layerIds: [l.id] });
    if (l.type === 'image' && !l.src) out.push({ severity: 'error', code: 'missing-image', message: `Image layer "${l.name}" has no src.`, layerIds: [l.id] });
    if (l.type === 'text') {
      if (!l.text?.trim()) out.push({ severity: 'warn', code: 'empty-text', message: `Text layer "${l.name}" is empty.`, layerIds: [l.id] });
      if (l.font && !FONTS.includes(l.font)) out.push({ severity: 'warn', code: 'unknown-font', message: `"${l.name}" uses font "${l.font}", which is not loaded. Use one of: ${FONTS.join(', ')}.`, layerIds: [l.id] });
      if ((l.fontSize ?? 100) < minDim * 0.03) out.push({ severity: 'warn', code: 'small-text', message: `"${l.name}" is ${l.fontSize}px, under ${Math.round(minDim * 0.03)}px: hard to read on a phone.`, layerIds: [l.id] });
      if (!l.autoFit && longestWord(l) * glyphWidth(l, l.fontSize ?? 100) > l.width * 1.03) out.push({ severity: 'warn', code: 'word-wider-than-box', message: `The longest word in "${l.name}" is about ${Math.round(longestWord(l) * glyphWidth(l, l.fontSize ?? 100))}px wide but the layer is ${Math.round(l.width)}px, so it spills over its box. Widen the layer, lower fontSize, or set autoFit: "box".`, layerIds: [l.id] });
      const b = bounds(l);
      const inside = area(inter(b, frame)) / Math.max(1, area(b));
      if (!l.keys.length && inside < 0.98 && l.enter.preset !== 'slideLeft' && l.enter.preset !== 'slideRight') {
        out.push({ severity: inside < 0.7 ? 'error' : 'warn', code: 'text-offscreen', message: `"${l.name}" likely runs ${Math.round((1 - inside) * 100)}% outside the frame (estimated ${Math.round(b.x1 - b.x0)}×${Math.round(b.y1 - b.y0)}px at ${Math.round(b.x0)},${Math.round(b.y0)}). Reduce fontSize or width, or add line breaks.`, layerIds: [l.id] });
      }
    } else if (l.type === 'image' && !l.keys.length) {
      const b = bounds(l);
      if (area(inter(b, frame)) / Math.max(1, area(b)) < 0.6) out.push({ severity: 'warn', code: 'image-offscreen', message: `"${l.name}" is mostly outside the frame.`, layerIds: [l.id] });
    }
  }

  // Contrast: text colour against whatever really sits behind it. Everything is sampled from the
  // animated state (moving panels, keyed fills), over the whole time the text is settled on screen.
  const bgLums = [p.background, p.background2].filter(Boolean).map((c) => lum(c!)).filter((v): v is number => v !== null);
  const backdrop = (i: number, tb: Rect, t: number): number[] | null => {
    for (let j = i - 1; j >= 0; j--) {
      const u = p.layers[j];
      if (u.type === 'text' || u.hidden || t < u.start || t >= u.end) continue;
      const us = layerState(u, t);
      if (us.opacity < 0.6) continue;
      const cover = area(inter(bounds(u, us), tb)) / Math.max(1, area(tb));
      if (cover < 0.5) continue;
      if (u.type === 'image') return null; // photo or video still: can't judge by a flat colour
      if (us.fill === 'transparent') continue;
      const ls = [lum(us.fill), u.fill2 ? lum(u.fill2) : null].filter((v): v is number => v !== null);
      return ls.length ? ls : null;
    }
    return bgLums;
  };
  p.layers.forEach((l, i) => {
    if (l.type !== 'text' || l.hidden) return;
    const inW = l.enter.preset === 'none' ? 0 : l.enter.duration, outW = l.exit.preset === 'none' ? 0 : l.exit.duration;
    let a = l.start + inW, b = Math.min(l.end, p.duration) - outW;
    if (b <= a) a = b = (l.start + Math.min(l.end, p.duration)) / 2;
    let worst: { ratio: number; t: number; fill: string } | null = null;
    for (let k = 0; k < 6; k++) {
      // Stay strictly inside the layer's life: at t = end it (and what it sits on) is already gone.
      const t = Math.min(p.duration - 0.01, l.end - 0.01, a + ((b - a) * k) / 5);
      const ls = layerState(l, t);
      const fgs = [lum(ls.fill), l.fill2 ? lum(l.fill2) : null].filter((v): v is number => v !== null);
      if (!fgs.length) return;
      const back = backdrop(i, bounds(l, ls), t);
      if (!back || !back.length) continue;
      for (const fg of fgs) for (const bk of back) {
        const ratio = contrast(fg, bk);
        if (!worst || ratio < worst.ratio) worst = { ratio, t, fill: ls.fill };
      }
    }
    if (!worst) return;
    const large = (l.fontSize ?? 100) >= minDim * 0.05;
    if (worst.ratio < (large ? 3 : 4.5)) out.push({ severity: worst.ratio < 1.8 ? 'error' : 'warn', code: 'low-contrast', message: `"${l.name}" (${worst.fill}) has contrast ${worst.ratio.toFixed(1)}:1 against the layer behind it at ${f1(worst.t)}s. Aim for ${large ? 3 : 4.5}:1 or more.`, layerIds: [l.id], time: worst.t });
  });

  // Camera: zoom > 1 shows only the middle of the stage, so type near the edge gets cut off.
  if (p.camera.length) {
    const neutral = { x: p.width / 2, y: p.height / 2, zoom: 1, rotation: 0 };
    const toScreen = (r: Rect, c: typeof neutral): Rect => rectToScreen(p, r, c);
    for (const l of p.layers) {
      if (l.hidden || l.type === 'shape') continue;
      if (l.type === 'text' && !l.text?.trim()) continue;
      const inW = l.enter.preset === 'none' ? 0 : l.enter.duration, outW = l.exit.preset === 'none' ? 0 : l.exit.duration;
      let worst: { inside: number; t: number; cam: typeof neutral } | null = null;
      for (let t = l.start + inW; t < Math.min(l.end - outW, p.duration); t += 0.1) {
        const ls = layerState(l, t);
        const b = bounds(l, ls);
        if (area(inter(toScreen(b, neutral), frame)) / Math.max(1, area(toScreen(b, neutral))) < 0.97) continue; // off-screen on purpose
        const cam = cameraAt(p, t);
        const sb = toScreen(b, cam);
        const inside = area(inter(sb, frame)) / Math.max(1, area(sb));
        if (!worst || inside < worst.inside) worst = { inside, t, cam };
      }
      if (worst && worst.inside < 0.97) {
        const c = worst.cam;
        out.push({ severity: worst.inside < 0.7 ? 'error' : 'warn', code: 'camera-crop', message: `The camera cuts off ${Math.round((1 - worst.inside) * 100)}% of "${l.name}" at ${f1(worst.t)}s (camera x ${Math.round(c.x)}, y ${Math.round(c.y)}, zoom ${c.zoom.toFixed(2)}${c.rotation ? `, rot ${c.rotation.toFixed(1)}°` : ''}). Zoom ${c.zoom.toFixed(2)} only shows the middle ${Math.round(p.width / c.zoom)}×${Math.round(p.height / c.zoom)}px of the stage around the camera x/y. Lower the zoom, move the camera x/y toward the layer, or pull the layer inward.`, layerIds: [l.id], time: worst.t });
      }
    }
  }

  // Text colliding with other text on screen at the same time.
  const texts = p.layers.filter((l) => l.type === 'text' && !l.hidden && l.text?.trim());
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      const from = Math.max(a.start, b.start), to = Math.min(a.end, b.end);
      if (to - from < 0.3) continue;
      let t = from;
      let clash = false;
      for (; t < to; t += 0.1) if (settledAt(a, t) && settledAt(b, t)) { clash = true; break; }
      if (!clash || a.keys.length || b.keys.length) continue;
      const ra = bounds(a), rb = bounds(b);
      const o = area(inter(ra, rb));
      if (o / Math.max(1, Math.min(area(ra), area(rb))) > 0.2) out.push({ severity: 'warn', code: 'text-overlap', message: `"${a.name}" and "${b.name}" overlap on screen around ${f1(t)}s. Move one or stagger their timing.`, layerIds: [a.id, b.id], time: t });
    }
  }

  // Pacing: moments when nothing is really showing. A layer only counts when it is actually IN FRAME
  // (animated position, parent and camera included), not faded out, and not tiny; full-length background
  // shapes are scenery and never count as content, otherwise a decorative blob hides every empty stretch.
  const decor = (l: Layer) => l.type === 'shape' && l.start <= 0.05 && l.end >= p.duration - 0.05;
  const frameRect: Rect = { x0: 0, y0: 0, x1: p.width, y1: p.height };
  const showing = (l: Layer, t: number) => {
    if (l.hidden || decor(l)) return false;
    if (t < l.start + (l.enter.preset === 'none' || (l.enter.from ?? 0) >= 0.15 ? 0 : Math.min(0.12, l.enter.duration * 0.4)) || t >= l.end - (l.exit.preset === 'none' ? 0 : Math.min(0.12, l.exit.duration * 0.4))) return false;
    const st = layerState(l, t);
    const par = parentDelta(p, l, t);
    if (Math.min(1, st.opacity) * (par?.opacity ?? 1) <= 0.05 || l.fill === 'transparent' && l.type === 'shape' && !(st.stroke && st.strokeWidth > 0)) return false;
    let r = bounds(l, st);
    if (par) r = rectAfter(r, par.m);
    const sr = rectToScreen(p, r, cameraAt(p, t));
    return area(inter(sr, frameRect)) >= 1500;
  };
  const holes: [number, number][] = [];
  for (let t = 0; t < p.duration; t += 0.05) {
    if (p.layers.some((l) => showing(l, t))) continue;
    const last = holes[holes.length - 1];
    if (last && t - last[1] < 0.06) last[1] = t; else holes.push([t, t]);
  }
  for (const [from, to] of holes) {
    const len = to - from + 0.05;
    if (len < 0.12) continue;
    const opening = from < 0.01;
    out.push({ severity: opening && len < 0.4 ? 'info' : len > 0.4 ? 'error' : 'warn', code: 'blank-frames', message: `${opening ? 'The video opens on' : 'Nothing is showing for'} ${len.toFixed(2)}s from ${f1(from)}s${opening ? ' (the first frame is also the thumbnail)' : ''}. ${opening ? 'Start something at 0 with enter "none", or give the entrance a floor (enter.from: 0.3 keeps a pop or letters visible at frame 0).' : 'Overlap the next layer\'s start with the previous exit by ~0.15s.'}`, time: from });
  }
  const events = [0, p.duration, ...p.layers.filter((l) => !l.hidden).flatMap((l) => [l.start, ...l.keys.map((k) => k.t)]), ...p.camera.map((k) => k.t)].filter((t) => t >= 0 && t <= p.duration).sort((a, b) => a - b);
  for (let i = 1; i < events.length; i++) {
    if (events[i] - events[i - 1] > 2) out.push({ severity: 'info', code: 'dead-air', message: `Nothing new happens between ${f1(events[i - 1])}s and ${f1(events[i])}s. Add a beat of motion, a camera move or a colour shift.`, time: events[i - 1] });
  }

  // Keyframes: each property interpolates only between the keys that set it. A key that leaves one out does not
  // "hold" it, which is almost never what was meant when that key sets other properties.
  const KEYP = ['x', 'y', 'scale', 'rotation', 'opacity', 'width', 'height', 'sx', 'sy', 'strokeWidth', 'fill', 'stroke'];
  for (const l of p.layers) {
    if (l.keys.length < 3) continue;
    const rows = l.keys as unknown as Record<string, unknown>[];
    const notes: string[] = [];
    for (const prop of KEYP) {
      const set = rows.map((k, i) => (k[prop] !== undefined ? i : -1)).filter((i) => i >= 0);
      if (set.length < 2) continue;
      const skipped = rows.filter((k, i) => i > set[0] && i < set[set.length - 1] && k[prop] === undefined && Object.keys(k).some((o) => o !== 't' && o !== 'ease' && k[o] !== undefined));
      if (skipped.length) notes.push(`${prop} (ignored by the key${skipped.length > 1 ? 's' : ''} at ${skipped.map((k) => `${Number(k.t).toFixed(2)}s`).join(', ')})`);
    }
    if (notes.length) out.push({ severity: 'info', code: 'sparse-keys', message: `"${l.name}": a key that leaves a property out does NOT hold it; that property just interpolates across the key. ${notes.join('; ')}. Write the value on every key where it should land.`, layerIds: [l.id] });
  }

  // Beat grid.
  const b = 60 / p.bpm;
  const off = p.layers.filter((l) => !l.hidden && l.start > 0.01 && Math.abs(l.start / (b / 2) - Math.round(l.start / (b / 2))) * (b / 2) > 0.06);
  if (off.length > Math.max(3, p.layers.length * 0.4)) out.push({ severity: 'info', code: 'off-beat', message: `${off.length} of ${p.layers.length} layers start off the ${p.bpm} BPM grid (1 beat = ${b.toFixed(3)}s). Snap starts to multiples of ${(b / 2).toFixed(3)}s so cuts land on the music.`, layerIds: off.slice(0, 8).map((l) => l.id) });

  // Sections.
  const sorted = [...p.sections].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].start < sorted[i - 1].end - 0.01) out.push({ severity: 'warn', code: 'section-overlap', message: `Sections "${sorted[i - 1].name}" and "${sorted[i].name}" overlap.` });
  if (sorted.length && sorted[sorted.length - 1].end < p.duration - 0.05) out.push({ severity: 'info', code: 'section-gap', message: `Sections end at ${f1(sorted[sorted.length - 1].end)}s but the video runs to ${f1(p.duration)}s.` });

  const rank = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.time ?? 0) - (b.time ?? 0));
}

export function formatLint(issues: LintIssue[]): string {
  if (!issues.length) return 'No issues found. Still look at the frames with render_frames before calling it done.';
  const c = (s: LintIssue['severity']) => issues.filter((i) => i.severity === s).length;
  return [
    `${c('error')} errors, ${c('warn')} warnings, ${c('info')} notes`,
    ...issues.map((i) => `[${i.severity}] ${i.code}: ${i.message}${i.layerIds?.length ? `  (ids: ${i.layerIds.join(', ')})` : ''}`),
  ].join('\n');
}
