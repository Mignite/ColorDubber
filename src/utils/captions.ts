import type { Caption, OverlapEntry, Hablante } from "../types";
import { SNAP_THRESHOLD } from "./constants";
import { formatTime } from "./time";
import { t } from "../i18n";

export function BuildOverlapReport(
  caps: Caption[],
  hablantes: Hablante[],
): OverlapEntry[] {
  const nombreDe = (id: string | null) =>
    hablantes.find((h) => h.id === id)?.nombre ||
    hablantes.find((h) => h.id === id)?.tecla ||
    t("overlap.unassigned");

  const ordenados = [...caps].sort((a, b) => a.inicio - b.inicio);
  const resultado: OverlapEntry[] = [];

  for (let i = 0; i < ordenados.length; i++) {
    for (let j = i + 1; j < ordenados.length; j++) {
      const a = ordenados[i];
      const b = ordenados[j];
      if (b.inicio >= a.fin) break;
      if (a.hablante_id === b.hablante_id) continue;
      resultado.push({
        inicio: Math.max(a.inicio, b.inicio),
        fin: Math.min(a.fin, b.fin),
        hablanteA: nombreDe(a.hablante_id),
        textoA: a.texto,
        hablanteB: nombreDe(b.hablante_id),
        textoB: b.texto,
      });
    }
  }
  return resultado;
}

export function FormatOverlapReport(entries: OverlapEntry[]): string {
  if (entries.length === 0) return t("overlap.noOverlaps");
  return entries
    .map(
      (e) =>
        `${formatTime(e.inicio)} \u2192 ${formatTime(e.fin)}  |  ${e.hablanteA} \u2194 ${e.hablanteB}\n  "${e.textoA}"\n  "${e.textoB}"\n`,
    )
    .join("\n");
}

export function findSnapTime(
  time: number,
  excludeIds: string | string[],
  caps: Caption[],
): number | null {
  const exclude =
    typeof excludeIds === "string" ? new Set([excludeIds]) : new Set(excludeIds);
  let best: number | null = null;
  let bestDist = SNAP_THRESHOLD;
  for (const cap of caps) {
    if (exclude.has(cap.id)) continue;
    for (const t of [cap.inicio, cap.fin]) {
      const dist = Math.abs(time - t);
      if (dist < bestDist) {
        bestDist = dist;
        best = t;
      }
    }
  }
  return best;
}