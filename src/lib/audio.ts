// Sound for MotionLess. Everything is mixed into ONE AudioBuffer with an OfflineAudioContext
// (imported files plus synthesised effects and music), so preview, export and the picture stay in sync.
import type { AudioClip, Project, SfxKind } from '../../shared/types.ts';

const SR = 44100;
const MUSIC_GAIN = 0.5;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise(ctx: BaseAudioContext, seconds: number, seed: number) {
  const buf = ctx.createBuffer(1, Math.max(1, Math.ceil(seconds * ctx.sampleRate)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  const r = rng(seed);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

/** A gain node that rises to `peak` and falls back to silence. */
function envelope(ctx: BaseAudioContext, out: AudioNode, at: number, attack: number, peak: number, total: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + Math.max(0.002, attack));
  g.gain.exponentialRampToValueAtTime(0.0001, at + total);
  g.connect(out);
  return g;
}

function tone(ctx: BaseAudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, at: number, attack: number, peak: number, total: number) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + total * 0.85);
  o.connect(envelope(ctx, out, at, attack, peak, total));
  o.start(at);
  o.stop(at + total + 0.05);
}

export const SFX_LENGTH: Record<SfxKind, number> = { whoosh: 0.7, hit: 0.5, boom: 1.5, pop: 0.18, click: 0.06, riser: 1.6, sparkle: 1, tick: 0.05 };

function voice(ctx: BaseAudioContext, out: AudioNode, kind: SfxKind, at: number, dur: number, dir: 'up' | 'down', seed: number) {
  switch (kind) {
    case 'whoosh': {
      const n = noise(ctx, dur + 0.1, seed);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 1.1;
      const [a, b] = dir === 'up' ? [350, 4200] : [4200, 350];
      bp.frequency.setValueAtTime(a, at);
      bp.frequency.exponentialRampToValueAtTime(b, at + dur);
      n.connect(bp); bp.connect(envelope(ctx, out, at, dur * 0.45, 1.1, dur));
      n.start(at); n.stop(at + dur + 0.1);
      break;
    }
    case 'hit': {
      tone(ctx, out, 'sine', 170, 42, at, 0.004, 1, dur);
      const n = noise(ctx, 0.1, seed);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
      n.connect(lp); lp.connect(envelope(ctx, out, at, 0.002, 0.5, 0.08));
      n.start(at); n.stop(at + 0.1);
      break;
    }
    case 'boom': {
      tone(ctx, out, 'sine', 95, 26, at, 0.01, 1.1, dur);
      const n = noise(ctx, dur, seed);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, at); lp.frequency.exponentialRampToValueAtTime(80, at + dur);
      n.connect(lp); lp.connect(envelope(ctx, out, at, 0.01, 0.6, dur));
      n.start(at); n.stop(at + dur);
      break;
    }
    case 'pop': {
      tone(ctx, out, 'sine', 560, 190, at, 0.003, 0.9, dur);
      const n = noise(ctx, 0.03, seed);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
      n.connect(hp); hp.connect(envelope(ctx, out, at, 0.001, 0.25, 0.025));
      n.start(at); n.stop(at + 0.03);
      break;
    }
    case 'click':
    case 'tick': {
      const n = noise(ctx, 0.06, seed);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = kind === 'tick' ? 3600 : 2400; bp.Q.value = kind === 'tick' ? 6 : 2;
      n.connect(bp); bp.connect(envelope(ctx, out, at, 0.001, kind === 'tick' ? 0.7 : 0.9, kind === 'tick' ? 0.035 : 0.05));
      n.start(at); n.stop(at + 0.06);
      break;
    }
    case 'riser': {
      const n = noise(ctx, dur, seed);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.Q.value = 2;
      hp.frequency.setValueAtTime(220, at); hp.frequency.exponentialRampToValueAtTime(6500, at + dur);
      n.connect(hp);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.9, at + dur * 0.97); g.gain.linearRampToValueAtTime(0, at + dur);
      hp.connect(g); g.connect(out);
      n.start(at); n.stop(at + dur);
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(110, at); o.frequency.exponentialRampToValueAtTime(880, at + dur);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, at); og.gain.exponentialRampToValueAtTime(0.12, at + dur * 0.97); og.gain.linearRampToValueAtTime(0, at + dur);
      o.connect(og); og.connect(out); o.start(at); o.stop(at + dur);
      break;
    }
    case 'sparkle': {
      const r = rng(seed);
      const notes = [1568, 1760, 2093, 2349, 2637, 3136, 3520, 4186];
      for (let i = 0; i < 6; i++) tone(ctx, out, 'sine', notes[Math.floor(r() * notes.length)], notes[Math.floor(r() * notes.length)], at + i * 0.07, 0.003, 0.28, 0.4);
      break;
    }
  }
}

// ---------- music ----------
const PROGRESSION = [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]];
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

function music(ctx: BaseAudioContext, out: AudioNode, c: AudioClip, bpm: number, at: number, length: number) {
  const style = c.music?.style ?? 'minimal';
  const root = 48 + (c.music?.key ?? 9);
  const beat = 60 / bpm;
  const r = rng(77 + root);
  const bars = Math.ceil(length / (beat * 4));
  const lp = (f: number) => { const x = ctx.createBiquadFilter(); x.type = 'lowpass'; x.frequency.value = f; x.connect(out); return x; };
  const padBus = lp(style === 'ambient' ? 1800 : 1200);
  const bassBus = lp(520);
  for (let bar = 0; bar < bars; bar++) {
    const chord = PROGRESSION[bar % 4];
    const t0 = at + bar * beat * 4;
    if (t0 >= at + length) break;
    // Pad: the chord held for the bar.
    for (const iv of chord) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = midi(root + 12 + iv);
      const g = ctx.createGain();
      const peak = style === 'ambient' ? 0.1 : 0.05;
      g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + beat * 1.2); g.gain.setValueAtTime(peak, t0 + beat * 3.2); g.gain.linearRampToValueAtTime(0.0001, t0 + beat * 4.05);
      o.connect(g); g.connect(padBus); o.start(t0); o.stop(t0 + beat * 4.1);
    }
    for (let step = 0; step < 16; step++) {
      const t = t0 + step * (beat / 4);
      if (t >= at + length) break;
      const beatPos = step / 4;
      const onBeat = step % 4 === 0;
      if (style !== 'ambient') {
        const kick = style === 'driving' ? onBeat : step === 0 || step === 8;
        if (kick) tone(ctx, out, 'sine', 150, 46, t, 0.003, 0.95, 0.28);
        if (style === 'driving' && (step === 4 || step === 12)) {
          const n = noise(ctx, 0.2, 5 + step + bar); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
          n.connect(bp); bp.connect(envelope(ctx, out, t, 0.002, 0.4, 0.16)); n.start(t); n.stop(t + 0.2);
        }
        const hat = style === 'driving' ? step % 2 === 1 : step % 4 === 2 || (step % 2 === 1 && r() > 0.55);
        if (hat) {
          const n = noise(ctx, 0.05, 40 + step); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
          n.connect(hp); hp.connect(envelope(ctx, out, t, 0.001, style === 'driving' ? 0.16 : 0.1, 0.04)); n.start(t); n.stop(t + 0.05);
        }
        const bassHit = style === 'driving' ? step % 2 === 0 : step === 0 || step === 6 || step === 10;
        if (bassHit) tone(ctx, bassBus, 'sawtooth', midi(root - 12 + chord[0]), midi(root - 12 + chord[0]), t, 0.005, 0.3, beat * (style === 'driving' ? 0.45 : 0.7));
        if (style === 'minimal' && step % 2 === 0) {
          const iv = chord[(step / 2 + Math.floor(beatPos)) % 3];
          tone(ctx, out, 'sine', midi(root + 24 + iv), midi(root + 24 + iv), t, 0.004, 0.07, beat * 0.5);
        }
      }
    }
  }
}

// ---------- mixdown ----------
const fileCache = new Map<string, Promise<AudioBuffer | null>>();
function loadFile(ctx: BaseAudioContext, src: string) {
  let p = fileCache.get(src);
  if (!p) {
    p = fetch(src).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))).then((b) => ctx.decodeAudioData(b)).catch(() => null);
    fileCache.set(src, p);
  }
  return p;
}

export const audioKey = (p: Project) => JSON.stringify([p.audio ?? [], p.bpm, p.duration]);

export async function mixdown(project: Project): Promise<AudioBuffer | null> {
  const clips = (project.audio ?? []).filter((c) => c.volume > 0);
  if (!clips.length) return null;
  const length = Math.ceil(project.duration * SR);
  const ctx = new OfflineAudioContext(2, length, SR);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 6; comp.ratio.value = 12; comp.attack.value = 0.002; comp.release.value = 0.15;
  const master = ctx.createGain(); master.gain.value = 0.75;
  comp.connect(master); master.connect(ctx.destination);
  for (const [i, c] of clips.entries()) {
    const room = Math.max(0, project.duration - c.start);
    const bus = ctx.createGain();
    const fadeIn = c.fadeIn ?? 0;
    const sfxLen = c.sfx ? Math.min(c.duration ?? SFX_LENGTH[c.sfx], c.sfx === 'riser' ? c.duration ?? SFX_LENGTH.riser : 99) : 0;
    const len = Math.min(room, c.duration ?? (c.sfx ? sfxLen : room));
    const gain = c.volume * (c.music ? MUSIC_GAIN : 1);
    bus.gain.setValueAtTime(fadeIn > 0 ? 0 : gain, c.start);
    if (fadeIn > 0) bus.gain.linearRampToValueAtTime(gain, c.start + fadeIn);
    if (c.fadeOut) { bus.gain.setValueAtTime(gain, Math.max(c.start + fadeIn, c.start + len - c.fadeOut)); bus.gain.linearRampToValueAtTime(0, c.start + len); }
    bus.connect(comp);
    if (c.src) {
      const buf = await loadFile(ctx, c.src);
      if (!buf) continue;
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.connect(bus);
      s.start(c.start, c.offset ?? 0, len || undefined);
    } else if (c.sfx) {
      voice(ctx, bus, c.sfx, c.start, c.sfx === 'riser' ? Math.max(0.3, len || SFX_LENGTH.riser) : SFX_LENGTH[c.sfx], c.direction ?? 'up', 1000 + i * 31);
    } else if (c.music) {
      music(ctx, bus, c, project.bpm, c.start, len);
    }
  }
  const out = await ctx.startRendering();
  // Safety net: a compressor is not a hard limiter. If anything still peaks past full scale, bring the whole mix down
  // so the exported video never clips (only ever attenuates).
  let peak = 0;
  for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; } }
  if (peak > 0.97) { const k = 0.97 / peak; for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; } }
  return out;
}

/** Encode a buffer as 16-bit PCM WAV. */
export function toWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, n = buf.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { out.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 32767, true); o += 2; }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

/** Live preview: plays the mixdown from a given project time. */
export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private node: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private key = '';
  private building: Promise<void> | null = null;
  muted = false;

  /** Build (or reuse) the mix for this project. */
  async prepare(project: Project) {
    const key = audioKey(project);
    if (key === this.key) return this.building ?? undefined;
    this.key = key;
    this.building = mixdown(project).then((b) => { if (this.key === key) this.buffer = b; }).catch(() => { this.buffer = null; });
    return this.building;
  }

  async play(project: Project, from: number) {
    this.stop();
    await this.prepare(project);
    if (!this.buffer || this.muted) return;
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const node = this.ctx.createBufferSource();
    node.buffer = this.buffer;
    node.connect(this.ctx.destination);
    node.start(0, Math.max(0, Math.min(from, this.buffer.duration - 0.01)));
    this.node = node;
  }

  stop() {
    try { this.node?.stop(); } catch { /* already stopped */ }
    this.node?.disconnect();
    this.node = null;
  }

  get hasAudio() { return !!this.buffer; }
}
