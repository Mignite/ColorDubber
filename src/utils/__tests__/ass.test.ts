import { describe, it, expect } from "vitest";
import {
  hexToAssColor,
  assColorToHex,
  formatAssTime,
  parseAssTime,
  escapeAssText,
  unescapeAssText,
  sanitizeNombreDialogo,
  asignarCarriles,
  calcularMargenesV,
} from "../ass";
import type { Caption, PresetAss } from "../../types";
import { DEFAULT_PRESET_ASS, ASS_FACTOR_ALTO_LINEA } from "../constants";

describe("hexToAssColor", () => {
  it("convierte a BGR invertido con alpha opaco", () => {
    expect(hexToAssColor("#FFFFFF")).toBe("&H00FFFFFF");
    expect(hexToAssColor("#E85D4E")).toBe("&H004E5DE8");
  });

  it("respeta el alpha recibido", () => {
    expect(hexToAssColor("#000000", "80")).toBe("&H80000000");
  });

  it("cae a negro ante hex inválido", () => {
    expect(hexToAssColor("nope")).toBe("&H00000000");
    expect(hexToAssColor("#FFF")).toBe("&H00000000");
  });
});

describe("assColorToHex", () => {
  it("deshace la conversión de hexToAssColor", () => {
    expect(assColorToHex("&H004E5DE8")).toBe("#E85D4E");
    expect(assColorToHex("&H00FFFFFF")).toBe("#FFFFFF");
  });

  it("tolera colores sin alpha y con & final", () => {
    expect(assColorToHex("&H4E5DE8")).toBe("#E85D4E");
    expect(assColorToHex("&H4E5DE8&")).toBe("#E85D4E");
  });

  it("cae a blanco ante basura", () => {
    expect(assColorToHex("rojo")).toBe("#FFFFFF");
  });
});

describe("formatAssTime", () => {
  it("usa centisegundos y no rellena la hora", () => {
    expect(formatAssTime(1.5)).toBe("0:00:01.50");
    expect(formatAssTime(0)).toBe("0:00:00.00");
    expect(formatAssTime(3661.5)).toBe("1:01:01.50");
  });

  it("hace rollover de centisegundos a segundos", () => {
    expect(formatAssTime(59.999)).toBe("0:01:00.00");
    expect(formatAssTime(1.999)).toBe("0:00:02.00");
  });

  it("acota negativos y no-finitos a cero", () => {
    expect(formatAssTime(-1)).toBe("0:00:00.00");
    expect(formatAssTime(NaN)).toBe("0:00:00.00");
  });
});

describe("parseAssTime", () => {
  it("parsea el formato de ASS", () => {
    expect(parseAssTime("0:00:01.50")).toBeCloseTo(1.5, 3);
    expect(parseAssTime("1:01:01.50")).toBeCloseTo(3661.5, 3);
  });

  it("tolera coma como separador", () => {
    expect(parseAssTime("0:00:05,25")).toBeCloseTo(5.25, 3);
  });

  it("devuelve 0 ante basura", () => {
    expect(parseAssTime("")).toBe(0);
    expect(parseAssTime("foo")).toBe(0);
  });
});

describe("escapeAssText / unescapeAssText", () => {
  it("convierte saltos de línea a \\N y vuelve", () => {
    expect(escapeAssText("línea 1\nlínea 2")).toBe("línea 1\\Nlínea 2");
    expect(unescapeAssText("línea 1\\Nlínea 2")).toBe("línea 1\nlínea 2");
  });

  it("escapa llaves para que no se lean como override", () => {
    expect(escapeAssText("{una} cosa")).toBe("\\{una\\} cosa");
    expect(unescapeAssText("\\{una\\} cosa")).toBe("{una} cosa");
  });

  it("quita bloques de override al desescapar", () => {
    expect(unescapeAssText("{\\pos(10,20)}texto")).toBe("texto");
  });

  it("mantiene texto normal intacto", () => {
    expect(unescapeAssText("texto normal")).toBe("texto normal");
  });

  it("sobrevive el round-trip", () => {
    const original = "antes\ndespués {con llaves} y \\ barra";
    expect(unescapeAssText(escapeAssText(original))).toBe(original);
  });
});

describe("sanitizeNombreDialogo", () => {
  it("quita comas: romperían el parseo de la línea Dialogue", () => {
    expect(sanitizeNombreDialogo("Smith, John")).toBe("Smith John");
  });

  it("deja nombres sin comas intactos", () => {
    expect(sanitizeNombreDialogo("Juan")).toBe("Juan");
  });
});

function cap(id: string, inicio: number, fin: number, texto = "x"): Caption {
  return { id, inicio, fin, texto, hablante_id: null };
}

const PRESET: PresetAss = { ...DEFAULT_PRESET_ASS };

describe("asignarCarriles", () => {
  it("pone en carriles distintos lo que se solapa", () => {
    const carriles = asignarCarriles([cap("a", 0, 3), cap("b", 2, 5)]);
    expect(carriles.get("a")).toBe(0);
    expect(carriles.get("b")).toBe(1);
  });

  it("reutiliza el mismo carril cuando no hay solape", () => {
    const carriles = asignarCarriles([cap("a", 0, 3), cap("b", 3, 5)]);
    expect(carriles.get("a")).toBe(0);
    expect(carriles.get("b")).toBe(0);
  });

  it("mete en carriles distintos tres simultáneos", () => {
    const carriles = asignarCarriles([cap("a", 0, 5), cap("b", 1, 6), cap("c", 2, 7)]);
    expect([carriles.get("a"), carriles.get("b"), carriles.get("c")]).toEqual([0, 1, 2]);
  });

  it("ordena por inicio internamente, no confía en el llamador", () => {
    const carriles = asignarCarriles([cap("b", 2, 5), cap("a", 0, 3)]);
    expect(carriles.get("a")).toBe(0);
    expect(carriles.get("b")).toBe(1);
  });
});

describe("calcularMargenesV", () => {
  it("deja todo en marginV cuando no hay solapes", () => {
    const m = calcularMargenesV([cap("a", 0, 3), cap("b", 3, 5)], PRESET, 1920);
    expect(m.get("a")).toBe(PRESET.marginV);
    expect(m.get("b")).toBe(PRESET.marginV);
  });

  it("sube el segundo carril", () => {
    const m = calcularMargenesV([cap("a", 0, 3), cap("b", 2, 5)], PRESET, 1920);
    expect(m.get("b")!).toBeGreaterThan(m.get("a")!);
  });

  it("el offset del carril de arriba usa el alto MÁXIMO de los de abajo", () => {
    // a tiene 3 renglones ("\n" explícito), b solo 1: b debe subir 3, no 1.
    const m = calcularMargenesV(
      [cap("a", 0, 3, "uno\ndos\ntres"), cap("b", 2, 5, "x")],
      PRESET,
      1920,
    );
    const unRenglon = PRESET.fontsize * ASS_FACTOR_ALTO_LINEA;
    expect(m.get("b")! - m.get("a")!).toBe(Math.round(unRenglon * 3));
  });
});
