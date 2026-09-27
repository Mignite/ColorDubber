# Export/import .ass con presets de estilo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exportar los subtítulos a `.ass` con color por hablante, estilo configurable por preset y apilado automático de captions que se solapan; y reimportar el `.ass`.

**Architecture:** Toda la lógica de formato vive en funciones puras de `src/utils/ass.ts` (builder + parser), verificadas con vitest antes de que exista UI. Los presets se guardan como JSON en `appConfigDir()` reusando los comandos `leer_archivo_texto` / `escribir_archivo_texto` que ya existen — cero comandos Rust nuevos. Un modal React edita presets y muestra un preview geométricamente fiel; App.tsx cablea los flujos de export e import.

**Tech Stack:** TypeScript, React 19, Tauri v2 (`@tauri-apps/api`, `@tauri-apps/plugin-dialog`), vitest. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-09-26-export-ass-design.md`

## Global Constraints

- Sin dependencias nuevas en `package.json`. `@tauri-apps/api` y `@tauri-apps/plugin-dialog` ya están instalados.
- Sin comandos Rust nuevos. Solo 2 items de menú nuevos (`exportar_ass`, `cargar_ass`).
- Nomenclatura en español para funciones, tipos y variables de dominio; `PascalCase` para tipos/interfaces, `camelCase` para funciones, `UPPER_SNAKE` para constantes (AGENTS.md patrón 5).
- Colores ASS siempre `&HAABBGGRR` (BGR invertido, `00` = opaco). Toda conversión pasa por `hexToAssColor` / `assColorToHex`.
- Tiempos ASS en **centisegundos** (`H:MM:SS.CC`), no milisegundos como SRT.
- `MarginL`/`MarginR` por evento = `0` (delega en el `Style:`); `MarginV` por evento = valor calculado de apilado.
- Presets en `appConfigDir()/presets_ass.json`, forma `{ "presets": PresetAss[] }`. Escritura atómica ya la hace `escribir_archivo_texto`.
- Abrir el modal NO escribe disco. Solo se persiste al guardar.
- Todo listener nuevo de `window` va en el `useEffect` de deps `[]` y lee refs, nunca state (AGENTS.md patrón 6).
- Verificación obligatoria antes de dar cualquier tarea por terminada: `npm test` y `npm run build` en verde.

---

### Task 1: Primitivas de formato (color, tiempo, escapes)

**Files:**
- Create: `src/utils/ass.ts`
- Create: `src/utils/__tests__/ass.test.ts`

**Interfaces:**
- Consumes: nada (tarea inicial).
- Produces:
  - `hexToAssColor(hex: string, alpha?: string): string`
  - `assColorToHex(color: string): string`
  - `formatAssTime(sec: number): string`
  - `parseAssTime(t: string): number`
  - `escapeAssText(s: string): string`
  - `unescapeAssText(s: string): string`
  - `sanitizeNombreDialogo(s: string): string`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/utils/__tests__/ass.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  hexToAssColor,
  assColorToHex,
  formatAssTime,
  parseAssTime,
  escapeAssText,
  unescapeAssText,
  sanitizeNombreDialogo,
} from "../ass";

describe("hexToAssColor", () => {
  it("convierte a BGR invertido con alpha opaco", () => {
    expect(hexToAssColor("#FFFFFF")).toBe("&H00FFFFFF");
    expect(hexToAssColor("#E85D4E")).toBe("&H004E5DE8");
  });

  it("respeta el alpha recibido", () => {
    expect(hexToAssColor("#000000", "80")).toBe("&H80000000");
  });

  it("cae a negro ante hex inválido", () => {
    expect(hexToAssColor("nope")).toBe("&H00000000");
    expect(hexToAssColor("#FFF")).toBe("&H00000000");
  });
});

describe("assColorToHex", () => {
  it("deshace la conversión de hexToAssColor", () => {
    expect(assColorToHex("&H004E5DE8")).toBe("#E85D4E");
    expect(assColorToHex("&H00FFFFFF")).toBe("#FFFFFF");
  });

  it("tolera colores sin alpha y con & final", () => {
    expect(assColorToHex("&H4E5DE8")).toBe("#E85D4E");
    expect(assColorToHex("&H4E5DE8&")).toBe("#E85D4E");
  });

  it("cae a blanco ante basura", () => {
    expect(assColorToHex("rojo")).toBe("#FFFFFF");
  });
});

describe("formatAssTime", () => {
  it("usa centisegundos y no rellena la hora", () => {
    expect(formatAssTime(1.5)).toBe("0:00:01.50");
    expect(formatAssTime(0)).toBe("0:00:00.00");
    expect(formatAssTime(3661.5)).toBe("1:01:01.50");
  });

  it(" hace rollover de centisegundos a segundos", () => {
    expect(formatAssTime(59.999)).toBe("0:01:00.00");
    expect(formatAssTime(1.999)).toBe("0:00:02.00");
  });

  it("acota negativos y no-finitos a cero", () => {
    expect(formatAssTime(-1)).toBe("0:00:00.00");
    expect(formatAssTime(NaN)).toBe("0:00:00.00");
  });
});

describe("parseAssTime", () => {
  it("parsea el formato de ASS", () => {
    expect(parseAssTime("0:00:01.50")).toBeCloseTo(1.5, 3);
    expect(parseAssTime("1:01:01.50")).toBeCloseTo(3661.5, 3);
  });

  it("tolera coma como separador", () => {
    expect(parseAssTime("0:00:05,25")).toBeCloseTo(5.25, 3);
  });

  it("devuelve 0 ante basura", () => {
    expect(parseAssTime("")).toBe(0);
    expect(parseAssTime("foo")).toBe(0);
  });
});

describe("escapeAssText / unescapeAssText", () => {
  it("convierte saltos de línea a \\N y vuelve", () => {
    expect(escapeAssText("línea 1\nlínea 2")).toBe("línea 1\\Nlínea 2");
    expect(unescapeAssText("línea 1\\Nlínea 2")).toBe("línea 1\nlínea 2");
  });

  it("escapa llaves para que no se lean como override", () => {
    expect(escapeAssText("{una} cosa")).toBe("\\{una\\} cosa");
    expect(unescapeAssText("\\{una\\} cosa")).toBe("{una} cosa");
  });

  it("quita bloques de override al desescapar", () => {
    expect(unescapeAssText("{\\pos(10,20)}texto")).toBe("texto");
  });

  it("mantiene texto normal intacto", () => {
    expect(unescapeAssText("texto normal")).toBe("texto normal");
  });

  it("sobrevive el round-trip", () => {
    const original = "antes\ndespués {con llaves} y \\ barra";
    expect(unescapeAssText(escapeAssText(original))).toBe(original);
  });
});

describe("sanitizeNombreDialogo", () => {
  it("quita comas: romperían el parseo de la línea Dialogue", () => {
    expect(sanitizeNombreDialogo("Smith, John")).toBe("Smith John");
  });

  it("deja nombres sin comas intactos", () => {
    expect(sanitizeNombreDialogo("Juan")).toBe("Juan");
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm test -- ass.test.ts`
Expected: FAIL — `Failed to resolve import "../ass"`.

- [ ] **Step 3: Implementar las primitivas**

Crear `src/utils/ass.ts`:

```ts
// Primitivas del formato Advanced SubStation Alpha (v4.00+).
// Puras y sin dependencias: el builder y el parser se apoyan acá.

const RE_HEX6 = /^[0-9a-fA-F]{6}$/;
// ASS escribe &HAABBGGRR. Acepta 8 dígitos (con alpha) o 6 (sin alpha),
// y descarta el & final que algunas herramientas agregan.
const RE_ASS_COLOR =
  /^&H(?:[0-9a-fA-F]{2})?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/;

/** "#E85D4E" -> "&H004E5DE8". alpha "00" = opaco (en ASS 00 es opaco, no transparente). */
export function hexToAssColor(hex: string, alpha = "00"): string {
  const limpio = hex.trim().replace(/^#/, "");
  if (!RE_HEX6.test(limpio)) return `&H${alpha}000000`;
  const r = limpio.slice(0, 2);
  const g = limpio.slice(2, 4);
  const b = limpio.slice(4, 6);
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

/** "&H004E5DE8" -> "#E85D4E". Inverso de hexToAssColor. */
export function assColorToHex(color: string): string {
  const m = color.trim().replace(/&$/, "").match(RE_ASS_COLOR);
  if (!m) return "#FFFFFF";
  const [, b, g, r] = m;
  return `#${r}${g}${b}`.toUpperCase();
}

/** Centisegundos, formato "H:MM:SS.CC". El rollover sale gratis al redondear el total. */
export function formatAssTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const totalCs = Math.round(sec * 100);
  const cs = totalCs % 100;
  const totalSeg = (totalCs - cs) / 100;
  const s = totalSeg % 60;
  const m = Math.floor(totalSeg / 60) % 60;
  const h = Math.floor(totalSeg / 3600);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/** "0:00:01.50" -> 1.5. Acepta coma como separador decimal. */
export function parseAssTime(t: string): number {
  const m = t.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,2})$/);
  if (!m) return 0;
  const [, h, min, s, cs] = m;
  return +h * 3600 + +min * 60 + +s + +cs / 100;
}

export function escapeAssText(s: string): string {
  return (
    s
      // El orden importa: las barras se escapan PRIMERO. Si el \n --> \N
      // fuera primero, la barra que introduce pasaría a ser \\ y el round-trip
      // devolvería una barra literal en vez del salto de línea.
      .replace(/\\/g, "\\\\")
      .replace(/\{/g, "\\{")
      .replace(/\}/g, "\\}")
      .replace(/\r\n|\r|\n/g, "\\N")
  );
}

export function unescapeAssText(s: string): string {
  return (
    s
      // Los overrides ({...}) no son parte del modelo: se descartan. El regex
      // exige que la { no esté precedida por barra, para no comerse las
      // llaves que escapamos al escribir.
      .replace(/(^|[^\\])\{[^}]*\}/g, "$1")
      .replace(/\\([{}\\])/g, "$1")
      .replace(/\\N|\\n/g, "\n")
  );
  // ponytail: una barra literal seguida de "N" es indistinguible de un salto
  // de línea en ASS y se resuelve como salto. Es una ambigüedad del formato,
  // no del código. Ningún escritor de ASS la puede evitar.
}

/** La columna Name de Dialogue: es el campo 5 de 10, no el último: una coma
 *  ahí corre todos los campos siguientes al parsearlos. La coma y los espacios
 *  que la siguen se funden en un solo espacio. */
export function sanitizeNombreDialogo(s: string): string {
  return s.replace(/,\s*/g, " ").trim();
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npm test -- ass.test.ts`
Expected: PASS — 20 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/ass.ts src/utils/__tests__/ass.test.ts
git commit -m "feat(ass): primitivas de color, tiempo y escapes"
```

---

### Task 2: Apilado de solapes + tipo PresetAss

**Files:**
- Modify: `src/types.ts` (agregar al final)
- Modify: `src/utils/constants.ts` (agregar al final)
- Modify: `src/utils/ass.ts` (agregar al final)
- Modify: `src/utils/__tests__/ass.test.ts` (agregar imports y describes)

**Interfaces:**
- Consumes: nada de Task 1.
- Produces:
  - `src/types.ts` → `interface PresetAss { id, nombre, fontname, fontsize, color, outlineColor, outline, shadow, alignment, marginL, marginR, marginV }` (todos string/number salvo `id`/`nombre`/`fontname`/`color`/`outlineColor` que son string)
  - `src/utils/constants.ts` → `DEFAULT_PRESET_ASS: PresetAss`, `ASS_PRESETS_ARCHIVO = "presets_ass.json"`, `ASS_FACTOR_ANCHO = 0.5`, `ASS_FACTOR_ALTO_LINEA = 1.35`
  - `src/utils/ass.ts` → `asignarCarriles(caps: Caption[]): Map<string, number>`, `lineasDeCaption(texto: string, preset: PresetAss, resX: number): number`, `calcularMargenesV(caps: Caption[], preset: PresetAss, resX: number): Map<string, number>`

- [ ] **Step 1: Agregar `PresetAss` a types.ts**

Append a `src/types.ts`:

```ts

export interface PresetAss {
  id: string;
  nombre: string;
  fontname: string;
  fontsize: number;
  color: string;
  outlineColor: string;
  outline: number;
  shadow: number;
  alignment: number;
  marginL: number;
  marginR: number;
  marginV: number;
}
```

- [ ] **Step 2: Agregar las constantes**

Append a `src/utils/constants.ts`:

```ts

// ==== Export .ass (Advanced SubStation Alpha) ====
export const ASS_PRESETS_ARCHIVO = "presets_ass.json";
// Ancho medio de glifo como fracción del tamaño de fuente. Conservador a
// propósito: subestimar renglones hace que el caption de arriba se monte
// encima del de abajo (el lado peligroso); sobreestimar solo deja un hueco.
export const ASS_FACTOR_ANCHO = 0.5;
export const ASS_FACTOR_ALTO_LINEA = 1.35;
export const DEFAULT_PRESET_ASS: PresetAss = {
  id: "preset-default",
  nombre: "Default",
  fontname: "Inter",
  fontsize: 48,
  color: "#FFFFFF",
  outlineColor: "#000000",
  outline: 2,
  shadow: 1,
  alignment: 2,
  marginL: 10,
  marginR: 10,
  marginV: 40,
};
```

Y agregar `import type { PresetAss } from "../types";` al inicio de `src/utils/constants.ts`.

- [ ] **Step 3: Escribir los tests que fallan**

En `src/utils/__tests__/ass.test.ts`, extender el import:

```ts
import {
  hexToAssColor,
  assColorToHex,
  formatAssTime,
  parseAssTime,
  escapeAssText,
  unescapeAssText,
  sanitizeNombreDialogo,
  asignarCarriles,
  calcularMargenesV,
} from "../ass";
import type { Caption, PresetAss } from "../../types";
import { DEFAULT_PRESET_ASS } from "../constants";
```

Y append:

```ts
function cap(id: string, inicio: number, fin: number, texto = "x"): Caption {
  return { id, inicio, fin, texto, hablante_id: null };
}

const PRESET: PresetAss = { ...DEFAULT_PRESET_ASS };

describe("asignarCarriles", () => {
  it("pone en carriles distintos lo que se solapa", () => {
    const carriles = asignarCarriles([cap("a", 0, 3), cap("b", 2, 5)]);
    expect(carriles.get("a")).toBe(0);
    expect(carriles.get("b")).toBe(1);
  });

  it("reutiliza el mismo carril cuando no hay solape", () => {
    const carriles = asignarCarriles([cap("a", 0, 3), cap("b", 3, 5)]);
    expect(carriles.get("a")).toBe(0);
    expect(carriles.get("b")).toBe(0);
  });

  it("mete en carriles distintos tres simultáneos", () => {
    const carriles = asignarCarriles([cap("a", 0, 5), cap("b", 1, 6), cap("c", 2, 7)]);
    expect([carriles.get("a"), carriles.get("b"), carriles.get("c")]).toEqual([0, 1, 2]);
  });

  it("ordena por inicio internamente, no confía en el llamador", () => {
    const carriles = asignarCarriles([cap("b", 2, 5), cap("a", 0, 3)]);
    expect(carriles.get("a")).toBe(0);
    expect(carriles.get("b")).toBe(1);
  });
});

describe("calcularMargenesV", () => {
  it("deja todo en marginV cuando no hay solapes", () => {
    const m = calcularMargenesV([cap("a", 0, 3), cap("b", 3, 5)], PRESET, 1920);
    expect(m.get("a")).toBe(PRESET.marginV);
    expect(m.get("b")).toBe(PRESET.marginV);
  });

  it("sube el segundo carril", () => {
    const m = calcularMargenesV([cap("a", 0, 3), cap("b", 2, 5)], PRESET, 1920);
    expect(m.get("b")!).toBeGreaterThan(m.get("a")!);
  });

  it("el offset del carril de arriba usa el alto MÁXIMO de los de abajo", () => {
    // a tiene 3 renglones ("\n" explícito), b solo 1: b debe subir 3, no 1.
    const largo = "uno\ndos\ntres";
    const corto = "x";
    const m = calcularMargenesV(
      [cap("a", 0, 3, largo), cap("b", 2, 5, corto)],
      PRESET,
      1920,
    );
    const unRenglon = PRESET.fontsize * ASS_FACTOR_ALTO_LINEA;
    expect(m.get("b")! - m.get("a")!).toBe(Math.round(unRenglon * 3));
  });
});
```

Y agregar el import de la constante al archivo de test: cambia `import { DEFAULT_PRESET_ASS } from "../constants";` por `import { DEFAULT_PRESET_ASS, ASS_FACTOR_ALTO_LINEA } from "../constants";`

- [ ] **Step 4: Correr el test para verificar que falla**

Run: `npm test -- ass.test.ts`
Expected: FAIL — `asignarCarriles` / `calcularMargenesV` no exportadas.

- [ ] **Step 5: Implementar el apilado**

Append a `src/utils/ass.ts`:

```ts
import type { Caption, PresetAss } from "../types";
import { ASS_FACTOR_ANCHO, ASS_FACTOR_ALTO_LINEA } from "./constants";

/** Greedy de interval graph: cada caption entra al primer carril libre.
 *  `fin <= inicio` — dos captions que solo se tocan comparten carril.
 *  Ordena por inicio acá adentro: el llamador no puede olvidarse. */
export function asignarCarriles(caps: Caption[]): Map<string, number> {
  const carriles = new Map<string, number>();
  const finPorCarril: number[] = [];
  for (const c of [...caps].sort((a, b) => a.inicio - b.inicio)) {
    let carril = finPorCarril.findIndex((fin) => fin <= c.inicio);
    if (carril === -1) {
      carril = finPorCarril.length;
      finPorCarril.push(c.fin);
    } else {
      finPorCarril[carril] = c.fin;
    }
    carriles.set(c.id, carril);
  }
  return carriles;
}

/** Renglones estimados. Los \n explícitos cuentan como renglones completos;
 *  el resto se estima por ancho de glifo contra el ancho útil del canvas. */
export function lineasDeCaption(
  texto: string,
  preset: PresetAss,
  resX: number,
): number {
  const partes = texto.split("\n");
  const explicitas = partes.length - 1;
  const resto = partes[partes.length - 1];
  const anchoUtil = Math.max(1, resX - preset.marginL - preset.marginR);
  const charsPorLinea = Math.max(1, anchoUtil / (preset.fontsize * ASS_FACTOR_ANCHO));
  return explicitas + Math.max(1, Math.ceil(resto.length / charsPorLinea));
}

/** MarginV por caption. El offset de un carril es la suma de las alturas
 *  MÁXIMAS de los carriles que tiene debajo, no su propia altura: si no, un
 *  caption de 1 renglón se le monta encima del de 3 que tiene abajo. */
export function calcularMargenesV(
  caps: Caption[],
  preset: PresetAss,
  resX: number,
): Map<string, number> {
  const carriles = asignarCarriles(caps);
  const altoPorCarril = new Map<number, number>();
  for (const c of caps) {
    const carril = carriles.get(c.id) ?? 0;
    const alto = lineasDeCaption(c.texto, preset, resX) * preset.fontsize * ASS_FACTOR_ALTO_LINEA;
    altoPorCarril.set(carril, Math.max(altoPorCarril.get(carril) ?? 0, alto));
  }
  const offset = new Map<number, number>();
  let acumulado = 0;
  for (const carril of [...altoPorCarril.keys()].sort((a, b) => a - b)) {
    offset.set(carril, acumulado);
    acumulado += altoPorCarril.get(carril) ?? 0;
  }
  const salida = new Map<string, number>();
  for (const c of caps) {
    const base = offset.get(carriles.get(c.id) ?? 0) ?? 0;
    salida.set(c.id, Math.round(preset.marginV + base));
  }
  return salida;
}
```

Mover los `import` de `types` y `constants` **al principio** del archivo (si quedaron al final tras el append, TypeScript los acepta igual, pero la convención del repo es arriba).

- [ ] **Step 6: Correr los tests para verificar que pasan**

Run: `npm test`
Expected: PASS — 20 + 8 = 28 tests en ass.test.ts, 53+28 en total.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/utils/constants.ts src/utils/ass.ts src/utils/__tests__/ass.test.ts
git commit -m "feat(ass): tipo PresetAss y apilado de solapes por MarginV"
```

---

### Task 3: `buildAss`

**Files:**
- Modify: `src/utils/ass.ts`
- Modify: `src/utils/__tests__/ass.test.ts`

**Interfaces:**
- Consumes: Task 1 (`hexToAssColor`, `formatAssTime`, `escapeAssText`, `sanitizeNombreDialogo`), Task 2 (`calcularMargenesV`), `Caption`, `Hablante`, `PresetAss`.
- Produces:
  - `ASS_STYLE_FORMAT: string` (23 columnas)
  - `ASS_EVENTS_FORMAT: string` (10 columnas)
  - `buildAss(caps: Caption[], hablantes: Hablante[], preset: PresetAss, resX: number, resY: number): string`

- [ ] **Step 1: Escribir los tests que fallan**

Append a `src/utils/__tests__/ass.test.ts`:

```ts
import { buildAss, ASS_STYLE_FORMAT, ASS_EVENTS_FORMAT } from "../ass";
import type { Hablante } from "../../types";

const HABLANTES: Hablante[] = [
  { id: "sp1", nombre: "Juan", tecla: "1", color: "#E85D4E" },
  { id: "sp2", nombre: "María", tecla: "2", color: "#4EA8E8" },
];

describe("buildAss", () => {
  it("escribe las cabeceras v4.00+ con el PlayRes pedido", () => {
    const out = buildAss([cap("a", 0, 3)], HABLANTES, PRESET, 1280, 720);
    expect(out).toContain("ScriptType: v4.00+");
    expect(out).toContain("PlayResX: 1280");
    expect(out).toContain("PlayResY: 720");
    expect(out).toContain("WrapStyle: 0");
    expect(out).toContain(`Format: ${ASS_STYLE_FORMAT}`);
    expect(out).toContain(`Format: ${ASS_EVENTS_FORMAT}`);
  });

  it("el Format de styles tiene 23 columnas y el de events 10", () => {
    expect(ASS_STYLE_FORMAT.split(",")).toHaveLength(23);
    expect(ASS_EVENTS_FORMAT.split(",")).toHaveLength(10);
  });

  it("numera los estilos por índice del array de hablantes y mete el color de cada uno", () => {
    const out = buildAss([cap("a", 0, 3)], HABLANTES, PRESET, 1920, 1080);
    const styles = out.split("\n").filter((l) => l.startsWith("Style:"));
    expect(styles[0]).toMatch(/^Style: H1,Inter,48,&H004E5DE8,/);
    expect(styles[1]).toMatch(/^Style: H2,Inter,48,&H00E8A84E,/);
  });

  it("emite un Style Default con el color del preset", () => {
    const out = buildAss([cap("a", 0, 3)], HABLANTES, PRESET, 1920, 1080);
    expect(out).toContain("Style: Default,Inter,48,&H00FFFFFF,");
  });

  it("usa el nombre cosmético en la columna Name y el estilo en la columna Style", () => {
    const out = buildAss(
      [{ ...cap("a", 0, 3), hablante_id: "sp2" }],
      HABLANTES,
      PRESET,
      1920,
      1080,
    );
    expect(out).toContain("Dialogue: 0,0:00:00.00,0:00:03.00,H2,María,0,0,40,,x");
  });

  it("los captions sin hablante van al estilo Default", () => {
    const out = buildAss([cap("a", 0, 3)], HABLANTES, PRESET, 1920, 1080);
    expect(out).toContain(",Default,,0,0,40,,x");
  });

  it("cae a tecla o id cuando el hablante no tiene nombre", () => {
    const sinNombre: Hablante[] = [
      { id: "spX", nombre: "", tecla: "7", color: "#FFFFFF" },
    ];
    const out = buildAss(
      [{ ...cap("a", 0, 3), hablante_id: "spX" }],
      sinNombre,
      PRESET,
      1920,
      1080,
    );
    expect(out).toContain(",H1,7,");
  });

  it("ordena los eventos por inicio aunque le lleguen desordenados", () => {
    const out = buildAss(
      [cap("b", 5, 6, "segundo"), cap("a", 1, 2, "primero")],
      HABLANTES,
      PRESET,
      1920,
      1080,
    );
    expect(out.indexOf("primero")).toBeLessThan(out.indexOf("segundo"));
  });

  it("escapa comas del nombre cosmético para no romper el parseo", () => {
    const conComa: Hablante[] = [
      { id: "sp1", nombre: "Smith, John", tecla: "1", color: "#FFFFFF" },
    ];
    const out = buildAss(
      [{ ...cap("a", 0, 3), hablante_id: "sp1" }],
      conComa,
      PRESET,
      1920,
      1080,
    );
    expect(out).toContain(",H1,Smith John,0,0,40,,x");
  });

  it("sin solapes deja todos los MarginV en el del preset", () => {
    const out = buildAss([cap("a", 0, 3), cap("b", 3, 6)], HABLANTES, PRESET, 1920, 1080);
    const margins = out
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:"))
      .map((l) => l.split(",")[7]);
    expect(margins).toEqual(["40", "40"]);
  });

  it("con solapes sube el MarginV del segundo", () => {
    const out = buildAss([cap("a", 0, 3), cap("b", 2, 5)], HABLANTES, PRESET, 1920, 1080);
    const margins = out
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:"))
      .map((l) => +l.split(",")[7]);
    expect(margins[1]).toBeGreaterThan(margins[0]);
  });

  it("un MarginV de estilo no pisa al del preset", () => {
    const outro: PresetAss = { ...PRESET, outline: 5, shadow: 3, marginV: 80 };
    const out = buildAss([cap("a", 0, 3)], HABLANTES, outro, 1920, 1080);
    expect(out).toContain(",1,5,3,2,10,10,80,1");
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm test -- ass.test.ts`
Expected: FAIL — `buildAss` no exportada.

- [ ] **Step 3: Implementar `buildAss`**

Append a `src/utils/ass.ts`:

```ts
import type { Caption, Hablante, PresetAss } from "../types";
import { ASS_FACTOR_ANCHO, ASS_FACTOR_ALTO_LINEA } from "./constants";

export const ASS_STYLE_FORMAT =
  "Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, " +
  "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, " +
  "Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding";

export const ASS_EVENTS_FORMAT =
  "Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";

function lineaStyle(nombre: string, colorPrimario: string, preset: PresetAss): string {
  const c = hexToAssColor(colorPrimario);
  const o = hexToAssColor(preset.outlineColor);
  return (
    `Style: ${nombre},${preset.fontname},${preset.fontsize},${c},${c},${o},` +
    `&H00000000,0,0,0,0,100,100,0,0,1,${preset.outline},${preset.shadow},` +
    `${preset.alignment},${preset.marginL},${preset.marginR},${preset.marginV},1`
  );
}

export function buildAss(
  caps: Caption[],
  hablantes: Hablante[],
  preset: PresetAss,
  resX: number,
  resY: number,
): string {
  const ordenados = [...caps].sort((a, b) => a.inicio - b.inicio);
  const margenes = calcularMargenesV(ordenados, preset, resX);

  // Nombre del estilo por id de hablante. El orden del array ES la numeración:
  // por eso un nombre duplicado no puede romper nada (H1, H2, ... siempre únicos)
  // y el nombre real, que sí puede repetirse, viaja en la columna Name.
  const indiceDe = new Map(hablantes.map((h, i) => [h.id, i + 1]));
  const styleDe = (id: string | null): string =>
    id !== null && indiceDe.has(id) ? `H${indiceDe.get(id)}` : "Default";
  const nombreDe = (id: string | null): string => {
    const h = hablantes.find((x) => x.id === id);
    if (!h) return "";
    return sanitizeNombreDialogo(h.nombre || h.tecla || h.id);
  };

  const styles = [
    ...hablantes.map((h, i) => lineaStyle(`H${i + 1}`, h.color, preset)),
    lineaStyle("Default", preset.color, preset),
  ];

  const eventos = ordenados.map(
    (c) =>
      `Dialogue: 0,${formatAssTime(c.inicio)},${formatAssTime(c.fin)},` +
      `${styleDe(c.hablante_id)},${nombreDe(c.hablante_id)},0,0,` +
      `${margenes.get(c.id) ?? preset.marginV},,${escapeAssText(c.texto)}`,
  );

  return (
    "[Script Info]\n" +
    "ScriptType: v4.00+\n" +
    `PlayResX: ${resX}\n` +
    `PlayResY: ${resY}\n` +
    "WrapStyle: 0\n" +
    "ScaledBorderAndShadow: yes\n" +
    "\n[V4+ Styles]\n" +
    `Format: ${ASS_STYLE_FORMAT}\n` +
    `${styles.join("\n")}\n` +
    "\n[Events]\n" +
    `Format: ${ASS_EVENTS_FORMAT}\n` +
    `${eventos.join("\n")}\n`
  );
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npm test`
Expected: PASS. Si falla el test de `,H1,7,` revisá que `nombreDe` use `nombre || tecla || id`.

- [ ] **Step 5: Commit**

```bash
git add src/utils/ass.ts src/utils/__tests__/ass.test.ts
git commit -m "feat(ass): buildAss con estilos por hablante y MarginV apilado"
```

---

### Task 4: `parseAss` + round-trip

**Files:**
- Modify: `src/utils/ass.ts`
- Modify: `src/utils/__tests__/ass.test.ts`

**Interfaces:**
- Consumes: Task 1 (`parseAssTime`, `unescapeAssText`, `assColorToHex`), Task 3 (`buildAss`).
- Produces:
  - `interface EstiloAss { nombre, fontname, fontsize, primaryColour, outlineColour, outline, shadow, alignment, marginL, marginR, marginV }`
  - `interface AssParseResult { captions: Caption[]; hablantes: Hablante[]; styles: EstiloAss[] }`
  - `parseAss(texto: string): AssParseResult` — **lanza** `Error` si `ScriptType` no es `v4.00+`.
  - `presetDesdeEstilos(styles: EstiloAss[], nombre: string, id: string): PresetAss | null` — arma el preset desde el `Style: Default`; `null` si no existe.

- [ ] **Step 1: Escribir los tests que fallan**

Append a `src/utils/__tests__/ass.test.ts`:

```ts
import { parseAss, presetDesdeEstilos } from "../ass";

const ASS_MUESTRA = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: ${ASS_STYLE_FORMAT}
Style: H1,Inter,48,&H004E5DE8,&H004E5DE8,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,40,1
Style: Default,Inter,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,2,2,10,10,40,1

[Events]
Format: ${ASS_EVENTS_FORMAT}
Dialogue: 0,0:00:01.00,0:00:03.50,H1,Juan,0,0,40,,Hola mundo
Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,40,,Sin hablante
Dialogue: 0,0:00:05.00,0:00:07.00,H1,Juan,0,0,104,,Con {llaves} y
salto
`;

describe("parseAss", () => {
  it("rechaza ScriptType v4.00 (legacy .ssa)", () => {
    expect(() => parseAss("[Script Info]\nScriptType: v4.00\n")).toThrow();
  });

  it("rechaza un archivo sin Script Info", () => {
    expect(() => parseAss("")).toThrow();
  });

  it("lee los captions con sus tiempos", () => {
    const r = parseAss(ASS_MUESTRA);
    expect(r.captions).toHaveLength(3);
    expect(r.captions[0].inicio).toBeCloseTo(1, 2);
    expect(r.captions[0].fin).toBeCloseTo(3.5, 2);
    expect(r.captions[0].texto).toBe("Hola mundo");
    expect(r.captions[2].texto).toBe("Con {llaves} y\nsalto");
  });

  it("crea un hablante por Style con el nombre de la columna Name", () => {
    const r = parseAss(ASS_MUESTRA);
    expect(r.hablantes).toHaveLength(1);
    expect(r.hablantes[0].id).toBe("H1");
    expect(r.hablantes[0].nombre).toBe("Juan");
    expect(r.hablantes[0].color).toBe("#E85D4E");
  });

  it("el estilo Default no se vuelve hablante: queda en null", () => {
    const r = parseAss(ASS_MUESTRA);
    expect(r.captions[1].hablante_id).toBeNull();
  });

  it("mapea las columnas por nombre del Format, no por posición", () => {
    // Format desordenado a propósito: si el parser fuera posicional, rompe.
    const raro = ASS_MUESTRA.replace(
      "Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Layer, Start, End, Name, Style, MarginL, MarginR, MarginV, Effect, Text",
    );
    const r = parseAss(raro);
    expect(r.captions[0].hablante_id).toBe("H1");
    expect(r.hablantes[0].nombre).toBe("Juan");
  });
});

describe("round-trip", () => {
  it("reimportar un .ass exportado devuelve el mismo proyecto", () => {
    const caps: Caption[] = [
      { id: "c1", inicio: 1, fin: 4, texto: "Hola mundo", hablante_id: "sp1" },
      { id: "c2", inicio: 5, fin: 8, texto: "Segunda línea", hablante_id: "sp2" },
      { id: "c3", inicio: 9, fin: 12, texto: "Sin hablante", hablante_id: null },
    ];
    const exportado = buildAss(caps, HABLANTES, PRESET, 1920, 1080);
    const r = parseAss(exportado);

    expect(r.captions.map((c) => c.texto)).toEqual(["Hola mundo", "Segunda línea", "Sin hablante"]);
    expect(r.captions[0].inicio).toBeCloseTo(1, 2);
    expect(r.captions[2].fin).toBeCloseTo(12, 2);
    expect(r.captions.map((c) => c.hablante_id)).toEqual(["H1", "H2", null]);
    expect(r.hablantes.map((h) => h.nombre)).toEqual(["Juan", "María"]);
    expect(r.hablantes.map((h) => h.color)).toEqual(["#E85D4E", "#4EA8E8"]);
  });

  it("re-exportar lo importado es estable (H1, H2 se mantienen)", () => {
    const caps: Caption[] = [
      { id: "c1", inicio: 1, fin: 4, texto: "Hola", hablante_id: "sp1" },
    ];
    const primera = parseAss(buildAss(caps, HABLANTES, PRESET, 1920, 1080));
    const segunda = parseAss(buildAss(primera.captions, primera.hablantes, PRESET, 1920, 1080));
    expect(segunda.hablantes.map((h) => h.id)).toEqual(["H1"]);
    expect(segunda.captions[0].texto).toBe("Hola");
  });

  it("mantiene H1=Juan aunque María hable primero (orden de estilos, no de eventos)", () => {
    const caps: Caption[] = [
      { id: "c1", inicio: 1, fin: 2, texto: "yo soy maría", hablante_id: "sp2" },
      { id: "c2", inicio: 3, fin: 4, texto: "yo soy juan", hablante_id: "sp1" },
    ];
    const r = parseAss(buildAss(caps, HABLANTES, PRESET, 1920, 1080));
    expect(r.hablantes.map((h) => h.id)).toEqual(["H1", "H2"]);
    expect(r.hablantes[0].nombre).toBe("Juan");
    expect(r.hablantes[1].nombre).toBe("María");
  });
});

describe("presetDesdeEstilos", () => {
  it("arma el preset desde el Style Default", () => {
    const r = parseAss(ASS_MUESTRA);
    const p = presetDesdeEstilos(r.styles, "Mi estilo", "preset-x");
    expect(p).not.toBeNull();
    expect(p!.color).toBe("#FFFFFF");
    expect(p!.fontsize).toBe(60);
    expect(p!.outline).toBe(3);
    expect(p!.shadow).toBe(2);
    expect(p!.nombre).toBe("Mi estilo");
  });

  it("devuelve null si el archivo no trae Style Default", () => {
    const sinDefault = ASS_MUESTRA.replace("Style: Default", "Style: Base");
    expect(presetDesdeEstilos(parseAss(sinDefault).styles, "x", "y")).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm test -- ass.test.ts`
Expected: FAIL — `parseAss` no exportada.

- [ ] **Step 3: Implementar `parseAss`**

Append a `src/utils/ass.ts`:

```ts
import type { Caption, Hablante, PresetAss } from "../types";

export interface EstiloAss {
  nombre: string;
  fontname: string;
  fontsize: number;
  primaryColour: string;
  outlineColour: string;
  outline: number;
  shadow: number;
  alignment: number;
  marginL: number;
  marginR: number;
  marginV: number;
}

export interface AssParseResult {
  captions: Caption[];
  hablantes: Hablante[];
  styles: EstiloAss[];
}

/** Divide una línea según las columnas de su Format. El ÚLTIMO campo se come
 *  el resto de la línea, que es lo que permite comas dentro de Text. */
function splitSegunFormat(linea: string, formato: string[]): Record<string, string> {
  const partes: string[] = [];
  let resto = linea;
  for (let i = 0; i < formato.length - 1; i++) {
    const p = resto.indexOf(",");
    partes.push(p === -1 ? resto : resto.slice(0, p));
    resto = p === -1 ? "" : resto.slice(p + 1);
  }
  partes.push(resto);
  const out: Record<string, string> = {};
  formato.forEach((k, i) => {
    out[k.trim()] = (partes[i] ?? "").trim();
  });
  return out;
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function parseAss(texto: string): AssParseResult {
  const normalizado = texto.replace(/\r/g, "");
  if (!/^ScriptType:\s*v4\.00\+/m.test(normalizado)) {
    throw new Error("solo .ass v4.00+ (ScriptType), no .ssa v4.00");
  }

  const estilos: EstiloAss[] = [];
  const eventos: Record<string, string>[] = [];
  let seccion = "";
  let formatoStyle: string[] = ASS_STYLE_FORMAT.split(",");
  let formatoEvents: string[] = ASS_EVENTS_FORMAT.split(",");

  for (const linea of normalizado.split("\n")) {
    const s = linea.trim();
    if (!s) continue;
    if (s.startsWith("[")) {
      seccion = s.toLowerCase();
      continue;
    }
    if (seccion === "[v4+ styles]") {
      if (s.startsWith("Format:")) {
        formatoStyle = s.slice(7).split(",").map((c) => c.trim());
        continue;
      }
      if (s.startsWith("Style:")) {
        const f = splitSegunFormat(s.slice(6), formatoStyle);
        estilos.push({
          nombre: f.Name ?? "",
          fontname: f.Fontname ?? "Arial",
          fontsize: num(f.Fontsize, 48),
          primaryColour: f.PrimaryColour ?? "&H00FFFFFF",
          outlineColour: f.OutlineColour ?? "&H00000000",
          outline: num(f.Outline, 2),
          shadow: num(f.Shadow, 0),
          alignment: num(f.Alignment, 2),
          marginL: num(f.MarginL, 10),
          marginR: num(f.MarginR, 10),
          marginV: num(f.MarginV, 40),
        });
      }
    } else if (seccion === "[events]") {
      if (s.startsWith("Format:")) {
        formatoEvents = s.slice(7).split(",").map((c) => c.trim());
        continue;
      }
      if (s.startsWith("Dialogue:")) {
        eventos.push(splitSegunFormat(s.slice(9), formatoEvents));
      }
    }
  }

  // El Style Default es "sin hablante": no se reconstruye como hablante.
  const nombrePorEstilo = new Map<string, string>();
  for (const e of eventos) {
    const estilo = e.Style ?? "";
    if (!estilo || estilo === "Default" || nombrePorEstilo.has(estilo)) continue;
    nombrePorEstilo.set(estilo, e.Name ?? "");
  }

  // El ORDEN importa y NO es el de los eventos: se itera la lista de estilos
  // del archivo, que es el orden del array de hablantes original. Armarlos en
  // orden de eventos renumeraría H1↔H2 en cuanto el hablante 2 hable primero,
  // y el re-export siguiente cambiaría el color de cada quien.
  const hablantes: Hablante[] = [];
  for (const st of estilos) {
    if (st.nombre === "Default" || !st.nombre) continue;
    const nombre = nombrePorEstilo.get(st.nombre) ?? st.nombre;
    hablantes.push({
      id: st.nombre,
      nombre: nombre || st.nombre,
      tecla: "",
      color: assColorToHex(st.primaryColour),
    });
  }
  // Un Dialogue puede referenciar un estilo que no tenga línea Style: (archivo
  //raro). No se pierde: se agrega al final en vez de descartarse en silencio.
  for (const estilo of nombrePorEstilo.keys()) {
    if (hablantes.some((h) => h.id === estilo)) continue;
    hablantes.push({
      id: estilo,
      nombre: nombrePorEstilo.get(estilo) || estilo,
      tecla: "",
      color: "#FFFFFF",
    });
  }

  const captions: Caption[] = eventos.map((e, i) => {
    const estilo = e.Style ?? "";
    return {
      id: `cap-${i + 1}-${Math.random().toString(36).slice(2, 7)}`,
      inicio: parseAssTime(e.Start ?? ""),
      fin: parseAssTime(e.End ?? ""),
      texto: unescapeAssText(e.Text ?? ""),
      hablante_id: !estilo || estilo === "Default" ? null : estilo,
    };
  });

  return { captions, hablantes, styles: estilos };
}

/** Base para el preset que crea el import. Sin Style Default no hay de dónde
 *  sacar un color base, así que devuelve null y el caller usa DEFAULT_PRESET_ASS. */
export function presetDesdeEstilos(
  styles: EstiloAss[],
  nombre: string,
  id: string,
): PresetAss | null {
  const base = styles.find((s) => s.nombre === "Default");
  if (!base) return null;
  return {
    id,
    nombre,
    fontname: base.fontname,
    fontsize: base.fontsize,
    color: assColorToHex(base.primaryColour),
    outlineColor: assColorToHex(base.outlineColour),
    outline: base.outline,
    shadow: base.shadow,
    alignment: base.alignment,
    marginL: base.marginL,
    marginR: base.marginR,
    marginV: base.marginV,
  };
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/ass.ts src/utils/__tests__/ass.test.ts
git commit -m "feat(ass): parseAss, estilos desde archivo y round-trip"
```

---

### Task 5: Almacén de presets (JSON global)

**Files:**
- Create: `src/utils/assPresets.ts`
- Create: `src/utils/__tests__/assPresets.test.ts`

**Interfaces:**
- Consumes: Task 2 (`PresetAss`, `DEFAULT_PRESET_ASS`, `ASS_PRESETS_ARCHIVO`).
- Produces:
  - `presetsDesdeJson(texto: string | null | undefined): PresetAss[]`
  - `presetsAJson(presets: PresetAss[]): string`
  - `nuevoPreset(base?: Partial<PresetAss>): PresetAss`
  - `cargarPresetsAss(): Promise<PresetAss[]>`
  - `guardarPresetsAss(presets: PresetAss[]): Promise<void>`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/utils/__tests__/assPresets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  presetsDesdeJson,
  presetsAJson,
  nuevoPreset,
} from "../assPresets";
import { DEFAULT_PRESET_ASS } from "../constants";
import type { PresetAss } from "../../types";

const P1: PresetAss = { ...DEFAULT_PRESET_ASS, id: "p1", nombre: "Blanco" };

describe("presetsDesdeJson", () => {
  it("siembra el preset por defecto cuando no hay archivo", () => {
    const r = presetsDesdeJson(null);
    expect(r).toHaveLength(1);
    expect(r[0].nombre).toBe("Default");
    expect(r[0].color).toBe("#FFFFFF");
    expect(r[0].shadow).toBe(1);
  });

  it("siembra el default si el JSON está corrupto", () => {
    expect(presetsDesdeJson("{no es json")).toHaveLength(1);
  });

  it("siembra el default si la lista está vacía o no es array", () => {
    expect(presetsDesdeJson('{"presets":[]}')).toHaveLength(1);
    expect(presetsDesdeJson('{"presets":"nope"}')).toHaveLength(1);
  });

  it("descarta entradas con campos faltantes o tipos raros", () => {
    const json = JSON.stringify({
      presets: [
        P1,
        { id: "roto", nombre: "Sin números" },
        { nombre: "Sin id", fontname: "X", fontsize: "grande", color: "#fff", outlineColor: "#000", outline: 1, shadow: 1, alignment: 2, marginL: 1, marginR: 1, marginV: 1 },
      ],
    });
    const r = presetsDesdeJson(json);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("p1");
  });

  it("lee una lista válida", () => {
    const r = presetsDesdeJson(JSON.stringify({ presets: [P1, { ...P1, id: "p2" }] }));
    expect(r.map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});

describe("presetsAJson", () => {
  it("sobrevive el round-trip por JSON", () => {
    const lista = [P1, { ...P1, id: "p2", nombre: "Con sombra", shadow: 4 }];
    const r = presetsDesdeJson(presetsAJson(lista));
    expect(r).toEqual(lista);
  });
});

describe("nuevoPreset", () => {
  it("parte del default con id y nombre nuevos", () => {
    const p = nuevoPreset();
    expect(p.id).not.toBe(DEFAULT_PRESET_ASS.id);
    expect(p.fontsize).toBe(DEFAULT_PRESET_ASS.fontsize);
  });

  it("acepta overrides parciales", () => {
    const p = nuevoPreset({ nombre: "Cine", fontsize: 64, alignment: 8 });
    expect(p.nombre).toBe("Cine");
    expect(p.fontsize).toBe(64);
    expect(p.alignment).toBe(8);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm test -- assPresets.test.ts`
Expected: FAIL — no se puede resolver `../assPresets`.

- [ ] **Step 3: Implementar el módulo**

Crear `src/utils/assPresets.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { appConfigDir, join } from "@tauri-apps/api/path";
import type { PresetAss } from "../types";
import { ASS_PRESETS_ARCHIVO, DEFAULT_PRESET_ASS } from "./constants";

const CAMPOS_TEXTO = ["id", "nombre", "fontname", "color", "outlineColor"] as const;
const CAMPOS_NUMERO = [
  "fontsize",
  "outline",
  "shadow",
  "alignment",
  "marginL",
  "marginR",
  "marginV",
] as const;

function esPresetAss(valor: unknown): valor is PresetAss {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return (
    CAMPOS_TEXTO.every((c) => typeof v[c] === "string") &&
    CAMPOS_NUMERO.every((c) => typeof v[c] === "number" && Number.isFinite(v[c]))
  );
}

function semilla(): PresetAss[] {
  return [{ ...DEFAULT_PRESET_ASS }];
}

export function presetsDesdeJson(texto: string | null | undefined): PresetAss[] {
  if (!texto) return semilla();
  try {
    const data = JSON.parse(texto) as { presets?: unknown };
    const lista = Array.isArray(data?.presets) ? data.presets.filter(esPresetAss) : [];
    return lista.length > 0 ? lista : semilla();
  } catch {
    return semilla();
  }
}

export function presetsAJson(presets: PresetAss[]): string {
  return JSON.stringify({ presets }, null, 2);
}

export function nuevoPreset(base: Partial<PresetAss> = {}): PresetAss {
  return {
    ...DEFAULT_PRESET_ASS,
    ...base,
    id: `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  };
}

export async function cargarPresetsAss(): Promise<PresetAss[]> {
  try {
    const ruta = await join(await appConfigDir(), ASS_PRESETS_ARCHIVO);
    return presetsDesdeJson(await invoke<string>("leer_archivo_texto", { ruta }));
  } catch {
    // El archivo todavía no existe (primer uso) o no se puede leer: se siembra.
    return semilla();
  }
}

export async function guardarPresetsAss(presets: PresetAss[]): Promise<void> {
  const ruta = await join(await appConfigDir(), ASS_PRESETS_ARCHIVO);
  await invoke("escribir_archivo_texto", { ruta, contenido: presetsAJson(presets) });
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/assPresets.ts src/utils/__tests__/assPresets.test.ts
git commit -m "feat(ass): presets globales en appConfigDir sin comandos Rust nuevos"
```

---

### Task 6: `AssPreview` (mini-frame con CSS)

**Files:**
- Create: `src/components/AssPreview.tsx`
- Modify: `src/App.css` (append al final)

**Interfaces:**
- Consumes: Task 2 (`calcularMargenesV`), Task 4 (`Caption`), `Hablante`, `PresetAss`.
- Produces: componente `AssPreview({ preset, hablantes, resX, resY }: Props)`.

- [ ] **Step 1: Crear el componente**

Crear `src/components/AssPreview.tsx`:

```tsx
import type { CSSProperties } from "react";
import type { Caption, Hablante, PresetAss } from "../types";
import { calcularMargenesV } from "../utils/ass";
import { useLocale } from "../i18n";

interface Props {
  preset: PresetAss;
  hablantes: Hablante[];
  resX: number;
  resY: number;
}

const ANCHO = 640;

function captionsDePrueba(hablantes: Hablante[]): Caption[] {
  const h = (i: number) =>
    hablantes.length > 0 ? (hablantes[i % hablantes.length]?.id ?? null) : null;
  return [
    {
      id: "preview-1",
      inicio: 0,
      fin: 4,
      texto: "Primer hablante con un texto largo para ver el salto de línea",
      hablante_id: h(0),
    },
    {
      id: "preview-2",
      inicio: 2,
      fin: 6,
      texto: "Segundo hablante\ncon dos renglones",
      hablante_id: h(1),
    },
    {
      id: "preview-3",
      inicio: 7,
      fin: 10,
      texto: "Tercero, ya sin solape",
      hablante_id: h(2),
    },
  ];
}

function alineacionHorizontal(a: number): CSSProperties["textAlign"] {
  const col = ((a - 1) % 3) + 1;
  return col === 1 ? "left" : col === 3 ? "right" : "center";
}

// En ASS, MarginV es la distancia desde el borde/ancla hacia el interior, así
// que subir el número aleja el texto del ancla en los tres tercios.
function posicionVertical(a: number, margenV: number, escala: number): CSSProperties {
  if (a >= 7) return { top: margenV * escala };
  if (a >= 4) return { top: `calc(50% + ${margenV * escala}px)` };
  return { bottom: margenV * escala };
}

export function AssPreview({ preset, hablantes, resX, resY }: Props) {
  const { t } = useLocale();
  const escala = ANCHO / resX;
  // 3 captions fijos: no hace falta useMemo, son 3 y el cálculo es de microsegundos.
  const caps = captionsDePrueba(hablantes);
  const margenes = calcularMargenesV(caps, preset, resX);

  return (
    <div
      className="assPreview"
      style={
        {
          aspectRatio: `${resX} / ${resY}`,
          paddingLeft: preset.marginL * escala,
          paddingRight: preset.marginR * escala,
          "--o": `${Math.max(0.5, preset.outline * escala)}px`,
          "--oc": preset.outlineColor,
          "--s": `${preset.shadow * escala}px`,
        } as CSSProperties
      }
    >
      {caps.map((c) => {
        const hablante = hablantes.find((h) => h.id === c.hablante_id);
        return (
          <div
            key={c.id}
            className="assPreviewCap"
            style={{
              ...posicionVertical(preset.alignment, margenes.get(c.id) ?? preset.marginV, escala),
              fontFamily: `"${preset.fontname}", var(--font-body)`,
              fontSize: preset.fontsize * escala,
              color: hablante?.color ?? preset.color,
              textAlign: alineacionHorizontal(preset.alignment),
              whiteSpace: "pre-line",
            }}
          >
            {c.texto}
          </div>
        );
      })}
      {hablantes.length === 0 && (
        <div className="assPreviewVacio">{t("assExport.previewNoSpeakers")}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Agregar los estilos**

Append a `src/App.css`:

```css
/* ===== MODAL EXPORT .ass ===== */
.assOverlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.assModal {
  background: var(--surface);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-xl);
  padding: 20px 24px;
  width: 860px;
  max-width: 94vw;
  max-height: 88vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.assModalHead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.assModalHead h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.assBody {
  display: grid;
  grid-template-columns: 190px 1fr;
  gap: 16px;
  min-height: 0;
}

.assPresetList {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-right: 1px solid var(--border);
  padding-right: 12px;
}

.assPresetItem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--r-sm);
  cursor: pointer;
  background: none;
  border: none;
  color: var(--textDim);
  font-family: var(--font-body);
  font-size: 13px;
  text-align: left;
  width: 100%;
}

.assPresetItem:hover {
  background: var(--surface2);
  color: var(--text);
}

.assPresetItem.activo {
  background: var(--accentSoft);
  color: var(--text);
  font-weight: 600;
}

.assPresetActions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: auto;
  padding-top: 10px;
}

.assFields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
  align-content: start;
}

.assField {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.assField label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--textFaint);
}

.assField input,
.assField select {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 13px;
  padding: 5px 7px;
  width: 100%;
}

.assField input:focus,
.assField select:focus {
  outline: none;
  border-color: var(--accent);
}

.assField input[type="color"] {
  padding: 2px;
  height: 28px;
  cursor: pointer;
}

.assPreviewWrap {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.assPreviewLabel {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--textFaint);
  margin-bottom: 6px;
}

.assPreview {
  position: relative;
  width: 100%;
  background: #000;
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-md);
  overflow: hidden;
}

.assPreviewCap {
  position: absolute;
  left: 0;
  right: 0;
  line-height: 1.15;
  font-weight: 400;
  /* ponytail: outline por 4 offsets. Es una aproximación — libass lo dibuja
     como anillo continuo y esto deja las diagonales un pelo sueltas. El shadow
     sí es exacto: ASS lo dibuja en OutlineColour, offset abajo-derecha. */
  text-shadow:
    calc(-1 * var(--o)) 0 0 var(--oc), var(--o) 0 0 var(--oc),
    0 calc(-1 * var(--o)) 0 var(--oc), 0 var(--o) 0 var(--oc),
    var(--s) var(--s) 0 var(--oc);
}

.assPreviewVacio {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--textFaint);
  font-size: 12px;
}

.assFooter {
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.assFooter .grow {
  flex: 1;
}

.assUnsaved {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--surface2);
  border: 1px solid var(--warn);
  border-radius: var(--r-sm);
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text);
}
```

- [ ] **Step 3: Verificar el typecheck**

Run: `npm run build`
Expected: PASS. Los componentes todavía no están importados por nadie, pero `tsc` los revisa igual.

- [ ] **Step 4: Commit**

```bash
git add src/components/AssPreview.tsx src/App.css
git commit -m "feat(ass): preview geométrico del apilado con CSS"
```

---

### Task 7: `AssExportModal`

**Files:**
- Create: `src/components/AssExportModal.tsx`

**Interfaces:**
- Consumes: Task 5 (`nuevoPreset`), Task 6 (`AssPreview`), `PresetAss`, `Hablante`.
- Produces: componente `AssExportModal({ presets, hablantes, resX, resY, onCerrar, onExportar, onGuardar })` con:
  - `onExportar(preset: PresetAss): void` — el modal **no** escribe el archivo; solo devuelve el preset elegido.
  - `onGuardar(presets: PresetAss[]): void` — persiste la lista (App.tsx la guarda).
  - `onCerrar(): void`
  - **No lleva prop `abierto`**: App.tsx lo monta condicionalmente (`{assModalAbierto && <AssExportModal ... />}`), así el componente se inicializa desde `presets` en cada apertura y no necesita efecto de sincronización.

- [ ] **Step 1: Crear el componente**

Crear `src/components/AssExportModal.tsx`:

```tsx
import { useState } from "react";
import type { Hablante, PresetAss } from "../types";
import { useLocale } from "../i18n";
import { nuevoPreset } from "../utils/assPresets";
import { AssPreview } from "./AssPreview";

interface Props {
  presets: PresetAss[];
  hablantes: Hablante[];
  resX: number;
  resY: number;
  onCerrar: () => void;
  onExportar: (preset: PresetAss) => void;
  onGuardar: (presets: PresetAss[]) => void;
}

const ALINEACIONES: { valor: number; etiqueta: string }[] = [
  { valor: 1, etiqueta: "1 Abajo izq." },
  { valor: 2, etiqueta: "2 Abajo centro" },
  { valor: 3, etiqueta: "3 Abajo der." },
  { valor: 4, etiqueta: "4 Medio izq." },
  { valor: 5, etiqueta: "5 Medio centro" },
  { valor: 6, etiqueta: "6 Medio der." },
  { valor: 7, etiqueta: "7 Arriba izq." },
  { valor: 8, etiqueta: "8 Arriba centro" },
  { valor: 9, etiqueta: "9 Arriba der." },
];

const CAMPOS_NUMERO: (keyof PresetAss)[] = [
  "fontsize",
  "outline",
  "shadow",
  "marginL",
  "marginR",
  "marginV",
];

export function AssExportModal({
  presets,
  hablantes,
  resX,
  resY,
  onCerrar,
  onExportar,
  onGuardar,
}: Props) {
  const { t } = useLocale();
  const [seleccionId, setSeleccionId] = useState<string>(presets[0]?.id ?? "");
  const [borrador, setBorrador] = useState<PresetAss | null>(presets[0] ?? null);
  // Acción que se quiere ejecutar pero primero hay que confirmar descarte.
  const [pendiente, setPendiente] = useState<(() => void) | null>(null);

  const original = presets.find((p) => p.id === seleccionId) ?? null;
  const sucio =
    borrador !== null && original !== null
      ? JSON.stringify(borrador) !== JSON.stringify(original)
      : false;

  /** Toda acción que descartaría los cambios pasa por acá: o se ejecuta, o se
   *  pide confirmación. Nunca se pierde trabajo en silencio. */
  const conConfirmacion = (accion: () => void) => {
    if (sucio) {
      setPendiente(() => accion);
      return;
    }
    accion();
  };

  const editar = <C extends keyof PresetAss>(campo: C, valor: PresetAss[C]) => {
    setBorrador((b) => (b ? { ...b, [campo]: valor } : b));
  };

  const seleccionar = (id: string) => {
    conConfirmacion(() => {
      const p = presets.find((x) => x.id === id);
      if (p) {
        setSeleccionId(id);
        setBorrador(p);
      }
    });
  };

  const guardar = () => {
    if (!borrador) return;
    const existe = presets.some((p) => p.id === borrador.id);
    onGuardar(
      existe
        ? presets.map((p) => (p.id === borrador.id ? borrador : p))
        : [...presets, borrador],
    );
    setSeleccionId(borrador.id);
  };

  const guardarComoNuevo = () => {
    if (!borrador) return;
    const nuevo = nuevoPreset({ ...borrador, nombre: `${borrador.nombre} copia` });
    onGuardar([...presets, nuevo]);
    setSeleccionId(nuevo.id);
    setBorrador(nuevo);
  };

  const borrar = () => {
    if (!borrador || presets.length <= 1) return;
    const resto = presets.filter((p) => p.id !== borrador.id);
    onGuardar(resto);
    setSeleccionId(resto[0].id);
    setBorrador(resto[0]);
  };

  return (
    <div className="assOverlay" onClick={() => conConfirmacion(onCerrar)}>
      <div className="assModal" onClick={(e) => e.stopPropagation()}>
        <div className="assModalHead">
          <h2>{t("assExport.title")}</h2>
          <span className="assPreviewLabel">
            {resX}x{resY}
          </span>
        </div>

        <div className="assBody">
          <div className="assPresetList">
            {presets.map((p) => (
              <button
                key={p.id}
                className={
                  "assPresetItem" + (p.id === seleccionId ? " activo" : "")
                }
                onClick={() => seleccionar(p.id)}
              >
                {p.nombre}
              </button>
            ))}
            <div className="assPresetActions">
              <button className="addFragmentBtn" onClick={guardarComoNuevo}>
                {t("assExport.newPreset")}
              </button>
              <button
                className="addFragmentBtn"
                onClick={borrar}
                disabled={presets.length <= 1}
              >
                {t("assExport.delete")}
              </button>
            </div>
          </div>

          {borrador && (
            <div className="assFields">
              <div className="assField">
                <label>{t("assExport.field_nombre")}</label>
                <input
                  value={borrador.nombre}
                  onChange={(e) => editar("nombre", e.target.value)}
                />
              </div>
              <div className="assField">
                <label>{t("assExport.field_fontname")}</label>
                <input
                  value={borrador.fontname}
                  list="assFuentes"
                  onChange={(e) => editar("fontname", e.target.value)}
                />
                <datalist id="assFuentes">
                  <option value="Inter" />
                  <option value="Space Grotesk" />
                  <option value="JetBrains Mono" />
                </datalist>
              </div>
              {CAMPOS_NUMERO.map((campo) => (
                <div className="assField" key={campo}>
                  <label>{t(`assExport.field_${campo}`)}</label>
                  <input
                    type="number"
                    value={borrador[campo] as number}
                    onChange={(e) => editar(campo, Number(e.target.value) || 0)}
                  />
                </div>
              ))}
              <div className="assField">
                <label>{t("assExport.field_alignment")}</label>
                <select
                  value={borrador.alignment}
                  onChange={(e) => editar("alignment", Number(e.target.value))}
                >
                  {ALINEACIONES.map((a) => (
                    <option key={a.valor} value={a.valor}>
                      {a.etiqueta}
                    </option>
                  ))}
                </select>
              </div>
              <div className="assField">
                <label>{t("assExport.field_color")}</label>
                <input
                  type="color"
                  value={borrador.color}
                  onChange={(e) => editar("color", e.target.value)}
                />
              </div>
              <div className="assField">
                <label>{t("assExport.field_outlineColor")}</label>
                <input
                  type="color"
                  value={borrador.outlineColor}
                  onChange={(e) => editar("outlineColor", e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {borrador && (
          <div className="assPreviewWrap">
            <div className="assPreviewLabel">{t("assExport.preview")}</div>
            <AssPreview
              preset={borrador}
              hablantes={hablantes}
              resX={resX}
              resY={resY}
            />
          </div>
        )}

        {pendiente && (
          <div className="assUnsaved">
            <span className="grow">{t("assExport.unsaved")}</span>
            <button
              className="addFragmentBtn"
              onClick={() => {
                const accion = pendiente;
                setPendiente(null);
                accion();
              }}
            >
              {t("assExport.discard")}
            </button>
            <button className="addFragmentBtn" onClick={() => setPendiente(null)}>
              {t("assExport.keepEditing")}
            </button>
          </div>
        )}

        <div className="assFooter">
          <span className="grow" />
          <button className="addFragmentBtn" onClick={() => conConfirmacion(onCerrar)}>
            {t("assExport.close")}
          </button>
          <button
            className="addFragmentBtn"
            onClick={guardar}
            disabled={!borrador}
          >
            {t("assExport.save")}
          </button>
          <button
            className="addFragmentBtn primary"
            onClick={() => borrador && onExportar(borrador)}
            disabled={!borrador}
          >
            {t("assExport.export")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**I18n:** los `<option>` de alineación llevan los nombres técnicos de ASS en español
("2 Abajo centro") sin pasar por `t()`. Son las etiquetas del formato, no copy de la
app: si molesta traducirlas, se agregan 3 keys (`alignBottom`/`alignMiddle`/`alignTop`).
Todo el resto del modal sí usa `t()`.

- [ ] **Step 2: Verificar el typecheck**

Run: `npm run build`
Expected: FAIL si falta la key `assExport.previewNoSpeakers` usada en Task 6 — no, las keys faltantes dan `undefined` en runtime, no error de tipos. PASS esperado.

- [ ] **Step 3: Commit**

```bash
git add src/components/AssExportModal.tsx
git commit -m "feat(ass): modal de export con editor de presets y descarte explícito"
```

---

### Task 8: Cableado en App.tsx, menú e i18n

**Files:**
- Modify: `src/App.tsx`
- Modify: `src-tauri/src/lib.rs` (líneas ~555-590, el bloque de menús)
- Modify: `src/i18n/es.json`, `src/i18n/en.json`

**Interfaces:**
- Consumes: Task 4 (`buildAss`, `parseAss`, `presetDesdeEstilos`), Task 5 (`cargarPresetsAss`, `guardarPresetsAss`, `nuevoPreset`), Task 7 (`AssExportModal`).
- Produces: menú `exportar_ass` y `cargar_ass`; state `assModalAbierto`; handlers `handleExportarAss`, `handleCargarAss`, `guardarPresets`.

- [ ] **Step 1: Agregar las keys de i18n**

En `src/i18n/es.json`, después de la línea `"app.export.jsonDone"`, agregar:

```json
  "assExport.title": "Exportar .ass",
  "assExport.newPreset": "Duplicar",
  "assExport.delete": "Borrar",
  "assExport.save": "Guardar",
  "assExport.export": "Exportar",
  "assExport.close": "Cerrar",
  "assExport.discard": "Descartar",
  "assExport.keepEditing": "Seguir editando",
  "assExport.unsaved": "Tenés cambios sin guardar en este preset.",
  "assExport.preview": "Vista previa",
  "assExport.previewNoSpeakers": "Sin hablantes: se ve el estilo Default",
  "assExport.field_nombre": "Nombre del preset",
  "assExport.field_fontname": "Fuente",
  "assExport.field_fontsize": "Tamaño",
  "assExport.field_outline": "Grosor del contorno",
  "assExport.field_shadow": "Sombra",
  "assExport.field_alignment": "Alineación",
  "assExport.field_marginL": "Margen izq.",
  "assExport.field_marginR": "Margen der.",
  "assExport.field_marginV": "Margen abajo",
  "assExport.field_color": "Color (solo captions sin hablante)",
  "assExport.field_outlineColor": "Color del contorno",
  "assExport.done": ".ass exportado: {count} subtítulo(s).",
  "assExport.noCaptions": "No hay subtítulos para exportar.",
  "assExport.importDone": ".ass importado: {count} subtítulo(s), {speakers} hablante(s).",
  "assExport.importError": "No se pudo leer el .ass: {error}",
  "assExport.importPresetCreated": "Se creó el preset \"{name}\" desde el archivo.",
  "dialog.filterAss": "Advanced SubStation Alpha (.ass)",
```

En `src/i18n/en.json`, agregar el equivalente:

```json
  "assExport.title": "Export .ass",
  "assExport.newPreset": "Duplicate",
  "assExport.delete": "Delete",
  "assExport.save": "Save",
  "assExport.export": "Export",
  "assExport.close": "Close",
  "assExport.discard": "Discard",
  "assExport.keepEditing": "Keep editing",
  "assExport.unsaved": "This preset has unsaved changes.",
  "assExport.preview": "Preview",
  "assExport.previewNoSpeakers": "No speakers: showing the Default style",
  "assExport.field_nombre": "Preset name",
  "assExport.field_fontname": "Font",
  "assExport.field_fontsize": "Size",
  "assExport.field_outline": "Outline width",
  "assExport.field_shadow": "Shadow",
  "assExport.field_alignment": "Alignment",
  "assExport.field_marginL": "Left margin",
  "assExport.field_marginR": "Right margin",
  "assExport.field_marginV": "Bottom margin",
  "assExport.field_color": "Color (unassigned captions only)",
  "assExport.field_outlineColor": "Outline color",
  "assExport.done": ".ass exported: {count} subtitle(s).",
  "assExport.noCaptions": "No subtitles to export.",
  "assExport.importDone": ".ass imported: {count} subtitle(s), {speakers} speaker(s).",
  "assExport.importError": "Could not read the .ass: {error}",
  "assExport.importPresetCreated": "Created preset \"{name}\" from the file.",
  "dialog.filterAss": "Advanced SubStation Alpha (.ass)",
```

- [ ] **Step 2: Agregar los items de menú en Rust**

En `src-tauri/src/lib.rs`, después del `let cargar_srt = ...` block (línea ~563), agregar dentro de `menu_archivo`:

```rust
            let cargar_ass = MenuItemBuilder::new("Cargar .ass")
                .id("cargar_ass")
                .build(app)?;
```

y en `.item(&cargar_srt)` agregar `.item(&cargar_ass)` justo después.

Y después del `let exportar_json = ...` (línea ~584), agregar:

```rust
            let exportar_ass = MenuItemBuilder::new("Exportar .ass...")
                .id("exportar_ass")
                .build(app)?;
```

y en `menu_exportar` agregar `.item(&exportar_ass)` después de `.item(&exportar_json)`.

- [ ] **Step 3: Verificar que Rust compila**

Run: `cargo check`
Expected: PASS, sin warnings nuevos.

- [ ] **Step 4: Cablear el frontend en App.tsx**

Agregar imports junto a los de la línea 29 (`import { parseSrt, buildSrt, ... }`):

```ts
import { buildAss, parseAss, presetDesdeEstilos } from "./utils/ass";
import {
  cargarPresetsAss,
  guardarPresetsAss,
  nuevoPreset,
} from "./utils/assPresets";
import { AssExportModal } from "./components/AssExportModal";
```

Agregar los states cerca de los demás `useState` de la app (junto a `showHelp`):

```ts
  const [assModalAbierto, setAssModalAbierto] = useState(false);
  const [presetsAss, setPresetsAss] = useState<PresetAss[]>([]);
  const [resAss, setResAss] = useState({ x: 1920, y: 1080 });
```

Agregar `videoRef` al import de tipos si no está: `import type { Caption, Hablante, Proyecto, TrackInfo, PresetAss } from "./types";`

Agregar los handlers después de `handleExportarJsonCombinado` (línea ~741):

```ts
  async function handleExportarAss() {
    if (captionsRef.current.length === 0) {
      setExportMensaje(t("assExport.noCaptions"));
      setTimeout(() => setExportMensaje(""), 4000);
      return;
    }
    // El canvas del .ass sigue al video real, para que el tamaño de fuente se
    // vea igual que en Kdenlive.
    const v = videoRef.current;
    setResAss({ x: v?.videoWidth || 1920, y: v?.videoHeight || 1080 });
    setPresetsAss(await cargarPresetsAss());
    setAssModalAbierto(true);
  }

  async function persistirPresets(presets: PresetAss[]) {
    setPresetsAss(presets);
    try {
      await guardarPresetsAss(presets);
    } catch (err) {
      console.error("Error guardando presets .ass:", err);
    }
  }

  async function exportarAssConPreset(preset: PresetAss) {
    try {
      const path = await save({
        filters: [{ name: t("dialog.filterAss"), extensions: ["ass"] }],
        defaultPath: "subtitulos.ass",
      });
      if (!path) return;
      // Se arma DESPUÉS del save: si el usuario cancela, no se hace el trabajo.
      const contenido = buildAss(
        captionsRef.current,
        hablantesRef.current,
        preset,
        resAss.x,
        resAss.y,
      );
      await invoke("escribir_archivo_texto", { ruta: path, contenido });
      setAssModalAbierto(false);
      setExportMensaje(
        t("assExport.done", { count: captionsRef.current.length }),
      );
      setTimeout(() => setExportMensaje(""), 5000);
    } catch (err) {
      console.error("Error exportando .ass:", err);
    }
  }

  async function handleCargarAss() {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: t("dialog.filterAss"), extensions: ["ass"] }],
      });
      if (!path) return;
      const contenido = await invoke<string>("leer_archivo_texto", { ruta: path });
      const resultado = parseAss(contenido);
      if (resultado.captions.length === 0) return;
      // El import crea un preset desde el Style Default del archivo: es la vía
      // para traer estilos de Premiere sin tipearlos.
      const nombrePreset = (path as string).split(/[\\/]/).pop()?.replace(/\.ass$/i, "") ?? "Importado";
      const nuevo = presetDesdeEstilos(
        resultado.styles,
        nombrePreset,
        `preset-import-${Date.now().toString(36)}`,
      ) ?? nuevoPreset({ nombre: nombrePreset });
      const presets = await cargarPresetsAss();
      await persistirPresets([...presets.filter((p) => p.id !== nuevo.id), nuevo]);

      // Mismo patrón que cargarSrtDesdeRuta: la carga deja el proyecto limpio.
      ignoreNextChangeRef.current = true;
      isDirtyRef.current = false;
      setHayCambios(false);
      setHablantes(resultado.hablantes);
      setCaptions(resultado.captions);
      setSelectedCaptionIds([]);
      setExportMensaje(
        t("assExport.importDone", {
          count: resultado.captions.length,
          speakers: resultado.hablantes.length,
        }) + " " + t("assExport.importPresetCreated", { name: nombrePreset }),
      );
      setTimeout(() => setExportMensaje(""), 5000);
    } catch (err) {
      console.error("Error importando .ass:", err);
      setExportMensaje(
        t("assExport.importError", { error: String(err) }),
      );
      setTimeout(() => setExportMensaje(""), 5000);
    }
  }
```

- [ ] **Step 5: Registrar los listeners del menú**

En el `useEffect` de deps `[]` que maneja los eventos de menú (App.tsx ~línea 748), agregar:

```ts
    const unlistenExportarAss = listen("exportar_ass", () =>
      handleExportarAss(),
    );
    const unlistenCargarAss = listen("cargar_ass", () => handleCargarAss());
```

y en el `return` del cleanup, antes del cierre:

```ts
      unlistenExportarAss.then((f) => f());
      unlistenCargarAss.then((f) => f());
```

- [ ] **Step 6: Montar el modal en el JSX**

Justo antes del cierre de `</main>` (después del bloque `{showHelp && ...}`), agregar:

```tsx
      {assModalAbierto && (
        <AssExportModal
          presets={presetsAss}
          hablantes={hablantes}
          resX={resAss.x}
          resY={resAss.y}
          onCerrar={() => setAssModalAbierto(false)}
          onExportar={exportarAssConPreset}
          onGuardar={persistirPresets}
        />
      )}
```

El montaje es condicional a propósito: el modal inicializa su estado desde `presets`
cada vez que se abre, así no necesita efecto de sincronización entre la lista y el
borrador.

- [ ] **Step 7: Verificar typecheck y build**

Run: `npm run build`
Expected: PASS. Si `tsc` se queja de `videoRef` o `resAss`, revisar que estén definidos antes de los handlers.

- [ ] **Step 8: Correr la suite completa**

Run: `npm test`
Expected: PASS, sin regresiones en los 53 tests preexistentes.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/i18n/es.json src/i18n/en.json src-tauri/src/lib.rs
git commit -m "feat(ass): cablea export e import de .ass en la app"
```

- [ ] **Step 10: Verificar en el navegador**

Run: `npm run tauri dev` (o `npm run dev` para el render web, aceptando que el IPC falle en consola).

Con `openchamber_web`:
1. Abrir la app.
2. `Exportar → Exportar .ass...`: el modal abre con el preset "Default", el preview muestra 3 captions (uno con `\n`) con el color del primer hablante, y sin captions en un timeline limpio el `MarginV` del preview no sube.
3. Cambiar `fontsize` a 64 y `alignment` a 8: el preview se actualiza en vivo (texto más arriba, alineado al centro arriba).
4. Cambiar a un preset con dos hablantes: el preview usa los colores de `Hablante.color`.
5. `Exportar`: aparece el diálogo de archivo; confirmar con un nombre de prueba.
6. Reabrir la app, `Archivo → Cargar .ass` y elegir el archivo exportado: los captions, hablantes y colores vuelven, y aparece el mensaje de import con el preset creado.
7. Errores de consola: solo los del IPC de Tauri en navegador puro (esperado, AGENTS.md).

- [ ] **Step 11: Commit de cualquier ajuste de la verificación**

```bash
git add -A
git commit -m "fix(ass): ajustes de la verificación en navegador"
```

---

## Self-Review

Revisión hecha **ejecutando la lógica del plan en Node antes de escribir el código**,
no solo leyéndola. Eso encontró 5 defectos reales:

1. **`escapeAssText` rompía el round-trip.** Convertía el `\n` a `\N` y *después* escapaba
   las barras, así que la barra del `\N` recién creado se convertía en `\\` y el texto
   volvía con una barra literal en vez del salto de línea. Fix: escapar barras y llaves
   primero, convertir el salto de línea al final (y en `unescapeAssText` al revés).
   Re-verificado: TODO VERDE.
2. **`parseAss` renumeraba los hablantes.** Armaba la lista en orden de *eventos*, así
   que si el hablante 2 hablaba primero, `H1` pasaba a ser él y el re-export siguiente
   cambiaba el color de cada quien. Fix: iterar los `Style:` del archivo (que es el orden
   original del array de hablantes) y tomar el nombre de los eventos. Hay test de
   regresión con María hablando primero.
3. **`sanitizeNombreDialogo` dejaba dos espacios** ("Smith, John" → "Smith  John"),
   que rompía el test que la cubría. Fix: `/,\s*/g` funde coma y espacios en uno.
4. **`asignarCarriles` no ordenaba y el llamador tenía que acordarse.** Era un
   footgun: `calcularMargenesV` la llamaba con captions sin ordenar. Fix: ordena
   internamente, y el test que documentaba el comportamiento frágil pasó a documentar
   el orden interno.
5. **Placeholder en el fixture de Task 4** (`Format: ${""}`) y **`eslint-disable` de un
   linter que el proyecto no tiene**. Los dos eliminados.

Cosas revisadas y confirmadas como correctas: los 3 valores de `formatAssTime` con
rollover, las conversiones BGR de ambos sentidos, los 5 casos de carriles, el offset por
altura máxima (194 = 3 × 48 × 1.35), la coma en la columna `Name` de `Dialogue:`, el
`Style:` con 23 columnas y el `Dialogue:` con 10, y que `videoRef` / `showHelp` existen
en App.tsx.

Un problema de clase que se eliminó de raíz: el modal llevaba un `useEffect` que
sincronizaba `presets` con el borrador y, con `borrador` en las deps, era un loop
latente. Se borró el efecto y el prop `abierto`: App monta el modal
condicionalmente, así inicializa desde props y no hay estado que sincronizar.

- [x] **Cobertura del spec:** 11 grupos de tests → Tasks 1-5. Presets/persistencia → Task 5. Preview y modal → Tasks 6-7. Export e import, menú, i18n, PlayRes, carga que deja el proyecto limpio → Task 8. `\pos` y fusionar captions siguen fuera de alcance (no-objetivos del spec).
- [x] **Placeholders:** ninguno. Cada step tiene el código o el comando concreto.
- [x] **Consistencia de tipos:** `PresetAss` se define en Task 2 y lo consumen Tasks 3-8 con los mismos nombres de campo. `buildAss(caps, hablantes, preset, resX, resY)` y `parseAss(texto)` se invocan igual en el código y en los tests. `calcularMargenesV` devuelve `Map<string, number>` en Tasks 2 y 6. `onGuardar` del modal toma la lista completa. Las keys i18n del modal son `field_<campo de PresetAss>`, generadas por el mismo nombre que usa el `map` de campos numéricos.
