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
| Solapes de tiempo → **un solo evento con `\N` y color por línea** | Kdenlive no maneja varios tracks de subs, y el apilado por `MarginV` dependía de que el renderizador lo respetara por evento |
| **Preset por hablante, elegido en el export y NO persistido** | El mapeo solo existe para exportar: no es una propiedad del hablante ni del proyecto |
| El preset es el estilo completo, color incluido | `Hablante.color` pasa a ser identidad en el editor; el color del video lo decide el preset |
| El import es **parcial** con eventos fusionados | Aceptado: un evento fusionado vuelve como un caption con el texto, sin los colores por linea (ver "Riesgos") |
| Presets editables solo dentro del modal de export | Un solo componente nuevo, un solo lugar |
| Sin `\pos` | Para apilar basta `MarginV`; `\pos` es para rótulos fijos (feature aparte) |
| El import crea un preset a partir de los `Style:` del archivo | El parse ya existe, ~10 líneas, y es la vía para traer estilos de Premiere sin tipearlos (vetoable) |
| Sin `\pos` | Para el rotulo del hablante; con `\N` y `\c` el fusionado no lo necesita |

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
- `sanitizeNombreDialogo(s)` → **quita comas** (las reemplaza por espacio). La columna
  `Name` es el campo 5 de 10, **no** el último: una coma ahí corre todos los campos
  siguientes al parsearlos. Solo el `Text`, que sí es el último, tolera comas. Los
  nombres de estilo (`H1..Hn`) no llevan sanitize porque no tienen.
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
Dialogue: 0,0:00:02.50,0:00:05.00,H2,María,0,0,105,,Otro texto
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

## Fusionado de solapes

```
segmentarPorSolape(caps) -> SegmentoAss[]   // { inicio, fin, captions }
```

Barrido (sweep-line), no agrupacion en cadena. Emite un evento por cada instante en
que cambia el set de hablantes activos, asi ninguna linea queda en pantalla despues de
que su hablante dejo de hablar.

Con A=[0,10], B=[5,15], C=[12,20] (A y C no se solapan) produce **6** segmentos:

```
[0,5]A   [5,10]A+B   [10,12]B   [12,15]B+C   [15,20]C
```

Una agrupacion en cadena habria dado un solo evento [0,20] con las tres lineas,
dejando el texto de A visible 10 s despues de que termino. Son 8 lineas de codigo
menos y un defecto visible en el video final que no se puede arreglar sin regenerar el
.ass.

### Overrides por linea

El `Style:` del evento es el del primer hablante. Cada linea lleva overrides
**solo de los campos que difieren** del preset base:

```
{\fnSpace Grotesk\fs52\c&HE85D4E&\bord2\shad1}Texto de Juan\N{\c&H4EA8E8&}Texto de Maria
```

Cuando todos los hablantes comparten preset —el caso de un solo hablante— no se emite
ningun override y la salida es identica a la de un evento normal. `\N` une las lineas;
`\c` color primario, `\3c` color de contorno, `\bord` y `\shad` borde y sombra.

**No existe mas apilado**: se borran `asignarCarriles`, `lineasDeCaption`,
`calcularMargenesV`, `ASS_FACTOR_ANCHO` y `ASS_FACTOR_ALTO_LINEA`. El `MarginV`
vuelve a ser el valor fijo del preset.


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

Los `MarginV` **no** se reimportan (el preset los define). Un evento fusionado vuelve como
un caption unico con las lineas unidas por `\n` y **sin los overrides de color**: `unescapeAssText`
descarta los bloques `{...}`. No es info corrupta, es info que no esta.
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
- **Sin preview.** Se valida en Kdenlive, que es donde se consume. Asi el modal es solo
  editor de presets + asignacion hablante -> preset.
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
4. Reemplaza `captions` y `hablantes` siguiendo exactamente el patrón de
   `cargarSrtDesdeRuta` (App.tsx:409): `ignoreNextChangeRef = true`,
   `isDirtyRef = false`, `setHayCambios(false)`, `setSelectedCaptionIds([])`. O sea
   la carga deja el proyecto **limpio**, no dirty — misma semántica que cargar un SRT
   o importar auto-subs: el contenido recién cargado no se cuenta como "cambios sin
   guardar" hasta que el usuario edite algo.
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
6. `buildAss` **sin solapes** -> un `Dialogue:` por caption, `MarginV` del preset.
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
10. **Round-trip** - `parseAss(buildAss(caps, hablantes, presetDe, 1920, 1080))`
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
| `src/components/AssExportModal.tsx` | lista + editor de presets + filas hablante -> preset |
| ~~`src/components/AssPreview.tsx`~~ | **borrado**: el preview salio del modal |
| `src/App.css` | estilos del modal (el preview se borro con el) |
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
