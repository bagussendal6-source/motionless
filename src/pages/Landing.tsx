import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Project } from '../../shared/types.ts';
import { buildDemoProject } from '../../shared/demo.ts';
import { Player } from '../components/Player.tsx';
import { Icon, Logo, ThemeToggle } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { kineticType, portraitPromo, productDrop } from '../lib/samples.ts';

const STICKERS = [
  { text: '“punchier hook, please”', color: '#FF5C8A', style: { left: '0%', top: 92, rotate: '-7deg' } },
  { text: '“now make it portrait”', color: '#5CC8FF', style: { right: '3%', top: 78, rotate: '5deg', fontSize: 12 } },
  { text: '“more bounce”', color: '#FFB13D', style: { right: '0%', top: 520, rotate: '9deg' } },
  { text: '“use our brand font”', color: '#C8FF3D', style: { left: '2%', top: 540, rotate: '-5deg', fontSize: 13 } },
];

const FEATURES = [
  { icon: 'sparkle', title: '15 motion presets', text: 'Rise, pop, wipe, flip, typewriter, per-letter and per-word staggers. Every one runs on springs.' },
  { icon: 'key', title: 'Keyframes + camera', text: 'Animate any property between keys, then push in, whip-pan or tilt the whole scene.' },
  { icon: 'magnet', title: 'Beat grid', text: 'Set the BPM and every drag snaps to the beat, so cuts land on the music.' },
  { icon: 'layers', title: 'Real layers', text: 'Text, shapes, gradients, images, blend modes and shadows. Nothing is baked into a video file.' },
  { icon: 'undo', title: 'One undo per change', text: "Every edit, yours or Claude's, is its own step in the history, labelled with who made it." },
  { icon: 'eye', title: 'Claude can look', text: 'render_frames lets Claude see its own frames and fix what looks off before you do.' },
  { icon: 'crop', title: 'Any aspect', text: 'Re-lay a 16:9 cut as 9:16, 1:1 or 4:5 in one step, then fine-tune.' },
  { icon: 'export', title: 'Export anywhere', text: 'Record to MP4 or WebM in the browser, grab a PNG still, or take the JSON with you.' },
] as const;

const FAQ = [
  { q: 'Do I need an API key?', a: 'No. MotionLess runs locally and Claude Code drives it through MCP, using your own Claude Code session.' },
  { q: 'Can I edit without Claude?', a: 'Yes. The editor is a complete motion tool on its own: layers, timeline, inspector, keyframes, camera and export.' },
  { q: 'Where are my projects stored?', a: 'As plain JSON files in the data/ folder of your MotionLess checkout. Diff them, commit them, script them.' },
  { q: 'How does Claude see what it made?', a: 'With the editor open, the render_frames tool asks the editor to draw frames at chosen times and returns them as images.' },
];

const CONNECT = `# in the MotionLess folder
npm install && npm run dev

# register the MCP server with Claude Code
claude mcp add motionless -- node $PWD/mcp/index.ts`;

export function Landing() {
  const demo = useMemo(buildDemoProject, []);
  const samples = useMemo(() => [productDrop(), kineticType(), portraitPromo()], []);
  const [t, setT] = useState(0);
  const [apiUp, setApiUp] = useState<boolean | null>(null);

  useEffect(() => {
    api.health().then(() => setApiUp(true), () => setApiUp(false));
  }, []);

  return (
    <div className="landing">
      <nav className="nav">
        <Link to="/"><Logo size={24} /></Link>
        <div className="nav-links">
          <a href="#how">How it works</a>
          <a href="#inside">Inside</a>
          <a href="#gallery">Gallery</a>
          <a href="#faq">FAQ</a>
        </div>
        <div className="nav-right">
          <ThemeToggle />
          <Link className="btn ghost" to="/dashboard">Projects</Link>
          <Link className="btn" to="/p/demo">Open the demo</Link>
        </div>
      </nav>

      <header className="hero">
        {STICKERS.map((s) => (
          <span key={s.text} className="sticker" style={{ background: s.color, ...s.style }}>{s.text}</span>
        ))}
        <h1>Less keyframing.<br /><em>More</em> motion.</h1>
        <p className="lede">
          MotionLess is an MCP server for Claude Code. Claude reads your repo and builds launch videos from your copy,
          colours, fonts and images. You watch them come together in a real editor, and every frame stays editable.
        </p>
        <div className="hero-ctas">
          <Link className="btn candy lg" to="/p/demo">Open the demo</Link>
          <Link className="btn lg" to="/new">New project</Link>
        </div>
        {apiUp === false && (
          <p className="hint" style={{ marginTop: 18 }}>
            The local API isn't running, so the editor can't open yet. Start it with <code>npm run dev</code>.
          </p>
        )}
      </header>

      <div className="demo-frame">
        <div className="demo-top">
          <div className="dots"><i /><i /><i /></div>
          <span style={{ marginLeft: 8 }}>{demo.name}</span>
          <span style={{ marginLeft: 'auto' }} className="pill">{demo.width}×{demo.height} · {demo.bpm} BPM</span>
        </div>
        <Player project={demo} className="demo-player" onTime={setT} />
        <div className="demo-sections">
          {demo.sections.map((s) => {
            const p = Math.max(0, Math.min(1, (t - s.start) / (s.end - s.start)));
            return (
              <div key={s.id} className={t >= s.start && t < s.end ? 'active' : ''} style={{ flex: s.end - s.start }}>
                <span className="fill" style={{ background: s.color, transform: `scaleX(${p})` }} />
                <b>{s.name}</b>
              </div>
            );
          })}
        </div>
      </div>

      <section className="section" id="how">
        <div className="eyebrow">How it works</div>
        <h2>Ask in plain words. Get a video you can still edit.</h2>
        <div className="steps">
          <div className="card">
            <div className="step-num" style={{ background: 'var(--accent)' }}>1</div>
            <h3>Connect</h3>
            <p>Run MotionLess locally and add its MCP server to Claude Code. One command.</p>
            <div className="code">{CONNECT.split('\n').map((l, i) => <div key={i} className={l.startsWith('#') ? 'c' : ''}>{l || ' '}</div>)}</div>
          </div>
          <div className="card">
            <div className="step-num" style={{ background: 'var(--pink)' }}>2</div>
            <h3>Ask</h3>
            <p>Tell Claude what you're launching. It reads your README, styles and logo, plans sections on the beat, then builds the cut.</p>
            <div className="code"><span className="g">›</span> make a 15s launch video for this repo,{'\n'}  portrait, lots of kinetic type</div>
          </div>
          <div className="card">
            <div className="step-num" style={{ background: 'var(--blue)' }}>3</div>
            <h3>Tweak</h3>
            <p>Each change shows up in the editor as it happens. Drag a bar on the timeline, swap a colour, or select a layer and tell Claude to change “this”.</p>
            <div className="code"><span className="g">›</span> make this bigger and slow it down{'\n'}<span className="c">  ✓ Edit 1 layer · undo available</span></div>
          </div>
        </div>
      </section>

      <section className="section" id="inside">
        <div className="eyebrow">Inside the editor</div>
        <h2>A real motion tool, not a template filler.</h2>
        <p className="sub">Everything Claude can do over MCP, you can do by hand, and the reverse is true too.</p>
        <div className="features">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <div className="ic"><Icon name={f.icon} size={18} /></div>
              <h4>{f.title}</h4>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="gallery">
        <div className="eyebrow">Gallery</div>
        <h2>Same engine, any format.</h2>
        <div className="gallery">
          {samples.map((s: Project) => (
            <figure key={s.id}>
              <Player project={s} className="shot" />
              <figcaption><b>{s.name}</b><span>{s.width === s.height ? '1:1' : s.width > s.height ? '16:9' : '9:16'} · {s.duration}s</span></figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="section" id="faq">
        <div className="eyebrow">FAQ</div>
        <h2>Good questions.</h2>
        <div className="faq">
          {FAQ.map((f) => (
            <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>
          ))}
        </div>
      </section>

      <div className="cta-band">
        <h2>Your next launch video<br />is one sentence away.</h2>
        <p>Open the demo, select any layer, and change it.</p>
        <Link className="btn lg" to="/p/demo">Open the demo</Link>
      </div>

      <footer className="footer">
        <div>
          <Logo size={22} />
          <p style={{ maxWidth: 280 }}>Motion design you can ask for and still edit.</p>
        </div>
        <div className="cols">
          <div><h5>Product</h5><a href="#inside">Inside</a><a href="#gallery">Gallery</a><Link to="/p/demo">Demo</Link></div>
          <div><h5>Learn</h5><a href="#how">How it works</a><a href="#faq">FAQ</a></div>
          <div><h5>Start</h5><Link to="/new">New video</Link><Link to="/dashboard">Projects</Link></div>
        </div>
        <div style={{ width: '100%', fontSize: 13 }}>© {new Date().getFullYear()} MotionLess</div>
      </footer>
    </div>
  );
}
