import { describe, expect, it } from "vitest";
import { computeC2Derived } from "./2026-c2";

describe("computeC2Derived", () => {
  it("derives a share as numerator / group denominator", () => {
    const raw = { C22: 30, C23: 70, C24: 0 };
    const derived = computeC2Derived(raw);
    expect(derived.D22).toBeCloseTo(0.3);
    expect(derived.D23).toBeCloseTo(0.7);
    expect(derived.D24).toBe(0);
  });

  it("returns 0 rather than dividing by zero when a group's denominator is empty", () => {
    const derived = computeC2Derived({});
    expect(derived.D22).toBe(0);
    expect(derived.D6).toBe(0);
  });

  it("excludes the two 'Tidak Berbadan Hukum' rows from the business-entity denominator (template quirk)", () => {
    const raw = { C62: 10, C72: 5, C73: 5 };
    const derived = computeC2Derived(raw);
    // denominator = C62..C70 only = 10, so C72/C73 (excluded from the sum) still get a share against it
    expect(derived.D62).toBeCloseTo(1);
    expect(derived.D72).toBeCloseTo(0.5);
    expect(derived.D73).toBeCloseTo(0.5);
  });

  it("computes the self-reported transaction total as SUM(C6:C17)", () => {
    const raw = { C6: 100, C7: 200 };
    const derived = computeC2Derived(raw);
    expect(derived.C18).toBe(300);
  });

  it("shares the transaction total across product rows plus the FATF/UN exposure rows", () => {
    const raw = { C6: 100, C120: 10, C121: 5, C123: 2 };
    const derived = computeC2Derived(raw);
    expect(derived.D6).toBeCloseTo(1);
    expect(derived.D120).toBeCloseTo(0.1);
    expect(derived.D121).toBeCloseTo(0.05);
    expect(derived.D123).toBeCloseTo(0.02);
  });
});
