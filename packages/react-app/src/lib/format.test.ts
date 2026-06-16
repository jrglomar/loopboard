// format.ts unit tests — ADR-013 v1.4.1
// Pure function; no mocks needed.

import { describe, it, expect } from "vitest";
import { formatPoints } from "./format";

describe("formatPoints", () => {
  it("renders integers without decimals", () => {
    expect(formatPoints(30)).toBe("30");
    expect(formatPoints(0)).toBe("0");
    expect(formatPoints(100)).toBe("100");
  });

  it("renders one-decimal values without trailing zero", () => {
    expect(formatPoints(13.5)).toBe("13.5");
    expect(formatPoints(1.1)).toBe("1.1");
  });

  it("renders two-decimal values as-is", () => {
    expect(formatPoints(29.75)).toBe("29.75");
    expect(formatPoints(0.25)).toBe("0.25");
  });

  it("truncates beyond 2 decimals (rounds at 3rd decimal)", () => {
    expect(formatPoints(13.333333)).toBe("13.33");
    expect(formatPoints(13.336)).toBe("13.34");
    // Note: 1.005 in IEEE 754 is slightly less than 1.005, so .toFixed(2) → "1.00"
    expect(formatPoints(1.005)).toBe("1");
  });

  it("strips trailing zeros from .toFixed(2) result", () => {
    expect(formatPoints(5.0)).toBe("5");
    expect(formatPoints(5.10)).toBe("5.1");
    expect(formatPoints(5.20)).toBe("5.2");
  });

  it("handles negative numbers (edge case)", () => {
    // Negative point totals shouldn't occur, but the function handles them
    expect(formatPoints(-1.5)).toBe("-1.5");
  });

  it("handles very small fractional points", () => {
    expect(formatPoints(0.5)).toBe("0.5");
    expect(formatPoints(0.1)).toBe("0.1");
  });
});
