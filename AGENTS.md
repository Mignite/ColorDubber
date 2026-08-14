# ColorDubber AI — Agent Guide

Tauri v2 + React 19 + Rust. AI subtitle editing with Whisper diarization.

## Files
- `src/types.ts` — All interfaces: `Caption`, `Hablante`, `Proyecto`, `TrackInfo`, `LaneInfo`, `OverlapEntry`
- `src/App.tsx` — Layout, canvas loop, keybindings, IPC orchestration
- `src/App.css` — All styles (camelCase classes)
- `src/components/CaptionList.tsx` — Virtualized rows with time+color
- `src/components/SpeakersPanel.tsx` — Accordion, name/key/color per speaker. Prop `onCommit` (undo snapshot on input focus)
- `src/components/WhisperPanel.tsx` — Model download, track selection, transcribe button, language + sampling mode (beam5/greedy) selectors
- `src/utils/constants.ts` — `VENTANAS_POR_SEGUNDO`, `PALETA`, `SNAP_THRESHOLD`, `HISTORY_LIMIT`
- `src/utils/srt.ts` — `parseSrt()`, `buildSrt()`, `formatSrtTimestamp()`
- `src/utils/captions.ts` — `computeCaptionLanes()`, `findSnapTime()`, `BuildOverlapReport()`
- `src/utils/time.ts` — `formatTime()`, `parseTimeInput()`
- `src/hooks/useHistory.ts` — `pushHistorial`/`deshacer`/`rehacer` snapshot undo
- `src/utils/__tests__/` — vitest suites for srt, time, captions
- `src-tauri/src/lib.rs` — All Rust commands + menu
- `src-tauri/src/postprocess.rs` — Word-level subtitle formatter
- `src-tauri/Cargo.toml` — Dependencies: tauri 2, symphonia, whisper-rs, polyvoice

## Commands
- `npm run build` — tsc + vite build (typecheck gate; run before finishing)
- `npm test` — vitest run (34 tests: srt/time/captions)
- `npm run dev` — browser-only Vite
- `npm run tauri` — desktop dev
- `npm run tauri:build:release` — release build (needs `CMAKE_ARGS=-DGGML_VULKAN_SHADERS_GEN_EXTERNAL=OFF`)
- Rust has no linter configured; `cargo check` requires a long fresh compile (whisper-rs/polyvoice)

## Windows build prerequisites (after a fresh install/format)
- **CMake** on PATH (needed by the `whisper-rs-sys` build script; else "program not found"). Install: `winget install --id Kitware.CMake`.
- **Visual Studio Build Tools** with C++ workload (MSVC), **Vulkan SDK** (`VULKAN_SDK` env var), Rust toolchain, ffmpeg on PATH.
- **Target dir**: `.cargo/config.toml` sets `target-dir = "C:/t/debug"` to avoid Windows path-too-long errors (whisper-rs-sys + long Vulkan SDK path). Don't remove it.

## Critical Patterns
1. **Dual ref+state** — `useRef` synced via a bare `useEffect` (no deps, App.tsx ~line 300) for every value read in rAF or event listeners. Ref is source of truth in callbacks.
2. **Canvas** — `requestAnimationFrame` loop; `drawCanvasFrame()` at App.tsx. Scaled by `devicePixelRatio` via `ctx.setTransform()`. Waveform, captions and playhead are drawn unconditionally (waveform only when prerendered).
3. **Undo** — Call `pushHistorial()` before any mutation (add/delete/split/assign/commit of edits). Snapshot uses `captionsRef` + `hablantesRef`. Text inputs snapshot on **focus** (see `handleEditorFocus`, SpeakersPanel `onCommit`) so keystrokes don't flood history.
4. **IPC** — `invoke("cmd", {args})` to call Rust; `listen("evt", cb)` for events.
5. **Language** — Spanish naming. PascalCase types, camelCase funcs, UPPER_SNAKE constants.
6. **Keyboard** — window `keydown` listener registered **once** (empty deps) — handlers must read refs, never state.
7. **Speaker colors** — `PALETA` in constants.ts, max 9. Hotkey `tecla`, name, color. Used in canvas, list borders, dots.
8. **Caption lanes** — `computeCaptionLanes()` returns `Map<id, LaneInfo>`; overlapping caps render in separate horizontal bands.
9. **Timeline** — Shift+scroll zoom (2–60s), scroll pan, edge-drag auto-scrolls, snap with Ctrl override.
10. **Menu events** — Menu items emit app events (`abrir_proyecto`, `guardar_proyecto`, …) consumed by a single `useEffect` with empty deps in App.tsx.
11. **Downloads** — Model downloads stream to a `.part` file and rename on success (never leave a corrupt model marked downloaded).
12. **Memoized props** — `CaptionList`/`SpeakersPanel`/`WhisperPanel` are `memo()`. Callbacks passed to them MUST be `useCallback`-stable (`seekTo`, `eliminarCaption`, `eliminarHablante`, `handleTranscribir`, `toggleTrack`, panel toggles, …); otherwise they re-render ~10×/s while the playhead state ticks. `playheadTime`/`windowStart` updates re-render App on every rAF tick — keep component boundaries memoized.
13. **Whisper state reuse** — `transcribir_video` creates a single `WhisperContext` state and reuses it across VAD segments (avoid re-allocating whisper buffers per segment); `params` is moved in the non-VAD branch and cloned per segment (`params.clone()`), the two branches are exclusive so the borrow checker is happy. Decode params come from the UI: `idioma` (`"auto"`/empty → `None`), `modo_muestreo` (`"greedy"` → `Greedy{best_of:1}`, default BeamSearch 5), plus `temperature_inc 0.2`, `entropy_thold 2.4`, `logprob_thold -1.0`, `max_len 42`.

## Known Traps & Gotchas
- **Track index mapping**: `listar_tracks_audio` enumerates tracks *filtered* by `sample_rate.is_some()`; `analizar_volumen` uses the same filtered `.nth(idx)`, but ffmpeg is called with `-map 0:a:N` (N-th *audio* stream). Works for typical containers; may mismatch on exotic layouts.
- **Hotkey collisions**: app hotkeys (`a`, `c`, `e`, `s`, `z`, `y`, `?`, arrows) take precedence over speaker hotkeys — don't assign those letters to a speaker.
- **Float precision**: `formatTime()` truncates to 2 decimals; roundtripping `parseTimeInput(formatTime(x))` drifts for values like 3599.99. `formatSrtTimestamp()` handles ms rollover (1.9995 → `00:00:02,000`).
- **Listener deps**: menu/drag/keyboard effects must stay `[]` — if you add state reads there, either add the deps or move reads into refs.
- **Virtual list**: `CaptionList` virtualizes rows; `rowRefs` only contains rendered rows — don't assume all captions have DOM refs.
- **Rust thread**: `transcribir_video` runs in a dedicated thread with 8MB stack (whisper.cpp needs it); never add heavy work to the async main thread.
- **ffmpeg required**: transcription, audio extraction and track mixing shell out to ffmpeg — check `verificar_ffmpeg()` on setup errors.
- **VAD/diarization are best-effort**: `run_vad_sync` and `diarizar_get_turns` failures are non-critical (fall back to full transcription / no speakers).
- **HiDPI hit-testing**: mouse events give CSS pixels, but `canvas.height/width` are device px (`* dpr`). Use `canvas.clientHeight` in hit-tests; `canvas.height` only inside `drawCanvasFrame`.
- **Array order after edge drags**: `actualizarTiempoCaption` does NOT re-sort `captions`; dragging a caption past another leaves the array unsorted. `sortedByStartRef` (rebuilt when captions change) exists for navigation/binary search — don't assume `captionsRef.current` is sorted.
- **Waveform prerender**: rebuilt in a `useEffect` on `[volumen, analizando]` — the `analizando` guard avoids regenerating on every `volumen_chunk` (quadratic cost on long videos). Keep `setVolumen` + `setAnalizando(false)` in the same sync block so they batch into one render.
- **Keyboard guard**: the global `keydown` returns early for `INPUT`/`TEXTAREA`/`SELECT` — arrow keys or space in the track `<select>` won't seek/play.
- **Undo**: call `pushHistorial()` *after* validating (e.g., check `currentCaptionIdxRef` before pushing in `asignarHablante`) to avoid empty undo steps.

## Session log (2026-08-14) — frontend pass (approved 1-17)
- **Bugs de interacción**: `handleClickTimeline` ya no pausa/restaura (el par mousedown/mouseup del canvas lo maneja — antes cada click con video reproduciéndose terminaba pausado); click sin arrastre en borde de caption no commitea undo vacío ni hace seek (`dragStartTimeRef` comparado + `justFinishedEdgeDragRef` consumido por el click); `agregarFragmento` marca `skipEditorHistoryRef` para que el focus automático no duplique el push (Ctrl+Z tras nuevo fragmento ahora deshace en UNA pulsación); `handleEditorFocus` solo pushea si cambió el estado real (refs `editorPushedCaptionsRef/HablantesRef`); transcripción descarta el resultado si `videoPathRef` cambió en vuelo; abrir video/proyecto/nuevo resetea `volumen`/`analizando`/`videoDuration`/request-id y limpia `waveformCacheRef`; borrar el modelo seleccionado limpia la selección (`""`); `saltarCaption` Alt+← retrocede uno más si el playhead está dentro del candidato (va al anterior, no reinicia el actual); `cargarTracks` valida `videoPathRef` al resolver.
- **Riesgos**: `handleAbrirSrt`/`handleGuardarComo`/`handleExportarJsonCombinado` con try/catch (antes unhandled rejections); error de transcripción visible en WhisperPanel (`errorTranscripcion` state + caja reutilizada) en vez de console.error silencioso; `ignoreNextChangeRef` ya se setea tras el parse exitoso (verificado).
- **Limpieza**: `isDraggingScrollbarRef` eliminado (write-only); tipos `ModeloDescargaEvent`/`TranscripcionProgreso` de types.ts usados en los listeners; rama `estadoDescarga === "tokenizer"` eliminada (Rust nunca la emite); `waveformCacheRef` con tope de 8 entradas (LRU simple via Map order); follow-scroll del caption activo en `CaptionList` (`rowRefs` + `scrollIntoView({block:"nearest"})` — no pelea con el scroll manual).
- **Traps nuevos**: `modeloSeleccionado` es `string` (no nullable) — limpiar selección con `""`; el click de React corre DESPUÉS del mouseup nativo — cualquier pausa/restauración de reproducción debe vivir en mousedown/mouseup, nunca en el handler `click`.

## Session log (2026-08-14) — "perfeccionar" pass (backend)
- **Concurrencia**: `TRANSCRIBIENDO` tokio `Semaphore::const_new(1)` — `transcribir_video` usa `try_acquire()` y rechaza la 2ª transcripción (cada una carga ~3GB de modelo en RAM). NO usar `Mutex::try_lock()` de std: el guard no es `Send` y el comando async cruza awaits (descargar VAD + `rx.await`) — el future no compilaría. `ANALIZANDO` es `LazyLock<Mutex<HashSet<(ruta, idx)>>>` (no `HashSet::new()` directo: no es const fn) — deduplica `analizar_volumen` y se limpia con un guard RAII (`AnalisisGuard`) que dropea aunque el cuerpo falle.
- **Descargas**: `.part` único por PID (`part-{pid}`) para modelos y VAD — dos descargas concurrentes ya no se pisan; VAD valida `resp.status()`; `descargar_modelo` verifica `descargado == total` antes de marcar completo y emite `"completo"` SOLO tras el rename exitoso (el `rename` de Windows reemplaza con MOVEFILE_REPLACE_EXISTING — no hay ventana de pérdida).
- **Escrituras atómicas**: helper `escribir_atomico` (.tmp + rename) en `guardar_proyecto`, `guardar_glosario_global`, `escribir_archivo_texto`, `escribir_archivo_en_carpeta`, `guardar_cache_volumen`; `cargar_cache_volumen` valida `len % 4 == 0` y no vacío, descarta el cache corrupto para re-analizar; `extraer_audio_stream` escribe `.part` y renombra (limpia `.part` en ambos fallos copy/AAC).
- **Memoria**: decode ffmpeg incremental — `leer_stdout_f32` (Stdio::piped + lectura por chunks con resto de 0-3 bytes + `-loglevel error`); el PCM ya no se bufferiza dos veces (pico ≈ mitad, ~460MB menos en un video de 2h). `bytes_a_f32` eliminado.
- **Perf**: `indice_turns` precomputa `(start, end, speaker)` una sola vez y `find_speaker_for_time` usa `partition_point` (binary search) — antes era O(tokens×turns) con una alloc de String por token.
- **Progreso**: `set_progress_callback_safe(FnMut(i32))` en la rama SIN VAD (heartbeat real 0-100). NO usar en la rama VAD: `params.clone()` por segmento rompería (el callback boxed no es Clone).
- **Varios**: `max_speakers.clamp(1, 20)`; la clave de cache mezcla los primeros 4KB del archivo (antes size+mtime colisionaba entre videos distintos); quitadas deps no usadas (libc, thiserror, ndarray, hound, once_cell, regex); `postprocess::merge_continuations` copia `punc` al fusionar continuaciones BPE (antes perdía "!" de "international!").

## Session log (2026-08-13)
- **Bugfixes**: `parseTimeInput` ("1.5" no longer = 15 min, time.ts), `formatSrtTimestamp` ms rollover (srt.ts), `drawCanvasFrame` captions/playhead drawn unconditionally (not nested in waveform `if`), undo for speaker edits via SpeakersPanel `onCommit`, `guardarProyectoEnRuta` sets ruta only on success, HiDPI hit-testing uses `canvas.clientHeight`, `asignarHablante` pushes history only after idx validation, new/open-project reset tracks/audio/selection, keydown guard includes `SELECT`, caption edge drag `>= 0`, `extraer_audio_stream` AAC 192k fallback when `-c:a copy` fails.
- **Optimizations**: menu/drag/keyboard listeners deps `[]`, `saltarCaption` binary search over `sortedByStartRef`, memoized `useCallback` props for `CaptionList`/`SpeakersPanel`/`WhisperPanel`, `currentCaptionIdx` via `useMemo`, waveform prerender skips while `analizando`, single `WhisperContext` reused across VAD segments, `amix normalize=0`.
- **User additions**: language selector (`es`/`en`/`auto`/`pt`/`fr`/`it`/`de`/`ja`/`zh`) + sampling mode (`beam5`/`greedy`) wired as dual ref+state (`idiomaWhisper`/`modoMuestreoWhisper`); decode tuning `set_language(None)` for auto; VAD model download is now async (`reqwest::get`, no `blocking` feature in Cargo.toml) with `.part`+rename; `CaptionList` virtualization improved (optional `rowRefs`, 600px height fallback, inline placeholder, ResizeObserver + `measure` callback).

## IPC Surface (commands)
`guardar_proyecto`, `cargar_proyecto`, `existe_archivo`, `leer_archivo_texto`, `escribir_archivo_texto`, `escribir_archivo_en_carpeta`, `analizar_volumen` (emits `volumen_chunk`), `existe_cache_volumen`, `cargar_cache_volumen`, `listar_modelos`, `descargar_modelo` (emits `modelo_descarga_progreso`), `eliminar_modelo`, `transcribir_video` (emits `transcripcion_progreso`; args: rutaVideo, modeloId, trackIndices, maxSpeakers, glosario, idioma, modoMuestreo), `listar_tracks_audio`, `extraer_audio_stream`, `cargar_glosario_global`, `guardar_glosario_global`, `verificar_ffmpeg`
