# Fase 1 UI companion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retirar de la UI todo lo que produce transcripción/diarización, dejando la app como editor companion con import SRT/auto-subs/proyecto.

**Architecture:** Solo frontend (App.tsx, WhisperPanel.tsx, i18n). El backend Rust queda intacto en esta fase; los args opcionales que alimentaba el panel se omiten del `invoke` (el backend los declara `Option`, `None` = default auto/beam5/polyvoice).

**Tech Stack:** React 19 + TypeScript, vitest, Tauri IPC (`invoke`).

**Spec:** `docs/superpowers/specs/2026-09-19-companion-autosubs-design.md` (sección Fase 1).

## Global Constraints

- No tocar `src-tauri/` en esta fase.
- Strings UI siempre vía `t()` i18n (es/en); no hardcodear español.
- `handleImportarAutosubs` y el flujo SRT/proyecto/export/undo no se tocan.
- Cada tarea termina compilando (`npm run build`) y con commit propio.

---

### Task 1: Desconectar WhisperPanel de App

**Files:**
- Modify: `src/App.tsx` (quitar JSX `<WhisperPanel …/>`, props, estados `modeloSeleccionado`, `idiomaWhisper`, `modoMuestreoWhisper`, `diarizadorWhisper`, `transcribiendo`, `transcripcionProgreso`, `errorTranscripcion`, `pyannoteDisponible` + refs + mount effect `verificar_pyannote`; quitar `idioma/modoMuestreo/diarizador` del `invoke("transcribir_video")`; quitar `handleTranscribir` y handlers de descarga de modelos si quedan sin uso)
- Test: `npm run build` (gate de tipos; sin tests UI en el repo)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: App sin referencias al panel (las tareas 2+ compilan sobre esto).

- [ ] **Step 1: Quitar el JSX y sus props**

```tsx
// BORRAR el bloque <WhisperPanel ... /> completo (props modelos,
// descargandoModelo, tracks, glosario, idioma, modoMuestreo, diarizador,
// onTranscribir, etc.). La columna derecha conserva CaptionList y el resto.
```

- [ ] **Step 2: Quitar estado, refs y sync asociados**

```tsx
// BORRAR: useState/useRef de modeloSeleccionado, idiomaWhisper,
// modoMuestreoWhisper, diarizadorWhisper, transcribiendo,
// transcripcionProgreso, errorTranscripcion, pyannoteDisponible;
// sus líneas en el bare useEffect de sync; el useEffect [] de
// verificar_pyannote; handleTranscribir, handleDescargarModelo,
// handleEliminarModelo (verificar que nada más los use con grep).
```

- [ ] **Step 3: Recortar el invoke de transcribir_video**

```tsx
// El invoke queda SIN idioma/modoMuestreo/diarizador (backend Option):
const segmentos = await invoke<SegmentoTranscrito[]>(
  "transcribir_video",
  {
    rutaVideo: ruta,
    modeloId: modelo,
    trackIndices: tracksSel,
    maxSpeakers: 10,
    glosario: glosarioCompleto,
  },
);
```

- [ ] **Step 4: Compilar**

Run: `npm run build`
Expected: PASS (tsc sin errores de símbolos sin usar; si tsc queja de algo aún referenciado, quitarlo aquí mismo).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "fase1: desconecta WhisperPanel de App"
```

### Task 2: Eliminar WhisperPanel + claves i18n huérfanas

**Files:**
- Delete: `src/components/WhisperPanel.tsx`
- Modify: `src/i18n/es.json`, `src/i18n/en.json` (quitar claves `whisper.*` que solo usaba el panel; verificar con grep que ninguna quede referenciada)
- Test: `npm test` (53 tests deben seguir verdes) + `npm run build`

**Interfaces:**
- Consumes: Task 1 (App ya no importa el panel).
- Produces: repo sin código muerto del panel.

- [ ] **Step 1: Borrar el componente**

```bash
git rm src/components/WhisperPanel.tsx
```

- [ ] **Step 2: Quitar claves i18n huérfanas**

```bash
grep -rn "whisper\." src --include="*.tsx" --include="*.ts" | grep -v "whisper-rs\|__tests__"
```

Borrar de `es.json`/`en.json` solo las claves `whisper.*` sin referencias (las de transcript/progress/error del panel). Si alguna la usa otro componente, se queda.

- [ ] **Step 3: Verificar**

Run: `npm test`
Expected: 53 passed (45 originales + 8 autosubs).

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/es.json src/i18n/en.json
git commit -m "fase1: elimina WhisperPanel y claves i18n huérfanas"
```

### Task 3: Revisión de optimización (reporte, sin aplicar)

**Files:**
- Review-only: `src/App.tsx` (regiones tocadas por Tasks 1-2), `src/utils/autosubs.ts`
- Test: ninguno (no se cambia código)

**Interfaces:**
- Consumes: diff de Tasks 1-2 (`git diff HEAD~2 --stat`).
- Produces: lista de hallazgos (qué cortar/simplificar, dónde, por qué) para aprobación del usuario antes de aplicar.

- [ ] **Step 1: Pasar review de over-engineering al diff**

Buscar exclusivamente: helpers duplicados con lo nuevo de autosubs, estado que quedó sin lectores tras el corte, imports sin uso que tsc no caza (tipos), constantes duplicadas (PALETA ya centralizada — verificar que nada la redefina).

- [ ] **Step 2: Reportar hallazgos en chat (una línea por hallazgo)**

Formato: `archivo:línea — qué cortar — qué lo reemplaza`. No aplicar nada sin "dale".

- [ ] **Step 3: Commit vacío de marca (no hay cambios; se salta)**

Esta tarea no commitea: el reporte vive en el chat. Si el usuario aprueba hallazgos, se convierten en mini-tareas con sus propios commits.

### Task 4: Humo en dev + cierre de fase

**Files:**
- Ninguno (verificación manual).
- Test: `npm test` final + app en dev.

- [ ] **Step 1: Tests finales**

Run: `npm test`
Expected: 53 passed.

- [ ] **Step 2: Abrir en dev y probar import**

Run: `npm run tauri` (dev, sin release build).
Expected: la ventana abre sin panel de modelos; Archivo → Importar auto-subs (SRT+TXT) carga `diarization-benchmark/asr_canary.srt` con 5 hablantes; abrir SRT y proyecto siguen iguales.

- [ ] **Step 3: Commit de cierre (solo si hubo ajustes)**

Si el humo no pidió cambios, no hay commit: la fase ya commiteó por tarea.
