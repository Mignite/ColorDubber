# ColorDubber

![Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![Rust](https://img.shields.io/badge/Rust-stable-CE422B?logo=rust)
![License MIT](https://img.shields.io/badge/License-MIT-green)

Visual multi-speaker subtitle editor and color-coding companion for [auto-subs](https://github.com/tmoroney/auto-subs). Import its SRT+TXT, assign each speaker their color on a per-speaker lane timeline, and export clean SRT/JSON.

> **⚠️ Windows only:** this project is developed, tested and built **only for Windows**. Linux is not supported — the Vulkan (`whisper-rs`), FFmpeg pipelines and WebView rendering are Windows-specific and unreliable elsewhere. Do not file Linux issues.

> **⚠️ Transparency — heavy AI assistance:** this project was built with **heavy LLM assistance** for architecture, Rust/React implementation and debugging (canvas, waveform, diarization, Whisper). The author (1st-semester Systems Engineering student) understands the high-level flow, but **large parts of the codebase are not yet fully understood line-by-line by the author**. It is published honestly as a learning project and as a reference that might be useful to others. **Current plan:** deeply study each part (React canvas loop, Tauri IPC, timeline/diarization-UI, state handling) and **progressively rewrite/refactor all code with full personal understanding**. Issues and PRs pointing out confusing or improvable code are welcome — they help that learning.

## Screenshots

![ColorDubber — timeline por hablante y coloreado](https://raw.githubusercontent.com/Mignite/ColorDubber/main/design/screenshot.png)

> See approved design study in [`design/mockup.html`](design/mockup.html) (tokens, typography, per-speaker timeline).

## Features

- **Per-speaker timeline** — one lane per speaker (`—` for unassigned), HTML clips with real subtitle text, overlapping clips stacked with natural z-index.
- **Waveform** — prerendered canvas scaled by `devicePixelRatio`, time grid and coral playhead with halo. Remapped on pan/zoom via dual ref+state `windowStart`.
- **Multi-selection** — click, Ctrl+click (toggle), Shift+click (time-range), marquee on `trackArea` (replace/add/toggle), virtualized list selection.
- **Editing** — block body-drag (CSS `translate` + snap via `findSnapTime`, auto-pan at edges), edge drag, `max-height` of `trackArea` (28–112px) via `trackHandle`, split at playhead, undo snapshots (`pushHistorial`/`deshacer`/`rehacer`).
- **Shortcuts** — `a` new fragment (audio island), `c`/`e`/`s`, `z`/`y`, arrows, `?` help, `1–9` assign speaker, `Alt+←/→` jump caption, `Ctrl+scroll` pan, `Shift+scroll` zoom.
- **Speakers panel** — accordion with name, hotkey and color (`PALETA` 9 colors), commit snapshot on focus.
- **auto-subs import** — File menu: pick the SRT, the twin TXT is found automatically (same folder/name). Cue times from SRT, speakers from `Speaker N:` turns (sequential text match, accent/punctuation tolerant).
- **Audio islands** — `buscarFinIslaAudio` finds optimal fragment length (1.5–5s) from RMS vs local background; fallback 1.5s if no analysis yet.
- **Persistence** — `.json` projects with `playhead`, per-track `audioSrc`, volume cache, atomic writes (`.tmp`+rename).

## Stack

| Layer | Technology |
|-------|------------|
| Desktop | Tauri v2 (Rust + WebView) |
| Frontend | React 19, TypeScript, Vite 7, Vitest 4 |
| Styles | CSS design tokens (`:root`), local fonts `Space Grotesk` / `JetBrains Mono` / `Inter` |
| Backend | Rust, `symphonia` (volume analysis), `tokio` (async commands) |
| Audio | FFmpeg (extraction/mixing, required on PATH) |

> Former AI era (until 2026-09-20): local Whisper (`whisper-rs`/Vulkan) + `polyvoice` diarization, later a `pyannote` external-Python option. Benchmarked against a human reference, then cut: transcription belongs to auto-subs. See `docs/superpowers/specs/2026-09-19-companion-autosubs-design.md`.

## Prerequisites (Windows)

- **Rust** toolchain (`rustup`)
- **Node.js** 20+ and npm
- **Visual Studio Build Tools** with C++ workload (MSVC)
- **FFmpeg** on PATH — `winget install Gyan.FFmpeg` or official build; verify with `ffmpeg -version`

> `.cargo/config.toml` pins `target-dir = "C:/t/debug"` to avoid Windows `path too long`. Release builds go to `C:\t\release\bundle\nsis`.

## Installation

```bash
npm install
```

### Dev

```bash
npm run tauri -- dev
# or frontend only (no Tauri IPC):
npm run dev
```

Frontend at `http://127.0.0.1:1420`, Rust backend with hot-reload.

### Release build

```bash
npm run tauri:build:release
# equals: tauri build
```

Installer at `C:\t\release\bundle\nsis`.

## Usage

1. Transcribe in [auto-subs](https://github.com/tmoroney/auto-subs) (any model), export SRT (+TXT to keep speakers).
2. Open video in ColorDubber (drag & drop or File menu), wait for volume analysis (waveform).
3. File → Import auto-subs (SRT+TXT): pick the SRT, the twin TXT loads automatically.
4. Edit on timeline: block-move, trim edges, assign speaker (`1–9`), split, delete, recolor.
5. Save project (`.json`) and export `.srt` / combined JSON.

Full shortcuts: press `?` inside the app.

## File Structure

```
src/
  App.tsx / App.css          # layout, canvas loop, keybindings, IPC
  types.ts                   # Caption, Hablante, Proyecto, TrackInfo
  components/
    CaptionList.tsx          # virtualized list
    SpeakersPanel.tsx        # speakers accordion
  utils/
    srt.ts                   # parseSrt / buildSrt
    autosubs.ts              # parseAutosubsTxt / text-match speaker assignment
    captions.ts              # findSnapTime, BuildOverlapReport
    time.ts                  # formatTime / parseTimeInput
    selection.ts             # filtrarPorMarquee
    audioIslands.ts          # buscarFinIslaAudio
    constants.ts             # PALETA, VENTANAS_POR_SEGUNDO, etc.
  hooks/useHistory.ts        # pushHistorial / deshacer / rehacer
src-tauri/
  src/lib.rs                 # Tauri commands + menu + IPC
  Cargo.toml
  tauri.conf.json
  capabilities/default.json
design/mockup.html           # approved design study
```

## Tests

```bash
npm test          # vitest run — 53 tests (srt, time, captions, selection, audioIslands, autosubs)
npm run build     # tsc + vite build (type gate)
```

Rust has no linter configured; `cargo check` is fast (no heavy AI deps).

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Migue Echeverri.
