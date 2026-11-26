import { makeLayer, makeProject, makeSection } from './catalog.ts';
import type { Layer, Project } from './types.ts';

const LIME = '#C8FF3D', PINK = '#FF5C8A', BLUE = '#5CC8FF', CREAM = '#F5F5F0', INK = '#0E0E10', AMBER = '#FFB13D';

/** The 15 s trailer shown on the landing page and opened by "Open the demo". */
export function buildDemoProject(): Project {
  const p = makeProject({ id: 'demo', name: 'MotionLess · Trailer', duration: 15, bpm: 120, background: INK, background2: '#17171C' });
  const L = (x: Partial<Layer> & { type: Layer['type'] }) => makeLayer(x, p);
  const text = (x: Partial<Layer>) => L({ type: 'text', fill: CREAM, font: 'Bricolage Grotesque', fontWeight: 800, letterSpacing: -6, lineHeight: 0.95, ...x });

  p.sections = [
    makeSection({ id: 's_hook', name: 'Hook', start: 0, end: 2 }, 0),
    makeSection({ id: 's_ask', name: 'Just ask', start: 2, end: 4.5 }, 1),
    makeSection({ id: 's_repo', name: 'Repo', start: 4.5, end: 7 }, 2),
    makeSection({ id: 's_editor', name: 'Editor', start: 7, end: 9.5 }, 3),
    makeSection({ id: 's_brand', name: 'Brand beats', start: 9.5, end: 11.5 }, 4),
    makeSection({ id: 's_end', name: 'End card', start: 11.5, end: 15 }, 5),
  ];

  p.camera = [
    { t: 0, zoom: 1.18 },
    { t: 1.9, zoom: 1, ease: 'smooth' },
    { t: 4.5, zoom: 1, rotation: 0 },
    { t: 5.2, zoom: 1.06, rotation: -2, ease: 'spring' },
    { t: 6.9, zoom: 1, rotation: 0, ease: 'smooth' },
    { t: 11.5, zoom: 1.1 },
    { t: 13, zoom: 1, ease: 'smooth' },
  ];

  p.layers = [
    // ---- Hook ----
    L({ name: 'Lime burst', type: 'shape', shape: 'ellipse', sectionId: 's_hook', start: 0, end: 2.1, width: 760, height: 760, fill: LIME, enter: { preset: 'pop', duration: 0.7, ease: 'bouncy' }, exit: { preset: 'pop', duration: 0.3, ease: 'snap' }, loop: { preset: 'pulse', period: 0.5, amount: 0.6 } }),
    L({ name: 'Orbit ring', type: 'shape', shape: 'ellipse', sectionId: 's_hook', start: 0.2, end: 2.1, width: 1000, height: 1000, fill: 'transparent', stroke: CREAM, strokeWidth: 4, opacity: 0.5, enter: { preset: 'zoom', duration: 0.8, ease: 'smooth' }, exit: { preset: 'fade', duration: 0.2, ease: 'linear' } }),
    text({ name: 'Less', sectionId: 's_hook', start: 0, end: 2, text: 'Less', fontSize: 340, fill: INK, letterSpacing: -14, y: 470, enter: { preset: 'zoom', duration: 0.5, ease: 'snap' }, exit: { preset: 'slideLeft', duration: 0.3, ease: 'easeInOut', distance: 900 } }),
    text({ name: 'keyframing.', sectionId: 's_hook', start: 0.6, end: 2, text: 'keyframing.', fontSize: 120, fill: INK, font: 'Instrument Serif', fontWeight: 400, italic: true, letterSpacing: -2, y: 660, enter: { preset: 'letters', duration: 0.4, ease: 'spring', stagger: 0.035 }, exit: { preset: 'fade', duration: 0.2, ease: 'linear' } }),
    L({ name: 'Star sticker', type: 'shape', shape: 'star', sectionId: 's_hook', start: 0.9, end: 2, x: 1420, y: 300, width: 150, height: 150, fill: PINK, enter: { preset: 'spin', duration: 0.6, ease: 'bouncy' }, loop: { preset: 'spin', period: 4, amount: 1 }, exit: { preset: 'pop', duration: 0.25, ease: 'snap' } }),

    // ---- Just ask ----
    text({ name: 'Just ask.', sectionId: 's_ask', start: 2, end: 4.5, text: 'Just ask.', fontSize: 220, y: 360, enter: { preset: 'words', duration: 0.45, ease: 'bouncy', stagger: 0.12 }, exit: { preset: 'rise', duration: 0.35, ease: 'easeInOut' } }),
    L({ name: 'Prompt card', type: 'shape', shape: 'pill', sectionId: 's_ask', start: 2.3, end: 4.5, y: 640, width: 1240, height: 150, fill: '#1E1E24', stroke: '#33333B', strokeWidth: 3, shadow: { color: 'rgba(0,0,0,0.5)', blur: 60, x: 0, y: 24 }, enter: { preset: 'rise', duration: 0.6, ease: 'spring' }, exit: { preset: 'drop', duration: 0.35, ease: 'easeInOut', distance: -200 } }),
    text({ name: 'Prompt text', sectionId: 's_ask', start: 2.5, end: 4.5, text: '› make a launch video from this repo', font: 'JetBrains Mono', fontWeight: 500, fontSize: 52, letterSpacing: 0, align: 'left', x: 960, y: 640, width: 1100, height: 80, fill: CREAM, enter: { preset: 'typewriter', duration: 1.2, ease: 'linear' }, exit: { preset: 'drop', duration: 0.35, ease: 'easeInOut', distance: -200 } }),
    L({ name: 'Send button', type: 'shape', shape: 'ellipse', sectionId: 's_ask', start: 3.6, end: 4.5, x: 1500, y: 640, width: 96, height: 96, fill: LIME, enter: { preset: 'pop', duration: 0.5, ease: 'bouncy' }, loop: { preset: 'pulse', period: 0.5, amount: 1 }, exit: { preset: 'pop', duration: 0.3, ease: 'snap' } }),

    // ---- Repo ----
    text({ name: 'Your repo is the brief.', sectionId: 's_repo', start: 4.35, end: 7, text: 'Your repo\nis the brief.', fontSize: 190, y: 400, enter: { preset: 'letters', duration: 0.5, ease: 'spring', stagger: 0.025 }, exit: { preset: 'blur', duration: 0.35, ease: 'easeOut' } }),
    ...[
      { label: 'README.md', color: LIME, x: 520 },
      { label: 'brand.css', color: PINK, x: 960 },
      { label: 'logo.svg', color: BLUE, x: 1400 },
    ].flatMap((chip, i) => [
      L({ name: `Chip ${chip.label}`, type: 'shape', shape: 'pill', sectionId: 's_repo', start: 5.2 + i * 0.25, end: 7, x: chip.x, y: 760, width: 380, height: 110, fill: chip.color, rotation: [-4, 3, -2][i], enter: { preset: 'drop', duration: 0.55, ease: 'bouncy', distance: 260 }, loop: { preset: 'float', period: 1.5 + i * 0.2, amount: 0.5 }, exit: { preset: 'pop', duration: 0.3, ease: 'snap' } }),
      text({ name: `Chip text ${chip.label}`, sectionId: 's_repo', start: 5.2 + i * 0.25, end: 7, text: chip.label, font: 'JetBrains Mono', fontWeight: 700, fontSize: 46, letterSpacing: 0, fill: INK, x: chip.x, y: 760, width: 360, height: 80, rotation: [-4, 3, -2][i], enter: { preset: 'drop', duration: 0.55, ease: 'bouncy', distance: 260 }, loop: { preset: 'float', period: 1.5 + i * 0.2, amount: 0.5 }, exit: { preset: 'pop', duration: 0.3, ease: 'snap' } }),
    ]),

    // ---- Editor ----
    L({ name: 'Editor window', type: 'shape', shape: 'rect', sectionId: 's_editor', start: 6.8, end: 9.6, y: 600, width: 1400, height: 640, radius: 36, fill: '#18181D', stroke: '#2C2C34', strokeWidth: 3, shadow: { color: 'rgba(0,0,0,0.6)', blur: 80, x: 0, y: 40 }, enter: { preset: 'flip', duration: 0.6, ease: 'spring' }, exit: { preset: 'zoom', duration: 0.35, ease: 'easeInOut' } }),
    L({ name: 'Preview pane', type: 'shape', shape: 'rect', sectionId: 's_editor', start: 7.15, end: 9.6, y: 480, width: 1300, height: 320, radius: 20, fill: LIME, fill2: BLUE, enter: { preset: 'wipe', duration: 0.6, ease: 'smooth' }, exit: { preset: 'zoom', duration: 0.35, ease: 'easeInOut' } }),
    text({ name: 'Every frame, editable.', sectionId: 's_editor', start: 7.3, end: 9.5, text: 'Every frame, editable.', fontSize: 110, fill: INK, letterSpacing: -4, y: 480, width: 1200, enter: { preset: 'words', duration: 0.4, ease: 'bouncy', stagger: 0.1 }, exit: { preset: 'fade', duration: 0.2, ease: 'linear' } }),
    ...[0, 1, 2].map((i) =>
      L({ name: `Track ${i + 1}`, type: 'shape', shape: 'pill', sectionId: 's_editor', start: 7.4 + i * 0.12, end: 9.6, x: 520 + i * 90, y: 710 + i * 50, width: 520 + i * 120, height: 30, fill: [PINK, AMBER, CREAM][i], opacity: 0.9, enter: { preset: 'wipe', duration: 0.5, ease: 'smooth' }, keys: [{ t: 8.2, width: 520 + i * 120, x: 520 + i * 90 }, { t: 9.1, width: 760 - i * 80, x: 640 + i * 60, ease: 'spring' }], exit: { preset: 'zoom', duration: 0.35, ease: 'easeInOut' } }),
    ),
    L({ name: 'Playhead', type: 'shape', shape: 'rect', sectionId: 's_editor', start: 7.5, end: 9.6, x: 300, y: 760, width: 6, height: 180, radius: 3, fill: CREAM, enter: { preset: 'fade', duration: 0.2, ease: 'linear' }, keys: [{ t: 7.5, x: 300 }, { t: 9.5, x: 1620, ease: 'linear' }], exit: { preset: 'fade', duration: 0.2, ease: 'linear' } }),

    // ---- Brand beats ----
    ...[
      { word: 'Your fonts.', bg: LIME, fg: INK, font: 'DM Serif Display', w: 400 },
      { word: 'Your colours.', bg: PINK, fg: INK, font: 'Unbounded', w: 800 },
      { word: 'Your copy.', bg: BLUE, fg: INK, font: 'Syne', w: 800 },
      { word: 'Your assets.', bg: CREAM, fg: INK, font: 'Bricolage Grotesque', w: 800 },
    ].flatMap((b, i) => {
      const s = 9.5 + i * 0.5;
      return [
        L({ name: `Beat bg ${i + 1}`, type: 'shape', shape: 'rect', sectionId: 's_brand', start: s, end: s + 0.62, width: 1920, height: 1080, radius: 0, fill: b.bg, enter: { preset: i % 2 ? 'slideRight' : 'slideLeft', duration: 0.25, ease: 'snap', distance: 1920 } }),
        text({ name: b.word, sectionId: 's_brand', start: s + 0.05, end: s + 0.62, text: b.word, fill: b.fg, font: b.font, fontWeight: b.w, fontSize: 210, letterSpacing: b.font === 'Unbounded' ? -10 : -4, width: 1800, enter: { preset: 'zoom', duration: 0.3, ease: 'snap' } }),
      ];
    }),

    // ---- End card ----
    L({ name: 'End glow', type: 'shape', shape: 'ellipse', sectionId: 's_end', start: 11.5, end: 15, y: 520, width: 1100, height: 520, fill: LIME, opacity: 0.12, enter: { preset: 'zoom', duration: 1, ease: 'smooth' }, loop: { preset: 'breathe', period: 2, amount: 0.6 }, shadow: { color: LIME, blur: 200, x: 0, y: 0 } }),
    text({ name: 'Wordmark', sectionId: 's_end', start: 11.5, end: 15, text: 'MotionLess', fontSize: 250, letterSpacing: -12, y: 470, enter: { preset: 'letters', duration: 0.55, ease: 'bouncy', stagger: 0.04 } }),
    L({ name: 'Wordmark dot', type: 'shape', shape: 'ellipse', sectionId: 's_end', start: 12.1, end: 15, x: 1585, y: 535, width: 46, height: 46, fill: PINK, enter: { preset: 'pop', duration: 0.5, ease: 'bouncy' }, loop: { preset: 'float', period: 1, amount: 0.4 } }),
    text({ name: 'Tagline', sectionId: 's_end', start: 12.3, end: 15, text: 'An MCP server for Claude Code', font: 'Inter', fontWeight: 500, fontSize: 52, letterSpacing: -1, fill: '#A1A1AA', y: 650, enter: { preset: 'rise', duration: 0.6, ease: 'spring', distance: 60 } }),
    L({ name: 'CTA pill', type: 'shape', shape: 'pill', sectionId: 's_end', start: 12.8, end: 15, y: 800, width: 520, height: 110, fill: LIME, enter: { preset: 'pop', duration: 0.6, ease: 'bouncy' }, loop: { preset: 'shimmer', period: 1.2, amount: 1 } }),
    text({ name: 'CTA text', sectionId: 's_end', start: 12.9, end: 15, text: 'npm run dev', font: 'JetBrains Mono', fontWeight: 700, fontSize: 48, letterSpacing: 0, fill: INK, y: 800, width: 500, height: 80, enter: { preset: 'typewriter', duration: 0.5, ease: 'linear' } }),
  ];
  return p;
}
