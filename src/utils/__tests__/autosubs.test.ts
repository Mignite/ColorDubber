import { describe, expect, it } from "vitest";
import {
  asignarHablantesPorTexto,
  hablantesDesdeNombres,
  normalizarTexto,
  parseAutosubsTxt,
} from "../autosubs";
import type { Caption } from "../../types";

function cue(inicio: number, fin: number, texto: string): Caption {
  return { id: "x", inicio, fin, texto, hablante_id: null };
}

describe("parseAutosubsTxt", () => {
  it("extrae turnos Speaker N con su texto", () => {
    const turnos = parseAutosubsTxt(
      "Speaker 1:\nHola mundo.\n\nSpeaker 2:\nAdiós.\n",
    );
    expect(turnos).toEqual([
      { speaker: "1", texto: "Hola mundo." },
      { speaker: "2", texto: "Adiós." },
    ]);
  });

  it("texto vacío no da turnos", () => {
    expect(parseAutosubsTxt("")).toEqual([]);
  });
});

describe("normalizarTexto", () => {
  it("minúsculas, sin tildes ni puntuación, espacios simples", () => {
    expect(normalizarTexto("¡Adiós,  MUY bueno!")).toBe("adios muy bueno");
  });
});

describe("asignarHablantesPorTexto", () => {
  it("asigna por orden secuencial de turnos", () => {
    const cues = [cue(0, 1, "Hola"), cue(1, 2, "Adiós"), cue(2, 3, "Hola otra vez")];
    const turnos = [
      { speaker: "1", texto: "Hola" },
      { speaker: "2", texto: "Adiós. Hola otra vez" },
    ];
    expect(asignarHablantesPorTexto(cues, turnos)).toEqual(["1", "2", "2"]);
  });

  it("tolera tildes y puntuación distinta entre SRT y TXT", () => {
    const cues = [cue(0, 1, "¡Adios, muy bueno!")];
    const turnos = [{ speaker: "3", texto: "Adiós; muy bueno" }];
    expect(asignarHablantesPorTexto(cues, turnos)).toEqual(["3"]);
  });

  it("cue sin match queda null", () => {
    const cues = [cue(0, 1, "zzz inexistente")];
    const turnos = [{ speaker: "1", texto: "Hola" }];
    expect(asignarHablantesPorTexto(cues, turnos)).toEqual([null]);
  });

  it("sin turnos todo queda null", () => {
    expect(asignarHablantesPorTexto([cue(0, 1, "Hola")], [])).toEqual([null]);
  });
});

describe("hablantesDesdeNombres", () => {
  it("convención de la app: nombre, tecla dígito, color PALETA", () => {
    const hs = hablantesDesdeNombres(["1", "2"]);
    expect(hs.map((h) => h.nombre)).toEqual(["Hablante 1", "Hablante 2"]);
    expect(hs.map((h) => h.tecla)).toEqual(["1", "2"]);
    expect(hs[0].color).toBe("#E85D4E");
    expect(hs[0].id).toMatch(/^sp-autosubs-/);
  });
});
