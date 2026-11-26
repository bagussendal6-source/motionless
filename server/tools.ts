// The thinking behind the MCP tools lives HERE, in the API server, not in the MCP process.
// The MCP server is a thin pipe: it forwards arguments and prints the text that comes back. That keeps
// validation, lint feedback, camera resolution, auto-SFX and motion analysis in the same process (and the
// same hot-reload) as the shared/ code they depend on, so they can never run a stale copy of it.
import { CATALOG_TEXT, uid } from '../shared/catalog.ts';
import { groupOps, type Op } from '../shared/ops.ts';
import { bounds, formatLint, lintProject } from '../shared/lint.ts';
import { formatInputIssues, sanitizeLayer, validateLayer, type InputIssue } from '../shared/validate.ts';
import { analyzeMotion, type AnalyzeOptions } from '../shared/analyze.ts';
import type { Project, SfxKind } from '../shared/types.ts';

export class ToolError extends Error {
  status = 422;
}

/** What a tool wants done: the ops to apply, an undo label, and how to describe the result. */
export interface Plan {
  ops: Op[];
  label: string;
  /** Validate and preview only; nothing is saved. */
  dryRun?: boolean;
  text: (after: Project, created: string[]) => string;
}

type Rec = Record<string, unknown>;

export { CATALOG_TEXT };

// ---------- batch triage ----------
function triage(items: Rec[], issuesOf: (item: Rec, i: number) => InputIssue[], label: (i: number) => string, mode: 'reject' | 'skip' | 'sanitize', what: string) {
  const issues = items.flatMap((it, i) => issuesOf(it, i));
  const errors = issues.filter((x) => x.severity === 'error');
  const bad = new Set(errors.map((x) => x.index));
  if (errors.length && mode === 'reject') {
    throw new ToolError(`${bad.size} of ${items.length} ${what} have problems, so NOTHING was applied (${errors.length} problem${errors.length > 1 ? 's' : ''}):\n${formatInputIssues(errors, label)}\nFix them and resend, or pass onInvalid: "skip" (apply only the valid ones) or "sanitize" (drop just the bad fields).`);
  }
  let use = items;
  const notes: string[] = [];
  if (errors.length && mode === 'skip') {
    use = items.filter((_, i) => !bad.has(i));
    notes.push(`Skipped ${bad.size} invalid ${what}:\n${formatInputIssues(errors, label)}`);
  } else if (errors.length && mode === 'sanitize') {
    use = items.map((it, i) => sanitizeLayer(it, errors.filter((x) => x.index === i)));
    notes.push(`Dropped ${errors.length} invalid field${errors.length > 1 ? 's' : ''} and applied the rest:\n${formatInputIssues(errors, label)}`);
  }
  const warns = issues.filter((x) => x.severity === 'warn');
  if (warns.length) notes.push(`Warnings:\n${formatInputIssues(warns, label)}`);
  return { use, notes };
}

/** What the caller needs right after an edit: estimated text boxes and any design problems on those layers. */
export function feedback(project: Project, ids: string[]): string {
  const set = new Set(ids);
  const lines: string[] = [];
  for (const l of project.layers) {
    if (!set.has(l.id) || l.type !== 'text' || !l.text) continue;
    const b = bounds(l);
    lines.push(`  ${l.id} "${l.name}": est. text ${Math.round(b.x1 - b.x0)}×${Math.round(b.y1 - b.y0)}px, x ${Math.round(b.x0)}–${Math.round(b.x1)}, y ${Math.round(b.y0)}–${Math.round(b.y1)} (centre ${Math.round(l.x)},${Math.round(l.y)}; frame ${project.width}×${project.height})`);
  }
  const issues = lintProject(project).filter((i) => i.severity !== 'info' && i.layerIds?.some((id) => set.has(id)));
  return [lines.length ? `Text layout estimates (about ±6% for plain text; confirm with render_frames):\n${lines.join('\n')}` : '', issues.length ? `Lint on these layers:\n${formatLint(issues).split('\n').slice(1).join('\n')}` : ''].filter(Boolean).join('\n');
}

const nameOf = (items: Rec[]) => (i: number) => `#${i} "${(items[i]?.name ?? items[i]?.id ?? items[i]?.type ?? '?') as string}"`;
const mode = (v: unknown): 'reject' | 'skip' | 'sanitize' => (v === 'skip' || v === 'sanitize' ? v : 'reject');

// ---------- tools ----------
function addLayers(p: Project, a: Rec): Plan | string {
  const layers = (a.layers as Rec[]) ?? [];
  const known = new Set([...p.layers.map((l) => l.id), ...layers.map((l) => l.id).filter((x): x is string => typeof x === 'string')]);
  const { use, notes } = triage(layers, (l, i) => validateLayer(l, i, { knownIds: known }), nameOf(layers), mode(a.onInvalid), 'layers');
  if (!use.length) return `${notes.join('\n')}\nNothing to add.`;
  const names = use.map((l) => (l.name ?? l.type) as string);
  return {
    ops: [{ op: 'addLayers', layers: use as never, above: a.above as string | undefined }],
    label: (a.label as string) ?? `Add ${use.length} layer${use.length > 1 ? 's' : ''}`,
    dryRun: !!a.dryRun,
    text: (after, created) => [`${a.dryRun ? `DRY RUN, nothing changed. Would add ${created.length} layers: ` : 'Added: '}${created.map((id, i) => `${id} (${names[i]})`).join(', ')}`, ...notes, feedback(after, created)].filter(Boolean).join('\n'),
  };
}

function updateLayers(p: Project, a: Rec): Plan | string {
  const updates = (a.updates as Rec[]) ?? [];
  const have = new Set(p.layers.map((l) => l.id));
  const missing: InputIssue[] = updates.flatMap((u, i) => (have.has(u.id as string) ? [] : [{ index: i, path: 'id', message: `No layer with id "${u.id}". Existing ids: ${[...have].slice(0, 12).join(', ')}${have.size > 12 ? ', …' : ''}`, severity: 'error' as const }]));
  const { use, notes } = triage(updates, (u, i) => [...validateLayer(u, i, { patch: true, knownIds: have }), ...missing.filter((m) => m.index === i)], nameOf(updates), mode(a.onInvalid), 'updates');
  if (!use.length) return `${notes.join('\n')}\nNothing to update.`;
  const ids = use.map((u) => u.id as string);
  return {
    ops: [{ op: 'updateLayers', updates: use as never }],
    label: (a.label as string) ?? `Edit ${use.length} layer${use.length > 1 ? 's' : ''}`,
    dryRun: !!a.dryRun,
    text: (after) => [a.dryRun ? `DRY RUN, nothing changed. Would update ${ids.length} layers.` : `Updated ${ids.length}.`, ...notes, feedback(after, ids)].filter(Boolean).join('\n'),
  };
}

function applyMotion(p: Project, a: Rec): Plan | string {
  const probe = { enter: a.enter, exit: a.exit, loop: a.loop } as Rec;
  const errs = validateLayer(probe, 0, { patch: true }).filter((x) => x.severity === 'error');
  if (errs.length) throw new ToolError(`Invalid motion, nothing applied:\n${formatInputIssues(errs, () => 'motion')}`);
  const have = new Set(p.layers.map((l) => l.id));
  const ids = (a.layerIds as string[]) ?? [];
  const missing = ids.filter((id) => !have.has(id));
  if (missing.length) throw new ToolError(`No layer with id: ${missing.join(', ')}. Nothing applied.`);
  return { ops: [{ op: 'updateLayers', updates: ids.map((id) => ({ id, enter: a.enter, exit: a.exit, loop: a.loop })) as never }], label: 'Apply motion', text: () => `Motion applied to ${ids.length} layers.` };
}

function group(p: Project, a: Rec): Plan {
  const ids = (a.layerIds as string[]) ?? [];
  const missing = ids.filter((id) => !p.layers.some((l) => l.id === id));
  if (missing.length) throw new ToolError(`No layer with id: ${missing.join(', ')}`);
  const g = groupOps(p, ids, {
    id: a.groupId as string | undefined,
    name: a.name as string | undefined,
    extra: { enter: { preset: 'none', duration: 0.5, ease: 'spring', ...((a.enter as Rec) ?? {}) } as never, ...(a.exit ? { exit: a.exit as never } : {}), ...(a.loop ? { loop: a.loop as never } : {}), ...(a.pivot ? { pivot: a.pivot as never } : {}) },
  });
  return { ops: g.ops, label: `Group ${ids.length} layers`, text: () => `Group ${g.groupId} (${Math.round(g.box.w)}×${Math.round(g.box.h)} at ${Math.round(g.box.x)},${Math.round(g.box.y)}) holds ${ids.join(', ')}. Animate ${g.groupId}; the members follow.` };
}

function setCamera(p: Project, a: Rec): Plan {
  const keys = ((a.keys as Rec[]) ?? []).map((k) => ({ ...k })) as { t: number; x?: number; y?: number; zoom?: number; rotation?: number; ease?: string }[];
  const errs = keys.flatMap((k, i) => (k.ease ? validateLayer({ keys: [{ t: k.t, ease: k.ease }] }, i, { patch: true }).map((x) => ({ ...x, path: 'ease' })) : []));
  if (errs.length) throw new ToolError(`Invalid camera keys, nothing applied:\n${formatInputIssues(errs, (i) => `key #${i}`)}`);
  let cur = { x: p.width / 2, y: p.height / 2, zoom: 1, rotation: 0 };
  const full = [...keys].sort((x, y) => x.t - y.t).map((k) => {
    cur = { x: k.x ?? cur.x, y: k.y ?? cur.y, zoom: k.zoom ?? cur.zoom, rotation: k.rotation ?? cur.rotation };
    return { t: k.t, ...cur, ...(k.ease ? { ease: k.ease } : {}) };
  });
  return {
    ops: [{ op: 'setCamera', keys: full as never }],
    label: 'Camera',
    text: (after) => {
      const table = full.map((k) => `  t ${k.t.toFixed(2)}s  x ${Math.round(k.x)}  y ${Math.round(k.y)}  zoom ${k.zoom.toFixed(2)}  rot ${k.rotation}${k.ease ? `  ease ${k.ease}` : ''}  → shows ${Math.round(p.width / k.zoom)}×${Math.round(p.height / k.zoom)}px of the ${p.width}×${p.height} stage`).join('\n');
      const crop = lintProject(after).filter((i) => i.code === 'camera-crop');
      return `Camera set (omitted values were filled from the previous key):\n${table}${crop.length ? `\n${formatLint(crop).split('\n').slice(1).join('\n')}` : ''}`;
    },
  };
}

function autoSfx(p: Project, a: Rec): Plan | string {
  const ids = Array.isArray(a.layerIds) ? new Set(a.layerIds as string[]) : null;
  const vol = (a.volume as number) ?? 0.7, ld = (a.lead as number) ?? 0.04;
  const picks: { t: number; sfx: SfxKind; why: string; v: number; dir?: 'up' | 'down' }[] = [];
  const MAP: Record<string, SfxKind | undefined> = { slideLeft: 'whoosh', slideRight: 'whoosh', rise: 'whoosh', drop: 'whoosh', wipe: 'whoosh', blur: 'whoosh', flip: 'whoosh', pop: 'pop', spin: 'pop', zoom: 'pop', letters: 'tick', words: 'tick', typewriter: 'click' };
  for (const l of p.layers) {
    if (l.hidden || (ids && !ids.has(l.id))) continue;
    const sfx = MAP[l.enter.preset];
    if (sfx && !(l.type === 'shape' && l.fill === 'transparent')) picks.push({ t: l.start, sfx, why: l.name, v: l.type === 'text' ? vol * 0.8 : vol, dir: ['slideRight', 'drop'].includes(l.enter.preset) ? 'down' : 'up' });
  }
  if (a.camera ?? true) {
    const ks = [...p.camera].sort((x, y) => x.t - y.t);
    for (let i = 1; i < ks.length; i++) if (Math.abs((ks[i].zoom ?? 1) - (ks[i - 1].zoom ?? 1)) > 0.12 || Math.hypot((ks[i].x ?? 0) - (ks[i - 1].x ?? 0), (ks[i].y ?? 0) - (ks[i - 1].y ?? 0)) > p.width * 0.25) picks.push({ t: ks[i - 1].t, sfx: 'whoosh', why: 'camera move', v: vol, dir: (ks[i].zoom ?? 1) >= (ks[i - 1].zoom ?? 1) ? 'up' : 'down' });
  }
  if (a.sectionHits ?? true) for (const sec of p.sections) if (sec.start > 0.05) picks.push({ t: sec.start + 0.04, sfx: 'hit', why: `section ${sec.name}`, v: vol * 1.1 });
  picks.sort((x, y) => x.t - y.t);
  // A clean mix: no two effects of one kind within 80 ms, effects that land on a hit are dropped, and a cap.
  const kept: typeof picks = [];
  for (const k of picks) {
    if (kept.some((o) => o.sfx === k.sfx && Math.abs(o.t - k.t) < 0.08) || kept.length >= 60) continue;
    if (k.sfx !== 'hit' && picks.some((h) => h.sfx === 'hit' && Math.abs(h.t - k.t) < 0.1)) continue;
    kept.push(k);
  }
  const old = (p.audio ?? []).filter((c) => c.name.startsWith('auto:')).map((c) => c.id);
  const list: Op[] = [];
  if (old.length) list.push({ op: 'deleteAudio', ids: old });
  if (kept.length) list.push({ op: 'addAudio', clips: kept.map((k) => ({ kind: 'sfx' as const, sfx: k.sfx, name: `auto: ${k.sfx} · ${k.why}`, start: Math.max(0, k.t - ld), volume: Math.min(1.5, k.v), direction: k.dir })) });
  if (!list.length) return 'Nothing to sync: no entrances, camera moves or sections matched.';
  const counts = kept.reduce<Record<string, number>>((m, k) => ((m[k.sfx] = (m[k.sfx] ?? 0) + 1), m), {});
  return { ops: list, label: `Auto SFX (${kept.length})`, text: () => `Placed ${kept.length} effects (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}), replacing ${old.length} earlier auto clips. Listen in the editor, then trim with delete_audio / update_audio.` };
}

const TOOLS: Record<string, (p: Project, a: Rec) => Plan | string> = {
  add_layers: addLayers,
  update_layers: updateLayers,
  apply_motion: applyMotion,
  group_layers: group,
  set_camera: setCamera,
  auto_sfx: autoSfx,
};

export const toolNames = () => [...Object.keys(TOOLS), 'analyze_motion'];

/** Run a tool against a project. A string result means "nothing to apply, just tell the caller this". */
export function planTool(name: string, p: Project, args: Rec): Plan | string {
  if (name === 'analyze_motion') return analyzeMotion(p, args as AnalyzeOptions);
  const t = TOOLS[name];
  if (!t) throw Object.assign(new ToolError(`Unknown tool "${name}"`), { status: 404 });
  return t(p, args);
}

export { uid };
