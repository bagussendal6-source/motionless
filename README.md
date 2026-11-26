# MotionLess

**Less keyframing. More motion.**

MotionLess is a motion-design editor that Claude Code drives over MCP. Ask Claude for a launch video and it reads
your repo (copy, colours, fonts, logo), then builds the video in the editor while you watch. Every frame stays editable,
by hand or by asking again.

## Quick start

```bash
npm install
npm run dev
```

- Editor: http://localhost:5173 (landing page, `/dashboard`, `/p/demo`)
- API: http://127.0.0.1:4317 (projects, history, live events)

## Connect Claude Code

The repo ships a project-scoped `.mcp.json`, so Claude Code started inside this folder picks up the server
automatically. To use MotionLess from any other repo (the usual case: you want a video *about* that repo):

```bash
claude mcp add motionless -- node /absolute/path/to/MotionLess/mcp/index.ts
```

Keep `npm run dev` running, open the project in the editor, and ask Claude something like:

> Make a 15 s launch video for this repo in MotionLess. Portrait, lots of kinetic type.

Select a layer in the editor and you can say “make **this** bigger”. Claude resolves it with `get_selection`.

### MCP tools

| Tool | What it does |
| --- | --- |
| `get_catalog` | Document format, presets, eases, fonts, craft notes |
| `list_projects` / `create_project` / `get_project` / `update_project` | Project CRUD |
| `add_layers` / `update_layers` / `delete_layers` / `duplicate_layers` / `reorder_layer` | Layer edits. Batches are validated whole: every problem is listed at once, `onInvalid: skip \| sanitize` applies the good part, `dryRun` previews. Replies include estimated text boxes and lint |
| `group_layers` | Transparent parent: animate one layer, every member follows |
| `analyze_motion` | Overshoot, settle time, bounces, hard jumps per enter/exit/keyframe segment (the motion, not just stills) |
| `add_audio` / `update_audio` / `delete_audio` / `auto_sfx` | Music and effects (synthesised or imported), synced to the picture, mixed into the export |
| `apply_motion` | Enter / exit / loop motion on many layers at once |
| `retime` | Shift or set timing (keyframes move with the layer) |
| `set_sections` / `set_camera` | Storyboard sections and camera keyframes. Camera keys are written out in full (omitted values hold the previous key) and checked for cropping |
| `adapt_aspect` | Re-lay the video for 16:9, 9:16, 1:1 or 4:5 |
| `import_asset` | Copy an image from a path or URL into the project |
| `undo` / `redo` / `history` | One undo step per change, labelled by who made it |
| `get_selection` | What the user selected in the editor, and the playhead |
| `render_frames` | Claude sees rendered frames (editor must be open) |
| `report_progress` | Status line shown in the editor |
| `open_editor` | Editor URL for a project |

## The editor

- **Canvas preview**: click to select, Shift-click to add, drag to move (Shift locks the axis), double-click text to edit it.
- **Timeline**: scrub the ruler, drag bars to retime, drag edges to trim. Snaps to the beat grid (hold Alt to bypass). Sections, camera keys and keyframes are all shown.
- **Layers**: text, shapes (rect, ellipse, pill, triangle, star, line) and images (upload). Drag to reorder; hide and lock.
- **Inspector**: typography, fill and gradient, stroke, shadow, blend mode, transform, timing, enter/exit/loop motion, and keyframes. With nothing selected it shows project settings, sections and the camera.
- **Motion**: 15 enter/exit presets (fade, rise, drop, slides, pop, zoom, spin, blur, wipe, flip, typewriter, letters, words), 6 loops, and spring, bouncy, smooth and snap eases.
- **Export**: MP4 or WebM recorded in the browser, a PNG of the current frame, or the project JSON.

Shortcuts: `Space` play/pause · `⌘Z` / `⇧⌘Z` undo/redo · `⌘D` duplicate · `⌫` delete · arrows nudge (Shift ×10) ·
`,` / `.` step one frame · `Home` / `End` jump to start / end · `Esc` deselect.

## How it fits together

```
Claude Code ──stdio──▶ mcp/index.ts ──HTTP──▶ server/index.ts ──SSE──▶ editor (React, canvas)
                                              │  JSON files in data/      ▲
                                              └── undo history ──────────┘  edits go back via PUT
```

- `shared/`: the document model (`types.ts`), operations (`ops.ts`), presets and catalog, and the demo trailer.
- `src/lib/engine.ts`: a deterministic renderer, `(project, time) → pixels`. Preview, scrubbing, thumbnails, `render_frames` and export all use it.
- `server/`: stores projects in `data/projects/*.json`, keeps per-project undo history, relays render requests, and serves `dist/` in production.

Production: `npm start` builds the editor and serves everything from the API port.

## Not included (yet)

Original-score generation, narration/voice-over and audio tracks. Export is silent video.

## Authoring notes

- **Edges, not centres**: `left` / `right` / `top` / `bottom` position a layer by its edge (`x`/`y` are centres). Text can `autoFit` into its box.
- **Keyframes** animate `x, y, scale, rotation, opacity, width, height, fill, sx, sy, stroke, strokeWidth`. `sx`/`sy` stretch and squash; `pivot` moves the transform origin (`{x:0, y:0.5}` = bottom edge).
- **Frame 0**: `enter.from` (0 to 0.95) lifts the starting size/opacity so `pop`, `letters` and friends never leave an empty first frame.
- **Camera**: a value left out of a key holds the previous key's value, and zoom > 1 crops the edges. `lint_project` reports `camera-crop`.
- **Audio**: built-in effects (`whoosh hit boom pop click riser sparkle tick`) and music (`minimal driving ambient`) are synthesised in the browser from the project bpm; import `.mp3/.wav/.m4a` for real tracks. Use the editor's Export menu for video with sound or a WAV.
