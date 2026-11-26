#!/usr/bin/env node
// MotionLess MCP server (stdio). Claude Code calls these tools; each one goes
// through the local API server, which saves the change, adds an undo step and
// pushes it live to any open editor.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'node:path';
import { ASPECTS, EASES, ENTER_PRESETS, FONTS, LOOP_PRESETS } from '../shared/catalog.ts';
import type { Op } from '../shared/ops.ts';
import type { AudioClip, Project, ProjectSummary, SfxKind } from '../shared/types.ts';

const API = process.env.MOTIONLESS_API ?? `http://127.0.0.1:${process.env.MOTIONLESS_PORT ?? 4317}`;
const EDITOR = process.env.MOTIONLESS_EDITOR ?? 'http://localhost:5173';

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-motionless-client': 'mcp', ...(init.headers ?? {}) },
    });
  } catch {
    throw new Error(`MotionLess API is not reachable at ${API}. Start it with \`npm run dev\` in the MotionLess folder.`);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const ops = async (projectId: string, list: Op[], label: string) => {
  const out = await api<{ project: Project; created: string[] }>(`/projects/${projectId}/ops`, { method: 'POST', body: JSON.stringify({ ops: list, label }) });
  return out;
};

const fetchProject = (projectId: string) => api<Project>(`/projects/${projectId}`);

/**
 * Run a tool on the API server. Validation, lint feedback, camera resolution, auto-SFX and motion analysis all
 * happen there (next to the shared/ code they use), so this process holds no logic that can go stale.
 */
const tool = async (projectId: string, name: string, args: Record<string, unknown>) => ok((await api<{ text: string }>(`/projects/${projectId}/tool/${name}`, { method: 'POST', body: JSON.stringify(args) })).text);

// ---------- schemas ----------
// Enum-like fields are plain strings here on purpose: the whole batch is validated by shared/validate.ts
// so every typo is reported together (with a "did you mean"), instead of the first one rejecting the call.
const EASE_IDS = EASES.map((e) => e.id).join(' | ');
const ease = z.string().describe(`One of: ${EASE_IDS}`);
const motion = z.object({
  preset: z.string().optional().describe(`One of: ${ENTER_PRESETS.map((p) => p.id).join(' | ')}`),
  duration: z.number().optional().describe('Seconds'),
  ease: ease.optional(),
  distance: z.number().optional().describe('Pixels for slide-style presets'),
  stagger: z.number().optional().describe('Seconds between glyphs for letters/words'),
  from: z.number().optional().describe('0..0.95 starting strength. Keeps frame 0 from being empty (pop/letters/fade start at this size/opacity instead of 0)'),
});
const loop = z.object({
  preset: z.string().optional().describe(`One of: ${LOOP_PRESETS.map((p) => p.id).join(' | ')}`),
  period: z.number().optional(),
  amount: z.number().min(0).max(1).optional(),
});
const keyframe = z.object({
  t: z.number(), x: z.number().optional(), y: z.number().optional(), scale: z.number().optional(),
  rotation: z.number().optional(), opacity: z.number().optional(), width: z.number().optional(),
  height: z.number().optional(), fill: z.string().optional(),
  sx: z.number().optional().describe('Horizontal stretch multiplier (squash & stretch), 1 = none'),
  sy: z.number().optional().describe('Vertical stretch multiplier, 1 = none'),
  stroke: z.string().optional().describe('Animated outline colour'),
  strokeWidth: z.number().optional().describe('Animated outline width'),
  ease: ease.optional(),
});
const layerFields = {
  name: z.string().optional(),
  start: z.number().optional().describe('Seconds'),
  end: z.number().optional().describe('Seconds'),
  x: z.number().optional().describe('Centre x in stage px'),
  y: z.number().optional().describe('Centre y in stage px'),
  left: z.number().optional().describe('Left edge in stage px (sets x = left + width/2). Use instead of x for left-aligned text'),
  right: z.number().optional().describe('Right edge in stage px (sets x = right - width/2)'),
  top: z.number().optional().describe('Top edge in stage px (sets y = top + height/2)'),
  bottom: z.number().optional().describe('Bottom edge in stage px (sets y = bottom - height/2)'),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional(),
  scale: z.number().optional(),
  opacity: z.number().optional(),
  fill: z.string().optional(),
  fill2: z.string().optional().describe('Gradient end colour'),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  radius: z.number().optional(),
  shadow: z.object({ color: z.string(), blur: z.number(), x: z.number(), y: z.number() }).optional(),
  blend: z.string().optional(),
  shape: z.string().optional().describe('rect | ellipse | pill | triangle | star | line'),
  text: z.string().optional(),
  font: z.string().optional().describe(`One of: ${FONTS.join(', ')}`),
  fontSize: z.number().optional(),
  fontWeight: z.number().optional(),
  italic: z.boolean().optional(),
  letterSpacing: z.number().optional(),
  lineHeight: z.number().optional(),
  align: z.string().optional().describe('left | center | right'),
  autoFit: z.string().optional().describe('Text only. "width": shrink until every line fits unwrapped; "box": shrink until the wrapped text fits width × height'),
  src: z.string().optional(),
  fit: z.string().optional().describe('cover | contain'),
  pivot: z.object({ x: z.number(), y: z.number() }).optional().describe('Transform origin as a fraction of size from the centre: {x:0,y:0.5} = bottom edge. Rotation/scale/sx/sy happen around it'),
  parent: z.string().optional().describe('Parent layer id: the child follows the parent\'s movement, scale, rotation and fade. Empty string detaches'),
  enter: motion.optional(),
  exit: motion.optional(),
  loop: loop.optional(),
  keys: z.array(keyframe).optional(),
  sectionId: z.string().optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
};
const newLayer = z.object({ type: z.string().describe('text | shape | image'), id: z.string().optional(), ...layerFields });
const layerPatch = z.object({ id: z.string(), ...layerFields });
const pid = z.string().describe('Project id (see list_projects)');
const batchMode = {
  onInvalid: z.enum(['reject', 'skip', 'sanitize']).optional().describe('What to do when some items are invalid. reject (default): apply nothing, list every problem. skip: apply the valid items. sanitize: drop only the bad fields and apply the rest'),
  dryRun: z.boolean().optional().describe('Validate and preview (text boxes, lint) without changing the project'),
};

// ---------- server ----------
const server = new McpServer(
  { name: 'motionless', version: '0.2.0' },
  {
    instructions: [
      'MotionLess is a motion-design editor. Videos are JSON documents edited only through these tools; the user watches the edits land live in the editor.',
      'Start with get_catalog. Keep a 15 s default unless asked otherwise. Something new every 1–2 s, every move on springs, snapped to the beat grid (60/bpm).',
      "Brand comes from the user's repo: read their README, CSS/Tailwind config and logo, use their copy, colours and fonts, and import_asset real images.",
      'Plan sections first (set_sections), build section by section, then run lint_project and fix everything it reports, review the whole piece with render_frames (sheet: true, every 0.25 s), list what a demanding art director would reject, fix it, and look again.',
      'Group related layers with group_layers and animate the group instead of keying every member. Position by edge (left/right/top/bottom) rather than computing centres; autoFit text that must fit a box.',
      'add_layers / update_layers validate the whole batch and list every problem at once (onInvalid: skip | sanitize, dryRun). They also return estimated text boxes and lint, so fix those before rendering.',
      'Judge motion with analyze_motion (overshoot, settle, hard jumps), not only stills. Add sound: add_audio for music or effects, auto_sfx to sync effects to the picture.',
      'Use report_progress to tell the user what you are working on.',
    ].join('\n'),
  },
);

server.registerTool('get_catalog', { description: 'Document format, motion presets, eases, fonts and craft notes. Read before the first edit.' }, async () => ok((await api<{ text: string }>('/catalog')).text));

server.registerTool('list_projects', { description: 'List projects, newest first.' }, async () => {
  const list = await api<ProjectSummary[]>('/projects');
  return ok(list.map((p) => `${p.id} · ${p.name} · ${p.width}×${p.height} · ${p.duration}s · ${p.layers} layers · ${p.updatedAt}`).join('\n') || 'No projects yet.');
});

server.registerTool(
  'create_project',
  {
    description: 'Create a new empty project and return its id and editor URL.',
    inputSchema: {
      name: z.string(),
      aspect: z.enum(ASPECTS.map((a) => a.id) as [string, ...string[]]).optional().describe('Defaults to 16:9'),
      duration: z.number().optional().describe('Seconds, default 15'),
      bpm: z.number().optional(),
      fps: z.number().optional(),
      background: z.string().optional(),
      background2: z.string().optional().describe('Optional gradient end colour'),
    },
  },
  async ({ aspect, ...rest }) => {
    const a = ASPECTS.find((x) => x.id === aspect) ?? ASPECTS[0];
    const p = await api<Project>('/projects', { method: 'POST', body: JSON.stringify({ ...rest, duration: rest.duration ?? 15, width: a.width, height: a.height }) });
    return ok(`Created ${p.id} (${p.width}×${p.height}, ${p.duration}s). Ask the user to open ${EDITOR}/p/${p.id} to watch it build.`);
  },
);

server.registerTool(
  'get_project',
  { description: 'Read the full project JSON (all layers, sections, camera).', inputSchema: { projectId: pid } },
  async ({ projectId }) => ok(JSON.stringify(await api<Project>(`/projects/${projectId}`))),
);

server.registerTool(
  'update_project',
  {
    description: 'Change project settings: name, duration, bpm, fps, background, background2.',
    inputSchema: {
      projectId: pid,
      name: z.string().optional(), duration: z.number().optional(), bpm: z.number().optional(), fps: z.number().optional(),
      background: z.string().optional(), background2: z.string().optional(),
    },
  },
  async ({ projectId, ...patch }) => {
    await ops(projectId, [{ op: 'updateProject', patch }], 'Project settings');
    return ok('Updated.');
  },
);

server.registerTool(
  'add_layers',
  {
    description: 'Add layers (text, shape, image). Later layers draw on top. Every layer in the batch is validated first and ALL problems are listed together; use onInvalid "skip" or "sanitize" to apply the good part anyway, or dryRun to check without changing anything. Returns the new ids plus estimated text boxes and lint for them.',
    inputSchema: { projectId: pid, layers: z.array(newLayer).min(1), above: z.string().optional().describe('Insert above this layer id; default top'), label: z.string().optional().describe('Undo label'), ...batchMode },
  },
  async ({ projectId, ...args }) => tool(projectId, 'add_layers', args),
);

server.registerTool(
  'update_layers',
  {
    description: 'Patch layers by id. enter/exit/loop merge into the existing motion; keys replaces the keyframe list. left/right/top/bottom position by edge. The whole batch is validated first and all problems are listed together (onInvalid / dryRun as in add_layers).',
    inputSchema: { projectId: pid, updates: z.array(layerPatch).min(1), label: z.string().optional(), ...batchMode },
  },
  async ({ projectId, ...args }) => tool(projectId, 'update_layers', args),
);

server.registerTool(
  'group_layers',
  {
    description: 'Group layers under one transparent parent so they move, scale, rotate and fade as one (a phone mockup, a card). Returns the group id: animate that layer (update_layers keys / enter / exit / loop) and every member follows, while members keep their own motion. Ungroup with update_layers { parent: "" }.',
    inputSchema: {
      projectId: pid, layerIds: z.array(z.string()).min(1), name: z.string().optional(), groupId: z.string().optional(),
      pivot: z.object({ x: z.number(), y: z.number() }).optional().describe('Group transform origin as a fraction of the group box from its centre'),
      enter: motion.optional(), exit: motion.optional(), loop: loop.optional(),
    },
  },
  async ({ projectId, ...args }) => tool(projectId, 'group_layers', args),
);

server.registerTool(
  'delete_layers',
  { description: 'Delete layers by id.', inputSchema: { projectId: pid, layerIds: z.array(z.string()).min(1) } },
  async ({ projectId, layerIds }) => {
    await ops(projectId, [{ op: 'deleteLayers', ids: layerIds }], `Delete ${layerIds.length} layer${layerIds.length > 1 ? 's' : ''}`);
    return ok('Deleted.');
  },
);

server.registerTool(
  'duplicate_layers',
  { description: 'Duplicate layers; copies sit directly above their originals.', inputSchema: { projectId: pid, layerIds: z.array(z.string()).min(1), offset: z.number().optional().describe('Pixel offset, default 24') } },
  async ({ projectId, layerIds, offset }) => {
    const out = await ops(projectId, [{ op: 'duplicateLayers', ids: layerIds, offset }], 'Duplicate');
    return ok(`Copies: ${out.created.join(', ')}`);
  },
);

server.registerTool(
  'reorder_layer',
  { description: 'Move a layer to a draw-order index (0 = bottom).', inputSchema: { projectId: pid, layerId: z.string(), index: z.number().int() } },
  async ({ projectId, layerId, index }) => {
    await ops(projectId, [{ op: 'reorderLayer', id: layerId, index }], 'Reorder');
    return ok('Moved.');
  },
);

server.registerTool(
  'apply_motion',
  {
    description: 'Set enter / exit / loop motion on several layers at once.',
    inputSchema: { projectId: pid, layerIds: z.array(z.string()).min(1), enter: motion.optional(), exit: motion.optional(), loop: loop.optional() },
  },
  async ({ projectId, ...args }) => tool(projectId, 'apply_motion', args),
);

server.registerTool(
  'retime',
  {
    description: 'Shift layers in time (keyframes move with them) or set start/end. Omit layerIds to shift every layer.',
    inputSchema: { projectId: pid, layerIds: z.array(z.string()).optional(), shift: z.number().optional(), start: z.number().optional(), end: z.number().optional() },
  },
  async ({ projectId, layerIds, ...rest }) => {
    await ops(projectId, [{ op: 'retime', ids: layerIds, ...rest }], 'Retime');
    return ok('Retimed.');
  },
);

server.registerTool(
  'set_sections',
  {
    description: 'Replace the section list (the storyboard shown above the timeline). Layers may reference a section via sectionId.',
    inputSchema: { projectId: pid, sections: z.array(z.object({ id: z.string().optional(), name: z.string(), start: z.number(), end: z.number(), color: z.string().optional() })) },
  },
  async ({ projectId, sections }) => {
    const out = await ops(projectId, [{ op: 'setSections', sections }], 'Sections');
    return ok(`Sections: ${out.project.sections.map((s) => `${s.id} ${s.name} ${s.start}–${s.end}s`).join('; ')}`);
  },
);

server.registerTool(
  'set_camera',
  {
    description: 'Replace camera keyframes. x/y = the stage point the camera centres on (default: stage centre), zoom 1 = none, rotation in degrees. A value you leave out HOLDS the previous key\'s value (it does not reset), so every key is written out in full and the resolved table is returned. Zoom > 1 crops the edges: only the middle width/zoom × height/zoom of the stage is visible, so keep text away from the edge or lower the zoom (lint_project reports camera-crop).',
    inputSchema: { projectId: pid, keys: z.array(z.object({ t: z.number(), x: z.number().optional(), y: z.number().optional(), zoom: z.number().optional(), rotation: z.number().optional(), ease: ease.optional() })) },
  },
  async ({ projectId, ...args }) => tool(projectId, 'set_camera', args),
);

server.registerTool(
  'adapt_aspect',
  { description: 'Re-lay the whole video for another frame size (e.g. portrait).', inputSchema: { projectId: pid, aspect: z.enum(ASPECTS.map((a) => a.id) as [string, ...string[]]) } },
  async ({ projectId, aspect }) => {
    const a = ASPECTS.find((x) => x.id === aspect)!;
    await ops(projectId, [{ op: 'resize', width: a.width, height: a.height }], `Adapt to ${a.id}`);
    return ok(`Now ${a.width}×${a.height}. Check type sizes and positions with render_frames; adapting is a starting point.`);
  },
);

server.registerTool(
  'import_asset',
  {
    description: "Copy an image from the user's repo (absolute or relative path) or a URL into MotionLess. Returns a src for image layers.",
    inputSchema: { path: z.string().optional(), url: z.string().url().optional() },
  },
  async ({ path, url }) => {
    const out = await api<{ url: string }>('/assets/import', { method: 'POST', body: JSON.stringify({ path: path ? resolve(path) : undefined, url }) });
    return ok(`src: ${out.url}`);
  },
);

server.registerTool('undo', { description: 'Undo the last change.', inputSchema: { projectId: pid } }, async ({ projectId }) => {
  const r = await api<{ moved: boolean; label?: string }>(`/projects/${projectId}/undo`, { method: 'POST' });
  return ok(r.moved ? r.label! : 'Nothing to undo.');
});
server.registerTool('redo', { description: 'Redo the last undone change.', inputSchema: { projectId: pid } }, async ({ projectId }) => {
  const r = await api<{ moved: boolean; label?: string }>(`/projects/${projectId}/redo`, { method: 'POST' });
  return ok(r.moved ? r.label! : 'Nothing to redo.');
});
server.registerTool('history', { description: 'List the undo history.', inputSchema: { projectId: pid } }, async ({ projectId }) => {
  const h = await api<{ history: { label: string; source: string; at: string }[]; cursor: number }>(`/projects/${projectId}/history`);
  return ok(h.history.map((e, i) => `${i === h.cursor ? '→' : ' '} ${e.at.slice(11, 19)} [${e.source}] ${e.label}`).join('\n'));
});

server.registerTool(
  'get_selection',
  { description: 'What the user has selected in the editor (resolve "this" / "it" / "here"), plus the playhead time.' },
  async () => {
    const s = await api<{ projectId: string | null; layerIds: string[]; time: number }>('/selection');
    if (!s.projectId) return ok('Nothing selected. The editor may be closed.');
    return ok(`project ${s.projectId}, time ${s.time.toFixed(2)}s, layers: ${s.layerIds.join(', ') || '(none)'}`);
  },
);

server.registerTool(
  'render_frames',
  {
    description: [
      'Render frames and look at them. Needs the project open in the editor.',
      'Default: up to 12 separate images at `times`. Pass `sheet: true` for ONE labelled contact sheet of up to 48 frames, the way to review a whole video cheaply: use `from`/`to`/`every` (e.g. 0 to 15 every 0.5) instead of listing times.',
      'Stills cannot show motion quality: use analyze_motion for overshoot, settle time and jumps, and sample densely (every 0.1 to 0.25 s) across each entrance, cut and camera move to compare neighbouring frames.',
    ].join(' '),
    inputSchema: {
      projectId: pid,
      times: z.array(z.number()).max(48).optional(),
      from: z.number().optional(), to: z.number().optional(), every: z.number().min(0.04).optional(),
      sheet: z.boolean().optional(),
      cols: z.number().int().min(1).max(8).optional().describe('Sheet columns, default 4'),
      width: z.number().optional().describe('Pixel width per frame, or of the whole sheet when sheet is true. Defaults: 640 / 1800'),
    },
  },
  async ({ projectId, times, from, to, every, sheet, cols, width }) => {
    let ts = times ?? [];
    if (!ts.length && every) { const hi = to ?? (await api<Project>(`/projects/${projectId}`)).duration; for (let t = from ?? 0; t < hi - 1e-6 && ts.length < 48; t += every) ts.push(Math.round(t * 1000) / 1000); }
    if (!ts.length) throw new Error('Pass times, or from/to/every.');
    if (!sheet && ts.length > 12) throw new Error('At most 12 separate frames. Use sheet: true for more.');
    const r = await api<{ frames: string[] }>(`/projects/${projectId}/render`, { method: 'POST', body: JSON.stringify({ times: ts, width: width ?? (sheet ? 1800 : 640), sheet: sheet ? { cols: cols ?? 4 } : undefined }) });
    if (sheet) return { content: [{ type: 'text' as const, text: `Contact sheet, ${ts.length} frames: ${ts.map((t) => t.toFixed(2)).join(', ')}s (left to right, top to bottom)` }, { type: 'image' as const, data: r.frames[0].replace(/^data:image\/\w+;base64,/, ''), mimeType: 'image/jpeg' }] };
    return {
      content: r.frames.flatMap((f, i) => [
        { type: 'text' as const, text: `t = ${ts[i].toFixed(2)}s` },
        { type: 'image' as const, data: f.replace(/^data:image\/\w+;base64,/, ''), mimeType: 'image/jpeg' },
      ]),
    };
  },
);

server.registerTool(
  'lint_project',
  {
    description: 'Automatic design review: text running off-frame or overlapping, small or low-contrast text, blank frames, dead air, off-beat starts, bad sections, missing images and fonts. Works without the editor open. Run it after every build pass and fix every error and warning before showing the user; confirm borderline ones with render_frames.',
    inputSchema: { projectId: pid },
  },
  async ({ projectId }) => ok((await api<{ text: string }>(`/projects/${projectId}/lint`)).text),
);

server.registerTool(
  'report_progress',
  { description: 'Show a short status line in the editor ("Building the hook…").', inputSchema: { projectId: pid, status: z.string().max(140) } },
  async ({ projectId, status }) => {
    await api(`/projects/${projectId}/claude`, { method: 'POST', body: JSON.stringify({ status }) });
    return ok('Shown.');
  },
);

// ---------- motion review ----------
server.registerTool(
  'analyze_motion',
  {
    description: 'Review HOW things move, in numbers, since render_frames only shows stills. For each enter / exit / keyframe segment: travel, overshoot, anticipation, settle time, direction reversals, peak speed and a sparkline per property (x, y, scale, rotation, opacity, sx, sy), with flags for hard jumps (a cut disguised as motion), very bouncy, abrupt (no ease-out), slow settles and jitter. By default only flagged segments are listed (verbose: true shows all). Add camera: true for the camera path. Pass layerIds + samples: true for per-frame values.',
    inputSchema: { projectId: pid, layerIds: z.array(z.string()).optional(), camera: z.boolean().optional(), verbose: z.boolean().optional().describe('Show clean segments too (default: flagged only)'), samples: z.boolean().optional(), from: z.number().optional(), to: z.number().optional() },
  },
  async ({ projectId, ...args }) => tool(projectId, 'analyze_motion', args),
);

// ---------- audio ----------
const SFX: SfxKind[] = ['whoosh', 'hit', 'boom', 'pop', 'click', 'riser', 'sparkle', 'tick'];
const clipSchema = z.object({
  id: z.string().optional(), name: z.string().optional(),
  kind: z.enum(['music', 'sfx', 'voice']).optional(),
  src: z.string().optional().describe('Imported audio file (/api/assets/<file> from import_asset: mp3, wav, m4a, ogg)'),
  sfx: z.enum(SFX as [SfxKind, ...SfxKind[]]).optional().describe('Built-in synthesised effect'),
  music: z.object({ style: z.enum(['minimal', 'driving', 'ambient']), key: z.number().int().min(0).max(11).optional().describe('Root note, 0 = C') }).optional().describe('Built-in music loop synthesised from the project bpm'),
  start: z.number().describe('Seconds into the video'),
  duration: z.number().optional(), offset: z.number().optional(),
  volume: z.number().min(0).max(1.5).optional(), fadeIn: z.number().optional(), fadeOut: z.number().optional(),
  direction: z.enum(['up', 'down']).optional(),
});

server.registerTool(
  'add_audio',
  {
    description: 'Add sound to the video: an imported file (src), a built-in effect (sfx: whoosh, hit, boom, pop, click, riser, sparkle, tick) or built-in music (music: {style}) synthesised from the project bpm so it sits on the beat grid. It plays in the editor and is mixed into the exported video. Place effects ~0.05 s before the visual hit.',
    inputSchema: { projectId: pid, clips: z.array(clipSchema).min(1) },
  },
  async ({ projectId, clips }) => {
    const bad = clips.flatMap((c, i) => (c.src || c.sfx || c.music ? [] : [`clip #${i}: give one of src, sfx or music`]));
    if (bad.length) throw new Error(bad.join('\n'));
    const out = await ops(projectId, [{ op: 'addAudio', clips: clips.map((c) => ({ ...c, kind: c.kind ?? (c.music ? 'music' : c.sfx ? 'sfx' : 'music') })) as never }], `Add ${clips.length} audio clip${clips.length > 1 ? 's' : ''}`);
    return ok(`Added: ${out.created.join(', ')}`);
  },
);

server.registerTool(
  'update_audio',
  { description: 'Change audio clips by id (start, volume, fades, duration, offset, sfx, music).', inputSchema: { projectId: pid, updates: z.array(clipSchema.extend({ id: z.string(), start: z.number().optional() })).min(1) } },
  async ({ projectId, updates }) => {
    await ops(projectId, [{ op: 'updateAudio', updates: updates as never }], 'Edit audio');
    return ok('Updated.');
  },
);

server.registerTool(
  'delete_audio',
  { description: 'Delete audio clips by id. Pass none to see what exists.', inputSchema: { projectId: pid, ids: z.array(z.string()).optional() } },
  async ({ projectId, ids }) => {
    if (!ids?.length) {
      const a = (await fetchProject(projectId)).audio ?? [];
      return ok(a.length ? a.map((c: AudioClip) => `${c.id} · ${c.kind} · ${c.name} · ${c.start.toFixed(2)}s · vol ${c.volume}`).join('\n') : 'No audio clips.');
    }
    await ops(projectId, [{ op: 'deleteAudio', ids }], `Delete ${ids.length} audio clip${ids.length > 1 ? 's' : ''}`);
    return ok('Deleted.');
  },
);

server.registerTool(
  'auto_sfx',
  {
    description: 'Sync sound effects to the picture: puts a whoosh on slide/rise/wipe entrances, a pop on pop/spin/zoom entrances, a tick on letters/words/typewriter, a whoosh on camera zooms and a hit at each section start (effects that would land on a hit are dropped). Replaces earlier auto_sfx clips (named "auto: …"). Run it after the visuals are locked, then thin out or adjust with update_audio / delete_audio.',
    inputSchema: { projectId: pid, layerIds: z.array(z.string()).optional().describe('Default: every layer'), volume: z.number().min(0).max(1.5).optional(), camera: z.boolean().optional(), sectionHits: z.boolean().optional(), lead: z.number().optional().describe('Seconds before the visual (default 0.04)') },
  },
  async ({ projectId, ...args }) => tool(projectId, 'auto_sfx', args),
);

server.registerTool('open_editor', { description: 'Editor URL for a project.', inputSchema: { projectId: pid } }, async ({ projectId }) => ok(`${EDITOR}/p/${projectId}`));

await server.connect(new StdioServerTransport());

// Tell the API this Claude Code session is alive, so the editor can show "connected".
const sessionId = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const beat = () => fetch(`${API}/api/mcp/heartbeat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: sessionId, cwd: process.cwd(), pid: process.pid }) }).catch(() => {});
beat();
setInterval(beat, 8000).unref();
const bye = () => { fetch(`${API}/api/mcp/bye`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: sessionId }) }).catch(() => {}); };
process.stdin.on('close', () => { bye(); setTimeout(() => process.exit(0), 150); });
process.on('SIGTERM', () => { bye(); setTimeout(() => process.exit(0), 150); });
