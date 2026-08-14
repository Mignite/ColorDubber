import { describe, it, expect } from "vitest";
import { findSnapTime, BuildOverlapReport } from "../captions";
import type { Caption, Hablante } from "../../types";

function makeCap(id: string, inicio: number, fin: number, hablante_id: string | null = null): Caption {
  return { id, inicio, fin, texto: "test", hablante_id };
}

const emptyHablantes: Hablante[] = [];

describe("findSnapTime", () => {
  it("returns null when no match within threshold", () => {
    const caps = [makeCap("c1", 0, 5)];
    expect(findSnapTime(10, "c1", caps)).toBeNull();
  });

  it("snaps to nearest caption edge", () => {
    const caps = [makeCap("c1", 0, 5), makeCap("c2", 10, 15)];
    const snap = findSnapTime(10.1, "c1", caps);
    expect(snap).toBe(10);
  });

  it("ignores the excluded caption id", () => {
    const caps = [makeCap("c1", 0, 5), makeCap("c2", 10, 15)];
    const snap = findSnapTime(10.05, "c1", caps);
    expect(snap).toBe(10);
  });
});

describe("BuildOverlapReport", () => {
  it("returns empty for no overlaps", () => {
    const caps = [makeCap("c1", 0, 5, "s1"), makeCap("c2", 6, 10, "s2")];
    const result = BuildOverlapReport(caps, emptyHablantes);
    expect(result).toHaveLength(0);
  });

  it("detects overlap between different speakers", () => {
    const caps = [makeCap("c1", 0, 10, "s1"), makeCap("c2", 3, 7, "s2")];
    const hablantes: Hablante[] = [
      { id: "s1", nombre: "Alice", tecla: "a", color: "#ff0000" },
      { id: "s2", nombre: "Bob", tecla: "b", color: "#00ff00" },
    ];
    const result = BuildOverlapReport(caps, hablantes);
    expect(result).toHaveLength(1);
    expect(result[0].inicio).toBe(3);
    expect(result[0].fin).toBe(7);
  });

  it("ignores overlap for same speaker", () => {
    const caps = [makeCap("c1", 0, 10, "s1"), makeCap("c2", 3, 7, "s1")];
    const result = BuildOverlapReport(caps, emptyHablantes);
    expect(result).toHaveLength(0);
  });
});
