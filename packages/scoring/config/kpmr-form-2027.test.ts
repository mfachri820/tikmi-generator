import { describe, expect, it } from "vitest";
import { scoringConfig2026 } from "./2026";
import { kpmrFieldMappings2027, kpmrFormQuestions2027 } from "./kpmr-form-2027";

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

describe("2027 form -> KPMR mapping", () => {
  it("covers every KPMR question row of the template exactly once, in order", () => {
    const templateRows = scoringConfig2026.kpmrQuestions.map((q) => Number(q.cellRef.split("!H")[1]));
    expect(kpmrFormQuestions2027.map((q) => q.row)).toEqual(templateRows);
  });

  it("has no two form questions with the same (whitespace-collapsed) title", () => {
    const titles = kpmrFieldMappings2027().map((m) => normalize(m.formColumn));
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("sends scores to H and documents to I, never to the pengawas column J", () => {
    for (const m of kpmrFieldMappings2027()) {
      expect(m.targetCell).toMatch(m.transform === "score" ? /!H\d+$/ : /!I\d+$/);
    }
  });
});
