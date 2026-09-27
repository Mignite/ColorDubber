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
  parseAss,
  presetDesdeEstilos,
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

// Ojo: dentro del template literal hay que escribir \\{ y no \{, porque en JS
// "\{" es un escape desconocido y el backslash se pierde. Así queda el \{ que
// un escritor de ASS emite de verdad para una llave literal.
const ASS_MUESTRA = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: ${ASS_STYLE_FORMAT}
Style: H1,Inter,48,&H004E5DE8,&H004E5DE8,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,40,1
Style: Default,Inter,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,2,2,10,10,40,1

[Events]
Format: ${ASS_EVENTS_FORMAT}
Dialogue: 0,0:00:01.00,0:00:03.50,H1,Juan,0,0,40,,Hola mundo
Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,40,,Sin hablante
Dialogue: 0,0:00:05.00,0:00:07.00,H1,Juan,0,0,104,,Con \\{llaves\\} y
salto
`;

describe("parseAss", () => {
  it("rechaza ScriptType v4.00 (legacy .ssa)", () => {
    expect(() => parseAss("[Script Info]\nScriptType: v4.00\n")).toThrow();
  });

  it("rechaza un archivo sin Script Info", () => {
    expect(() => parseAss("")).toThrow();
  });

  it("lee los captions con sus tiempos", () => {
    const r = parseAss(ASS_MUESTRA);
    expect(r.captions).toHaveLength(3);
    expect(r.captions[0].inicio).toBeCloseTo(1, 2);
    expect(r.captions[0].fin).toBeCloseTo(3.5, 2);
    expect(r.captions[0].texto).toBe("Hola mundo");
    expect(r.captions[2].texto).toBe("Con {llaves} y\nsalto");
  });

  it("crea un hablante por Style con el nombre de la columna Name", () => {
    const r = parseAss(ASS_MUESTRA);
    expect(r.hablantes).toHaveLength(1);
    expect(r.hablantes[0].id).toBe("H1");
    expect(r.hablantes[0].nombre).toBe("Juan");
    expect(r.hablantes[0].color).toBe("#E85D4E");
  });

  it("el estilo Default no se vuelve hablante: queda en null", () => {
    const r = parseAss(ASS_MUESTRA);
    expect(r.captions[1].hablante_id).toBeNull();
  });

  it("mapea las columnas por nombre del Format, no por posición", () => {
    // Format Y valores intercambiados juntos: un parser posicional leería
    // "Juan" como estilo y "H1" como nombre. Solo uno que siga el Format acierta.
    const raro = ASS_MUESTRA.replace(
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.50,H1,Juan,0,0,40,,Hola mundo",
      "Format: Layer, Start, End, Name, Style, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.50,Juan,H1,0,0,40,,Hola mundo",
    );
    const r = parseAss(raro);
    expect(r.captions[0].hablante_id).toBe("H1");
    expect(r.hablantes[0].nombre).toBe("Juan");
  });

  it("lee un Dialogue de varias líneas (así los escribe Aegisub)", () => {
    const r = parseAss(ASS_MUESTRA);
    expect(r.captions).toHaveLength(3);
    expect(r.captions[2].texto).toBe("Con {llaves} y\nsalto");
  });

  it("no se come un Comment como si fuera continuación", () => {
    const conComment = ASS_MUESTRA.replace(
      "Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,40,,Sin hablante",
      "Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,40,,Sin hablante\nComment: 0,0:00:04.00,0:00:06.00,Default,,0,0,40,,soy un comentario",
    );
    const r = parseAss(conComment);
    expect(r.captions).toHaveLength(3);
    expect(r.captions[1].texto).toBe("Sin hablante");
  });
});

describe("round-trip", () => {
  it("reimportar un .ass exportado devuelve el mismo proyecto", () => {
    const caps: Caption[] = [
      { id: "c1", inicio: 1, fin: 4, texto: "Hola mundo", hablante_id: "sp1" },
      { id: "c2", inicio: 5, fin: 8, texto: "Segunda línea", hablante_id: "sp2" },
      { id: "c3", inicio: 9, fin: 12, texto: "Sin hablante", hablante_id: null },
    ];
    const exportado = buildAss(caps, HABLANTES, PRESET, 1920, 1080);
    const r = parseAss(exportado);

    expect(r.captions.map((c) => c.texto)).toEqual([
      "Hola mundo",
      "Segunda línea",
      "Sin hablante",
    ]);
    expect(r.captions[0].inicio).toBeCloseTo(1, 2);
    expect(r.captions[2].fin).toBeCloseTo(12, 2);
    expect(r.captions.map((c) => c.hablante_id)).toEqual(["H1", "H2", null]);
    expect(r.hablantes.map((h) => h.nombre)).toEqual(["Juan", "María"]);
    expect(r.hablantes.map((h) => h.color)).toEqual(["#E85D4E", "#4EA8E8"]);
  });

  it("re-exportar lo importado es estable (H1 se mantiene)", () => {
    const caps: Caption[] = [
      { id: "c1", inicio: 1, fin: 4, texto: "Hola", hablante_id: "sp1" },
    ];
    const primera = parseAss(buildAss(caps, HABLANTES, PRESET, 1920, 1080));
    const segunda = parseAss(
      buildAss(primera.captions, primera.hablantes, PRESET, 1920, 1080),
    );
    // buildAss emite un Style por cada hablante del array, usado o no, así que
    // el import reconstruye los dos. H2 no tiene eventos: su nombre cae al
    // nombre del estilo.
    expect(segunda.hablantes.map((h) => h.id)).toEqual(["H1", "H2"]);
    expect(segunda.hablantes[0].nombre).toBe("Juan");
    expect(segunda.captions[0].texto).toBe("Hola");
    expect(segunda.captions[0].hablante_id).toBe("H1");
  });

  it("mantiene H1=Juan aunque María hable primero (orden de estilos, no de eventos)", () => {
    const caps: Caption[] = [
      { id: "c1", inicio: 1, fin: 2, texto: "yo soy maría", hablante_id: "sp2" },
      { id: "c2", inicio: 3, fin: 4, texto: "yo soy juan", hablante_id: "sp1" },
    ];
    const r = parseAss(buildAss(caps, HABLANTES, PRESET, 1920, 1080));
    expect(r.hablantes.map((h) => h.id)).toEqual(["H1", "H2"]);
    expect(r.hablantes[0].nombre).toBe("Juan");
    expect(r.hablantes[1].nombre).toBe("María");
  });
});

describe("presetDesdeEstilos", () => {
  it("arma el preset desde el Style Default", () => {
    const r = parseAss(ASS_MUESTRA);
    const p = presetDesdeEstilos(r.styles, "Mi estilo", "preset-x");
    expect(p).not.toBeNull();
    expect(p!.color).toBe("#FFFFFF");
    expect(p!.fontsize).toBe(60);
    expect(p!.outline).toBe(3);
    expect(p!.shadow).toBe(2);
    expect(p!.nombre).toBe("Mi estilo");
  });

  it("devuelve null si el archivo no trae Style Default", () => {
    const sinDefault = ASS_MUESTRA.replace("Style: Default", "Style: Base");
    expect(presetDesdeEstilos(parseAss(sinDefault).styles, "x", "y")).toBeNull();
  });
});
