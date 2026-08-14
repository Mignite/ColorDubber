import { describe, it, expect } from "vitest";
import { computeCaptionLanes, findSnapTime, BuildOverlapReport } from "../captions";
import type { Caption, Hablante } from "../../types";

function makeCap(id: string, inicio: number, fin: number, hablante_id: string | null = null): Caption {
  return { id, inicio, fin, texto: "test", hablante_id };
}

const emptyHablantes: Hablante[] = [];

describe("computeCaptionLanes", () => {
  it("returns empty map for empty input", () => {
    const result = computeCaptionLanes([]);
    expect(result.size).toBe(0);
  });

  it("assigns lane 0 to a single caption", () => {
    const caps = [makeCap("c1", 0, 5)];
    const result = computeCaptionLanes(caps);
    expect(result.get("c1")).toEqual({ lane: 0, totalLanes: 1 });
  });

  it("assigns same lane to non-overlapping captions", () => {
    const caps = [makeCap("c1", 0, 2), makeCap("c2", 3, 5)];
    const result = computeCaptionLanes(caps);
    expect(result.get("c1")?.lane).toBe(0);
    expect(result.get("c2")?.lane).toBe(0);
  });

  it("assigns different lanes to overlapping captions", () => {
    const caps = [makeCap("c1", 0, 5), makeCap("c2", 2, 7)];
    const result = computeCaptionLanes(caps);
    expect(result.get("c1")?.lane).not.toBe(result.get("c2")?.lane);
    expect(result.get("c1")?.totalLanes).toBe(2);
    expect(result.get("c2")?.totalLanes).toBe(2);
  });

  it("handles three overlapping captions", () => {
    const caps = [
      makeCap("c1", 0, 10),
      makeCap("c2", 2, 8),
      makeCap("c3", 4, 6),
    ];
    const result = computeCaptionLanes(caps);
    expect(result.get("c1")?.totalLanes).toBe(3);
    expect(result.get("c2")?.totalLanes).toBe(3);
    expect(result.get("c3")?.totalLanes).toBe(3);
  });

  it("reuses lanes after caption ends", () => {
    const caps = [
      makeCap("c1", 0, 3),
      makeCap("c2", 2, 5),
      makeCap("c3", 4, 7),
    ];
    const result = computeCaptionLanes(caps);
    expect(result.get("c1")?.lane).toBe(0);
    expect(result.get("c2")?.lane).toBe(1);
    expect(result.get("c3")?.lane).toBe(0);
  });
});

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
