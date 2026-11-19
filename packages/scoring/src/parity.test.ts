/**
 * Engine vs Microsoft Excel on random inputs: replays the cases made by
 * scripts/parity/generate-cases.ts through the engine and compares every
 * formula cell with the values Excel computed for the same inputs
 * (scripts/parity/excel-recalc.ps1). Same tolerance as the golden test.
 *
 * Fixtures live in templates/tikmi/<year>/_parity/ (gitignored: Excel's
 * results include Sumber BI amounts). Without them the test is skipped.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { MrDefinition } from "./definitions";
import { XlError, type Scalar } from "./formula/values";
import { mrWorkbook, type MrTables } from "./mr";
import { DIR, load, same, tablesFrom } from "./test-helpers";
import b2 from "../definitions/2025-mr-b2.json";
import b3 from "../definitions/2025-mr-b3.json";

type Raw = string | number | boolean | null | { error: string };
const toScalar = (v: Raw): Scalar => (v !== null && typeof v === "object" ? XlError.of(v.error) : v);
const show = (v: Scalar) => JSON.stringify(v instanceof XlError ? v.code : v);

for (const def of [b2, b3] as unknown as MrDefinition[]) {
  const casesPath = resolve(DIR, "_parity", `cases-b${def.bundling}.json`);
  const resultsPath = resolve(DIR, "_parity", `results-b${def.bundling}.json`);
  const ready = existsSync(casesPath) && existsSync(resultsPath) && existsSync(resolve(DIR, def.templateFile));

  describe.skipIf(!ready)(`parity with Excel: MR KK Bundling ${def.bundling}`, () => {
    it("agrees with Excel on every formula cell of every random case", async () => {
      const cases = JSON.parse(readFileSync(casesPath, "utf8")).cases as { seed: number; cells: Record<string, string | number> }[];
      const results = JSON.parse(readFileSync(resultsPath, "utf8").replace(/^﻿/, "")).results as { seed: number; values: Record<string, Raw> }[];
      const tables: MrTables = await tablesFrom(await load(def.templateFile));
      expect(results.length).toBe(cases.length);

      const mismatches: string[] = [];
      let compared = 0;
      for (const c of cases) {
        const excel = results.find((r) => r.seed === c.seed);
        if (!excel) throw new Error(`No Excel result for case ${c.seed}`);
        const computed = mrWorkbook(def, c.cells, tables).evaluateAll();
        for (const [ref, raw] of Object.entries(excel.values)) {
          compared++;
          const expected = toScalar(raw);
          const actual = computed.get(ref) ?? null;
          if (!same(actual, expected)) mismatches.push(`seed ${c.seed} ${ref}: engine ${show(actual)} vs Excel ${show(expected)}`);
        }
      }
      expect(compared).toBeGreaterThan(0);
      expect(mismatches, `${mismatches.length} of ${compared} cells differ:\n` + mismatches.slice(0, 40).join("\n")).toEqual([]);
    }, 300_000);
  });
}
