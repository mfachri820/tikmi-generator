import { describe, expect, it } from "vitest";
import { scoringConfig2026, parameterShareRefs } from "./2026";

describe("2026 scoring config", () => {
  it("has the 35 A2 parameter rows the build plan lists", () => {
    expect(scoringConfig2026.parameters).toHaveLength(35);
  });

  it("has a share-ref mapping for every form parameter", () => {
    const formParams = scoringConfig2026.parameters.filter((p) => p.kind === "form");
    for (const p of formParams) {
      expect(parameterShareRefs[p.id], `parameter ${p.id}`).toBeDefined();
    }
  });

  it("has exactly the 7 manual (no-form-data) parameters the build plan lists", () => {
    const manualIds = scoringConfig2026.parameters.filter((p) => p.kind === "manual").map((p) => p.id);
    expect(manualIds.sort((a, b) => Number(a) - Number(b))).toEqual([
      "26",
      "31",
      "32",
      "39",
      "42",
      "51",
      "55",
    ]);
  });

  it("has 31 KPMR questions across 5 pillars", () => {
    expect(scoringConfig2026.kpmrQuestions).toHaveLength(31);
    expect(new Set(scoringConfig2026.kpmrQuestions.map((q) => q.pillar)).size).toBe(5);
  });

  it("has a 5x5 final IRA matrix", () => {
    expect(scoringConfig2026.finalIraMatrix).toHaveLength(25);
  });
});
