import { describe, it, expect } from "vitest";
import {
  xlmToStroops,
  stroopsToXlm,
  shortenAddress,
  fundedPercent,
  STROOPS_PER_XLM,
} from "@/lib/units";

describe("units: xlmToStroops", () => {
  it("converts whole XLM to stroops", () => {
    expect(xlmToStroops("1")).toBe(STROOPS_PER_XLM);
    expect(xlmToStroops("10")).toBe(100_000_000n);
  });

  it("handles fractional XLM without floating point drift", () => {
    expect(xlmToStroops("0.5")).toBe(5_000_000n);
    expect(xlmToStroops("1.2345678")).toBe(12_345_678n);
  });

  it("truncates beyond 7 decimal places (stroop precision)", () => {
    expect(xlmToStroops("0.123456789")).toBe(1_234_567n);
  });

  it("treats empty / zero input as zero", () => {
    expect(xlmToStroops("0")).toBe(0n);
    expect(xlmToStroops("")).toBe(0n);
  });
});

describe("units: stroopsToXlm", () => {
  it("is the inverse of xlmToStroops for clean values", () => {
    expect(stroopsToXlm(100_000_000n)).toBe(10);
    expect(stroopsToXlm(5_000_000n)).toBe(0.5);
  });

  it("accepts number and string inputs", () => {
    expect(stroopsToXlm(10_000_000)).toBe(1);
    expect(stroopsToXlm("20000000")).toBe(2);
  });
});

describe("units: shortenAddress", () => {
  it("abbreviates a Stellar address", () => {
    const g = "GBIYZWNE6HGKGGT2G73W6F7ZXXRQ2LP3RGLYIOOTZH6557A3EEBB4S7D";
    expect(shortenAddress(g)).toBe("GBIYZ…BB4S7D".slice(0, 5) + "…" + g.slice(-5));
  });

  it("returns empty string for nullish input", () => {
    expect(shortenAddress(null)).toBe("");
    expect(shortenAddress(undefined)).toBe("");
  });
});

describe("units: fundedPercent", () => {
  it("computes a percentage of the goal", () => {
    expect(fundedPercent(250, 500)).toBe(50);
    expect(fundedPercent(125, 500)).toBe(25);
  });

  it("clamps at 100% when over-funded", () => {
    expect(fundedPercent(750, 500)).toBe(100);
  });

  it("guards against a zero / invalid goal", () => {
    expect(fundedPercent(100, 0)).toBe(0);
    expect(fundedPercent(100, -5)).toBe(0);
  });
});
