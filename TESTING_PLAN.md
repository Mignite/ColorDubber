# Testing Plan — Post-Optimization Verification

## 1. Automated Tests

```bash
npm run test              # 26 JS tests (SRT parse/build, lane computation, snap, overlap reports)
cd src-tauri && cargo test  # 17 Rust tests (postprocess: punctuation, merging, cue splitting, scheduling)
```

## 2. TypeScript & Rust Compilation

```bash
npx tsc --noEmit                         # zero errors expected
cd src-tauri && cargo build 2>&1          # release profile applies, no build breakage
```

## 3. Manual Testing — Canvas Waveform (Per-Frame Optimization)

| Test | Steps | Expected |
|------|-------|----------|
| **Waveform renders** | Open a video, wait for audio analysis | Waveform appears in timeline, same visual as before |
| **Waveform updates on scroll/zoom** | Scroll timeline (wheel), zoom (shift+wheel) | Waveform follows window correctly, no visual tearing |
| **Waveform on different tracks** | Switch audio track selector | Waveform re-renders for new track |
| **No regression on seek** | Click timeline to seek, drag playhead | Waveform stays stable, no flicker |
| **Drag caption edges** | Drag caption start/end edge | Edge colors (speaker color) appear correctly |
| **Memory** | Open DevTools → Performance → record while playing video | No frame drops, no per-frame GC allocations in waveform paint |

## 4. Manual Testing — Virtual CaptionList

| Test | Steps | Expected |
|------|-------|----------|
| **Scroll behavior** | Load 500+ captions, scroll up/down | Smooth scrolling, only ~25 rows in DOM |
| **Active caption visible** | Play video, watch CaptionList | Active row highlights, list scrolls to keep it visible |
| **Speaker colors** | Assign speakers via 1-9 keys | Border colors and speaker tags appear instantly |
| **Delete/resize** | Delete a caption, add new ones | List re-renders correctly, scroll height adjusts |
| **Empty state** | Remove all captions | "Sin subtítulos cargados" placeholder shows |
| **Count** | Check caption count in header | Matches actual number of captions |

## 5. Manual Testing — Shortcut Help Modal

| Test | Steps | Expected |
|------|-------|----------|
| **Toggle** | Press `?` key | Overlay appears with full shortcut table |
| **Dismiss** | Click outside, press `?` again, or click "Cerrar" | Modal closes |
| **Responsive** | Resize window | Modal stays centered and scrollable |

## 6. Manual Testing — Rust Backend

| Test | Steps | Expected |
|------|-------|----------|
| **FFmpeg check** | Check Tauri devtools console for `verificar_ffmpeg` result | Returns `true` if ffmpeg installed, `false` otherwise |
| **Transcription** | Start transcription | VAD model downloads before blocking thread (shorter blocking phase) |
| **Release build** | `npm run tauri:build:release` | Binary builds with LTO, smaller size, faster execution |

## 7. Performance Benchmarking (Optional)

```bash
# Before/after comparison using React DevTools Profiler
# Record 10s of playback with 200+ captions:
# Before: ~800+ fillRect calls + N×M find() per frame
# After:  1 drawImage + O(1) Map get + virtualized DOM
```

**Key metrics to compare:**
- FPS during playback (should stay 60fps)
- DOM node count (should drop from N to ~25)
- Memory allocations/s in DevTools Performance tab
- CaptionList React re-render time (Profile tab)

## 8. Regression Checklist

- [ ] Drag-drop SRT files works
- [ ] `npm run build` passes (tsc + vite build)
- [ ] Speaker panel add/edit/delete works
- [ ] Ctrl+Z/Y undo/redo works
- [ ] Audio track switching re-analyzes waveform
