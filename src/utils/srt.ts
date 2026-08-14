import type { Caption } from "../types";

export function parseSrtTime(t: string): number {
  const m = t.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  const [, h, min, s, ms] = m;
  return +h * 3600 + +min * 60 + +s + +ms / 1000;
}

export function parseSrt(texto: string): Caption[] {
  const bloques = texto.replace(/\r/g, "").trim().split(/\n\n+/);
  const resultado: Caption[] = [];
  let contador = 1;

  for (const bloque of bloques) {
    const lineas = bloque.split("\n").filter((l) => l.length > 0);
    if (lineas.length < 2) continue;

    const idxTiempo = lineas.findIndex((l) => l.includes("-->"));
    if (idxTiempo === -1) continue;

    const [inicioStr, finStr] = lineas[idxTiempo].split("-->");
    const textoLineas = lineas.slice(idxTiempo + 1);

    resultado.push({
      id: `cap-${contador++}-${Math.random().toString(36).slice(2, 7)}`,
      inicio: parseSrtTime(inicioStr),
      fin: parseSrtTime(finStr),
      texto: textoLineas.join("\n"),
      hablante_id: null,
    });
  }

  return resultado.sort((a, b) => a.inicio - b.inicio);
}

export function formatSrtTimestamp(sec: number): string {
  if (sec < 0) sec = 0;
  let ms = Math.round((sec - Math.floor(sec)) * 1000);
  let h = Math.floor(sec / 3600);
  let m = Math.floor((sec % 3600) / 60);
  let s = Math.floor(sec % 60);
  if (ms >= 1000) {
    ms = 0;
    s += 1;
    if (s >= 60) {
      s = 0;
      m += 1;
      if (m >= 60) {
        m = 0;
        h += 1;
      }
    }
  }
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function buildSrt(caps: Caption[]): string {
  return caps
    .map(
      (c, i) =>
        `${i + 1}\n${formatSrtTimestamp(c.inicio)} --> ${formatSrtTimestamp(c.fin)}\n${c.texto}\n`,
    )
    .join("\n");
}