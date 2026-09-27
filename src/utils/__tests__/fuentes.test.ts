import { describe, it, expect } from "vitest";
import { limpiarNombresFuentes } from "../fuentes";

describe("limpiarNombresFuentes", () => {
  it("quita el sufijo de tipo del registro", () => {
    expect(limpiarNombresFuentes(["Arial (TrueType)"])).toEqual(["Arial"]);
    expect(limpiarNombresFuentes(["Consolas Bold Italic (TrueType)"])).toEqual([
      "Consolas Bold Italic",
    ]);
    expect(limpiarNombresFuentes(["Aptos (OpenType)", "Foo (V1.0)"])).toEqual([
      "Aptos",
      "Foo",
    ]);
  });

  it("deduplica y ordena", () => {
    const r = limpiarNombresFuentes([
      "Comic Sans MS (TrueType)",
      "Arial (TrueType)",
      "Arial Bold (TrueType)",
      "Arial (TrueType)",
    ]);
    expect(r).toEqual(["Arial", "Arial Bold", "Comic Sans MS"]);
  });

  it("descarta vacíos y espacios", () => {
    expect(limpiarNombresFuentes(["", "   ", "(TrueType)", " Inter "])).toEqual([
      "Inter",
    ]);
  });

  it("no toca paréntesis que no son el sufijo final", () => {
    expect(limpiarNombresFuentes(["Foo (Bar) (TrueType)"])).toEqual(["Foo (Bar)"]);
  });

  it("devuelve lista vacía si no hay nada", () => {
    expect(limpiarNombresFuentes([])).toEqual([]);
  });
});
