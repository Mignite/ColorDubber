# ColorDubber companion de auto-subs — diseño

Fecha: 2026-09-19. Estado: aprobado por Eche (enfoque A por fases).

## Contexto

Benchmark propio (diarization-benchmark/, referencia humana limpia de 80
captions, español Valorant 5 hablantes):

- diarizen 59% (lento, CPU 364 s, pesos CC BY-NC → no embarcable comercial).
- pyannote community-1 49% / 145 s CPU (integrable como Python externo).
- auto-subs (canary/cohere/whisper-turbo) 45% diarización; texto en empate
  técnico con Whisper (sin motivo para cambiar de ASR).
- polyvoice 31% (actual, rápido, nativo).

Decisión: no competir en transcripción. ColorDubber pasa a ser companion
puro de auto-subs: importa su SRT+TXT y aporta edición/coloreado por
hablante. Se corta TODA la IA propia (incluido el pyannote externo recién
integrado).

## Fase 1 — UI companion (backend intacto)

- Retirar `WhisperPanel` completo: modelos, descargar/eliminar, tracks para
  transcribir, glosario, idioma, muestreo, diarizador, botón Transcribir.
- Retirar estado asociado en `App.tsx`: `modeloSeleccionado`,
  `idioma/modoMuestreo/diarizadorWhisper`, `transcribiendo`,
  `transcripcionProgreso`, `errorTranscripcion`, check `verificar_pyannote`.
- Se queda: abrir video, waveform, timeline por hablante, editor (E),
  SpeakersPanel, CaptionList, import SRT / auto-subs / proyecto, exports,
  undo, statusBar.
- El import auto-subs (`handleImportarAutosubs`, ya construido) queda como
  vía principal de entrada; evaluar moverlo de lugar si el hueco del panel
  lo pide (decisión en implementación, sin cambiar su lógica).
- Verificación: `npm run build` + `npm test` + dev a ojo.

## Fase 2 — backend sin IA

- Eliminar: `transcribir_video` (hilo dedicado + semáforo `TRANSCRIBIENDO`),
  `diarizar_get_turns`, `diarizar_pyannote`, `verificar_pyannote`,
  `listar_modelos`, `descargar_modelo`, `eliminar_modelo`, descarga del
  modelo VAD, `src-tauri/resources/diarizar_pyannote.py`, dependencias
  `whisper-rs` y `polyvoice` de `Cargo.toml`.
- Se queda: `analizar_volumen` (symphonia), `extraer_audio_stream` + 
  `verificar_ffmpeg` (ffmpeg sigue requisito externo), IO de
  proyecto/SRT/glosario, cache de volumen, menú (menos items de IA).
- Docs: actualizar `AGENTS.md` (IPC Surface, comandos, patrones) marcando
  lo retirado como histórico; no borrar session logs.
- Verificación: `cargo check` + `npm run build/test` + release build de
  prueba (admin) para confirmar instalador adelgazado y sin Vulkan/CMake.

## Fuera de alcance

- Cambios al editor, timeline, exports, undo o formato Proyecto.
- Mejoras a la diarización propia (no hay más IA propia).
- Aportes upstream a auto-subs (proyecto separado futuro).

## Riesgos

- Usuarios actuales que transcribían dentro de la app pierden el flujo
  completo: mitigado con el import auto-subs como camino principal
  documentado (README).
- performance sin cambios: lo que se quita no lo usaba el editor.
