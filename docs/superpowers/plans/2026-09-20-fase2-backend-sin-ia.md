# Fase 2 backend sin IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quitar del backend Rust toda la transcripción/diarización IA, dejando IO de proyecto/SRT/volumen y ffmpeg.

**Architecture:** Solo `src-tauri/` (+ `AGENTS.md` docs). El frontend Fase 1 ya no llama estos comandos; se eliminan funciones, comandos registrados, deps y el script empaquetado.

**Tech Stack:** Rust (Tauri v2), cargo check como gate.

**Spec:** `docs/superpowers/specs/2026-09-19-companion-autosubs-design.md` (sección Fase 2).

## Global Constraints

- No tocar `src/` salvo que el build lo exija (y justificándolo).
- Cada tarea termina con `cargo check` pasando y commit propio.
- Glosario (global y proyecto) se va entero: sin UI que lo edite desde Fase 1, es código muerto (concern Task 1 resuelto aquí).

---

### Task 1: Quitar transcribir_video y diarización

**Files:**
- Modify: `src-tauri/src/lib.rs` (eliminar `transcribir_video`, hilo dedicado, semáforo `TRANSCRIBIENDO`, `diarizar_get_turns`, `diarizar_pyannote`, `verificar_pyannote`, `escribir_wav_mono_16k`, `python_con_pyannote`, struct `PyannoteInfo`, descarga modelo VAD `descargar_modelo_vad` + `run_vad_sync` si solo se usan ahí — verificar con grep; quitar del `invoke_handler`: `transcribir_video`, `verificar_pyannote`)
- Delete: `src-tauri/resources/diarizar_pyannote.py`
- Test: `cargo check --manifest-path src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: nada (código a borrar).
- Produces: lib.rs sin IA; `analizar_volumen`, `extraer_audio_stream`, proyecto/SRT IO intactos.

- [ ] **Step 1: Localizar con grep todo lo exclusivo de transcribir/diarizar**

```bash
grep -n "TRANSCRIBIENDO\|diarizar_\|verificar_pyannote\|PyannoteInfo\|escribir_wav_mono_16k\|python_con_pyannote\|descargar_modelo_vad\|run_vad_sync\|SegmentoTranscrito\|SpeakerTurn\|polyvoice::\|whisper_rs::" src-tauri/src/lib.rs
```

Si `run_vad_sync`/`descargar_modelo_vad` se usan fuera de transcribir, se quedan (anotarlo).

- [ ] **Step 2: Eliminar funciones + registro + script**

Borrar las funciones del paso 1 (confirmadas exclusivas), sus entradas en `invoke_handler`, y `git rm src-tauri/resources/diarizar_pyannote.py`.

- [ ] **Step 3: Verificar**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS sin warnings nuevos (los preexistentes se dejan).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/resources
git commit -m "fase2: quita transcribir_video y diarizacion"
```

### Task 2: Quitar modelos, glosario muerto y dependencias

**Files:**
- Modify: `src-tauri/src/lib.rs` (eliminar `listar_modelos`, `descargar_modelo`, `eliminar_modelo`, `MODELOS_DISPONIBLES`, `carpeta_modelos`, `ruta_modelo_por_id`, `cargar_glosario_global`, `guardar_glosario_global`, `ruta_glosario_global` + registros; verificar con grep que `glosario` no se lea en otro comando)
- Modify: `src-tauri/Cargo.toml` (quitar deps `whisper-rs` y `polyvoice` + features asociadas si quedan sin uso)
- Modify: `src/App.tsx` (quitar `glosarioGlobal` state/ref + load/save effects + `cargar_glosario_global` invoke — es la única lectura/escritura restante)
- Test: `cargo check`, `npm run build`, `npm test` (53 passed)

**Interfaces:**
- Consumes: Task 1 (lib.rs ya sin transcribir).
- Produces: backend sin IA ni glosario; frontend sin estado huérfano.

- [ ] **Step 1: Eliminar comandos de modelos y glosario del backend**

Grep de confirmación para `glosario` en lib.rs antes de borrar. Borrar funciones + registros invoke_handler.

- [ ] **Step 2: Quitar dependencias del Cargo.toml**

```toml
# borrar líneas whisper-rs y polyvoice (+ unusual features si `cargo check` las deja huérfanas con warning)
```

- [ ] **Step 3: Quitar glosarioGlobal del frontend**

Borrar state/ref, mount load effect y debounce-save effect en `src/App.tsx`. (Excepción explícita a "no tocar src/": es código muerto de Fase 1.)

- [ ] **Step 4: Verificar**

Run: `cargo check --manifest-path src-tauri/Cargo.toml` → PASS.
Run: `npm run build` → PASS. Run: `npm test` → 53 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src/App.tsx
git commit -m "fase2: quita modelos, glosario y deps IA"
```

### Task 3: Docs + cierre

**Files:**
- Modify: `AGENTS.md` (sección IPC Surface: quitar comandos eliminados; patrones Whisper/polyforce → nota histórica de una línea; comandos de build intactos)
- Test: `npm run build` + release smoke solo si hubo cambios de código (no los hay en esta tarea; no rebuildear)

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: docs coherentes con el companion.

- [ ] **Step 1: Actualizar AGENTS.md**

Quitar de IPC Surface: `transcribir_video`, `listar_modelos`, `descargar_modelo`, `eliminar_modelo`, `verificar_pyannote`, `cargar/guardar_glosario_global`. Añadir nota histórica de una línea sobre la era IA (whisper/polyvoice/pyannote) apuntando al spec. No borrar session logs.

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "fase2: docs companion sin IA"
```
