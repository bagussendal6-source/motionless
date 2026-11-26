import type { EaseName, EnterPreset, Layer, LoopPreset, Motion, Project, Section } from './types.ts';

export const ENTER_PRESETS: { id: EnterPreset; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'Cut in. No transition.' },
  { id: 'fade', label: 'Fade', hint: 'Opacity 0 to 1.' },
  { id: 'rise', label: 'Rise', hint: 'Slides up from below while fading in.' },
  { id: 'drop', label: 'Drop', hint: 'Falls in from above.' },
  { id: 'slideLeft', label: 'Slide left', hint: 'Enters from the right, travelling left.' },
  { id: 'slideRight', label: 'Slide right', hint: 'Enters from the left, travelling right.' },
  { id: 'pop', label: 'Pop', hint: 'Scales up from zero on a spring.' },
  { id: 'zoom', label: 'Zoom', hint: 'Shrinks from oversized into place.' },
  { id: 'spin', label: 'Spin', hint: 'Rotates half a turn while scaling up.' },
  { id: 'blur', label: 'Blur', hint: 'Comes into focus.' },
  { id: 'wipe', label: 'Wipe', hint: 'Revealed left to right by a mask.' },
  { id: 'flip', label: 'Flip', hint: 'Flips in on the X axis, like a card.' },
  { id: 'typewriter', label: 'Typewriter', hint: 'Text only: characters appear one by one.' },
  { id: 'letters', label: 'Letters', hint: 'Text only: each letter rises on a stagger.' },
  { id: 'words', label: 'Words', hint: 'Text only: each word pops on a stagger.' },
];

export const LOOP_PRESETS: { id: LoopPreset; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'float', label: 'Float' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'wiggle', label: 'Wiggle' },
  { id: 'spin', label: 'Spin' },
  { id: 'breathe', label: 'Breathe' },
  { id: 'shimmer', label: 'Shimmer' },
];

export const EASES: { id: EaseName; label: string }[] = [
  { id: 'spring', label: 'Spring' },
  { id: 'bouncy', label: 'Bouncy' },
  { id: 'smooth', label: 'Smooth' },
  { id: 'snap', label: 'Snap' },
  { id: 'easeOut', label: 'Ease out' },
  { id: 'easeInOut', label: 'Ease in-out' },
  { id: 'linear', label: 'Linear' },
];

export const FONTS = [
  'Bricolage Grotesque',
  'Inter',
  'Space Grotesk',
  'Syne',
  'Unbounded',
  'Archivo Black',
  'DM Serif Display',
  'Instrument Serif',
  'JetBrains Mono',
];

/**
 * Average glyph advance as a fraction of the font size at weights 400 / 600 / 800, measured with canvas
 * in the editor on mixed Indonesian/English copy. The server has no canvas, so the linter and the
 * text-box estimates use this instead of one guess for every font. Syne is much wider at 800.
 */
export const FONT_ADVANCE: Record<string, [number, number, number]> = {
  'Archivo Black': [0.585, 0.585, 0.585],
  'Bricolage Grotesque': [0.44, 0.454, 0.468],
  'DM Serif Display': [0.468, 0.468, 0.468],
  'Instrument Serif': [0.36, 0.36, 0.36],
  Inter: [0.504, 0.514, 0.525],
  'JetBrains Mono': [0.6, 0.6, 0.6],
  'Space Grotesk': [0.509, 0.51, 0.511],
  Syne: [0.499, 0.537, 0.844],
  Unbounded: [0.635, 0.66, 0.679],
};

/** Advance ratio for a font at a weight, interpolated between the measured weights. */
export function glyphAdvance(font: string | undefined, weight: number | undefined): number {
  const a = FONT_ADVANCE[font ?? 'Inter'] ?? FONT_ADVANCE.Inter;
  const w = Math.max(400, Math.min(800, weight ?? 700));
  return w <= 600 ? a[0] + ((a[1] - a[0]) * (w - 400)) / 200 : a[1] + ((a[2] - a[1]) * (w - 600)) / 200;
}

export const SECTION_COLORS = ['#C8FF3D', '#FF5C8A', '#5CC8FF', '#FFB13D', '#A78BFA', '#3DFFB4', '#FF7A45'];

export const ASPECTS = [
  { id: '16:9', label: 'Landscape 16:9', width: 1920, height: 1080 },
  { id: '9:16', label: 'Portrait 9:16', width: 1080, height: 1920 },
  { id: '1:1', label: 'Square 1:1', width: 1080, height: 1080 },
  { id: '4:5', label: 'Feed 4:5', width: 1080, height: 1350 },
];

let counter = 0;
export function uid(prefix = 'l'): string {
  counter = (counter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}${counter.toString(36)}`;
}

export const NO_MOTION: Motion = { preset: 'none', duration: 0.5, ease: 'spring' };

export function makeLayer(partial: Partial<Layer> & { type: Layer['type'] }, project?: Pick<Project, 'width' | 'height' | 'duration'>): Layer {
  const w = project?.width ?? 1920;
  const h = project?.height ?? 1080;
  const base: Layer = {
    id: uid('l'),
    name: partial.type === 'text' ? 'Text' : partial.type === 'image' ? 'Image' : 'Shape',
    type: partial.type,
    start: 0,
    end: project?.duration ?? 5,
    x: w / 2,
    y: h / 2,
    width: partial.type === 'text' ? Math.round(w * 0.8) : 400,
    height: partial.type === 'text' ? 200 : 400,
    rotation: 0,
    scale: 1,
    opacity: 1,
    fill: partial.type === 'text' ? '#F5F5F0' : '#C8FF3D',
    enter: { preset: 'rise', duration: 0.6, ease: 'spring' },
    exit: { ...NO_MOTION },
    loop: { preset: 'none', period: 2, amount: 0.5 },
    keys: [],
  };
  if (partial.type === 'text') {
    Object.assign(base, { text: 'Your words here', font: 'Bricolage Grotesque', fontSize: 120, fontWeight: 800, letterSpacing: -2, lineHeight: 1.0, align: 'center' });
  }
  if (partial.type === 'shape') Object.assign(base, { shape: 'rect', radius: 24 });
  if (partial.type === 'image') Object.assign(base, { fit: 'cover', radius: 24, fill: 'transparent' });
  const layer = { ...base, ...partial } as Layer;
  layer.enter = { ...base.enter, ...(partial.enter ?? {}) };
  layer.exit = { ...base.exit, ...(partial.exit ?? {}) };
  layer.loop = { ...base.loop, ...(partial.loop ?? {}) };
  layer.keys = [...(partial.keys ?? [])].sort((a, b) => a.t - b.t);
  return layer;
}

export function makeProject(partial: Partial<Project> = {}): Project {
  const now = new Date().toISOString();
  return {
    id: uid('p'),
    name: 'Untitled video',
    width: 1920,
    height: 1080,
    duration: 15,
    fps: 30,
    bpm: 120,
    background: '#0E0E10',
    sections: [],
    layers: [],
    camera: [],
    rev: 0,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function makeSection(partial: Partial<Section> & { start: number; end: number }, index = 0): Section {
  return { id: uid('s'), name: `Section ${index + 1}`, color: SECTION_COLORS[index % SECTION_COLORS.length], ...partial };
}

/** Human and machine readable reference, served to Claude by get_catalog. */
export const CATALOG_TEXT = `
# MotionLess catalog

## Document
A project is JSON: { name, width, height, duration (s), fps, bpm, background, background2?, sections[], layers[] (bottom→top), camera[] }.
Coordinates are stage pixels; a layer's x/y is its CENTRE. Rotation is degrees. Times are absolute seconds.
You never have to compute a centre: pass \`left\` (+ width) or \`right\` (+ width) instead of x, and \`top\` / \`bottom\` (+ height) instead of y.
  Left-aligned text: { align: "left", left: 120, width: 800 }. Text is drawn from the layer's left edge when align is "left",
  from its right edge when "right", and centred in the box when "center".

## Layer
type: "text" | "shape" | "image"
Common: name, start, end, x, y, width, height, rotation, scale, opacity, fill, fill2 (gradient end), stroke, strokeWidth,
radius, shadow {color, blur, x, y}, blend (any canvas composite op, e.g. "screen", "multiply", "difference"), sectionId, hidden.
Text: text (use \\n for line breaks; also wraps at width), font, fontSize, fontWeight, italic, letterSpacing (px), lineHeight (multiple), align.
Shape: shape = rect | ellipse | pill | triangle | star | line.
Text fitting: autoFit: "width" shrinks the font until every line fits unwrapped; "box" until the wrapped text fits width × height.
  add_layers / update_layers print an estimated text box for every text layer (measured font metrics, about ±6% for plain text), so you know before rendering.
Image: src (URL or /api/assets/<file> from import_asset), fit = cover | contain.
pivot: { x, y } = transform origin as a fraction of the layer size from its centre. {x:0,y:0.5} is the bottom edge, {x:-0.5,y:-0.5}
  the top-left corner. Rotation, scale, sx and sy happen around it; the layer still rests where x/y put it.
parent: id of another layer. The child is authored in normal stage coordinates; when the parent moves, scales, rotates or fades
  (keys, enter/exit, loop) the child follows rigidly. Use group_layers to make a transparent parent for a set of layers (a phone mockup,
  a card), then animate the one group layer. Parent a child to a parent and the child's own motion still stacks on top.

## Motion
enter / exit: { preset, duration (s), ease, distance? (px), stagger? (s) }
  presets: ${ENTER_PRESETS.map((p) => `${p.id} (${p.hint})`).join('; ')}
  from (0..0.95, default 0): starting strength. pop with from 0.6 starts at 60% size, letters/words/fade/rise start at that opacity.
    A layer that begins at 0 s with letters or pop is an EMPTY first frame (and an empty thumbnail); set enter.from ≈ 0.3, or enter none.
  exit plays the same preset in reverse, finishing exactly at layer.end.
loop: { preset: ${LOOP_PRESETS.map((p) => p.id).join(' | ')}, period (s), amount (0..1) }
eases: ${EASES.map((e) => e.id).join(', ')}. spring/bouncy overshoot; smooth is critically damped; snap is fast and crisp.

## Keyframes
layer.keys: [{ t, x?, y?, scale?, rotation?, opacity?, width?, height?, fill?, sx?, sy?, stroke?, strokeWidth?, ease? }]
  sx / sy are horizontal / vertical stretch multipliers on top of scale (squash & stretch: land with sy 0.8, sx 1.15, then settle to 1).
  Combine with a bottom pivot so the object squashes against the floor. stroke (colour) and strokeWidth animate the outline.
EVERY PROPERTY IS ITS OWN CHANNEL. A property interpolates only between the keys that set it; a key that leaves it out does NOT hold
  it, the channel just runs straight past that key. So write every property you animate on every key where it should land
  (a squash key at t 8.0 that sets only sx/sy leaves y gliding from the key before to the key after). lint_project notes sparse-keys.
Values between keys interpolate with the arriving key's ease. Before the first key the layer holds the first key's values
for any property it sets; after the last key it holds the last values. Keyframes stack with enter/exit/loop.

## Camera
project.camera: [{ t, x?, y?, zoom?, rotation?, ease? }] — x/y is the stage point the camera looks at (default centre), zoom 1 = no zoom.
Use it for push-ins, whip pans and dutch tilts across the whole scene.
DEFAULTS, because they bite: a value left out of a key is NOT "reset"; it holds what the previous key that set it had (before any key sets it:
x/y = stage centre, zoom 1, rotation 0). So after a pan to x 1500, a later key with only zoom stays panned at x 1500.
Zoom > 1 shows only the middle (width/zoom × height/zoom) of the stage around x/y, so type near the edges gets CUT OFF by the zoom itself.
set_camera therefore writes every key out in full and prints the resolved table; lint_project reports camera-crop for any layer the camera cuts.

## Grouping
group_layers(layerIds) creates a transparent parent and returns its id. Animate the parent (keys, enter, exit, loop, scale, rotation) and every member follows.
Members keep their own motion. ungroup via update_layers { parent: "" }. Deleting a group re-attaches its children to the group's parent.

## Audio
project.audio: [{ id, name, kind music|sfx|voice, src? | sfx? | music?, start, duration?, offset?, volume, fadeIn?, fadeOut?, direction? }]
Built-in sound effects (synthesised, no files needed): ${'whoosh, hit, boom, pop, click, riser, sparkle, tick'}. Built-in music: a loop synthesised from the project bpm
(styles minimal, driving, ambient). Or import_asset a .mp3/.wav/.m4a and add_audio it with src. auto_sfx places effects on layer entrances and camera hits for you.
Audio plays in the editor and is mixed into the exported video.

## Reviewing motion
render_frames shows stills. analyze_motion shows the motion itself: for every enter/exit/keyframe segment, per property the travel, overshoot, anticipation,
settle time, reversals, peak speed and a sparkline, and it flags hard jumps, very bouncy, abrupt and jittery moves.

## Batches
add_layers / update_layers check the WHOLE batch and list every problem at once. onInvalid: "reject" (default, nothing applied), "skip" (apply the valid layers),
"sanitize" (drop only the bad fields, apply the rest). dryRun: true validates and previews without changing anything.

## Fonts
${FONTS.join(', ')}

## Craft notes
- Something new every 1–2 s. Overlap enters with previous exits by ~0.1–0.2 s so cuts feel continuous.
- Snap starts to the beat grid: one beat = 60 / bpm seconds.
- Big type: 140–260 px headlines on 1920×1080, negative letterSpacing (-2 to -8) for display fonts.
- Use render_frames to look at the result while the editor is open, then fix what you see.
`.trim();
