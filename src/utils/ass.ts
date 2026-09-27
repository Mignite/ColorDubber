// Primitivas del formato Advanced SubStation Alpha (v4.00+).
// Puras y sin dependencias: el builder y el parser se apoyan acá.

import type { Caption, Hablante, PresetAss } from "../types";

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

export interface SegmentoAss {
  inicio: number;
  fin: number;
  /** Activos en ese tramo, ordenados por inicio. */
  captions: Caption[];
}

/** Barrido (sweep-line): un segmento por cada instante en que cambia el set de
 *  captions activos. NO es agrupación en cadena — con A=[0,10] B=[5,15]
 *  C=[12,20] la cadena daría un evento [0,20] con las tres y dejaría el texto
 *  de A visible 10 s después de que terminó. */
export function segmentarPorSolape(caps: Caption[]): SegmentoAss[] {
  const ordenados = [...caps]
    .filter((c) => c.fin > c.inicio)
    .sort((a, b) => a.inicio - b.inicio || a.fin - b.fin);
  const segmentos: SegmentoAss[] = [];
  let activas: Caption[] = [];
  let i = 0;
  let t = ordenados.length > 0 ? ordenados[0].inicio : 0;

  while (i < ordenados.length || activas.length > 0) {
    let siguiente = Infinity;
    if (i < ordenados.length) siguiente = ordenados[i].inicio;
    for (const c of activas) siguiente = Math.min(siguiente, c.fin);

    if (activas.length > 0) {
      segmentos.push({ inicio: t, fin: siguiente, captions: [...activas] });
    }
    activas = activas.filter((c) => c.fin > siguiente);
    while (i < ordenados.length && ordenados[i].inicio <= siguiente) {
      if (ordenados[i].fin > siguiente) activas.push(ordenados[i]);
      i++;
    }
    t = siguiente;
  }
  return segmentos;
}

/** Overrides ASS de una línea, SOLO por los campos que difieren del preset base.
 *  Vacío cuando no difiere nada, que es el caso normal de un solo hablante. */
export function overridesDeLinea(linea: PresetAss, base: PresetAss): string {
  const p: string[] = [];
  if (linea.fontname !== base.fontname) p.push(`\\fn${linea.fontname}`);
  if (linea.fontsize !== base.fontsize) p.push(`\\fs${linea.fontsize}`);
  if (linea.color.toLowerCase() !== base.color.toLowerCase())
    p.push(`\\c${hexToAssColor(linea.color)}&`);
  if (linea.outlineColor.toLowerCase() !== base.outlineColor.toLowerCase())
    p.push(`\\3c${hexToAssColor(linea.outlineColor)}&`);
  if (linea.outline !== base.outline) p.push(`\\bord${linea.outline}`);
  if (linea.shadow !== base.shadow) p.push(`\\shad${linea.shadow}`);
  return p.length > 0 ? `{${p.join("")}}` : "";
}

/** Un solo Dialogue con una línea por caption, unida por \N. */
export function fusionarLineas(
  captions: Caption[],
  presetDe: (c: Caption) => PresetAss,
  base: PresetAss,
): string {
  return captions
    .map((c) => overridesDeLinea(presetDe(c), base) + escapeAssText(c.texto))
    .join("\\N");
}

export const ASS_STYLE_FORMAT =  "Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, " +
  "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, " +
  "Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding";

export const ASS_EVENTS_FORMAT =
  "Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";

function lineaStyle(nombre: string, preset: PresetAss): string {
  const c = hexToAssColor(preset.color);
  const o = hexToAssColor(preset.outlineColor);
  return (
    `Style: ${nombre},${preset.fontname},${preset.fontsize},${c},${c},${o},` +
    `&H00000000,0,0,0,0,100,100,0,0,1,${preset.outline},${preset.shadow},` +
    `${preset.alignment},${preset.marginL},${preset.marginR},${preset.marginV},1`
  );
}

/** `presetDe` resuelve el preset de un hablante (o el de "sin hablante" con id
 *  null). La resuelve el caller desde la asignacion elegida en el modal: es mas
 *  facil de testear que pasar ids sueltos. */
export function buildAss(
  caps: Caption[],
  hablantes: Hablante[],
  presetDe: (hablanteId: string | null) => PresetAss,
  resX: number,
  resY: number,
): string {
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
    ...hablantes.map((h, i) => lineaStyle(`H${i + 1}`, presetDe(h.id))),
    lineaStyle("Default", presetDe(null)),
  ];

  const eventos = segmentarPorSolape(caps).map((seg) => {
    const primero = seg.captions[0];
    const base = presetDe(primero.hablante_id);
    return (
      `Dialogue: 0,${formatAssTime(seg.inicio)},${formatAssTime(seg.fin)},` +
      `${styleDe(primero.hablante_id)},${nombreDe(primero.hablante_id)},0,0,` +
      `${base.marginV},,${fusionarLineas(
        seg.captions,
        (c) => presetDe(c.hablante_id),
        base,
      )}`
    );
  });

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
function splitSegunFormat(
  linea: string,
  formato: string[],
): Record<string, string> {
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
  // Un Dialogue multilínea sigue en las líneas siguientes: se pegan al último
  // evento. Es la forma normal de los .ass de Aegisub/Kdenlive.
  const CONOCIDOS = [
    "Format:",
    "Style:",
    "Dialogue:",
    "Comment:",
    "Picture:",
    "Sound:",
    "Movie:",
    "Command:",
  ];
  let ultimoEvento: Record<string, string> | null = null;

  for (const linea of normalizado.split("\n")) {
    const s = linea.trim();
    if (!s) continue;
    if (s.startsWith("[")) {
      seccion = s.toLowerCase();
      ultimoEvento = null;
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
        ultimoEvento = splitSegunFormat(s.slice(9), formatoEvents);
        eventos.push(ultimoEvento);
        continue;
      }
      if (ultimoEvento && !CONOCIDOS.some((p) => s.startsWith(p))) {
        ultimoEvento.Text = (ultimoEvento.Text ?? "") + "\n" + s;
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
  // Un Dialogue puede referenciar un estilo sin línea Style: (archivo raro).
  // No se pierde: se agrega al final en vez de descartarse en silencio.
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
