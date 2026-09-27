import { describe, it, expect } from "vitest";
import { presetsDesdeJson, presetsAJson, nuevoPreset } from "../assPresets";
import { DEFAULT_PRESET_ASS } from "../constants";
import type { PresetAss } from "../../types";

const P1: PresetAss = { ...DEFAULT_PRESET_ASS, id: "p1", nombre: "Blanco" };

describe("presetsDesdeJson", () => {
  it("siembra el preset por defecto cuando no hay archivo", () => {
    const r = presetsDesdeJson(null);
    expect(r).toHaveLength(1);
    expect(r[0].nombre).toBe("Default");
    expect(r[0].color).toBe("#FFFFFF");
    expect(r[0].shadow).toBe(1);
  });

  it("siembra el default si el JSON está corrupto", () => {
    expect(presetsDesdeJson("{no es json")).toHaveLength(1);
  });

  it("siembra el default si la lista está vacía o no es array", () => {
    expect(presetsDesdeJson('{"presets":[]}')).toHaveLength(1);
    expect(presetsDesdeJson('{"presets":"nope"}')).toHaveLength(1);
  });

  it("descarta entradas con campos faltantes o tipos raros", () => {
    const json = JSON.stringify({
      presets: [
        P1,
        { id: "roto", nombre: "Sin números" },
        {
          nombre: "Sin id",
          fontname: "X",
          fontsize: "grande",
          color: "#fff",
          outlineColor: "#000",
          outline: 1,
          shadow: 1,
          alignment: 2,
          marginL: 1,
          marginR: 1,
          marginV: 1,
        },
      ],
    });
    const r = presetsDesdeJson(json);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("p1");
  });

  it("lee una lista válida", () => {
    const r = presetsDesdeJson(JSON.stringify({ presets: [P1, { ...P1, id: "p2" }] }));
    expect(r.map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});

describe("presetsAJson", () => {
  it("sobrevive el round-trip por JSON", () => {
    const lista = [P1, { ...P1, id: "p2", nombre: "Con sombra", shadow: 4 }];
    const r = presetsDesdeJson(presetsAJson(lista));
    expect(r).toEqual(lista);
  });
});

describe("nuevoPreset", () => {
  it("parte del default con id y nombre nuevos", () => {
    const p = nuevoPreset();
    expect(p.id).not.toBe(DEFAULT_PRESET_ASS.id);
    expect(p.fontsize).toBe(DEFAULT_PRESET_ASS.fontsize);
  });

  it("acepta overrides parciales", () => {
    const p = nuevoPreset({ nombre: "Cine", fontsize: 64, alignment: 8 });
    expect(p.nombre).toBe("Cine");
    expect(p.fontsize).toBe(64);
    expect(p.alignment).toBe(8);
  });

  it("genera ids distintos en dos llamadas seguidas", () => {
    expect(nuevoPreset().id).not.toBe(nuevoPreset().id);
  });
});
