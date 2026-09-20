import { PALETA } from "./constants";
import type { Caption, Hablante } from "../types";

export interface TurnoAutosubs {
  speaker: string;
  texto: string;
}

// Turnos "Speaker N:" del TXT de auto-subs (solo trae hora de inicio por
// turno, sin fin: el alineamiento con los cues es por TEXTO, no por tiempo).
export function parseAutosubsTxt(contenido: string): TurnoAutosubs[] {
  const turnos: TurnoAutosubs[] = [];
  const re = /Speaker (\d+):\n(.+?)(?=\nSpeaker \d+:|\s*$)/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(contenido)) !== null) {
    turnos.push({ speaker: m[1], texto: m[2].trim() });
  }
  return turnos;
}

// Minúsculas, sin tildes ni puntuación: SRT y TXT puntúan distinto el mismo
// diálogo ("¡Adiós, muy bueno!" vs "Adiós; muy bueno").
export function normalizarTexto(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Cada cue hereda el speaker del turno cuyo texto lo contiene. Búsqueda
// SECUENCIAL desde el último match: ambos archivos salen del mismo transcript
// en orden, así que un cue nunca pertenece a un turno anterior al ya asignado.
export function asignarHablantesPorTexto(
  cues: Caption[],
  turnos: TurnoAutosubs[],
): (string | null)[] {
  const normales = turnos.map((t) => normalizarTexto(t.texto));
  let pos = 0;
  return cues.map((c) => {
    const nc = normalizarTexto(c.texto);
    if (!nc) return null;
    let hit = -1;
    for (let i = pos; i < normales.length; i++) {
      if (normales[i].includes(nc)) {
        hit = i;
        break;
      }
    }
    if (hit === -1) {
      for (let i = 0; i < normales.length; i++) {
        if (normales[i].includes(nc)) {
          hit = i;
          break;
        }
      }
    }
    if (hit === -1) return null;
    pos = hit + 1;
    return turnos[hit].speaker;
  });
}

// Hablantes con la convención de la app (ver import de transcripción y
// agregarHablante en App.tsx): nombre "Hablante N", tecla dígito, PALETA.
export function hablantesDesdeNombres(numeros: string[]): Hablante[] {
  const base = Date.now();
  return numeros.map((n, i) => ({
    id: `sp-autosubs-${base}-${i}`,
    nombre: `Hablante ${n}`,
    tecla: String((i % 9) + 1),
    color: PALETA[i % PALETA.length],
  }));
}
