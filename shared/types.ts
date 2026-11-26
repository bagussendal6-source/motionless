// The MotionLess document model. A project is plain JSON: the editor, the API
// server and the MCP server all read and write this same shape.

export type LayerType = 'text' | 'shape' | 'image';
export type ShapeKind = 'rect' | 'ellipse' | 'pill' | 'triangle' | 'star' | 'line';
export type Align = 'left' | 'center' | 'right';

export type EaseName = 'linear' | 'easeOut' | 'easeInOut' | 'spring' | 'bouncy' | 'smooth' | 'snap';

export type EnterPreset =
  | 'none' | 'fade' | 'rise' | 'drop' | 'slideLeft' | 'slideRight'
  | 'pop' | 'zoom' | 'spin' | 'blur' | 'wipe' | 'flip'
  | 'typewriter' | 'letters' | 'words';

export type LoopPreset = 'none' | 'float' | 'pulse' | 'wiggle' | 'spin' | 'breathe' | 'shimmer';

export interface Motion {
  preset: EnterPreset;
  /** Seconds. */
  duration: number;
  ease: EaseName;
  /** Pixels travelled by slide-style presets. */
  distance?: number;
  /** Seconds between characters / words for per-glyph presets. */
  stagger?: number;
  /**
   * Starting strength, 0..1 (default 0). Scale/opacity begin here instead of at nothing, so a layer
   * that starts at 0 s is not an empty frame (thumbnails!). `pop` with from 0.6 starts at 60% size.
   */
  from?: number;
}

export interface LoopMotion {
  preset: LoopPreset;
  /** Seconds per cycle. */
  period: number;
  /** 0..1 strength. */
  amount: number;
}

/** Animatable values. Any omitted value holds the layer's base value. */
export interface KeyValues {
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
  width?: number;
  height?: number;
  fill?: string;
  /** Horizontal / vertical stretch multipliers (squash & stretch). 1 = none. */
  sx?: number;
  sy?: number;
  stroke?: string;
  strokeWidth?: number;
}

export interface Keyframe extends KeyValues {
  /** Absolute project time in seconds. */
  t: number;
  /** Easing used to arrive at this keyframe. */
  ease?: EaseName;
}

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  /** Absolute seconds. */
  start: number;
  end: number;
  /** Centre of the layer in stage pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  opacity: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  shadow?: { color: string; blur: number; x: number; y: number };
  blend?: GlobalCompositeOperation;

  // shape
  shape?: ShapeKind;
  /** Gradient end colour for shapes and text. */
  fill2?: string;

  // text
  text?: string;
  font?: string;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  letterSpacing?: number;
  lineHeight?: number;
  align?: Align;

  // image
  src?: string;
  fit?: 'cover' | 'contain';

  /** Text only: shrink the font until the text fits. 'width' = every line fits unwrapped; 'box' = wrapped text fits width × height. */
  autoFit?: 'width' | 'box';

  /**
   * Pivot for rotation / scale / sx / sy, as a fraction of the layer's size from its centre:
   * {x:0,y:0.5} = bottom edge centre (landing squash), {x:-0.5,y:-0.5} = top-left. Default centre.
   * The layer rests exactly where x/y put it; only the transform origin moves.
   */
  pivot?: { x: number; y: number };
  /**
   * Parent layer id. The child is authored in normal stage coordinates; whenever the parent moves,
   * scales, rotates or fades (keys, enter/exit, loop) the child follows it as one rigid group.
   */
  parent?: string;

  enter: Motion;
  exit: Motion;
  loop: LoopMotion;
  keys: Keyframe[];

  sectionId?: string;
  hidden?: boolean;
  locked?: boolean;
}

export interface Section {
  id: string;
  name: string;
  start: number;
  end: number;
  color: string;
}

export interface CameraKey {
  t: number;
  x?: number;
  y?: number;
  zoom?: number;
  rotation?: number;
  ease?: EaseName;
}

export type SfxKind = 'whoosh' | 'hit' | 'boom' | 'pop' | 'click' | 'riser' | 'sparkle' | 'tick';

/** A sound on the timeline. Either an imported file (src) or something MotionLess synthesises. */
export interface AudioClip {
  id: string;
  name: string;
  kind: 'music' | 'sfx' | 'voice';
  /** Imported file, /api/assets/<file>. */
  src?: string;
  /** Built-in sound effect. */
  sfx?: SfxKind;
  /** Built-in music loop (synthesised from the project bpm). */
  music?: { style: 'minimal' | 'driving' | 'ambient'; key?: number };
  /** Seconds into the project. */
  start: number;
  /** Seconds of the clip to play (default: whole file / sfx length / until the video ends). */
  duration?: number;
  /** Seconds skipped at the start of the file. */
  offset?: number;
  /** 0..1.5, default 1. */
  volume: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Sfx only: 'up' or 'down' sweep for whoosh and riser. */
  direction?: 'up' | 'down';
}

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
  fps: number;
  bpm: number;
  background: string;
  background2?: string;
  sections: Section[];
  /** Bottom to top draw order. */
  layers: Layer[];
  camera: CameraKey[];
  audio?: AudioClip[];
  rev: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  duration: number;
  layers: number;
  updatedAt: string;
}

export interface HistoryEntry {
  id: string;
  label: string;
  source: 'user' | 'claude' | 'system';
  at: string;
}

/** Messages pushed to editors over SSE. */
export type ServerEvent =
  | { type: 'project'; project: Project; label: string; source: HistoryEntry['source']; clientId?: string }
  | { type: 'history'; projectId: string; history: HistoryEntry[]; cursor: number }
  | { type: 'render'; projectId: string; requestId: string; times: number[]; width: number; sheet?: { cols: number } }
  | { type: 'claude'; projectId: string; status: string; at: string }
  | { type: 'hello'; claudeSeenAt: string | null };
