import { describe, it, expect } from "vitest";
import { parseSrt, buildSrt, parseSrtTime, formatSrtTimestamp } from "../srt";

describe("parseSrtTime", () => {
  it("parses standard timestamp", () => {
    expect(parseSrtTime("00:01:30,500")).toBeCloseTo(90.5, 3);
  });

  it("parses with dot separator", () => {
    expect(parseSrtTime("00:00:05.250")).toBeCloseTo(5.25, 3);
  });

  it("returns 0 for invalid input", () => {
    expect(parseSrtTime("")).toBe(0);
    expect(parseSrtTime("foo")).toBe(0);
  });

  it("handles leading zeros", () => {
    expect(parseSrtTime("01:02:03,004")).toBeCloseTo(3723.004, 3);
  });
});

describe("formatSrtTimestamp", () => {
  it("formats time correctly", () => {
    expect(formatSrtTimestamp(90.5)).toBe("00:01:30,500");
  });

  it("handles negative values", () => {
    expect(formatSrtTimestamp(-1)).toBe("00:00:00,000");
  });

  it("formats hours correctly", () => {
    expect(formatSrtTimestamp(3661.001)).toBe("01:01:01,001");
  });

  it("rolls over milliseconds that would round to 1000", () => {
    expect(formatSrtTimestamp(1.9995)).toBe("00:00:02,000");
    expect(formatSrtTimestamp(59.9996)).toBe("00:01:00,000");
    expect(formatSrtTimestamp(1.999)).toBe("00:00:01,999");
  });
});

describe("parseSrt", () => {
  const sample = `1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:05,000 --> 00:00:08,500
This is a test
With two lines`;

  it("parses basic SRT content", () => {
    const result = parseSrt(sample);
    expect(result).toHaveLength(2);
    expect(result[0].inicio).toBeCloseTo(1, 3);
    expect(result[0].fin).toBeCloseTo(4, 3);
    expect(result[0].texto).toBe("Hello world");
    expect(result[1].inicio).toBeCloseTo(5, 3);
    expect(result[1].fin).toBeCloseTo(8.5, 3);
    expect(result[1].texto).toBe("This is a test\nWith two lines");
  });

  it("returns empty array for empty input", () => {
    expect(parseSrt("")).toHaveLength(0);
    expect(parseSrt("  ")).toHaveLength(0);
  });

  it("assigns unique ids", () => {
    const result = parseSrt(sample);
    expect(result[0].id).toMatch(/^cap-/);
    expect(result[1].id).toMatch(/^cap-/);
    expect(result[0].id).not.toBe(result[1].id);
  });

  it("sorts by start time", () => {
    const unsorted = `1
00:00:05,000 --> 00:00:06,000
Second

2
00:00:01,000 --> 00:00:02,000
First`;
    const result = parseSrt(unsorted);
    expect(result[0].texto).toBe("First");
    expect(result[1].texto).toBe("Second");
  });
});

describe("buildSrt", () => {
  const captions = [
    { id: "c1", inicio: 1, fin: 4, texto: "Hello world", hablante_id: null },
    { id: "c2", inicio: 5, fin: 8.5, texto: "Line 1\nLine 2", hablante_id: null },
  ];

  it("builds valid SRT format", () => {
    const result = buildSrt(captions);
    expect(result).toContain("00:00:01,000 --> 00:00:04,000");
    expect(result).toContain("Hello world");
    expect(result).toContain("00:00:05,000 --> 00:00:08,500");
    expect(result).toContain("Line 1\nLine 2");
  });

  it("numbers sequences starting from 1", () => {
    const result = buildSrt(captions);
    expect(result).toMatch(/^1\n/);
  });
});

describe("round-trip", () => {
  it("preserves content through parse and build", () => {
    const input = `1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:05,000 --> 00:00:08,500
This is a test`;
    const parsed = parseSrt(input);
    const rebuilt = buildSrt(parsed);
    const reparsed = parseSrt(rebuilt);
    expect(reparsed).toHaveLength(2);
    expect(reparsed[0].inicio).toBeCloseTo(1, 2);
    expect(reparsed[0].fin).toBeCloseTo(4, 2);
    expect(reparsed[0].texto).toBe("Hello world");
    expect(reparsed[1].inicio).toBeCloseTo(5, 2);
    expect(reparsed[1].fin).toBeCloseTo(8.5, 2);
    expect(reparsed[1].texto).toBe("This is a test");
  });
});
