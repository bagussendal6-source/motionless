import { useEffect, useRef, useState } from 'react';
import type { Layer, Project, ShapeKind } from '../../shared/types.ts';
import { applyOps, groupOps } from '../../shared/ops.ts';
import { Icon } from '../components/ui.tsx';
import { api } from '../lib/api.ts';

const depthOf = (p: Project, l: Layer) => {
  let d = 0;
  for (let cur: Layer | undefined = l; cur?.parent && d < 6; d++) cur = p.layers.find((x) => x.id === cur!.parent);
  return d;
};

interface Props {
  project: Project;
  selected: string[];
  onSelect: (ids: string[]) => void;
  commit: (p: Project, label: string, coalesce?: string) => void;
  now: () => number;
  seek: (t: number) => void;
  notify: (m: string) => void;
}

const SHAPES: ShapeKind[] = ['rect', 'ellipse', 'pill', 'triangle', 'star', 'line'];

function TypeIcon({ l }: { l: Layer }) {
  if (l.type === 'text') return <Icon name="text" size={14} />;
  if (l.type === 'image') return <Icon name="image" size={14} />;
  return <span className="swatch" style={{ background: l.fill2 ? `linear-gradient(135deg, ${l.fill}, ${l.fill2})` : l.fill, borderRadius: l.shape === 'ellipse' || l.shape === 'pill' ? 99 : 4 }} />;
}

export function LayersPanel({ project, selected, onSelect, commit, now, seek, notify }: Props) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragId = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const rows = [...project.layers].reverse();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected.length) listRef.current?.querySelector(`[data-id="${selected[selected.length - 1]}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  function add(partial: Partial<Layer> & { type: Layer['type'] }, label: string) {
    const t = Math.min(now(), Math.max(0, project.duration - 0.5));
    const out = applyOps(project, [{ op: 'addLayers', layers: [{ start: t, end: Math.min(project.duration, t + 3), ...partial }] }]);
    commit(out.project, label);
    onSelect(out.created);
    setMenu(false);
    // Land just after the entrance so the new layer is visible, not mid-fade.
    const added = out.project.layers.find((l) => l.id === out.created[0]);
    if (added) seek(Math.min(added.end - 0.01, added.start + added.enter.duration + 0.05));
  }

  async function addImage(file: File) {
    try {
      const src = await api.upload(file);
      const img = new Image();
      img.src = src;
      await img.decode().catch(() => {});
      const max = Math.min(project.width, project.height) * 0.6;
      const r = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
      add({ type: 'image', src, name: file.name.replace(/\.\w+$/, ''), width: r >= 1 ? max : max * r, height: r >= 1 ? max / r : max, enter: { preset: 'pop', duration: 0.6, ease: 'spring' } }, 'Add image');
    } catch (e) {
      notify((e as Error).message);
    }
  }

  function toggle(l: Layer, key: 'hidden' | 'locked') {
    commit({ ...project, layers: project.layers.map((x) => (x.id === l.id ? { ...x, [key]: !x[key] } : x)) }, `${key === 'hidden' ? (l.hidden ? 'Show' : 'Hide') : l.locked ? 'Unlock' : 'Lock'} ${l.name}`);
  }

  function rename(l: Layer, name: string) {
    setRenaming(null);
    if (name.trim() && name !== l.name) commit({ ...project, layers: project.layers.map((x) => (x.id === l.id ? { ...x, name: name.trim() } : x)) }, `Rename ${l.name}`);
  }

  function drop(rowIndex: number) {
    const id = dragId.current;
    dragId.current = null;
    setDropAt(null);
    if (!id) return;
    // Rows are top-first; draw order is bottom-first.
    const from = project.layers.findIndex((l) => l.id === id);
    let target = project.layers.length - rowIndex;
    if (from < target) target -= 1;
    if (target === from) return;
    commit(applyOps(project, [{ op: 'reorderLayer', id, index: target }]).project, 'Reorder layers');
  }

  return (
    <>
      <div className="panel-head" style={{ position: 'relative' }}>
        <h3>Layers <span className="pill" style={{ marginLeft: 4 }}>{project.layers.length}</span></h3>
        <button className="icon-btn" title="Duplicate (⌘D)" disabled={!selected.length}
          onClick={() => { const out = applyOps(project, [{ op: 'duplicateLayers', ids: selected }]); commit(out.project, 'Duplicate'); onSelect(out.created); }}>
          <Icon name="copy" />
        </button>
        <button className="icon-btn" title="Group selected layers under one parent" disabled={selected.length < 2}
          onClick={() => { const g = groupOps(project, selected, { name: 'Group' }); commit(applyOps(project, g.ops).project, 'Group layers'); onSelect([g.groupId]); }}>
          <Icon name="layers" />
        </button>
        <button className="icon-btn" title="Delete (⌫)" disabled={!selected.length}
          onClick={() => { commit(applyOps(project, [{ op: 'deleteLayers', ids: selected }]).project, `Delete ${selected.length > 1 ? `${selected.length} layers` : 'layer'}`); onSelect([]); }}>
          <Icon name="trash" />
        </button>
        <button className="btn sm candy" onClick={() => setMenu(!menu)}><Icon name="plus" size={14} /> Add</button>
        {menu && (
          <div className="menu" style={{ top: 44, right: 8 }} onMouseLeave={() => setMenu(false)}>
            <button onClick={() => add({ type: 'text', fontSize: Math.round(project.height / 8) }, 'Add text')}><Icon name="text" /> Text</button>
            {SHAPES.map((s) => (
              <button key={s} onClick={() => add({ type: 'shape', shape: s, name: s[0].toUpperCase() + s.slice(1), ...(s === 'line' ? { height: 8, width: 600 } : s === 'pill' ? { width: 500, height: 140 } : {}) }, `Add ${s}`)}>
                <Icon name="shape" /> {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
            <button onClick={() => fileInput.current?.click()}><Icon name="image" /> Image…</button>
          </div>
        )}
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) addImage(f); e.target.value = ''; }} />
      </div>
      <div className="panel-body" ref={listRef} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(rows.length)}>
        {rows.map((l, i) => (
          <div
            key={l.id}
            data-id={l.id}
            className={`layer-row ${selected.includes(l.id) ? 'sel' : ''} ${l.hidden ? 'hidden' : ''} ${dropAt === i ? 'drop-above' : ''}`}
            draggable={renaming !== l.id}
            onDragStart={() => { dragId.current = l.id; }}
            onDragOver={(e) => { e.preventDefault(); setDropAt(i); }}
            onDragLeave={() => setDropAt((d) => (d === i ? null : d))}
            onDrop={(e) => { e.stopPropagation(); drop(i); }}
            onClick={(e) => onSelect(e.shiftKey || e.metaKey ? (selected.includes(l.id) ? selected.filter((x) => x !== l.id) : [...selected, l.id]) : [l.id])}
            onDoubleClick={() => setRenaming(l.id)}
          >
            <TypeIcon l={l} />
            <div className="nm" style={{ paddingLeft: depthOf(project, l) * 12 }}>
              {renaming === l.id
                ? <input className="input" autoFocus defaultValue={l.name} onBlur={(e) => rename(l, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') rename(l, (e.target as HTMLInputElement).value); if (e.key === 'Escape') setRenaming(null); }} onClick={(e) => e.stopPropagation()} />
                : l.name}
            </div>
            <button className={`icon-btn ${l.locked ? 'keep' : ''}`} title={l.locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.stopPropagation(); toggle(l, 'locked'); }}><Icon name={l.locked ? 'lock' : 'unlock'} size={13} /></button>
            <button className={`icon-btn ${l.hidden ? 'keep' : ''}`} title={l.hidden ? 'Show' : 'Hide'} onClick={(e) => { e.stopPropagation(); toggle(l, 'hidden'); }}><Icon name={l.hidden ? 'eyeOff' : 'eye'} size={13} /></button>
          </div>
        ))}
        {!rows.length && <div className="empty">Empty canvas. Add a layer, or ask Claude to build the whole thing.</div>}
      </div>
    </>
  );
}
