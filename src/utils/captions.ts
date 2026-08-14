import type { Caption, LaneInfo, OverlapEntry, Hablante } from "../types";
import { SNAP_THRESHOLD } from "./constants";
import { formatTime } from "./time";

export function computeCaptionLanes(caps: Caption[]): Map<string, LaneInfo> {
  const result = new Map<string, LaneInfo>();
  if (caps.length === 0) return result;

  const ordenados = [...caps].sort((a, b) => a.inicio - b.inicio);

  function resolverCluster(cluster: Caption[]) {
    const laneEndTimes: number[] = [];
    const laneAsignado = new Map<string, number>();

    for (const cap of cluster) {
      let laneEncontrado = -1;
      for (let i = 0; i < laneEndTimes.length; i++) {
        if (laneEndTimes[i] <= cap.inicio) {
          laneEncontrado = i;
          break;
        }
      }
      if (laneEncontrado === -1) {
        laneEncontrado = laneEndTimes.length;
        laneEndTimes.push(cap.fin);
      } else {
        laneEndTimes[laneEncontrado] = cap.fin;
      }
      laneAsignado.set(cap.id, laneEncontrado);
    }

    const totalLanes = laneEndTimes.length;
    for (const cap of cluster) {
      result.set(cap.id, { lane: laneAsignado.get(cap.id)!, totalLanes });
    }
  }

  let clusterCaps: Caption[] = [];
  let clusterMaxFin = -Infinity;

  for (const cap of ordenados) {
    if (clusterCaps.length === 0 || cap.inicio < clusterMaxFin) {
      clusterCaps.push(cap);
      clusterMaxFin = Math.max(clusterMaxFin, cap.fin);
    } else {
      resolverCluster(clusterCaps);
      clusterCaps = [cap];
      clusterMaxFin = cap.fin;
    }
  }
  resolverCluster(clusterCaps);

  return result;
}

export function BuildOverlapReport(
  caps: Caption[],
  hablantes: Hablante[],
): OverlapEntry[] {
  const nombreDe = (id: string | null) =>
    hablantes.find((h) => h.id === id)?.nombre ||
    hablantes.find((h) => h.id === id)?.tecla ||
    "Sin hablante";

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
  if (entries.length === 0) return "No se encontraron subtítulos solapados.\n";
  return entries
    .map(
      (e) =>
        `${formatTime(e.inicio)} \u2192 ${formatTime(e.fin)}  |  ${e.hablanteA} \u2194 ${e.hablanteB}\n  "${e.textoA}"\n  "${e.textoB}"\n`,
    )
    .join("\n");
}

export function findSnapTime(
  time: number,
  excludeId: string,
  caps: Caption[],
): number | null {
  let best: number | null = null;
  let bestDist = SNAP_THRESHOLD;
  for (const cap of caps) {
    if (cap.id === excludeId) continue;
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