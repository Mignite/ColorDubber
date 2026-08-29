# ColorDubber

![Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![Rust](https://img.shields.io/badge/Rust-stable-CE422B?logo=rust)
![Whisper](https://img.shields.io/badge/Whisper-local%20GGML-7C3AED)
![License MIT](https://img.shields.io/badge/License-MIT-green)

Visual multi-speaker subtitle editor with AI diarization. Speaker-based color-coding, volume waveform, per-speaker lane timeline, local transcription with Whisper (GGML models) and VAD.

> **⚠️ Windows only:** this project is developed, tested and built **only for Windows**. Linux is not supported — the Vulkan (`whisper-rs`), FFmpeg pipelines and WebView rendering are Windows-specific and unreliable elsewhere. Do not file Linux issues.

> **⚠️ Transparency — heavy AI assistance:** this project was built with **heavy LLM assistance** for architecture, Rust/React implementation and debugging (canvas, waveform, diarization, Whisper). The author (1st-semester Systems Engineering student) understands the high-level flow, but **large parts of the codebase are not yet fully understood line-by-line by the author**. It is published honestly as a learning project and as a reference that might be useful to others. **Current plan:** deeply study each part (React canvas loop, Tauri IPC, Whisper/VAD, state handling) and **progressively rewrite/refactor all code with full personal understanding**. Issues and PRs pointing out confusing or improvable code are welcome — they help that learning.

## Screenshots

> See approved design study in [`design/mockup.html`](design/mockup.html) (tokens, typography, per-speaker timeline).

Placeholder: add screenshots in `design/` or `docs/screenshots/` and reference them here.

## Features

- **Per-speaker timeline** — one lane per speaker (`—` for unassigned), HTML clips with real subtitle text, overlapping clips stacked with natural z-index.
- **Waveform** — prerendered canvas scaled by `devicePixelRatio`, time grid and coral playhead with halo. Remapped on pan/zoom via dual ref+state `windowStart`.
- **Multi-selection** — click, Ctrl+click (toggle), Shift+click (time-range), marquee on `trackArea` (replace/add/toggle), virtualized list selection.
- **Editing** — block body-drag (CSS `translate` + snap via `findSnapTime`, auto-pan at edges), edge drag, `max-height` of `trackArea` (28–112px) via `trackHandle`, split at playhead, undo snapshots (`pushHistorial`/`deshacer`/`rehacer`).
- **Shortcuts** — `a` new fragment (audio island), `c`/`e`/`s`, `z`/`y`, arrows, `?` help, `1–9` assign speaker, `Alt+←/→` jump caption, `Ctrl+scroll` pan, `Shift+scroll` zoom.
- **Speakers panel** — accordion with name, hotkey and color (`PALETA` 9 colors), commit snapshot on focus.
- **Whisper panel** — GGML model download with `.part`+rename progress, track selection, languages (`auto`/`es`/`en`/`pt`/`fr`/`it`/`de`/`ja`/`zh`), modes `beam5`/`greedy`, global glossary, VAD and diarization (polyvoice, best-effort with fallback).
- **Audio islands** — `buscarFinIslaAudio` finds optimal fragment length (1.5–5s) from RMS vs local background; fallback 1.5s if no analysis yet.
- **Persistence** — `.json` projects with `playhead`, per-track `audioSrc`, volume cache, atomic writes (`.tmp`+rename).

## Stack

| Layer | Technology |
|-------|------------|
| Desktop | Tauri v2 (Rust + WebView) |
| Frontend | React 19, TypeScript, Vite 7, Vitest 4 |
| Styles | CSS design tokens (`:root`), local fonts `Space Grotesk` / `JetBrains Mono` / `Inter` |
| Backend | Rust, `whisper-rs` (Vulkan), `polyvoice` (VAD/diarization), `symphonia` (volume analysis) |
| Audio | FFmpeg (extraction/mixing, required on PATH) |

## Prerequisites (Windows)

- **Rust** toolchain (`rustup`)
- **Node.js** 20+ and npm
- **CMake** on PATH — `winget install --id Kitware.CMake` (required by `whisper-rs-sys`)
- **Visual Studio Build Tools** with C++ workload (MSVC)
- **Vulkan SDK** — set `VULKAN_SDK`
- **FFmpeg** on PATH — `winget install Gyan.FFmpeg` or official build; verify with `ffmpeg -version`

> `.cargo/config.toml` and `src-tauri/.cargo/config.toml` pin `target-dir = "C:/t/debug"` to avoid Windows `path too long` with `whisper-rs-sys` + Vulkan. Do not remove. Release builds go to `C:\t\release\bundle\nsis`.

## Installation

```bash
npm install
```

### Dev

```bash
npm run tauri dev
# or frontend only (no Tauri IPC):
npm run dev
```

Frontend at `http://localhost:1420`, Rust backend with hot-reload.

### Release build

Run in an **administrator** terminal (required for NSIS):

```bash
npm run tauri:build:release
# equals: cross-env CMAKE_ARGS=-DGGML_VULKAN_SHADERS_GEN_EXTERNAL=OFF tauri build
```

Installer at `C:\t\release\bundle\nsis`.

## Usage

1. Open video (drag & drop or File menu).
2. Wait for volume analysis (waveform).
3. Pick Whisper model, language and mode; choose tracks; transcribe. Optional speaker diarization.
4. Edit on timeline: create (`a`), block-move, trim edges, assign speaker (`1–9`), split, delete.
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
    WhisperPanel.tsx         # models, transcription, language/mode
  utils/
    srt.ts                   # parseSrt / buildSrt
    captions.ts              # findSnapTime, BuildOverlapReport
    time.ts                  # formatTime / parseTimeInput
    selection.ts             # filtrarPorMarquee
    audioIslands.ts          # buscarFinIslaAudio
    constants.ts             # PALETA, VENTANAS_POR_SEGUNDO, etc.
  hooks/useHistory.ts        # pushHistorial / deshacer / rehacer
src-tauri/
  src/lib.rs                 # Tauri commands + menu + IPC
  src/postprocess.rs         # word-level formatting
  Cargo.toml
  tauri.conf.json
  capabilities/default.json
design/mockup.html           # approved design study
```

## Tests

```bash
npm test          # vitest run — 45 tests (srt, time, captions, selection, audioIslands)
npm run build     # tsc + vite build (type gate)
```

Rust has no linter configured; `cargo check` needs a long build (whisper-rs/polyvoice).

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Migue Echeverri.
