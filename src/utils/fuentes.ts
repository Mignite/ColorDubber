import { invoke } from "@tauri-apps/api/core";

// Detección de fuentes instaladas para el preset .ass.
//
// El webview no tiene API de fuentes, así que el plan es de dos pasos:
//   1. el backend lee el registro de Windows (familias del sistema + del
//      usuario) y devuelve los nombres CRUDOS;
//   2. el renderer descarta los que no existen de verdad, midiendo.
//
// El paso 2 es el que importa: el registro mezcla familias reales ("Arial
// Black", "Calibri Light") con variantes de estilo que NUNCA resuelven como
// familia ("Calibri Bold", "Consolas Bold Italic"). Escribir esas en el .ass
// produce un fallback silencioso, que es justo lo que hay que evitar.

/** Quita el sufijo de tipo que el registro agrega y deduplica.
 *  "Calibri Bold (TrueType)" -> "Calibri Bold" */
export function limpiarNombresFuentes(raw: string[]): string[] {
  const vistos = new Set<string>();
  for (const r of raw) {
    const limpio = r.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (limpio) vistos.add(limpio);
  }
  return [...vistos].sort((a, b) => a.localeCompare(b));
}

const MUESTRA = "abcdefghijklmnopqrstuvwxyz 0123456789 WMWiIlj";
const BASELINE = "cdub-fuente-que-no-existe-zzz";

/** Mide un conjunto de font-families ya armados. La div tiene que estar en el
 *  document: fuera del DOM no hay layout, todas las medidas dan 0 y se cuela
 *  todo (medido: sin esto la detección devolvía [] siempre). */
function medir(fontFamilies: string[]): number[] {
  const caja = document.createElement("div");
  caja.style.cssText =
    "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font-size:48px;line-height:normal;";
  document.body.appendChild(caja);
  const spans = fontFamilies.map((ff) => {
    const span = document.createElement("span");
    span.style.fontFamily = ff;
    span.style.whiteSpace = "nowrap";
    span.textContent = MUESTRA;
    caja.appendChild(span);
    return span;
  });
  const out = spans.map((s) => s.getBoundingClientRect().width);
  caja.remove();
  return out;
}

const cacheResolucion = new Map<string, boolean>();

/** ¿El renderer puede pintar ESA cadena exacta como font-family?
 *
 *  Es la pregunta correcta para el aviso "no está instalada", y no puede
 *  contestarse con la lista: el registro de Windows da el nombre con el estilo
 *  pegado ("Bebas Neue Regular") pero el nombre de familia real es "Bebas
 *  Neue", así que comparar exacto daba un falso negativo (medido).
 */
export function fuenteResuelve(nombre: string): boolean {
  if (typeof document === "undefined") return true;
  const limpio = nombre.trim();
  if (!limpio) return true;
  const cacheado = cacheResolucion.get(limpio);
  if (cacheado !== undefined) return cacheado;
  const baseMono = medir([`"${BASELINE}", monospace`])[0];
  const baseSerif = medir([`"${BASELINE}", serif`])[0];
  const wMono = medir([`"${limpio}", monospace`])[0];
  const wSerif = medir([`"${limpio}", serif`])[0];
  // Consolas ES la monospace por defecto de Windows: con un solo genérico sus
  // métricas son idénticas al fallback y se colaba. Con dos, no hay familia
  // real que coincida con ambos.
  const ok = Math.abs(wMono - baseMono) > 0.5 || Math.abs(wSerif - baseSerif) > 0.5;
  cacheResolucion.set(limpio, ok);
  return ok;
}

/** Deja pasar solo las familias que el renderer puede pintar. */
export function detectarFamilias(candidatas: string[]): string[] {
  if (typeof document === "undefined") return candidatas;
  const baseMono = medir([`"${BASELINE}", monospace`])[0];
  const baseSerif = medir([`"${BASELINE}", serif`])[0];
  const con = (g: string) => (f: string) => `"${f}", ${g}`;
  const wMono = medir(candidatas.map(con("monospace")));
  const wSerif = medir(candidatas.map(con("serif")));
  return candidatas.filter(
    (_, i) =>
      Math.abs(wMono[i] - baseMono) > 0.5 || Math.abs(wSerif[i] - baseSerif) > 0.5,
  );
}

let cache: Promise<string[]> | null = null;

/** Familias instaladas, ya limpiadas y filtradas. Se cachea por sesión:
 *  el set de fuentes no cambia mientras la app esté abierta. */
export function fuentesDisponibles(): Promise<string[]> {
  if (!cache) {
    cache = (async () => {
      // Esperar a las webfonts ANTES de medir: la app carga Inter, Space
      // Grotesk y JetBrains Mono por @font-face, y si se mide mientras cargan
      // caen al fallback y se marcan como "no instaladas" (falso positivo).
      if (typeof document !== "undefined" && document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {
          // sin soporte: seguimos igual
        }
      }
      const raw = await invoke<string[]>("listar_fuentes_sistema");
      return detectarFamilias(limpiarNombresFuentes(raw ?? []));
    })().catch((err) => {
      console.error("Error listando fuentes del sistema:", err);
      cache = null; // se reintenta la próxima vez
      return [] as string[];
    });
  }
  return cache;
}
