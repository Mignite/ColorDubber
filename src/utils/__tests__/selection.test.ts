import { describe, it, expect } from "vitest";
import { captionRowIndex, filtrarPorMarquee } from "../selection";
import type { Caption, Hablante } from "../../types";

function makeCap(id: string, inicio: number, fin: number, hablante_id: string | null = null): Caption {
  return { id, inicio, fin, texto: "test", hablante_id };
}

const hablantes: Hablante[] = [
  { id: "s1", nombre: "Alice", tecla: "a", color: "#ff0000" },
  { id: "s2", nombre: "Bob", tecla: "b", color: "#00ff00" },
];

describe("captionRowIndex", () => {
  it("maps unassigned captions to row 0", () => {
    expect(captionRowIndex(null, hablantes)).toBe(0);
  });

  it("maps each speaker to its position + 1", () => {
    expect(captionRowIndex("s1", hablantes)).toBe(1);
    expect(captionRowIndex("s2", hablantes)).toBe(2);
  });

  it("falls back to row 0 for unknown speaker", () => {
    expect(captionRowIndex("nope", hablantes)).toBe(0);
  });
});

describe("filtrarPorMarquee", () => {
  it("returns empty for empty captions", () => {
    expect(filtrarPorMarquee([], hablantes, { t1: 0, t2: 10, fila1: 0, fila2: 2 })).toEqual([]);
  });

  it("selects captions intersecting the time range", () => {
    const caps = [
      makeCap("c1", 0, 5, "s1"),
      makeCap("c2", 6, 10, "s1"),
      makeCap("c3", 12, 15, "s1"),
    ];
    const ids = filtrarPorMarquee(caps, hablantes, { t1: 4, t2: 13, fila1: 1, fila2: 1 });
    expect(ids).toEqual(["c1", "c2", "c3"]);
  });

  it("filters by speaker row", () => {
    const caps = [
      makeCap("c1", 0, 5, "s1"),
      makeCap("c2", 1, 3, "s2"),
      makeCap("c3", 2, 4, null),
    ];
    const ids = filtrarPorMarquee(caps, hablantes, { t1: 0, t2: 10, fila1: 2, fila2: 2 });
    expect(ids).toEqual(["c2"]);
  });

  it("normalizes inverted rectangle bounds", () => {
    const caps = [makeCap("c1", 0, 5, "s1")];
    const ids = filtrarPorMarquee(caps, hablantes, { t1: 5, t2: 0, fila1: 1, fila2: 0 });
    expect(ids).toEqual(["c1"]);
  });

  it("requires overlap, not containment", () => {
    const caps = [makeCap("c1", 0, 1, "s1"), makeCap("c2", 10, 12, "s1")];
    const ids = filtrarPorMarquee(caps, hablantes, { t1: 2, t2: 9, fila1: 1, fila2: 1 });
    expect(ids).toEqual([]);
  });
});
