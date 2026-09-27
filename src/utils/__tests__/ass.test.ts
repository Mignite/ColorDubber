import { describe, it, expect } from "vitest";
import {
  hexToAssColor,
  assColorToHex,
  formatAssTime,
  parseAssTime,
  escapeAssText,
  unescapeAssText,
  sanitizeNombreDialogo,
  buildAss,
  segmentarPorSolape,
  fusionarLineas,
  parseAss,
  presetDesdeEstilos,
  ASS_STYLE_FORMAT,
  ASS_EVENTS_FORMAT,
} from "../ass";
import type { Caption, PresetAss, Hablante } from "../../types";
import { DEFAULT_PRESET_ASS } from "../constants";

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

describe("buildAss", () => {
  // Un preset por hablante, como elige el modal. H1=rojo, H2=azul, null=blanco.
  const P_ROJO: PresetAss = { ...DEFAULT_PRESET_ASS, color: "#E85D4E" };
  const P_AZUL: PresetAss = { ...DEFAULT_PRESET_ASS, color: "#4EA8E8" };
  const P_BLANCO: PresetAss = { ...DEFAULT_PRESET_ASS, color: "#FFFFFF" };
  const porHab = (id: string | null): PresetAss =>
    id === "sp1" ? P_ROJO : id === "sp2" ? P_AZUL : P_BLANCO;
  const build = (caps: Caption[]) => buildAss(caps, HABLANTES, porHab, 1920, 1080);

  it("escribe las cabeceras v4.00+ con el PlayRes pedido", () => {
    const out = buildAss([cap("a", 0, 3)], HABLANTES, porHab, 1280, 720);
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

  it("el color sale del preset del hablante, no de su color de paleta", () => {
    const out = build([cap("a", 0, 3)]);
    const styles = out.split("\n").filter((l) => l.startsWith("Style:"));
    // Se compara contra el nombre del preset, no hardcodeado: si el default
    // cambia de fuente el test sigue valiendo.
    expect(styles[0]).toMatch(new RegExp(`^Style: H1,${P_ROJO.fontname},48,&H004E5DE8,`));
    expect(styles[1]).toMatch(new RegExp(`^Style: H2,${P_AZUL.fontname},48,&H00E8A84E,`));
    expect(styles[2]).toMatch(new RegExp(`^Style: Default,${P_BLANCO.fontname},48,&H00FFFFFF,`));
  });

  it("un Style por hablante aunque compartan preset", () => {
    const out = buildAss([cap("a", 0, 3)], HABLANTES, () => P_ROJO, 1920, 1080);
    expect(out).toContain(`Style: H1,${P_ROJO.fontname},48,&H004E5DE8,`);
    expect(out).toContain(`Style: H2,${P_ROJO.fontname},48,&H004E5DE8,`);
  });

  it("usa el nombre cosmético en la columna Name y el estilo en la Style", () => {
    const out = build([{ ...cap("a", 0, 3), hablante_id: "sp2" }]);
    expect(out).toContain("Dialogue: 0,0:00:00.00,0:00:03.00,H2,María,0,0,40,,x");
  });

  it("los captions sin hablante van al estilo Default", () => {
    expect(build([cap("a", 0, 3)])).toContain(",Default,,0,0,40,,x");
  });

  it("cae a tecla o id cuando el hablante no tiene nombre", () => {
    const sinNombre: Hablante[] = [
      { id: "spX", nombre: "", tecla: "7", color: "#FFFFFF" },
    ];
    const out = buildAss(
      [{ ...cap("a", 0, 3), hablante_id: "spX" }],
      sinNombre,
      porHab,
      1920,
      1080,
    );
    expect(out).toContain(",H1,7,");
  });

  it("ordena los eventos por inicio aunque le lleguen desordenados", () => {
    const out = build([cap("b", 5, 6, "segundo"), cap("a", 1, 2, "primero")]);
    expect(out.indexOf("primero")).toBeLessThan(out.indexOf("segundo"));
  });

  it("escapa comas del nombre cosmético para no romper el parseo", () => {
    const conComa: Hablante[] = [
      { id: "sp1", nombre: "Smith, John", tecla: "1", color: "#FFFFFF" },
    ];
    const out = buildAss(
      [{ ...cap("a", 0, 3), hablante_id: "sp1" }],
      conComa,
      porHab,
      1920,
      1080,
    );
    expect(out).toContain(",H1,Smith John,0,0,40,,x");
  });

  it("los margins del preset se van al Style y al MarginV del evento", () => {
    const outro: PresetAss = { ...P_ROJO, outline: 5, shadow: 3, marginV: 80 };
    const out = buildAss([cap("a", 0, 3)], HABLANTES, () => outro, 1920, 1080);
    expect(out).toContain(",1,5,3,2,10,10,80,1");
    expect(out).toContain(",0,0,80,,");
  });

  it("un solo hablante no emite ningun override", () => {
    const out = build([
      { ...cap("a", 0, 3, "hola"), hablante_id: "sp1" },
      { ...cap("b", 1, 2, "otro"), hablante_id: "sp1" },
    ]);
    expect(out).toContain(",H1,Juan,0,0,40,,hola\\N");
  });

  it("fusiona dos hablantes en un evento con override de color", () => {
    const out = build([
      { ...cap("a", 0, 6, "linea de Juan"), hablante_id: "sp1" },
      { ...cap("b", 3, 9, "linea de Maria"), hablante_id: "sp2" },
    ]);
    expect(out).toContain(
      "Dialogue: 0,0:00:03.00,0:00:06.00,H1,Juan,0,0,40,,linea de Juan\\N{\\c&H00E8A84E&}linea de Maria",
    );
  });

  it("emite \\fn y \\fs cuando el preset del segundo cambia la tipografia", () => {
    const cine: PresetAss = { ...P_AZUL, fontname: "Space Grotesk", fontsize: 64 };
    const out = buildAss(
      [
        { ...cap("a", 0, 6, "juan"), hablante_id: "sp1" },
        { ...cap("b", 3, 9, "maria"), hablante_id: "sp2" },
      ],
      HABLANTES,
      (id) => (id === "sp2" ? cine : P_ROJO),
      1920,
      1080,
    );
    expect(out).toContain("juan\\N{\\fnSpace Grotesk\\fs64\\c&H00E8A84E&}maria");
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

describe("segmentarPorSolape", () => {
  it("sin solapes devuelve un segmento por caption", () => {
    const s = segmentarPorSolape([cap("a", 0, 3), cap("b", 5, 8)]);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ inicio: 0, fin: 3 });
    expect(s[0].captions.map((c) => c.id)).toEqual(["a"]);
    expect(s[1].captions.map((c) => c.id)).toEqual(["b"]);
  });

  it("parte en cada instante en que cambia el set de activos", () => {
    // No se puede poner la linea de B antes de que B hable, ni quitarla antes
    // de que termine: el set de activos cambia de verdad en t=2 y en t=5.
    const s = segmentarPorSolape([cap("a", 0, 5), cap("b", 2, 7)]);
    expect(s.map((x) => [x.inicio, x.fin, x.captions.map((c) => c.id)])).toEqual([
      [0, 2, ["a"]],
      [2, 5, ["a", "b"]],
      [5, 7, ["b"]],
    ]);
  });

  it("un caption contenido en otro produce un tramo con las dos lineas", () => {
    const s = segmentarPorSolape([cap("a", 0, 10), cap("b", 3, 5)]);
    expect(s.map((x) => [x.inicio, x.fin, x.captions.map((c) => c.id)])).toEqual([
      [0, 3, ["a"]],
      [3, 5, ["a", "b"]],
      [5, 10, ["a"]],
    ]);
  });

  it("corta cuando el set de activos cambia, sin dejar texto colgando", () => {
    // A=[0,10] B=[5,15] C=[12,20]: A y C NO se solapan. Una agrupacion en
    // cadena daria un solo evento [0,20] con las tres y dejaria el texto de A
    // 10 s despues de que termino.
    const s = segmentarPorSolape([cap("a", 0, 10), cap("b", 5, 15), cap("c", 12, 20)]);
    expect(s.map((x) => [x.inicio, x.fin, x.captions.map((c) => c.id)])).toEqual([
      [0, 5, ["a"]],
      [5, 10, ["a", "b"]],
      [10, 12, ["b"]],
      [12, 15, ["b", "c"]],
      [15, 20, ["c"]],
    ]);
  });

  it("no fusiona captions que solo se tocan", () => {
    const s = segmentarPorSolape([cap("a", 0, 3), cap("b", 3, 6)]);
    expect(s).toHaveLength(2);
  });

  it("ordena las lineas por inicio dentro del segmento", () => {
    const s = segmentarPorSolape([cap("b", 4, 9), cap("a", 0, 6)]);
    const conAmbas = s.find((x) => x.captions.length === 2);
    expect(conAmbas!.captions.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("el mismo hablante solapado produce dos lineas en el tramo comun", () => {
    const s = segmentarPorSolape([
      { ...cap("a", 0, 5), hablante_id: "sp1" },
      { ...cap("b", 2, 7), hablante_id: "sp1" },
    ]);
    const comun = s.find((x) => x.captions.length === 2);
    expect(comun).toBeDefined();
    expect(comun!.inicio).toBe(2);
    expect(comun!.fin).toBe(5);
  });

  it("descarta captions de duracion cero", () => {
    const s = segmentarPorSolape([cap("a", 0, 0), cap("b", 1, 3)]);
    expect(s).toHaveLength(1);
    expect(s[0].captions.map((c) => c.id)).toEqual(["b"]);
  });

  it("aguanta vacio y un solo caption", () => {
    expect(segmentarPorSolape([])).toHaveLength(0);
    expect(segmentarPorSolape([cap("a", 2, 3)])).toHaveLength(1);
  });
});

describe("fusionarLineas", () => {
  const base: PresetAss = { ...DEFAULT_PRESET_ASS, color: "#FFFFFF" };
  const rojo: PresetAss = { ...DEFAULT_PRESET_ASS, color: "#E85D4E" };
  const cine: PresetAss = {
    ...DEFAULT_PRESET_ASS,
    color: "#4EA8E8",
    fontname: "Space Grotesk",
    fontsize: 64,
    outline: 4,
  };

  it("une con \\N y no emite overrides si todas las lineas usan el base", () => {
    const texto = fusionarLineas(
      [cap("a", 0, 3, "uno"), cap("b", 0, 3, "dos")],
      () => base,
      base,
    );
    expect(texto).toBe("uno\\Ndos");
  });

  it("emite \\c solo con el color que cambia", () => {
    const texto = fusionarLineas(
      [cap("a", 0, 3, "uno"), cap("b", 0, 3, "dos")],
      (c) => (c.id === "a" ? base : rojo),
      base,
    );
    expect(texto).toBe("uno\\N{\\c&H004E5DE8&}dos");
  });

  it("emite todos los campos que difieren del base", () => {
    const texto = fusionarLineas(
      [cap("a", 0, 3, "uno"), cap("b", 0, 3, "dos")],
      (c) => (c.id === "a" ? base : cine),
      base,
    );
    expect(texto).toBe(
      "uno\\N{\\fnSpace Grotesk\\fs64\\c&H00E8A84E&\\bord4}dos",
    );
  });

  it("no emite override para la primera linea si usa el base", () => {
    const texto = fusionarLineas(
      [cap("a", 0, 3, "uno"), cap("b", 0, 3, "dos")],
      (c) => (c.id === "b" ? rojo : base),
      base,
    );
    expect(texto.startsWith("uno\\N")).toBe(true);
  });

  it("escapa el texto de cada linea", () => {
    const texto = fusionarLineas(
      [cap("a", 0, 3, "l1\nl2"), cap("b", 0, 3, "{x}")],
      () => base,
      base,
    );
    expect(texto).toBe("l1\\Nl2\\N\\{x\\}");
  });
});
describe("round-trip", () => {
  const P_ROJO: PresetAss = { ...DEFAULT_PRESET_ASS, color: "#E85D4E" };
  const P_AZUL: PresetAss = { ...DEFAULT_PRESET_ASS, color: "#4EA8E8" };
  const porHab = (id: string | null): PresetAss =>
    id === "sp1" ? P_ROJO : id === "sp2" ? P_AZUL : DEFAULT_PRESET_ASS;
  const build = (caps: Caption[], hab: Hablante[] = HABLANTES) =>
    buildAss(caps, hab, porHab, 1920, 1080);

  it("reimportar un .ass exportado devuelve el mismo proyecto", () => {
    const caps: Caption[] = [
      { id: "c1", inicio: 1, fin: 4, texto: "Hola mundo", hablante_id: "sp1" },
      { id: "c2", inicio: 5, fin: 8, texto: "Segunda línea", hablante_id: "sp2" },
      { id: "c3", inicio: 9, fin: 12, texto: "Sin hablante", hablante_id: null },
    ];
    const r = parseAss(build(caps));

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
    const primera = parseAss(build(caps));
    const segunda = parseAss(build(primera.captions, primera.hablantes));
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
    const r = parseAss(build(caps));
    expect(r.hablantes.map((h) => h.id)).toEqual(["H1", "H2"]);
    expect(r.hablantes[0].nombre).toBe("Juan");
    expect(r.hablantes[1].nombre).toBe("María");
  });

  it("un evento fusionado vuelve como un caption con las lineas, sin los overrides", () => {
    // Es la limitacion aceptada: unescapeAssText descarta los bloques {...},
    // asi que el color por linea no sobrevive al round-trip. No es info
    // corrupta, es info que no esta.
    const caps: Caption[] = [
      { id: "c1", inicio: 0, fin: 6, texto: "juan", hablante_id: "sp1" },
      { id: "c2", inicio: 3, fin: 9, texto: "maria", hablante_id: "sp2" },
    ];
    const r = parseAss(build(caps));
    const conDosLineas = r.captions.filter((c) => c.texto.includes("\n"));
    expect(conDosLineas).toHaveLength(1);
    expect(conDosLineas[0].texto).toBe("juan\nmaria");
    expect(conDosLineas[0].texto).not.toContain("{");
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
