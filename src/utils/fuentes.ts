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

const INEXISTENTE = "cdub-fuente-que-no-existe-zzz";
const MUESTRA = "abcdefghijklmnopqrstuvwxyz 0123456789 WMWiIlj";

/** Deja pasar solo las familias que el renderer realmente puede pintar.
 *  Mide el ancho de un texto con la familia candidata contra el fallback
 *  (monospace): si cambia, la familia existe.
 *
 *  ponytail: una fuente cuyas métricas coincidan exactamente con monospace
 *  se descarta por falso negativo. El input sigue siendo texto libre, así que
 *  igual se puede escribir a mano.
 */
export function detectarFamilias(candidatas: string[]): string[] {
  if (typeof document === "undefined") return candidatas;
  const caja = document.createElement("div");
  caja.style.cssText =
    "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font-size:48px;line-height:normal;";
  const ancho = (familia: string): number => {
    const span = document.createElement("span");
    span.style.fontFamily = `"${familia}", monospace`;
    span.textContent = MUESTRA;
    caja.appendChild(span);
    return span.getBoundingClientRect().width;
  };

  // Un solo paso de layout para todas: se miden midiendo, no una por vez.
  const base = ancho(INEXISTENTE);
  const spans = candidatas.map((familia) => {
    const span = document.createElement("span");
    span.style.fontFamily = `"${familia}", monospace`;
    span.textContent = MUESTRA;
    caja.appendChild(span);
    return span;
  });
  const anchos = spans.map((s) => s.getBoundingClientRect().width);
  caja.remove();

  return candidatas.filter((_, i) => Math.abs(anchos[i] - base) > 0.5);
}

let cache: Promise<string[]> | null = null;

/** Familias instaladas, ya limpiadas y filtradas. Se cachea por sesión:
 *  el set de fuentes no cambia mientras la app esté abierta. */
export function fuentesDisponibles(): Promise<string[]> {
  if (!cache) {
    cache = invoke<string[]>("listar_fuentes_sistema")
      .then((raw) => {
        const limpias = limpiarNombresFuentes(raw ?? []);
        return detectarFamilias(limpias);
      })
      .catch((err) => {
        console.error("Error listando fuentes del sistema:", err);
        cache = null; // se reintenta la próxima vez
        return [] as string[];
      });
  }
  return cache;
}
