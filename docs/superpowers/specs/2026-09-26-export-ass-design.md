# Export/import .ass con presets de estilo

**Fecha:** 2026-09-26
**Estado:** aprobado en chat, pendiente de review de este doc

## Objetivo

Exportar los subtítulos como Advanced SubStation Alpha (`.ass`) para consumirlos en
Kdenlive (u otro lector libass) conservando el color por hablante, con un estilo
configurable por el usuario y persistido como preset global. Y poder reimportar el
`.ass` para no perder el trabajo si el resultado no convence.

## Decisiones tomadas

| Decisión | Motivo |
|---|---|
| Builder y parser en TS puro (`src/utils/ass.ts`) | 0 deps nuevas, 0 comandos Rust, todo testeable con vitest |
| Presets = base; el color de cada hablante sale de `Hablante.color` (PALETA) | Agregar un hablante no obliga a tocar el preset |
| `Style:` con nombre numerado `H1..Hn`; nombre cosmético en la columna `Name` de `Dialogue:` | Elimina de raíz el bug de nombres duplicados; el nombre legible sigue visible en Aegisub/Kdenlive |
| Solapes de tiempo → apilado vertical por `MarginV` | Puro layout, no toca el texto; timeline limpio produce un `.ass` idéntico |
| Presets editables solo dentro del modal de export | Un solo componente nuevo, un solo lugar |
| Sin `\pos` | Para apilar basta `MarginV`; `\pos` es para rótulos fijos (feature aparte) |
| El import crea un preset a partir de los `Style:` del archivo | El parse ya existe, ~10 líneas, y es la vía para traer estilos de Premiere sin tipearlos (vetoable) |
| Sin clamp de carriles, sin topes de stack | El apilado no se recorta; el preview del modal es el guard. Ver "No objetivos" |

## No objetivos

- `\pos` / rótulos tipo lower-third.
- ScriptType `v4.00` (`.ssa` legacy, `Format:` de style con menos campos): no se parsea.
  Si el `Script Info` no dice `v4.00+`, el import avisa y no hace nada.
- Presets desde archivos de Premiere (`.prfpset`): se tunean a mano en la UI.
- Fusionar dos captions simultáneos en un solo evento de dos líneas.
- Presets exportables/importables como archivo aparte (el JSON se puede copiar a mano).

## Modelo de datos

`src/types.ts`:

```ts
export interface PresetAss {
  id: string;
  nombre: string;          // "Default" — etiqueta del preset, no un hablante
  fontname: string;
  fontsize: number;
  color: string;           // "#RRGGBB" — solo lo usa el Style: "Default"
  outlineColor: string;
  outline: number;         // ancho del borde, px
  shadow: number;          // drop shadow offset, px
  alignment: number;       // 1-9, numeración de ASS
  marginL: number;
  marginR: number;
  marginV: number;
}
```

El preset **no** guarda el color por hablante: `buildAss` escribe el `PrimaryColour`
de cada `Style:` desde `Hablante.color`, y `PresetAss.color` solo se usa para el
`Style: Default` (captions sin hablante asignado).

`Proyecto` **no** cambia. Los presets son globales, no por proyecto.

## Presets: persistencia

Archivo: `appConfigDir()/presets_ass.json`, forma `{ "presets": PresetAss[] }`.

Se lee y escribe con los comandos que ya existen — `leer_archivo_texto` y
`escribir_archivo_texto` (App.tsx ya los usa para el proyecto). **No se agrega ningún
comando Rust.** La ruta se resuelve en el frontend con `appConfigDir()` de
`@tauri-apps/api` (dependencia ya instalada).

Si el archivo no existe, se crea en memoria con el preset semilla:

```ts
DEFAULT_PRESET_ASS = {
  nombre: "Default", fontname: "Inter", fontsize: 48,
  color: "#FFFFFF", outlineColor: "#000000",
  outline: 2, shadow: 1, alignment: 2,
  marginL: 10, marginR: 10, marginV: 40,
}
```

Se persiste la primera vez que el usuario guarda (no al abrir el modal: abrir el
modal no debe escribir disco).

## Formato de salida (`buildAss`)

`src/utils/ass.ts`. Funciones puras, sin estado, sin deps.

```
buildAss(captions, hablantes, preset, resX, resY) → string
```

Ordena `captions` por `inicio` internamente (el caller no tiene que acordarse).
Filtrado de captions: se exportan **todas**, incluidas las sin hablante.

### Helpers

- `hexToAssColor("#E85D4E")` → `"&H004E5DE8"`
  ASS usa `&HAABBGGRR`: **BGR invertido**, y `00` de alpha = opaco. Es el gotcha
  principal del formato.
- `assColorToHex("&H004E5DE8")` → `"#E85D4E"` (inverso, para el import).
- `formatAssTime(sec)` → `"0:00:01.50"`
  **Centisegundos** (2 decimales), no milisegundos como SRT. Rollover de `59.999` →
  `1:00.00` manejado explícitamente (misma clase de bug que
  `formatSrtTimestamp`, AGENTS.md 13-ago).
- `escapeAssText(s)` → `\n` se vuelve `\N`; `{` y `}` literales se escapan
  (`\{`, `\}`) porque ASS los lee como bloque de override.
- `unescapeAssText(s)` → inverso, para el import. Quita los bloques `{...}`
  completos (no preservamos `\pos` ni overrides: no son parte del modelo).
- `sanitizeStyleName(s)` → quita comas y recorta. Los nombres de estilo son `Hn`
  y no necesitan sanitize, pero el nombre cosmético de la columna `Name` puede
  traer comas sin problema (el texto de `Dialogue:` es el último campo).
- `parseAssTime(str)` → segundos. Para el import.

### Estructura del archivo

```
[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: H1,Inter,48,&H004E5DE8,&H004E5DE8,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,40,1
Style: Default,Inter,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,H1,Juan,0,0,40,,Texto del diálogo
Dialogue: 0,0:00:02.50,0:00:05.00,H2,María,0,0,104,,Otro texto
```

- `SecondaryColour` = copia de `PrimaryColour` (ASS solo lo usa con
  `{\k}` karaoke y con `\c` + secondary color; no se usa acá).
- `BackColour` = `&H00000000` (opaco negro). `BorderStyle: 1` (outline+shadow).
- `Bold`/`Italic` = 0 fijos. No se exponen en el preset: no se pidieron.
- `Name` = `h.nombre || h.tecla || h.id` (mismo fallback que el export SRT,
  App.tsx:664) — el nombre cosmético.
- `Style:` = `H${indiceEnHablantes + 1}`. Los captions sin hablante usan
  `Style: Default`.
- `PlayResX/Y` = `videoRef.current?.videoWidth/Height`, con fallback `1920x1080`
  si no hay video cargado. Se leen en el handler de export, sin estado nuevo.

## Apilado de solapes

`asignarCarriles(captions) → Map<captionId, carril>`

Greedy de interval graph, ~15 líneas: se ordenan por `inicio` y cada caption entra al
carril más bajo cuyo último `fin` ya terminó, es decir `finUltimoDelCarril <= inicio`
(tocar no cuenta como solapar: un caption que arranca justo cuando termina el anterior
comparte carril).

### Offset de carril: dos pasadas, no una

El `MarginV` de un caption depende del **alto de los carriles que tiene debajo**, no
de sus propias líneas. Si el caption del carril 0 tiene 3 renglones y el del carril 1
tiene 1, el del carril 1 tiene que subir 3 renglones; si no, se le monta encima.

```
// pasada 1: asignarCarriles → Map<id, carril>
// pasada 2: altoPorCarril[c] = max(lineas(caption) de los captions del carril c) * fontsize * 1.35
//           offsetAcumulado[c] = sum(altoPorCarril[0..c-1])   →  offsetAcumulado[0] = 0
// marginV del caption = preset.marginV + offsetAcumulado[carril]
```

`lineas(texto, preset, resX)`:

```
partes = texto.split("\n")
lineas = partes.length - 1
resto = partes[partes.length - 1]
charsPorLinea = (resX - preset.marginL - preset.marginR) / (preset.fontsize * ASS_FACTOR_ANCHO)
lineas += max(1, ceil(len(resto) / charsPorLinea))
```

- Los `\n` explícitos cuentan como renglones completos (si no, un caption con newline
  subestima su altura y el de arriba se le monta).
- `ASS_FACTOR_ANCHO = 0.5` (ancho medio de glifo como fracción del tamaño de fuente) se
  deja **conservador a propósito**: subestimar renglones hace que el caption de arriba
  se monte encima del de abajo, que es el lado peligroso. Sobreestimar solo deja un hueco.
- El conteo de líneas **solo calcula la altura del carril, no el layout del texto**.
  Con `WrapStyle: 0` sigue mandando libass: si el heuristic se equivoca, el texto se
  envuelve igual y queda un hueco de más o una línea apretada. Nunca rompe.
- Timeline sin solapes → todos en carril 0 → `offsetAcumulado[0] = 0` → `.ass`
  byte-idéntico al de la versión sin apilado. Cero regresión visual.
- `# ponytail: alto de carril heurístico, sin clamp contra resY. Si una pila de 4+ hablantes se sale de pantalla, upgrade path = reducir ASS_FACTOR_ALTO_LINEA dinámicamente hasta que la pila quepa en resY.`

El `Layer` de todos los eventos es 0. No se usa: apilar por `MarginV` no genera
z-order.

## Formato de entrada (`parseAss`)

`src/utils/ass.ts`, siguiendo el patrón de `parseSrt`.

```
parseAss(texto) → { captions: Caption[]; hablantes: Hablante[] }
```

1. Lee `Script Info`; si `ScriptType` no es `v4.00+`, devuelve error
   ("solo .ass v4.00+, no .ssa"). No parsea el `Format:` de `v4.00`.
2. `[V4+ Styles]`: cada `Style:` → mapa `nombre → { fontname, fontsize, primaryColour, outlineColour, outline, shadow, alignment, marginL, marginR, marginV }`.
   El `Format:` del archivo se usa para mapear columnas por nombre, no por posición
   (ASS garantiza el orden, pero parsear por nombre hace el import tolerante a
   variantes). De ese registro solo `primaryColour` es necesario para reconstruir los
   hablantes; el resto existe únicamente para alimentar el preset del import (ver
   abajo) — si esa decisión se corta, el parser se reduce a `nombre → primaryColour`.
3. `[Events]`: cada `Dialogue:` → `inicio = parseAssTime(Start)`, `fin = parseAssTime(End)`,
   `texto = unescapeAssText(Text)`, `Style` = nombre de estilo, `Name` = nombre cosmético.
   Estilo `Default` → `hablante_id: null`.
4. Reconstruye hablantes **en el orden en que aparecen los `Style:`**, con
   `id = nombre del estilo` (`H1`, `H2`, …), `nombre = Name` de los eventos que lo
   usan (o el nombre del estilo si el estilo no se usa), `color = assColorToHex(PrimaryColour)`,
   `tecla = ""`.
5. `Caption.hablante_id` = el nombre del estilo. `Caption.id` con el mismo patrón que
   `parseSrt`: `cap-${n}-${random}`.

### Round-trip

Exportar y reimportar un `.ass` sin tocarlo devuelve el mismo proyecto: mismas
veces, mismo texto, mismo nombre y color por hablante. Es el test que prueba las dos
mitades del formato, y por eso el `Style:` numerado tiene que ser re-asociable.

Los `MarginV` de apilado **no** se reimportan (el apilado es una decisión de
renderizado, no del modelo). Reimportar un `.ass` con solapes devuelve todos los
captions en carril 0 para el siguiente export — que es el comportamiento correcto,
porque el siguiente export recalcula los carriles.

### Decisión (vetoable en la review del spec)

Importar un `.ass` **crea un preset** con los `Style:` del archivo: toma el `Style:`
`Default` como base (el que trae los colores); si el archivo no tiene `Default`, cae
a `DEFAULT_PRESET_ASS`. Cuesta ~10 líneas porque el parse de styles ya existe, y es
la vía para traer estilos de Premiere sin tipearlos. Se puede cortar sin afectar el
builder, el resto del import ni el modal; lo único que se cae es el registro de style
completo del punto 2, que se reduce a `nombre → primaryColour`.

## UI: `src/components/AssExportModal.tsx`

Un solo componente, hace de selector y de editor.

- **Lista de presets** (izquierda): nombre de cada preset. Abajo: `Duplicar`,
  `Guardar como nuevo`, `Borrar`.
- **Editor** (derecha): un input por campo del preset.
  - `color` y `outlineColor`: `<input type="color">`. El de `color` va etiquetado
    **"Color (solo captions sin hablante)"** — es el único uso que tiene, y sin el
   label parece que debería pintar a todos los hablantes.
  - `alignment`: `<select>` 1-9 con los nombres reales de ASS —
    `1 Abajo izq.`, `2 Abajo centro`, `3 Abajo der.`, `4 Medio izq.`, `5 Medio centro`,
    `6 Medio der.`, `7 Arriba izq.`, `8 Arriba centro`, `9 Arriba der.`. Default `2`.
  - `fontsize`, `outline`, `shadow`, `marginL/R/V`: `<input type="number">`.
  - `fontname`: `<input type="text">` con `list` de `datalist` con las fuentes que ya
    usa la app (`Inter`, `Space Grotesk`, `JetBrains Mono`) — sin validación, es texto
    libre que viaja al `.ass`.
- **Preview** (abajo, ancho completo): mini-frame con fondo oscuro y **2-3 captions
  apilados** (uno por hablante, con su color), renderizados con CSS equivalente —
  `font-family`, `color`, `-webkit-text-stroke` para el outline, `text-shadow` para el
  drop shadow, `text-align` según alignment, `padding` según margins. Alimentado por
  el mismo `asignarCarriles` sobre captions sintéticos, para que el usuario vea el
  apilado real y no solo el estilo. **No** es un renderizador de ASS: es una
  aproximación fiel a estos efectos, y por eso también es el guard visual del
  desborde de la pila.

### Estado sucio

Los cambios de un preset viven en estado local del modal hasta que se guarda
(`Guardar` sobre el preset existente, o `Guardar como nuevo`). Al cerrar con cambios
sin guardar, se pide confirmación con un botón `Descartar` explícito — nunca se
descarta en silencio (misma clase de bug que el `saveState` del statusBar, AGENTS.md
15-ago).

## Flujo de export

1. Menú `Exportar` → nuevo item **"Exportar .ass..."** con id `exportar_ass`.
2. `on_menu_event` emite el evento (el mecanismo que ya usan los demás items) →
   `handleExportarAss()` en App.tsx setea `assModalAbierto = true`.
3. Al pulsar **Exportar** en el modal: `save()` de `@tauri-apps/plugin-dialog` con
   `filters: [{ name: "Advanced SubStation Alpha (.ass)", extensions: ["ass"] }]`,
   `defaultPath: "subtitulos.ass"`.
4. `invoke("escribir_archivo_texto", { ruta, contenido: buildAss(...) })`.
5. Mensaje en `exportMensaje` con el conteo de captions exportados.

Guardas: 0 captions → `app.export.noCaptions` (ya existe). Cancelar el `save()` → no
pasa nada. El `buildAss` se calcula **después** del `save()` para no hacer trabajo si
el usuario cancela.

## Flujo de import

1. Menú `Archivo` → nuevo item **"Cargar .ass"** con id `cargar_ass`.
2. `open()` de plugin-dialog con `filters: [{ name: "Advanced SubStation Alpha (.ass)", extensions: ["ass"] }]`.
3. `invoke("leer_archivo_texto", { ruta })` → `parseAss(contenido)`.
4. Reemplaza `captions` y `hablantes` (como `cargar_srt` / `importar_autosubs`),
   limpia la selección, y **marca el proyecto dirty** (`isDirtyRef` + `setHayCambios`),
   igual que el resto de rutas de escritura.
5. Mensaje con el conteo. Si `parseAss` falla, mensaje de error y **no** se toca el
   proyecto.

`.ssa` y `.ass` de otros lectores: el filtro es solo `.ass`; un `.ssa` pedido a mano
pasa por el check de `ScriptType` y avisa.

## i18n

~20 keys nuevas en `src/i18n/es.json` y `en.json`, bajo `assExport.*`: nombres de
campo, labels de botones, mensajes de éxito/error, confirmaciones de descarte.

## Testing

`src/utils/__tests__/ass.test.ts` (vitest, ya configurado; hoy hay 53 tests):

1. `hexToAssColor` — `#FFFFFF`→`&H00FFFFFF`, `#E85D4E`→`&H004E5DE8` (BGR
   invertido), alpha, hex inválido.
2. `assColorToHex` — inverso de (1).
3. `formatAssTime` — centisegundos, rollover `59.999`→`1:00.00`, `0`→`0:00:00.00`,
   negativo → 0.
4. `escapeAssText` / `unescapeAssText` — `\n`↔`\N`, llaves, round-trip.
5. `buildAss` — cabeceras correctas, `Format:` de styles con 23 campos, un `Style:`
   por hablante + `Default`, orden de eventos, `Name` con el nombre cosmético,
   color por hablante desde PALETA, `PlayResX/Y` del video.
6. `buildAss` **sin solapes** → `MarginV` igual a `preset.marginV` en todos los
   eventos (el byte-idéntico).
7. `asignarCarriles` — dos captions solapados → carriles 0 y 1; tres simultáneos →
   0,1,2; sin solape → todos 0; captions del mismo hablante también se apilan;
   captions que solo se tocan (`fin == inicio`) comparten carril.
8. **Offset por altura máxima del carril** — el caso que rompe la fórmula ingenua: un
   caption de 3 renglones en el carril 0 y uno de 1 renglón en el carril 1 → el del
   carril 1 sube 3 renglones, no 1. Y un caption con `\n` explícito cuenta esos
   renglones en su altura.
9. `parseAss` — `Style:` por nombre de columna, `Dialogue:` a `Caption`,
   `Default`→`hablante_id: null`, `&HAABBGGRR`→`#RRGGBB`, `ScriptType` viejo → error.
10. **Round-trip** — `parseAss(buildAss(caps, hablantes, preset, 1920, 1080))`
    devuelve las mismas veces, textos, nombres y colores.
11. Import → preset (si se mantiene esa decisión): un `.ass` con `Style: Default` deja
    un preset cuyo `color` es el `PrimaryColour` de ese style.

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/utils/ass.ts` | **nuevo** — builder + parser + helpers |
| `src/utils/__tests__/ass.test.ts` | **nuevo** — 11 grupos de tests |
| `src/types.ts` | `+ PresetAss` |
| `src/utils/constants.ts` | `+ DEFAULT_PRESET_ASS`, `+ ASS_PRESETS_ARCHIVO = "presets_ass.json"`, `+ ASS_FACTOR_ANCHO = 0.5`, `+ ASS_FACTOR_ALTO_LINEA = 1.35` |
| `src/components/AssExportModal.tsx` | **nuevo** — lista + editor + preview |
| `src/components/AssPreview.tsx` | **nuevo** — el mini-frame con CSS equivalente |
| `src/App.css` | estilos del modal y del preview |
| `src/App.tsx` | `assModalAbierto` state, `handleExportarAss`, `handleCargarAss`, listener del menú |
| `src-tauri/src/lib.rs` | 2 items de menú (`exportar_ass`, `cargar_ass`). **Sin comandos nuevos** |
| `src/i18n/es.json`, `en.json` | ~20 keys `assExport.*` |

## Riesgos

- **El heuristic de alto de línea puede fallar** con fuentes muy anchas. Mitigado: solo
  afecta la separación entre carriles, y el preview del modal lo muestra antes de
  exportar. `\fscx`/`\fscy` en el preset lo arreglaría si molesta.
- **libass y Kdenlive pueden diferir** en el render de outline/shadow según la fuente
  instalada. El preview es CSS, no libass: es una aproximación, no una garantía. La
  verificación real es abrir el `.ass` en Kdenlive.
- **El `Shadow` de ASS es un offset fijo abajo-derecha**, sin ángulo. El drop shadow
  angulado de Premiere no se reproduce exacto. Es una limitación del formato, no del
  diseño.
