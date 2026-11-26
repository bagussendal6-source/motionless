// Small showcase videos for the landing-page gallery. Built in code, never stored.
import { makeLayer, makeProject } from '../../shared/catalog.ts';
import type { Layer, Project } from '../../shared/types.ts';

function build(p: Project, layers: (Partial<Layer> & { type: Layer['type'] })[]): Project {
  p.layers = layers.map((l) => makeLayer(l, p));
  return p;
}

export function kineticType(): Project {
  const p = makeProject({ id: 'sample-type', name: 'Kinetic type', width: 1080, height: 1080, duration: 6, background: '#FF5C8A' });
  const T = { type: 'text' as const, font: 'Unbounded', fontWeight: 900, fill: '#0E0E10', letterSpacing: -8, lineHeight: 0.9 };
  return build(p, [
    { ...T, text: 'SHIP', fontSize: 300, y: 400, start: 0, end: 3, enter: { preset: 'letters', duration: 0.5, ease: 'bouncy', stagger: 0.06 }, exit: { preset: 'slideLeft', duration: 0.35, ease: 'easeInOut', distance: 1200 } },
    { ...T, text: 'IT.', fontSize: 300, y: 700, fill: '#F5F5F0', start: 0.4, end: 3, enter: { preset: 'zoom', duration: 0.4, ease: 'snap' }, exit: { preset: 'slideRight', duration: 0.35, ease: 'easeInOut', distance: 1200 } },
    { type: 'shape', shape: 'star', width: 520, height: 520, fill: '#C8FF3D', start: 3, end: 6, enter: { preset: 'spin', duration: 0.7, ease: 'bouncy' }, loop: { preset: 'spin', period: 6, amount: 1 } },
    { ...T, text: 'NOW', fontSize: 220, start: 3.2, end: 6, enter: { preset: 'pop', duration: 0.5, ease: 'bouncy' }, loop: { preset: 'pulse', period: 0.5, amount: 1 } },
  ]);
}

export function productDrop(): Project {
  const p = makeProject({ id: 'sample-drop', name: 'Product drop', width: 1920, height: 1080, duration: 6, background: '#0B1220', background2: '#1B2B4B' });
  return build(p, [
    { type: 'shape', shape: 'rect', radius: 48, width: 620, height: 620, x: 1300, y: 540, fill: '#5CC8FF', fill2: '#A78BFA', rotation: 8, start: 0, end: 6, enter: { preset: 'drop', duration: 0.8, ease: 'bouncy', distance: 500 }, loop: { preset: 'float', period: 2.5, amount: 0.7 } },
    { type: 'shape', shape: 'ellipse', width: 220, height: 220, x: 1560, y: 300, fill: '#FFB13D', start: 0.5, end: 6, enter: { preset: 'pop', duration: 0.6, ease: 'bouncy' }, loop: { preset: 'float', period: 1.8, amount: 0.8 } },
    { type: 'text', text: 'New in v2', font: 'JetBrains Mono', fontWeight: 600, fontSize: 44, letterSpacing: 0, fill: '#5CC8FF', align: 'left', x: 560, y: 360, width: 800, start: 0.3, end: 6, enter: { preset: 'typewriter', duration: 0.6, ease: 'linear' } },
    { type: 'text', text: 'Faster than\nyour coffee.', font: 'Bricolage Grotesque', fontWeight: 800, fontSize: 140, letterSpacing: -5, lineHeight: 0.95, fill: '#F5F5F0', align: 'left', x: 560, y: 540, width: 800, start: 0.6, end: 6, enter: { preset: 'words', duration: 0.5, ease: 'spring', stagger: 0.1 } },
    { type: 'shape', shape: 'pill', width: 300, height: 90, x: 310, y: 760, fill: '#C8FF3D', start: 1.6, end: 6, enter: { preset: 'wipe', duration: 0.5, ease: 'smooth' }, loop: { preset: 'shimmer', period: 1.5, amount: 1 } },
    { type: 'text', text: 'Try it free', font: 'Inter', fontWeight: 700, fontSize: 36, letterSpacing: -0.5, fill: '#0B1220', x: 310, y: 760, width: 300, start: 1.8, end: 6, enter: { preset: 'fade', duration: 0.3, ease: 'linear' } },
  ]);
}

export function portraitPromo(): Project {
  const p = makeProject({ id: 'sample-portrait', name: 'Portrait promo', width: 1080, height: 1920, duration: 6, background: '#F5F1E8' });
  return build(p, [
    ...[0, 1, 2, 3].map((i) => ({
      type: 'shape' as const, shape: 'pill' as const, width: 900, height: 200, x: 540, y: 520 + i * 260, fill: ['#C8FF3D', '#FF5C8A', '#5CC8FF', '#FFB13D'][i],
      rotation: [-6, 4, -3, 5][i], start: 0.2 + i * 0.15, end: 6,
      enter: { preset: (i % 2 ? 'slideLeft' : 'slideRight') as 'slideLeft', duration: 0.6, ease: 'spring' as const, distance: 1100 },
      loop: { preset: 'wiggle' as const, period: 2 + i * 0.3, amount: 0.4 },
    })),
    { type: 'text', text: 'Weekend\nmarket', font: 'DM Serif Display', fontWeight: 400, fontSize: 190, letterSpacing: -4, lineHeight: 0.95, fill: '#0E0E10', y: 240, width: 1000, start: 0, end: 6, enter: { preset: 'letters', duration: 0.5, ease: 'spring', stagger: 0.03 } },
    ...['Coffee', 'Vinyl', 'Plants', 'Bread'].map((w, i) => ({
      type: 'text' as const, text: w, font: 'Syne', fontWeight: 800, fontSize: 96, letterSpacing: -2, fill: '#0E0E10', x: 540, y: 520 + i * 260, width: 860,
      rotation: [-6, 4, -3, 5][i], start: 0.5 + i * 0.15, end: 6, enter: { preset: 'pop' as const, duration: 0.5, ease: 'bouncy' as const },
      loop: { preset: 'wiggle' as const, period: 2 + i * 0.3, amount: 0.4 },
    })),
  ]);
}
