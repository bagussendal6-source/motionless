// Checks layer input before it is applied, so one typo (`enter.preset: "slam"`) is reported with every
// other problem in the batch instead of failing the whole call one error at a time.
import { EASES, ENTER_PRESETS, FONTS, LOOP_PRESETS } from './catalog.ts';

export interface InputIssue {
  /** Index in the submitted array. */
  index: number;
  /** Dotted path of the bad field, e.g. "enter.preset" or "keys.2.ease". */
  path: string;
  message: string;
  /** 'error' blocks the layer; 'warn' is applied anyway. */
  severity: 'error' | 'warn';
}

const SHAPES = ['rect', 'ellipse', 'pill', 'triangle', 'star', 'line'];
const TYPES = ['text', 'shape', 'image'];
const ALIGN = ['left', 'center', 'right'];
const FIT = ['cover', 'contain'];
const AUTOFIT = ['width', 'box'];

function dist(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// Words people (and models) reach for that are not preset names, mapped to the presets that do what they mean.
const SYNONYMS: Record<string, string[]> = {
  slam: ['drop', 'pop'], smash: ['drop', 'pop'], bam: ['pop'], thud: ['drop'], bounce: ['pop'], boing: ['pop'], grow: ['pop', 'zoom'], scale: ['pop', 'zoom'], scaleup: ['pop', 'zoom'],
  appear: ['fade', 'none'], show: ['fade', 'none'], dissolve: ['fade'], fadein: ['fade'], fadeout: ['fade'], cut: ['none'], instant: ['none'],
  slide: ['slideLeft', 'slideRight'], slidein: ['slideLeft', 'slideRight'], left: ['slideLeft'], right: ['slideRight'], up: ['rise'], down: ['drop'], fall: ['drop'], lift: ['rise'], raise: ['rise'],
  rotate: ['spin'], twirl: ['spin'], swirl: ['spin'], turn: ['spin'], reveal: ['wipe'], mask: ['wipe'], flipx: ['flip'], flipy: ['flip'], card: ['flip'],
  focus: ['blur'], typing: ['typewriter'], type: ['typewriter'], letter: ['letters'], char: ['letters'], word: ['words'], zoomin: ['zoom'],
  wobble: ['wiggle'], woble: ['wiggle'], shake: ['wiggle'], jiggle: ['wiggle'], jitter: ['wiggle'], vibrate: ['wiggle'], tilt: ['wiggle'], sway: ['wiggle'],
  hover: ['float'], bob: ['float'], levitate: ['float'], drift: ['float'], heartbeat: ['pulse'], throb: ['pulse'], beat: ['pulse'], glow: ['shimmer', 'breathe'], twinkle: ['shimmer'], sparkle: ['shimmer'], flicker: ['breathe', 'shimmer'], rotateloop: ['spin'],
  ease: ['smooth', 'easeOut'], easein: ['easeInOut'], easeinout: ['easeInOut'], easeout: ['easeOut'], bouncey: ['bouncy'], elastic: ['bouncy', 'spring'], fast: ['snap'], sharp: ['snap'], soft: ['smooth'],
};

function oneOf(value: unknown, allowed: string[], what: string): string | null {
  if (typeof value === 'string' && allowed.includes(value)) return null;
  const v = String(value);
  const key = v.toLowerCase().replace(/[\s_-]/g, '');
  const ci = allowed.find((a) => a.toLowerCase() === key);
  const hits = new Set<string>();
  if (ci) hits.add(ci);
  for (const syn of SYNONYMS[key] ?? []) if (allowed.includes(syn)) hits.add(syn);
  // Edit distance, with a threshold that scales with length so "woble" finds "wiggle" and "slideleft" finds "slideLeft".
  const ranked = [...allowed].map((a) => ({ a, d: dist(key, a.toLowerCase()) })).sort((x, y) => x.d - y.d);
  for (const r of ranked.slice(0, 2)) if (r.d <= Math.max(2, Math.ceil(r.a.length / 2) - (r.a.length < 5 ? 1 : 0))) hits.add(r.a);
  // A shared prefix or containment is also a strong hint ("slide" -> slideLeft).
  for (const a of allowed) if (key.length >= 3 && (a.toLowerCase().startsWith(key) || key.startsWith(a.toLowerCase()))) hits.add(a);
  // A typo of a synonym ("bouce" for "bounce") still points at the right presets.
  if (!ci && key.length >= 4) for (const [syn, presets] of Object.entries(SYNONYMS)) if (dist(key, syn) <= 1) for (const p of presets) if (allowed.includes(p)) hits.add(p);
  const guess = ci ? [ci] : [...hits].slice(0, 3);
  const hint = guess.length ? ` Did you mean ${guess.map((g) => `"${g}"`).join(' or ')}?` : '';
  return `${what} "${v}" does not exist.${hint} Valid: ${allowed.join(', ')}.`;
}
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

type Rec = Record<string, unknown>;

function motion(m: unknown, base: string, index: number, out: InputIssue[]) {
  if (m === undefined) return;
  const r = m as Rec;
  if (r.preset !== undefined) { const e = oneOf(r.preset, ENTER_PRESETS.map((p) => p.id), 'Motion preset'); if (e) out.push({ index, path: `${base}.preset`, message: e, severity: 'error' }); }
  if (r.ease !== undefined) { const e = oneOf(r.ease, EASES.map((p) => p.id), 'Ease'); if (e) out.push({ index, path: `${base}.ease`, message: e, severity: 'error' }); }
  if (r.from !== undefined && (!finite(r.from) || (r.from as number) < 0 || (r.from as number) > 0.95)) out.push({ index, path: `${base}.from`, message: '`from` must be between 0 and 0.95.', severity: 'error' });
}

/** Validate one layer (or layer patch). `partial` patches need no type. */
export function validateLayer(l: Rec, index: number, opts: { patch?: boolean; knownIds?: Set<string> } = {}): InputIssue[] {
  const out: InputIssue[] = [];
  const bad = (path: string, message: string, severity: 'error' | 'warn' = 'error') => out.push({ index, path, message, severity });
  if (!opts.patch) { const e = oneOf(l.type, TYPES, 'Layer type'); if (e) bad('type', e); }
  if (l.shape !== undefined) { const e = oneOf(l.shape, SHAPES, 'Shape'); if (e) bad('shape', e); }
  if (l.align !== undefined) { const e = oneOf(l.align, ALIGN, 'Align'); if (e) bad('align', e); }
  if (l.fit !== undefined) { const e = oneOf(l.fit, FIT, 'Image fit'); if (e) bad('fit', e); }
  if (l.autoFit !== undefined) { const e = oneOf(l.autoFit, AUTOFIT, 'autoFit'); if (e) bad('autoFit', e); }
  if (typeof l.font === 'string' && !FONTS.includes(l.font)) bad('font', `Font "${l.font}" is not loaded and will fall back to a system font. Use one of: ${FONTS.join(', ')}.`, 'warn');
  motion(l.enter, 'enter', index, out);
  motion(l.exit, 'exit', index, out);
  if (l.loop !== undefined) {
    const lp = l.loop as Rec;
    if (lp.preset !== undefined) { const e = oneOf(lp.preset, LOOP_PRESETS.map((p) => p.id), 'Loop preset'); if (e) bad('loop.preset', e); }
  }
  if (Array.isArray(l.keys)) {
    (l.keys as Rec[]).forEach((k, i) => {
      if (!finite(k.t)) bad(`keys.${i}.t`, 'Keyframe needs a numeric `t` (seconds).');
      if (k.ease !== undefined) { const e = oneOf(k.ease, EASES.map((p) => p.id), 'Ease'); if (e) bad(`keys.${i}.ease`, e); }
    });
  }
  for (const f of ['x', 'y', 'width', 'height', 'rotation', 'scale', 'opacity', 'fontSize', 'start', 'end', 'left', 'top', 'right', 'bottom']) {
    if (l[f] !== undefined && !finite(l[f])) bad(f, `\`${f}\` must be a finite number.`);
  }
  if (finite(l.start) && finite(l.end) && (l.end as number) <= (l.start as number)) bad('end', `end (${l.end}) must be after start (${l.start}).`);
  if (l.pivot !== undefined) {
    const p = l.pivot as Rec;
    if (!finite(p?.x) || !finite(p?.y)) bad('pivot', 'pivot needs numeric x and y (fractions of the layer size from its centre, e.g. {"x":0,"y":0.5} = bottom edge).');
  }
  if (typeof l.parent === 'string' && l.parent && opts.knownIds && !opts.knownIds.has(l.parent)) bad('parent', `Parent "${l.parent}" is not a layer in this project or batch.`);
  return out;
}

/** Remove the offending fields so the rest of the layer can still be applied. */
export function sanitizeLayer<T extends Rec>(l: T, issues: InputIssue[]): T {
  const copy = structuredClone(l) as Rec;
  for (const i of issues.filter((x) => x.severity === 'error')) {
    const parts = i.path.split('.');
    let cur: unknown = copy;
    for (let k = 0; k < parts.length - 1; k++) cur = (cur as Rec)?.[parts[k]];
    if (cur && typeof cur === 'object') delete (cur as Rec)[parts[parts.length - 1]];
  }
  return copy as T;
}

export function formatInputIssues(issues: InputIssue[], label: (i: number) => string): string {
  return issues.map((i) => `  ${label(i.index)} · ${i.path}: ${i.message}`).join('\n');
}
