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
  buildAss,
  ASS_STYLE_FORMAT,
  ASS_EVENTS_FORMAT,
} from "../ass";
import type { Caption, PresetAss, Hablante } from "../../types";
import { DEFAULT_PRESET_ASS, ASS_FACTOR_ALTO_LINEA } from "../constants";

const HABLANTES: Hablante[] = [
  { id: "sp1", nombre: "Juan", tecla: "1", color: "#E85D4E" },
  { id: "sp2", nombre: "María", tecla: "2", color: "#4EA8E8" },
];

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

describe("buildAss", () => {
  it("escribe las cabeceras v4.00+ con el PlayRes pedido", () => {
    const out = buildAss([cap("a", 0, 3)], HABLANTES, PRESET, 1280, 720);
    expect(out).toContain("ScriptType: v4.00+");
    expect(out).toContain("PlayResX: 1280");
    expect(out).toContain("PlayResY: 720");
    expect(out).toContain("WrapStyle: 0");
    expect(out).toContain(`Format: ${ASS_STYLE_FORMAT}`);
    expect(out).toContain(`Format: ${ASS_EVENTS_FORMAT}`);
  });

  it("el Format de styles tiene 23 columnas y el de events 10", () => {
    expect(ASS_STYLE_FORMAT.split(",")).toHaveLength(23);
    expect(ASS_EVENTS_FORMAT.split(",")).toHaveLength(10);
  });

  it("numera los estilos por índice del array de hablantes y mete el color de cada uno", () => {
    const out = buildAss([cap("a", 0, 3)], HABLANTES, PRESET, 1920, 1080);
    const styles = out.split("\n").filter((l) => l.startsWith("Style:"));
    expect(styles[0]).toMatch(/^Style: H1,Inter,48,&H004E5DE8,/);
    expect(styles[1]).toMatch(/^Style: H2,Inter,48,&H00E8A84E,/);
  });

  it("emite un Style Default con el color del preset", () => {
    const out = buildAss([cap("a", 0, 3)], HABLANTES, PRESET, 1920, 1080);
    expect(out).toContain("Style: Default,Inter,48,&H00FFFFFF,");
  });

  it("usa el nombre cosmético en la columna Name y el estilo en la columna Style", () => {
    const out = buildAss(
      [{ ...cap("a", 0, 3), hablante_id: "sp2" }],
      HABLANTES,
      PRESET,
      1920,
      1080,
    );
    expect(out).toContain("Dialogue: 0,0:00:00.00,0:00:03.00,H2,María,0,0,40,,x");
  });

  it("los captions sin hablante van al estilo Default", () => {
    const out = buildAss([cap("a", 0, 3)], HABLANTES, PRESET, 1920, 1080);
    expect(out).toContain(",Default,,0,0,40,,x");
  });

  it("cae a tecla o id cuando el hablante no tiene nombre", () => {
    const sinNombre: Hablante[] = [
      { id: "spX", nombre: "", tecla: "7", color: "#FFFFFF" },
    ];
    const out = buildAss(
      [{ ...cap("a", 0, 3), hablante_id: "spX" }],
      sinNombre,
      PRESET,
      1920,
      1080,
    );
    expect(out).toContain(",H1,7,");
  });

  it("ordena los eventos por inicio aunque le lleguen desordenados", () => {
    const out = buildAss(
      [cap("b", 5, 6, "segundo"), cap("a", 1, 2, "primero")],
      HABLANTES,
      PRESET,
      1920,
      1080,
    );
    expect(out.indexOf("primero")).toBeLessThan(out.indexOf("segundo"));
  });

  it("escapa comas del nombre cosmético para no romper el parseo", () => {
    const conComa: Hablante[] = [
      { id: "sp1", nombre: "Smith, John", tecla: "1", color: "#FFFFFF" },
    ];
    const out = buildAss(
      [{ ...cap("a", 0, 3), hablante_id: "sp1" }],
      conComa,
      PRESET,
      1920,
      1080,
    );
    expect(out).toContain(",H1,Smith John,0,0,40,,x");
  });

  it("sin solapes deja todos los MarginV en el del preset", () => {
    const out = buildAss([cap("a", 0, 3), cap("b", 3, 6)], HABLANTES, PRESET, 1920, 1080);
    const margins = out
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:"))
      .map((l) => l.split(",")[7]);
    expect(margins).toEqual(["40", "40"]);
  });

  it("con solapes sube el MarginV del segundo", () => {
    const out = buildAss([cap("a", 0, 3), cap("b", 2, 5)], HABLANTES, PRESET, 1920, 1080);
    const margins = out
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:"))
      .map((l) => +l.split(",")[7]);
    expect(margins[1]).toBeGreaterThan(margins[0]);
  });

  it("los margins del preset se van al Style y no al Dialogue", () => {
    const outro: PresetAss = { ...PRESET, outline: 5, shadow: 3, marginV: 80 };
    const out = buildAss([cap("a", 0, 3)], HABLANTES, outro, 1920, 1080);
    expect(out).toContain(",1,5,3,2,10,10,80,1");
  });
});
