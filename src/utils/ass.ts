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
