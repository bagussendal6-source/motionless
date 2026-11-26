import { makeLayer, makeSection, uid } from './catalog.ts';
import type { AudioClip, CameraKey, Keyframe, Layer, Project, Section } from './types.ts';

/**
 * Edge-based positioning, so left-aligned text and anchored boxes need no centre arithmetic.
 * `left` + `width` sets x; `right` + `width` sets x; `top` / `bottom` + `height` set y.
 */
export interface Edges { left?: number; right?: number; top?: number; bottom?: number }
export type LayerInput = Partial<Layer> & Edges & { type: Layer['type'] };
export type LayerPatch = Partial<Omit<Layer, 'enter' | 'exit' | 'loop' | 'parent'>> & Edges & {
  id: string;
  /** Empty string detaches the layer from its parent. */
  parent?: string;
  enter?: Partial<Layer['enter']>;
  exit?: Partial<Layer['exit']>;
  loop?: Partial<Layer['loop']>;
};

export type Op =
  | { op: 'addLayers'; layers: LayerInput[]; /** Insert above this layer id, or at top when omitted. */ above?: string }
  | { op: 'updateLayers'; updates: LayerPatch[] }
  | { op: 'deleteLayers'; ids: string[] }
  | { op: 'duplicateLayers'; ids: string[]; offset?: number }
  | { op: 'reorderLayer'; id: string; index: number }
  | { op: 'updateProject'; patch: Partial<Omit<Project, 'id' | 'layers' | 'sections' | 'camera' | 'rev' | 'createdAt' | 'updatedAt'>> }
  | { op: 'setSections'; sections: (Partial<Section> & { start: number; end: number })[] }
  | { op: 'setCamera'; keys: CameraKey[] }
  | { op: 'retime'; ids?: string[]; shift?: number; start?: number; end?: number }
  | { op: 'resize'; width: number; height: number }
  | { op: 'addAudio'; clips: (Partial<AudioClip> & { start: number })[] }
  | { op: 'updateAudio'; updates: (Partial<AudioClip> & { id: string })[] }
  | { op: 'deleteAudio'; ids: string[] };

/** Turn left/right/top/bottom into x/y using the (new or current) size. */
export function resolveEdges<T extends Edges & { x?: number; y?: number; width?: number; height?: number }>(input: T, cur?: { width: number; height: number; scale?: number }): Omit<T, keyof Edges> {
  const { left, right, top, bottom, ...rest } = input;
  const out = rest as T;
  const w = input.width ?? cur?.width;
  const h = input.height ?? cur?.height;
  if (left !== undefined && w !== undefined) out.x = left + w / 2;
  else if (right !== undefined && w !== undefined) out.x = right - w / 2;
  if (top !== undefined && h !== undefined) out.y = top + h / 2;
  else if (bottom !== undefined && h !== undefined) out.y = bottom - h / 2;
  return out;
}

function checkParents(p: Project) {
  const ids = new Set(p.layers.map((l) => l.id));
  for (const l of p.layers) {
    if (!l.parent) { delete l.parent; continue; }
    if (!ids.has(l.parent)) throw new Error(`Layer "${l.id}" has parent "${l.parent}", which does not exist.`);
    const seen = new Set([l.id]);
    for (let cur = p.layers.find((x) => x.id === l.parent); cur; cur = cur.parent ? p.layers.find((x) => x.id === cur!.parent) : undefined) {
      if (seen.has(cur.id)) throw new Error(`Parenting "${l.id}" under "${l.parent}" would make a loop.`);
      seen.add(cur.id);
    }
  }
}

const clone = <T,>(v: T): T => structuredClone(v);

export function applyOps(project: Project, ops: Op[]): { project: Project; created: string[] } {
  let p = clone(project);
  const created: string[] = [];
  for (const o of ops) {
    switch (o.op) {
      case 'addLayers': {
        const made = o.layers.map((l) => {
          const { left, right, top, bottom, ...rest } = l;
          const m = makeLayer({ ...rest, id: l.id && !p.layers.some((x) => x.id === l.id) ? l.id : uid('l') }, p);
          const { x, y } = resolveEdges({ left, right, top, bottom, x: m.x, y: m.y, width: m.width, height: m.height });
          m.x = x!; m.y = y!;
          return m;
        });
        made.forEach((l) => created.push(l.id));
        const idx = o.above ? p.layers.findIndex((l) => l.id === o.above) : -1;
        if (idx >= 0) p.layers.splice(idx + 1, 0, ...made);
        else p.layers.push(...made);
        break;
      }
      case 'updateLayers': {
        for (const u of o.updates) {
          const i = p.layers.findIndex((l) => l.id === u.id);
          if (i < 0) throw new Error(`No layer with id "${u.id}"`);
          const cur = p.layers[i];
          const { enter, exit, loop, keys, parent, ...rest } = u;
          const next: Layer = { ...cur, ...(resolveEdges(rest, cur) as Partial<Layer>) };
          if (parent !== undefined) { if (parent) next.parent = parent; else delete next.parent; }
          if (enter) next.enter = { ...cur.enter, ...enter };
          if (exit) next.exit = { ...cur.exit, ...exit };
          if (loop) next.loop = { ...cur.loop, ...loop };
          if (keys) next.keys = [...keys].sort((a: Keyframe, b: Keyframe) => a.t - b.t);
          p.layers[i] = next;
        }
        break;
      }
      case 'deleteLayers': {
        const ids = new Set(o.ids);
        // Children of a deleted group move up to its parent instead of being orphaned.
        const up = new Map(p.layers.filter((l) => ids.has(l.id)).map((l) => [l.id, l.parent]));
        p.layers = p.layers.filter((l) => !ids.has(l.id));
        for (const l of p.layers) while (l.parent && ids.has(l.parent)) { const next = up.get(l.parent); if (next) l.parent = next; else delete l.parent; }
        break;
      }
      case 'duplicateLayers': {
        const off = o.offset ?? 24;
        const copies = new Map(o.ids.map((id) => [id, uid('l')]));
        for (const id of o.ids) {
          const i = p.layers.findIndex((l) => l.id === id);
          if (i < 0) continue;
          const copy: Layer = { ...clone(p.layers[i]), id: copies.get(id)!, name: `${p.layers[i].name} copy`, x: p.layers[i].x + off, y: p.layers[i].y + off };
          // Duplicating a group together with its children keeps the copies grouped with each other.
          if (copy.parent && copies.has(copy.parent)) copy.parent = copies.get(copy.parent);
          copy.keys = copy.keys.map((k) => ({ ...k, x: k.x !== undefined ? k.x + off : undefined, y: k.y !== undefined ? k.y + off : undefined }));
          p.layers.splice(i + 1, 0, copy);
          created.push(copy.id);
        }
        break;
      }
      case 'reorderLayer': {
        const i = p.layers.findIndex((l) => l.id === o.id);
        if (i < 0) break;
        const [l] = p.layers.splice(i, 1);
        p.layers.splice(Math.max(0, Math.min(p.layers.length, o.index)), 0, l);
        break;
      }
      case 'updateProject': {
        p = { ...p, ...o.patch };
        break;
      }
      case 'setSections': {
        p.sections = o.sections
          .map((s, i) => makeSection({ ...s, id: s.id ?? uid('s') }, i))
          .sort((a, b) => a.start - b.start);
        break;
      }
      case 'setCamera': {
        p.camera = [...o.keys].sort((a, b) => a.t - b.t);
        break;
      }
      case 'retime': {
        const ids = o.ids ? new Set(o.ids) : null;
        for (const l of p.layers) {
          if (ids && !ids.has(l.id)) continue;
          if (o.shift) {
            l.start += o.shift;
            l.end += o.shift;
            l.keys = l.keys.map((k) => ({ ...k, t: k.t + o.shift! }));
          }
          if (o.start !== undefined) l.start = o.start;
          if (o.end !== undefined) l.end = o.end;
        }
        break;
      }
      case 'resize': {
        p = resizeProject(p, o.width, o.height);
        break;
      }
      case 'addAudio': {
        p.audio ??= [];
        for (const c of o.clips) {
          const clip: AudioClip = { id: c.id && !p.audio.some((x) => x.id === c.id) ? c.id : uid('a'), name: c.name ?? c.sfx ?? (c.music ? `Music · ${c.music.style}` : 'Audio'), kind: c.kind ?? (c.music ? 'music' : 'sfx'), volume: 1, ...c } as AudioClip;
          clip.id = c.id && !p.audio.some((x) => x.id === c.id) ? c.id : clip.id;
          p.audio.push(clip);
          created.push(clip.id);
        }
        break;
      }
      case 'updateAudio': {
        for (const u of o.updates) {
          const i = (p.audio ?? []).findIndex((c) => c.id === u.id);
          if (i < 0) throw new Error(`No audio clip with id "${u.id}"`);
          p.audio![i] = { ...p.audio![i], ...u };
        }
        break;
      }
      case 'deleteAudio': {
        const ids = new Set(o.ids);
        p.audio = (p.audio ?? []).filter((c) => !ids.has(c.id));
        break;
      }
      default:
        throw new Error(`Unknown op ${(o as { op: string }).op}`);
    }
  }
  checkParents(p);
  return { project: normalize(p), created };
}

/** Adapt a composition to a new frame size: positions stretch, sizes scale uniformly. */
export function resizeProject(project: Project, width: number, height: number): Project {
  const sx = width / project.width;
  const sy = height / project.height;
  const s = Math.min(sx, sy);
  const p = clone(project);
  p.width = width;
  p.height = height;
  for (const l of p.layers) {
    l.x *= sx;
    l.y *= sy;
    l.width *= s;
    l.height *= s;
    if (l.fontSize) l.fontSize *= s;
    if (l.letterSpacing) l.letterSpacing *= s;
    if (l.radius) l.radius *= s;
    if (l.strokeWidth) l.strokeWidth *= s;
    if (l.enter.distance) l.enter.distance *= s;
    if (l.exit.distance) l.exit.distance *= s;
    l.keys = l.keys.map((k) => ({
      ...k,
      x: k.x !== undefined ? k.x * sx : undefined,
      y: k.y !== undefined ? k.y * sy : undefined,
      width: k.width !== undefined ? k.width * s : undefined,
      height: k.height !== undefined ? k.height * s : undefined,
      strokeWidth: k.strokeWidth !== undefined ? k.strokeWidth * s : undefined,
    }));
  }
  p.camera = p.camera.map((c) => ({ ...c, x: c.x !== undefined ? c.x * sx : undefined, y: c.y !== undefined ? c.y * sy : undefined }));
  return p;
}

/** Fill gaps so a hand-written or older document always renders. */
export function normalize(p: Project): Project {
  p.sections ??= [];
  p.layers ??= [];
  p.camera ??= [];
  p.fps ||= 30;
  p.bpm ||= 120;
  p.duration = Math.max(0.5, Number(p.duration) || 10);
  p.layers = p.layers.map((l) => {
    const full = makeLayer({ ...l, id: l.id || uid('l') }, p);
    if (full.end <= full.start) full.end = full.start + 0.1;
    return full;
  });
  return p;
}

/** Ops that wrap layers in a transparent parent sized to their combined box. */
export function groupOps(p: Project, ids: string[], opts: { id?: string; name?: string; extra?: Partial<Layer> } = {}): { ops: Op[]; groupId: string; box: Rect } {
  const ms = ids.map((id) => p.layers.find((l) => l.id === id)).filter((l): l is Layer => !!l);
  if (!ms.length) throw new Error('No such layers to group.');
  const x0 = Math.min(...ms.map((l) => l.x - (l.width * l.scale) / 2)), x1 = Math.max(...ms.map((l) => l.x + (l.width * l.scale) / 2));
  const y0 = Math.min(...ms.map((l) => l.y - (l.height * l.scale) / 2)), y1 = Math.max(...ms.map((l) => l.y + (l.height * l.scale) / 2));
  const groupId = opts.id && !p.layers.some((l) => l.id === opts.id) ? opts.id : uid('g');
  return {
    groupId,
    box: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 },
    ops: [
      { op: 'addLayers', layers: [{ type: 'shape', id: groupId, name: opts.name ?? 'Group', x: (x0 + x1) / 2, y: (y0 + y1) / 2, width: x1 - x0, height: y1 - y0, fill: 'transparent', radius: 0, start: Math.min(...ms.map((l) => l.start)), end: Math.max(...ms.map((l) => l.end)), enter: { preset: 'none', duration: 0.5, ease: 'spring' }, ...opts.extra }] },
      { op: 'updateLayers', updates: ms.map((l) => ({ id: l.id, parent: groupId })) },
    ],
  };
}
interface Rect { x: number; y: number; w: number; h: number }
