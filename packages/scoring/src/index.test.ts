import { describe, expect, it } from "vitest";
import { computeWorkbookScores } from "./index";
import type { ScoringConfig } from "./types";

/**
 * Synthetic config with two categories, one form parameter and one manual
 * parameter each. Numbers here are made up for the test only -- see ground
 * rules in the build plan: no 2026 weights/thresholds belong in this repo.
 */
const config: ScoringConfig = {
  categoryWeights: { CatA: 0.6, CatB: 0.4 },
  parameters: [
    {
      kind: "form",
      id: "p1",
      category: "CatA",
      weight: 1,
      cellRef: "Sheet!O1",
      label: "Test parameter",
      rule: {
        kind: "maxShare",
        thresholds: [
          { maxShare: 0.2, score: 5 },
          { maxShare: 0.4, score: 4 },
          { maxShare: 0.6, score: 3 },
          { maxShare: 0.8, score: 2 },
          { maxShare: 1, score: 1 },
        ],
      },
    },
    {
      kind: "manual",
      id: "p2",
      category: "CatB",
      weight: 1,
      cellRef: "Sheet!O2",
      defaultScore: 5,
      label: "Test manual parameter",
    },
  ],
  kpmrQuestions: [
    { id: "k1", pillar: "Pillar1", cellRef: "B!H1", pengawasCellRef: "B!J1" },
    { id: "k2", pillar: "Pillar2", cellRef: "B!H2", pengawasCellRef: "B!J2" },
  ],
  inherentPredikatRules: [
    { label: "Rendah", minScore: 4 },
    { label: "Sedang", minScore: 2 },
    { label: "Tinggi", minScore: 0 },
  ],
  kpmrPredikatRules: [
    { label: "Kuat", minScore: 4 },
    { label: "Cukup", minScore: 2 },
    { label: "Lemah", minScore: 0 },
  ],
  finalIraMatrix: [
    { inherentPredikat: "Rendah", kpmrPredikat: "Kuat", score: 5 },
    { inherentPredikat: "Rendah", kpmrPredikat: "Cukup", score: 4 },
    { inherentPredikat: "Sedang", kpmrPredikat: "Kuat", score: 4 },
    { inherentPredikat: "Sedang", kpmrPredikat: "Cukup", score: 3 },
    { inherentPredikat: "Tinggi", kpmrPredikat: "Lemah", score: 1 },
  ],
  dataMismatchPenalty: 1,
};

describe("computeWorkbookScores", () => {
  it("scores a low-share, high-default-risk workbook with no overrides", () => {
    const result = computeWorkbookScores(config, {
      parameters: [{ id: "p1", share: 0.1 }],
      kpmrAnswers: [
        { id: "k1", pjpScore: 5 },
        { id: "k2", pjpScore: 5 },
      ],
      hasDataMismatch: false,
    });

    expect(result.inherentScore.pjp).toBeCloseTo(0.6 * 5 + 0.4 * 5);
    expect(result.inherentPredikat.pjp).toBe("Rendah");
    expect(result.kpmrOverall.pjp).toBe(5);
    expect(result.kpmrPredikat.pjp).toBe("Kuat");
    expect(result.finalIra.pjp).toBe(5);
    expect(result.finalIra.pengawasRaw).toBe(5);
    expect(result.finalIra.pengawasAdjusted).toBe(5);
  });

  it("lets a pengawas override diverge from the PJP-derived score", () => {
    const result = computeWorkbookScores(config, {
      parameters: [{ id: "p1", share: 0.1, pengawasScore: 1 }],
      kpmrAnswers: [
        { id: "k1", pjpScore: 5, pengawasScore: 1 },
        { id: "k2", pjpScore: 5 },
      ],
      hasDataMismatch: false,
    });

    const p1 = result.parameters.find((p) => p.id === "p1")!;
    expect(p1.pjpValue).toBe(5);
    expect(p1.pengawasValue).toBe(1);
    expect(p1.isOverride).toBe(true);
    expect(result.inherentScore.pjp).not.toBe(result.inherentScore.pengawas);
  });

  it("subtracts the data-mismatch penalty from the pengawas final IRA only, floored at 1", () => {
    const result = computeWorkbookScores(config, {
      parameters: [{ id: "p1", share: 0.1 }],
      kpmrAnswers: [
        { id: "k1", pjpScore: 5 },
        { id: "k2", pjpScore: 5 },
      ],
      hasDataMismatch: true,
    });

    expect(result.finalIra.pjp).toBe(5);
    expect(result.finalIra.pengawasRaw).toBe(5);
    expect(result.finalIra.pengawasAdjusted).toBe(4);
  });

  it("treats an unanswered (n/a) KPMR question as excluded from its pillar average", () => {
    const result = computeWorkbookScores(config, {
      parameters: [{ id: "p1", share: 0.1 }],
      kpmrAnswers: [{ id: "k1", pjpScore: 3 }],
      hasDataMismatch: false,
    });

    expect(result.kpmrPillarAverages.pjp).toEqual({ Pillar1: 3 });
    expect(result.kpmrOverall.pjp).toBe(3);
  });

  it("returns #N/A like the template (instead of throwing) when a score is below every predikat rule", () => {
    // A freshly generated workbook has no KPMR answers yet: average 0, below the lowest rule (1).
    const result = computeWorkbookScores(
      { ...config, kpmrPredikatRules: [{ label: "Kuat", minScore: 4 }, { label: "Lemah", minScore: 1 }] },
      { parameters: [{ id: "p1", share: 0.1 }], kpmrAnswers: [], hasDataMismatch: true },
    );

    expect(result.kpmrOverall.pjp).toBe(0);
    expect(result.kpmrPredikat.pjp).toBe("#N/A");
    expect(result.finalIra.pjp).toBeNaN();
    expect(result.finalIra.pengawasAdjusted).toBeNaN();
    expect(result.finalIraPredikat.pengawasAdjusted).toBe("#N/A");
  });
});
