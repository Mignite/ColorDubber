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

/** Deja pasar solo las familias que el renderer realmente puede pintar.
 *  Mide el texto con la familia candidata y compara contra el fallback.
 *
 *  Hace falta comparar contra DOS genéricos, no uno: Consolas (instalada en
 *  cualquier Windows) ES la monospace por defecto, así que midiendo solo
 *  contra `monospace` sus métricas dan idénticas al fallback y se cuela. Con
 *  serif + monospace no hay forma de que una familia real coincida con
 *  ambos. Medido: con un solo genérico, Consolas desaparecía de la lista.
 */
export function detectarFamilias(candidatas: string[]): string[] {
  if (typeof document === "undefined") return candidatas;
  const BASELINE = "cdub-fuente-que-no-existe-zzz";
  const caja = document.createElement("div");
  caja.style.cssText =
    "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font-size:48px;line-height:normal;";
  // Imprescindible: fuera del document el div no tiene layout y TODAS las
  // medidas dan 0, con lo cual |0-0| = 0 y se cuela todo. Medido: sin esta
  // línea la función devolvía [] siempre.
  document.body.appendChild(caja);

  const medir = (fontFamilies: string[]): number[] => {
    const spans = fontFamilies.map((ff) => {
      const span = document.createElement("span");
      span.style.fontFamily = ff;
      span.style.whiteSpace = "nowrap";
      span.textContent = MUESTRA;
      caja.appendChild(span);
      return span;
    });
    const out = spans.map((s) => s.getBoundingClientRect().width);
    for (const s of spans) s.remove();
    return out;
  };

  const con = (generico: string) => (f: string) => `"${f}", ${generico}`;
  const baseMono = medir([`"${BASELINE}", monospace`])[0];
  const baseSerif = medir([`"${BASELINE}", serif`])[0];
  // Dos pasadas: cada genérico solo, así cada familia candidata se mide una vez.
  const wMono = medir(candidatas.map(con("monospace")));
  const wSerif = medir(candidatas.map(con("serif")));
  caja.remove();

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
