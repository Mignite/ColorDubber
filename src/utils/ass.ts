// Primitivas del formato Advanced SubStation Alpha (v4.00+).
// Puras y sin dependencias: el builder y el parser se apoyan acá.

import type { Caption, Hablante, PresetAss } from "../types";
import { ASS_FACTOR_ANCHO, ASS_FACTOR_ALTO_LINEA } from "./constants";

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
  const charsPorLinea = Math.max(
    1,
    anchoUtil / (preset.fontsize * ASS_FACTOR_ANCHO),
  );
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
    const alto =
      lineasDeCaption(c.texto, preset, resX) * preset.fontsize * ASS_FACTOR_ALTO_LINEA;
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

export const ASS_STYLE_FORMAT =
  "Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, " +
  "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, " +
  "Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding";

export const ASS_EVENTS_FORMAT =
  "Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";

function lineaStyle(
  nombre: string,
  colorPrimario: string,
  preset: PresetAss,
): string {
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

  // El nombre del estilo es el índice del array de hablantes: por eso un
  // nombre duplicado no puede romper nada (H1, H2, ... son únicos por
  // construcción) y el nombre real, que sí puede repetirse, viaja aparte.
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
