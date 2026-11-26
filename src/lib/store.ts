import { useSyncExternalStore } from 'react';

/** A tiny observable value: lets the playhead tick at 60 fps without re-rendering the whole editor. */
export class Signal<T> {
  private listeners = new Set<() => void>();
  private value: T;
  constructor(value: T) { this.value = value; }
  get = () => this.value;
  set = (v: T) => {
    if (Object.is(v, this.value)) return;
    this.value = v;
    this.listeners.forEach((l) => l());
  };
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };
}

export function useSignal<T>(s: Signal<T>): T {
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}

/** Wait for every font the project uses, so measurement and the first frame are right. */
export async function loadProjectFonts(fonts: Iterable<string>) {
  if (!('fonts' in document)) return;
  await Promise.all(
    [...new Set(fonts)].flatMap((f) => [400, 500, 700, 800].map((w) => document.fonts.load(`${w} 40px "${f}"`).catch(() => null))),
  );
  await Promise.all([...new Set(fonts)].map((f) => document.fonts.load(`italic 400 40px "${f}"`).catch(() => null)));
}

export function useTheme(): ['light' | 'dark', () => void] {
  const theme = useSignal(themeSignal);
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')];
}
const initialTheme = (() => {
  try { return (localStorage.getItem('ml-theme') as 'light' | 'dark') ?? 'dark'; } catch { return 'dark'; }
})();
const themeSignal = new Signal<'light' | 'dark'>(initialTheme);
document.documentElement.dataset.theme = initialTheme;
function setTheme(t: 'light' | 'dark') {
  themeSignal.set(t);
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('ml-theme', t); } catch { /* private mode */ }
}
