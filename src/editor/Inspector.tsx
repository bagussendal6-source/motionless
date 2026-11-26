import { useEffect, useRef, useState } from 'react';
import type { AudioClip, EaseName, EnterPreset, Keyframe, Layer, LoopPreset, Motion, Project, Section, SfxKind } from '../../shared/types.ts';
import { ASPECTS, EASES, ENTER_PRESETS, FONTS, LOOP_PRESETS, SECTION_COLORS, uid } from '../../shared/catalog.ts';
import { resizeProject } from '../../shared/ops.ts';
import { layerState } from '../lib/engine.ts';
import { Icon } from '../components/ui.tsx';

type Commit = (p: Project, label: string, coalesce?: string) => void;

// ---------- fields ----------
function Num({ label, value, onChange, step = 1, min, max, title }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; title?: string }) {
  const [text, setText] = useState(String(round(value)));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(round(value))); }, [value]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  function scrub(e: React.PointerEvent) {
    const x0 = e.clientX, v0 = value;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onChange(clamp(round(v0 + (ev.clientX - x0) * step * (ev.shiftKey ? 10 : 1))));
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }
  return (
    <div className="num" title={title}>
      <label onPointerDown={scrub}>{label}</label>
      <input
        className="input" value={text} inputMode="decimal"
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(String(round(value))); }}
        onChange={(e) => { setText(e.target.value); const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(clamp(v)); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = clamp(round(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
            onChange(v); setText(String(v));
          }
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}
const round = (v: number) => Math.round(v * 1000) / 1000;

function Color({ value, onChange, allowNone }: { value: string | undefined; onChange: (v: string | undefined) => void; allowNone?: boolean }) {
  const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return (
    <div className="color">
      <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} />
      <input className="input" value={value ?? ''} placeholder={allowNone ? 'none' : ''} onChange={(e) => onChange(e.target.value || (allowNone ? undefined : '#000000'))} />
      {allowNone && value && <button className="icon-btn" title="Remove" onClick={() => onChange(undefined)}><Icon name="x" size={14} /></button>}
    </div>
  );
}

function Select<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
}

const F = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="field"><span>{label}</span>{children}</label>;

// ---------- motion ----------
function MotionEditor({ title, motion, onChange, textOnly }: { title: string; motion: Motion; onChange: (m: Partial<Motion>) => void; textOnly: boolean }) {
  const opts = ENTER_PRESETS.filter((p) => textOnly || !['typewriter', 'letters', 'words'].includes(p.id));
  return (
    <div className="group">
      <h4>{title}</h4>
      <Select<EnterPreset> value={motion.preset} options={opts} onChange={(preset) => onChange({ preset })} />
      {motion.preset !== 'none' && (
        <>
          <div className="row2">
            <Num label="s" title="Duration (seconds)" value={motion.duration} step={0.01} min={0.05} onChange={(duration) => onChange({ duration })} />
            <Select<EaseName> value={motion.ease} options={EASES} onChange={(ease) => onChange({ ease })} />
          </div>
          {['rise', 'drop', 'slideLeft', 'slideRight', 'letters', 'words'].includes(motion.preset) && (
            <div className="row2">
              <Num label="d" title="Distance (px)" value={motion.distance ?? (motion.preset.startsWith('slide') ? 420 : 140)} step={2} onChange={(distance) => onChange({ distance })} />
              {(motion.preset === 'letters' || motion.preset === 'words') && <Num label="st" title="Stagger (seconds)" value={motion.stagger ?? (motion.preset === 'words' ? 0.08 : 0.03)} step={0.005} min={0} onChange={(stagger) => onChange({ stagger })} />}
            </div>
          )}
          <div className="row2">
            <Num label="from" title="Starting strength 0..0.95: keeps frame 0 from being empty" value={motion.from ?? 0} step={0.01} min={0} max={0.95} onChange={(from) => onChange({ from: from || undefined })} />
          </div>
          <p className="hint">{ENTER_PRESETS.find((p) => p.id === motion.preset)?.hint}</p>
        </>
      )}
    </div>
  );
}

function isDescendant(project: Project, layer: Layer, ancestorId: string, depth = 0): boolean {
  if (!layer.parent || depth > 8) return false;
  if (layer.parent === ancestorId) return true;
  const par = project.layers.find((l) => l.id === layer.parent);
  return par ? isDescendant(project, par, ancestorId, depth + 1) : false;
}

// ---------- layer inspector ----------
function LayerInspector({ project, layer, commit, now, textRef }: { project: Project; layer: Layer; commit: Commit; now: () => number; textRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const set = (patch: Partial<Layer>, label: string, key?: string) =>
    commit({ ...project, layers: project.layers.map((l) => (l.id === layer.id ? { ...l, ...patch } : l)) }, `${label} · ${layer.name}`, key ? `${layer.id}:${key}` : undefined);
  const num = (k: keyof Layer, label: string) => (v: number) => set({ [k]: v } as Partial<Layer>, label, String(k));

  function addKey() {
    const t = round(now());
    const s = layerState({ ...layer, enter: { ...layer.enter, preset: 'none' }, exit: { ...layer.exit, preset: 'none' }, loop: { ...layer.loop, preset: 'none' } }, t);
    const k: Keyframe = { t, x: round(s.x), y: round(s.y), scale: round(s.scale), rotation: round(s.rotation), opacity: round(s.opacity), ease: 'spring' };
    set({ keys: [...layer.keys.filter((x) => Math.abs(x.t - t) > 0.001), k].sort((a, b) => a.t - b.t) }, 'Add keyframe');
  }
  function editKey(i: number, patch: Partial<Keyframe>, label: string) {
    set({ keys: layer.keys.map((k, j) => (j === i ? { ...k, ...patch } : k)).sort((a, b) => a.t - b.t) }, label, `key${i}`);
  }

  const isText = layer.type === 'text';
  return (
    <div className="insp">
      <div className="group">
        <h4>{layer.type === 'shape' ? `Shape · ${layer.shape}` : layer.type}<span className="pill">{layer.id.slice(-6)}</span></h4>
        <F label="Name"><input className="input" value={layer.name} onChange={(e) => set({ name: e.target.value }, 'Rename', 'name')} /></F>
        {isText && (
          <>
            <F label="Text"><textarea ref={textRef} className="textarea" rows={3} value={layer.text ?? ''} onChange={(e) => set({ text: e.target.value }, 'Edit text', 'text')} /></F>
            <div className="row2">
              <F label="Font"><Select value={layer.font ?? 'Inter'} options={FONTS.map((f) => ({ id: f, label: f }))} onChange={(font) => set({ font }, 'Font')} /></F>
              <F label="Weight"><Select value={String(layer.fontWeight ?? 700)} options={[300, 400, 500, 600, 700, 800, 900].map((w) => ({ id: String(w), label: String(w) }))} onChange={(w) => set({ fontWeight: Number(w) }, 'Weight')} /></F>
            </div>
            <div className="row3">
              <Num label="pt" title="Font size" value={layer.fontSize ?? 100} min={4} onChange={num('fontSize', 'Font size')} />
              <Num label="ls" title="Letter spacing" value={layer.letterSpacing ?? 0} step={0.5} onChange={num('letterSpacing', 'Letter spacing')} />
              <Num label="lh" title="Line height" value={layer.lineHeight ?? 1.1} step={0.01} min={0.5} onChange={num('lineHeight', 'Line height')} />
            </div>
            <div className="seg">
              {(['left', 'center', 'right'] as const).map((a) => <button key={a} className={(layer.align ?? 'center') === a ? 'on' : ''} onClick={() => set({ align: a }, 'Align')}>{a}</button>)}
              <button className={layer.italic ? 'on' : ''} onClick={() => set({ italic: !layer.italic }, 'Italic')}><i>I</i></button>
            </div>
            <F label="Auto-fit"><Select value={layer.autoFit ?? ''} options={[{ id: '', label: 'Off' }, { id: 'width', label: 'Shrink to one line' }, { id: 'box', label: 'Shrink into box' }]} onChange={(v) => set({ autoFit: (v || undefined) as Layer['autoFit'] }, 'Auto-fit')} /></F>
          </>
        )}
        {layer.type === 'shape' && (
          <div className="row2">
            <F label="Shape"><Select value={layer.shape ?? 'rect'} options={['rect', 'ellipse', 'pill', 'triangle', 'star', 'line'].map((s) => ({ id: s as NonNullable<Layer['shape']>, label: s }))} onChange={(shape) => set({ shape }, 'Shape')} /></F>
            <F label="Radius"><Num label="r" value={layer.radius ?? 0} min={0} onChange={num('radius', 'Radius')} /></F>
          </div>
        )}
        {layer.type === 'image' && (
          <>
            <F label="Source"><input className="input" value={layer.src ?? ''} onChange={(e) => set({ src: e.target.value }, 'Image source', 'src')} /></F>
            <div className="row2">
              <F label="Fit"><Select value={layer.fit ?? 'cover'} options={[{ id: 'cover', label: 'Cover' }, { id: 'contain', label: 'Contain' }]} onChange={(fit) => set({ fit }, 'Fit')} /></F>
              <F label="Radius"><Num label="r" value={layer.radius ?? 0} min={0} onChange={num('radius', 'Radius')} /></F>
            </div>
          </>
        )}
      </div>

      {layer.type !== 'image' && (
        <div className="group">
          <h4>Fill</h4>
          <Color value={layer.fill} onChange={(v) => set({ fill: v ?? '#000000' }, 'Fill', 'fill')} />
          <F label="Gradient to"><Color allowNone value={layer.fill2} onChange={(v) => set({ fill2: v }, 'Gradient', 'fill2')} /></F>
        </div>
      )}
      <div className="group">
        <h4>Stroke & effects</h4>
        <div className="row2">
          <Color allowNone value={layer.stroke} onChange={(v) => set({ stroke: v, strokeWidth: v ? layer.strokeWidth || 4 : layer.strokeWidth }, 'Stroke', 'stroke')} />
          <Num label="w" title="Stroke width" value={layer.strokeWidth ?? 0} min={0} onChange={num('strokeWidth', 'Stroke width')} />
        </div>
        <div className="row2">
          <F label="Blend"><Select value={layer.blend ?? 'source-over'} options={['source-over', 'screen', 'multiply', 'overlay', 'difference', 'lighter', 'color-dodge'].map((b) => ({ id: b as GlobalCompositeOperation, label: b === 'source-over' ? 'normal' : b }))} onChange={(blend) => set({ blend: blend === 'source-over' ? undefined : blend }, 'Blend')} /></F>
          <F label="Shadow"><button className="btn sm" onClick={() => set({ shadow: layer.shadow ? undefined : { color: 'rgba(0,0,0,0.5)', blur: 40, x: 0, y: 16 } }, layer.shadow ? 'Remove shadow' : 'Add shadow')}>{layer.shadow ? 'Remove' : 'Add'}</button></F>
        </div>
        {layer.shadow && (
          <div className="row3">
            <Num label="b" title="Blur" value={layer.shadow.blur} min={0} onChange={(blur) => set({ shadow: { ...layer.shadow!, blur } }, 'Shadow', 'shadow')} />
            <Num label="x" value={layer.shadow.x} onChange={(x) => set({ shadow: { ...layer.shadow!, x } }, 'Shadow', 'shadow')} />
            <Num label="y" value={layer.shadow.y} onChange={(y) => set({ shadow: { ...layer.shadow!, y } }, 'Shadow', 'shadow')} />
          </div>
        )}
      </div>

      <div className="group">
        <h4>Transform</h4>
        <div className="row2"><Num label="X" value={layer.x} onChange={num('x', 'Move')} /><Num label="Y" value={layer.y} onChange={num('y', 'Move')} /></div>
        <div className="row2"><Num label="W" value={layer.width} min={1} onChange={num('width', 'Resize')} /><Num label="H" value={layer.height} min={1} onChange={num('height', 'Resize')} /></div>
        <div className="row3">
          <Num label="°" title="Rotation" value={layer.rotation} onChange={num('rotation', 'Rotate')} />
          <Num label="×" title="Scale" value={layer.scale} step={0.01} min={0} onChange={num('scale', 'Scale')} />
          <Num label="α" title="Opacity" value={layer.opacity} step={0.01} min={0} max={1} onChange={num('opacity', 'Opacity')} />
        </div>
        <div className="row2">
          <Num label="px" title="Pivot x: fraction of width from the centre (rotate/scale happen around it)" value={layer.pivot?.x ?? 0} step={0.01} min={-1} max={1} onChange={(x) => set({ pivot: { x, y: layer.pivot?.y ?? 0 } }, 'Pivot', 'pivot')} />
          <Num label="py" title="Pivot y: fraction of height from the centre (0.5 = bottom edge)" value={layer.pivot?.y ?? 0} step={0.01} min={-1} max={1} onChange={(y) => set({ pivot: { x: layer.pivot?.x ?? 0, y } }, 'Pivot', 'pivot')} />
        </div>
        <F label="Parent">
          <Select value={layer.parent ?? ''} options={[{ id: '', label: '—' }, ...project.layers.filter((l) => l.id !== layer.id && !isDescendant(project, l, layer.id)).map((l) => ({ id: l.id, label: l.name }))]} onChange={(parent) => set({ parent: parent || undefined }, 'Parent')} />
        </F>
        <div className="row2">
          <button className="btn sm" onClick={() => set({ x: project.width / 2 }, 'Centre horizontally')}>Centre H</button>
          <button className="btn sm" onClick={() => set({ y: project.height / 2 }, 'Centre vertically')}>Centre V</button>
        </div>
      </div>

      <div className="group">
        <h4>Timing</h4>
        <div className="row2">
          <Num label="in" title="Start (s)" value={layer.start} step={0.01} min={0} onChange={(v) => set({ start: Math.min(v, layer.end - 0.05) }, 'Start', 'start')} />
          <Num label="out" title="End (s)" value={layer.end} step={0.01} min={0} onChange={(v) => set({ end: Math.max(v, layer.start + 0.05) }, 'End', 'end')} />
        </div>
        {project.sections.length > 0 && (
          <F label="Section"><Select value={layer.sectionId ?? ''} options={[{ id: '', label: '—' }, ...project.sections.map((s) => ({ id: s.id, label: s.name }))]} onChange={(sectionId) => set({ sectionId: sectionId || undefined }, 'Section')} /></F>
        )}
      </div>

      <MotionEditor title="Enter" motion={layer.enter} textOnly={isText} onChange={(m) => set({ enter: { ...layer.enter, ...m } }, 'Enter motion', 'enter')} />
      <MotionEditor title="Exit" motion={layer.exit} textOnly={isText} onChange={(m) => set({ exit: { ...layer.exit, ...m } }, 'Exit motion', 'exit')} />

      <div className="group">
        <h4>Loop</h4>
        <Select<LoopPreset> value={layer.loop.preset} options={LOOP_PRESETS} onChange={(preset) => set({ loop: { ...layer.loop, preset } }, 'Loop')} />
        {layer.loop.preset !== 'none' && (
          <div className="row2">
            <Num label="s" title="Period (seconds)" value={layer.loop.period} step={0.01} min={0.05} onChange={(period) => set({ loop: { ...layer.loop, period } }, 'Loop', 'loop')} />
            <Num label="%" title="Amount 0..1" value={layer.loop.amount} step={0.01} min={0} max={1} onChange={(amount) => set({ loop: { ...layer.loop, amount } }, 'Loop', 'loop')} />
          </div>
        )}
      </div>

      <div className="group">
        <h4>Keyframes <button className="btn sm" onClick={addKey}><Icon name="key" size={12} /> Add at playhead</button></h4>
        {!layer.keys.length && <p className="hint">Keys capture position, scale, rotation and opacity at the playhead. Edit values below.</p>}
        <div className="keylist">
          {layer.keys.map((k, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, padding: 8 }}>
              <div style={{ padding: 0, background: 'none' }}>
                <span>◆ {k.t.toFixed(2)}s</span>
                <button className="icon-btn" title="Delete keyframe" onClick={() => set({ keys: layer.keys.filter((_, j) => j !== i) }, 'Delete keyframe')}><Icon name="trash" size={13} /></button>
              </div>
              <div className="row3">
                <Num label="t" value={k.t} step={0.01} min={0} onChange={(t) => editKey(i, { t }, 'Keyframe time')} />
                <Num label="X" value={k.x ?? layer.x} onChange={(x) => editKey(i, { x }, 'Keyframe')} />
                <Num label="Y" value={k.y ?? layer.y} onChange={(y) => editKey(i, { y }, 'Keyframe')} />
                <Num label="×" value={k.scale ?? layer.scale} step={0.01} onChange={(scale) => editKey(i, { scale }, 'Keyframe')} />
                <Num label="°" value={k.rotation ?? layer.rotation} onChange={(rotation) => editKey(i, { rotation }, 'Keyframe')} />
                <Num label="α" value={k.opacity ?? layer.opacity} step={0.01} min={0} max={1} onChange={(opacity) => editKey(i, { opacity }, 'Keyframe')} />
                <Num label="sx" title="Horizontal stretch (squash & stretch)" value={k.sx ?? 1} step={0.01} min={0} onChange={(sx) => editKey(i, { sx }, 'Keyframe')} />
                <Num label="sy" title="Vertical stretch (squash & stretch)" value={k.sy ?? 1} step={0.01} min={0} onChange={(sy) => editKey(i, { sy }, 'Keyframe')} />
                <Num label="sw" title="Stroke width" value={k.strokeWidth ?? layer.strokeWidth ?? 0} min={0} onChange={(strokeWidth) => editKey(i, { strokeWidth }, 'Keyframe')} />
              </div>
              <Select<EaseName> value={k.ease ?? 'smooth'} options={EASES} onChange={(ease) => editKey(i, { ease }, 'Keyframe ease')} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- project inspector ----------
function ProjectInspector({ project, commit, now }: { project: Project; commit: Commit; now: () => number }) {
  const set = (patch: Partial<Project>, label: string, key?: string) => commit({ ...project, ...patch }, label, key ? `project:${key}` : undefined);
  const setSections = (sections: Section[], label: string, key?: string) => set({ sections: [...sections].sort((a, b) => a.start - b.start) }, label, key);
  const aspect = ASPECTS.find((a) => a.width === project.width && a.height === project.height)?.id ?? 'custom';

  return (
    <div className="insp">
      <p className="hint">Nothing selected: these are the project settings. Select a layer in the preview, timeline or Layers panel.</p>
      <div className="group">
        <h4>Project</h4>
        <F label="Name"><input className="input" value={project.name} onChange={(e) => set({ name: e.target.value }, 'Rename project', 'name')} /></F>
        <F label="Format">
          <Select value={aspect} options={[...ASPECTS.map((a) => ({ id: a.id, label: `${a.label} · ${a.width}×${a.height}` })), ...(aspect === 'custom' ? [{ id: 'custom', label: `${project.width}×${project.height}` }] : [])]}
            onChange={(id) => { const a = ASPECTS.find((x) => x.id === id); if (a) commit(resizeProject(project, a.width, a.height), `Adapt to ${a.id}`); }} />
        </F>
        <div className="row3">
          <Num label="s" title="Duration (seconds)" value={project.duration} step={0.1} min={0.5} onChange={(duration) => set({ duration }, 'Duration', 'duration')} />
          <Num label="♩" title="BPM" value={project.bpm} min={20} max={300} onChange={(bpm) => set({ bpm }, 'BPM', 'bpm')} />
          <Num label="fps" value={project.fps} min={1} max={60} onChange={(fps) => set({ fps: Math.round(fps) }, 'FPS', 'fps')} />
        </div>
      </div>
      <div className="group">
        <h4>Background</h4>
        <Color value={project.background} onChange={(v) => set({ background: v ?? '#000000' }, 'Background', 'bg')} />
        <F label="Gradient to"><Color allowNone value={project.background2} onChange={(v) => set({ background2: v }, 'Background gradient', 'bg2')} /></F>
      </div>
      <div className="group">
        <h4>Sections
          <button className="btn sm" onClick={() => {
            const start = round(now());
            const next = project.sections.find((s) => s.start > start)?.start ?? project.duration;
            setSections([...project.sections, { id: uid('s'), name: `Section ${project.sections.length + 1}`, start, end: Math.min(next, start + 2), color: SECTION_COLORS[project.sections.length % SECTION_COLORS.length] }], 'Add section');
          }}><Icon name="plus" size={12} /> At playhead</button>
        </h4>
        {!project.sections.length && <p className="hint">Sections are the storyboard: named beats shown above the timeline.</p>}
        {project.sections.map((s, i) => (
          <div key={s.id} style={{ display: 'grid', gap: 6, background: 'var(--bg-2)', borderRadius: 10, padding: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="color" value={s.color} onChange={(e) => setSections(project.sections.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)), 'Section colour', `sec${s.id}`)} style={{ width: 24, height: 24, border: 0, padding: 0, background: 'none' }} />
              <input className="input" value={s.name} onChange={(e) => setSections(project.sections.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)), 'Rename section', `sec${s.id}`)} />
              <button className="icon-btn" title="Delete section" onClick={() => setSections(project.sections.filter((_, j) => j !== i), 'Delete section')}><Icon name="trash" size={13} /></button>
            </div>
            <div className="row2">
              <Num label="in" value={s.start} step={0.01} min={0} onChange={(start) => setSections(project.sections.map((x, j) => (j === i ? { ...x, start } : x)), 'Section timing', `sec${s.id}`)} />
              <Num label="out" value={s.end} step={0.01} min={0} onChange={(end) => setSections(project.sections.map((x, j) => (j === i ? { ...x, end } : x)), 'Section timing', `sec${s.id}`)} />
            </div>
          </div>
        ))}
      </div>
      <div className="group">
        <h4>Audio
          <select className="select" style={{ width: 'auto' }} value="" onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            const clip: AudioClip = v.startsWith('music:')
              ? { id: uid('a'), name: `Music · ${v.slice(6)}`, kind: 'music', music: { style: v.slice(6) as 'minimal' }, start: 0, volume: 0.8 }
              : { id: uid('a'), name: v, kind: 'sfx', sfx: v as SfxKind, start: round(now()), volume: 0.9 };
            set({ audio: [...(project.audio ?? []), clip] }, `Add ${clip.name}`);
          }}>
            <option value="">+ Add…</option>
            <optgroup label="Music (synthesised)">{['minimal', 'driving', 'ambient'].map((m) => <option key={m} value={`music:${m}`}>{m}</option>)}</optgroup>
            <optgroup label="Effect at playhead">{(['whoosh', 'hit', 'boom', 'pop', 'click', 'riser', 'sparkle', 'tick'] as SfxKind[]).map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
          </select>
        </h4>
        {!(project.audio?.length) && <p className="hint">No sound yet. Add synthesised music or effects here, or ask Claude to compose and sync them.</p>}
        {(project.audio ?? []).map((c, i) => {
          const edit = (patch: Partial<AudioClip>, label: string) => set({ audio: project.audio!.map((x, j) => (j === i ? { ...x, ...patch } : x)) }, label, `aud${c.id}`);
          return (
            <div key={c.id} style={{ display: 'grid', gap: 6, background: 'var(--bg-2)', borderRadius: 10, padding: 8 }}>
              <div className="row2" style={{ gridTemplateColumns: '1fr auto' }}>
                <input className="input" value={c.name} onChange={(e) => edit({ name: e.target.value }, 'Rename audio')} />
                <button className="icon-btn" title="Delete clip" onClick={() => set({ audio: project.audio!.filter((_, j) => j !== i) }, 'Delete audio')}><Icon name="trash" size={13} /></button>
              </div>
              <div className="row3">
                <Num label="in" title="Start (s)" value={c.start} step={0.01} min={0} onChange={(start) => edit({ start }, 'Audio start')} />
                <Num label="vol" title="Volume" value={c.volume} step={0.01} min={0} max={1.5} onChange={(volume) => edit({ volume }, 'Audio volume')} />
                <Num label="fo" title="Fade out (s)" value={c.fadeOut ?? 0} step={0.05} min={0} onChange={(fadeOut) => edit({ fadeOut: fadeOut || undefined }, 'Audio fade')} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="group">
        <h4>Camera
          <button className="btn sm" onClick={() => set({ camera: [...project.camera.filter((k) => Math.abs(k.t - now()) > 0.001), { t: round(now()), x: project.width / 2, y: project.height / 2, zoom: 1, rotation: 0, ease: 'smooth' as const }].sort((a, b) => a.t - b.t) }, 'Add camera key')}>
            <Icon name="camera" size={12} /> Key at playhead
          </button>
        </h4>
        {!project.camera.length && <p className="hint">Camera keys push in, pan and tilt the whole scene.</p>}
        {project.camera.map((k, i) => {
          const edit = (patch: Partial<typeof k>, label: string) => set({ camera: project.camera.map((x, j) => (j === i ? { ...x, ...patch } : x)).sort((a, b) => a.t - b.t) }, label, `cam${i}`);
          return (
            <div key={i} style={{ display: 'grid', gap: 6, background: 'var(--bg-2)', borderRadius: 10, padding: 8 }}>
              <div className="row3">
                <Num label="t" value={k.t} step={0.01} min={0} onChange={(t) => edit({ t }, 'Camera time')} />
                <Num label="×" title="Zoom" value={k.zoom ?? 1} step={0.01} min={0.1} onChange={(zoom) => edit({ zoom }, 'Camera zoom')} />
                <Num label="°" value={k.rotation ?? 0} step={0.5} onChange={(rotation) => edit({ rotation }, 'Camera tilt')} />
                <Num label="X" value={k.x ?? project.width / 2} onChange={(x) => edit({ x }, 'Camera pan')} />
                <Num label="Y" value={k.y ?? project.height / 2} onChange={(y) => edit({ y }, 'Camera pan')} />
                <button className="btn sm" title="Delete camera key" onClick={() => set({ camera: project.camera.filter((_, j) => j !== i) }, 'Delete camera key')}><Icon name="trash" size={12} /></button>
              </div>
              <Select<EaseName> value={k.ease ?? 'smooth'} options={EASES} onChange={(ease) => edit({ ease }, 'Camera ease')} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Inspector({ project, selected, commit, now, textRef }: { project: Project; selected: string[]; commit: Commit; now: () => number; textRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const layers = project.layers.filter((l) => selected.includes(l.id));
  if (layers.length === 1) return <LayerInspector key={layers[0].id} project={project} layer={layers[0]} commit={commit} now={now} textRef={textRef} />;
  if (layers.length > 1) {
    const setAll = (patch: Partial<Layer>, label: string) => commit({ ...project, layers: project.layers.map((l) => (selected.includes(l.id) ? { ...l, ...patch } : l)) }, label);
    return (
      <div className="insp">
        <div className="group">
          <h4>{layers.length} layers selected</h4>
          <p className="hint">Changes here apply to every selected layer.</p>
          <F label="Enter"><Select<EnterPreset> value={layers[0].enter.preset} options={ENTER_PRESETS} onChange={(preset) => setAll({ enter: { ...layers[0].enter, preset } } as Partial<Layer>, 'Enter motion')} /></F>
          <F label="Ease"><Select<EaseName> value={layers[0].enter.ease} options={EASES} onChange={(ease) => commit({ ...project, layers: project.layers.map((l) => (selected.includes(l.id) ? { ...l, enter: { ...l.enter, ease } } : l)) }, 'Enter ease')} /></F>
          <F label="Loop"><Select<LoopPreset> value={layers[0].loop.preset} options={LOOP_PRESETS} onChange={(preset) => commit({ ...project, layers: project.layers.map((l) => (selected.includes(l.id) ? { ...l, loop: { ...l.loop, preset } } : l)) }, 'Loop')} /></F>
          <F label="Fill"><Color value={layers[0].fill} onChange={(v) => setAll({ fill: v ?? '#000000' }, 'Fill')} /></F>
          <button className="btn sm" onClick={() => {
            const t = round(now());
            commit({ ...project, layers: project.layers.map((l) => (selected.includes(l.id) ? { ...l, end: l.end - l.start + t, start: t, keys: l.keys.map((k) => ({ ...k, t: k.t - l.start + t })) } : l)) }, 'Align starts to playhead');
          }}>Start all at playhead</button>
        </div>
      </div>
    );
  }
  return <ProjectInspector project={project} commit={commit} now={now} />;
}
