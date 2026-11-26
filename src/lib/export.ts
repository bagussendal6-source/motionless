import type { Project } from '../../shared/types.ts';
import { ImageCache, renderFrame } from './engine.ts';
import { loadProjectFonts } from './store.ts';
import { mixdown } from './audio.ts';

function pickMime(): { mime: string; ext: string } {
  const options = [
    { mime: 'video/mp4;codecs=avc1.640028', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  return options.find((o) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(o.mime)) ?? options[3];
}

/**
 * Records the project in real time from an offscreen canvas. The browser's
 * encoder timestamps frames by wall clock, so the export takes `duration` seconds.
 */
export async function exportVideo(project: Project, opts: { scale?: number; onProgress?: (p: number) => void; signal?: AbortSignal } = {}) {
  const scale = opts.scale ?? 1;
  const images = new ImageCache();
  await Promise.all([images.ready(project), loadProjectFonts(project.layers.map((l) => l.font ?? 'Inter'))]);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(project.width * scale);
  canvas.height = Math.round(project.height * scale);
  const ctx = canvas.getContext('2d')!;
  renderFrame(ctx, project, 0, { scale, images });

  const { mime, ext } = pickMime();
  const stream = canvas.captureStream(project.fps);
  // Sound: mix everything offline, then feed it into the recording as an audio track.
  const mix = await mixdown(project).catch(() => null);
  let actx: AudioContext | null = null;
  let src: AudioBufferSourceNode | null = null;
  if (mix) {
    actx = new AudioContext();
    const dest = actx.createMediaStreamDestination();
    src = actx.createBufferSource();
    src.buffer = mix;
    src.connect(dest);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 * scale * scale });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(250);
  src?.start();

  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      if (opts.signal?.aborted) return resolve();
      const t = (performance.now() - t0) / 1000;
      renderFrame(ctx, project, Math.min(t, project.duration - 1e-3), { scale, images });
      opts.onProgress?.(Math.min(1, t / project.duration));
      if (t >= project.duration) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await done;
  try { src?.stop(); } catch { /* already ended */ }
  actx?.close().catch(() => {});
  stream.getTracks().forEach((tr) => tr.stop());
  if (opts.signal?.aborted) return null;
  return { blob: new Blob(chunks, { type: mime.split(';')[0] }), ext };
}

export async function frameToDataUrl(project: Project, t: number, width: number, images: ImageCache, type = 'image/jpeg') {
  const scale = width / project.width;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(project.width * scale);
  canvas.height = Math.round(project.height * scale);
  renderFrame(canvas.getContext('2d')!, project, t, { scale, images });
  return canvas.toDataURL(type, 0.86);
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'motionless';

/** One image holding many frames in a labelled grid. `width` is the whole sheet's pixel width. */
export async function contactSheet(project: Project, times: number[], width: number, cols: number, images: ImageCache) {
  const gap = 6, labelH = 22;
  const cellW = Math.floor((width - gap * (cols + 1)) / cols);
  const cellH = Math.round((cellW * project.height) / project.width);
  const rows = Math.ceil(times.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = width;
  sheet.height = gap + rows * (cellH + labelH + gap);
  const ctx = sheet.getContext('2d')!;
  ctx.fillStyle = '#1b1b1f';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  const cell = document.createElement('canvas');
  cell.width = cellW;
  cell.height = cellH;
  const cctx = cell.getContext('2d')!;
  ctx.font = '600 13px ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  times.forEach((t, i) => {
    const x = gap + (i % cols) * (cellW + gap), y = gap + Math.floor(i / cols) * (cellH + labelH + gap);
    renderFrame(cctx, project, Math.max(0, Math.min(project.duration - 1e-3, t)), { scale: cellW / project.width, images });
    ctx.drawImage(cell, x, y + labelH);
    ctx.fillStyle = '#c8ff3d';
    ctx.fillText(`${t.toFixed(2)}s`, x + 2, y + labelH / 2);
  });
  return sheet.toDataURL('image/jpeg', 0.85);
}
