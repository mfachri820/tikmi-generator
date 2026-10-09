import { describe, expect, it } from "vitest";
import { buildScoringConfig2026, defaultWeights2026, parameterShareRefs, scoringConfig2026, weightProblems, withDefaultWeights } from "./2026";

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

  it("TPPT Pengguna Jasa (rows 29-32) uses the BSSS weights 35/15/35/15, adding up to the item's full 30%", () => {
    const weightOf = (id: string) => scoringConfig2026.parameters.find((p) => p.id === id)!.weight;
    expect(weightOf("30")).toBeCloseTo(0.3 * 0.15);
    expect(weightOf("32")).toBeCloseTo(0.3 * 0.15);
    expect(["29", "30", "31", "32"].reduce((s, id) => s + weightOf(id), 0)).toBeCloseTo(0.3);
  });

  it("default weight set rebuilds exactly today's scoring config", () => {
    const built = buildScoringConfig2026(defaultWeights2026);
    expect(built.categoryWeights).toEqual(scoringConfig2026.categoryWeights);
    expect(built.kpmrPillarWeights).toEqual(scoringConfig2026.kpmrPillarWeights);
    for (const p of scoringConfig2026.parameters) {
      expect(built.parameters.find((b) => b.id === p.id)!.weight, `parameter ${p.id}`).toBeCloseTo(p.weight, 9);
    }
    expect(weightProblems(defaultWeights2026)).toEqual([]);
  });

  it("flags every weight group that doesn't add up to 100%", () => {
    const broken = withDefaultWeights({ categories: { ...defaultWeights2026.categories, TPPU: 0.5 }, kpmrPillars: { ...defaultWeights2026.kpmrPillars } });
    broken.leaves = { ...broken.leaves, "7": 0.7 };
    expect(weightProblems(broken).map((p) => p.group)).toEqual(["Kategori risiko", "Parameter baris 6"]);
  });

  it("weights every KPMR pillar, and the weights add up to 100%", () => {
    const pillars = new Set(scoringConfig2026.kpmrQuestions.map((q) => q.pillar));
    const weights = scoringConfig2026.kpmrPillarWeights!;
    expect(new Set(Object.keys(weights))).toEqual(pillars);
    expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});
