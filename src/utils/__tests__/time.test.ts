import { describe, it, expect } from "vitest";
import { parseTimeInput, formatTime } from "../time";

describe("parseTimeInput", () => {
  it("returns null for empty string", () => {
    expect(parseTimeInput("")).toBeNull();
    expect(parseTimeInput("   ")).toBeNull();
  });

  it("parses single number as seconds", () => {
    expect(parseTimeInput("90")).toBe(90);
    expect(parseTimeInput("90.5")).toBe(90.5);
  });

  it("parses MM:SS format", () => {
    expect(parseTimeInput("01:30")).toBe(90);
    expect(parseTimeInput("1:30.5")).toBe(90.5);
  });

  it("parses HH:MM:SS format", () => {
    expect(parseTimeInput("00:01:30")).toBe(90);
    expect(parseTimeInput("01:01:01")).toBe(3661);
    expect(parseTimeInput("01:01:01.001")).toBe(3661.001);
  });

  it("returns null for invalid input", () => {
    expect(parseTimeInput("abc")).toBeNull();
    expect(parseTimeInput("01:")).toBeNull();
    expect(parseTimeInput(":01")).toBeNull();
    expect(parseTimeInput("01:02:03:04")).toBeNull();
  });

  it("roundtrips with formatTime", () => {
    const seconds = [0, 1.5, 90.5, 3661.001];
    for (const s of seconds) {
      const formatted = formatTime(s);
      const parsed = parseTimeInput(formatted);
      expect(parsed).toBeCloseTo(s, 2);
    }
  });

  it("does not misinterpret 1.5 minutes as 15 minutes (regression)", () => {
    expect(parseTimeInput("1.5")).toBe(1.5);
    expect(parseTimeInput("00:01:30.50")).toBe(90.5);
  });
});
