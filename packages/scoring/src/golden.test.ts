/**
 * Golden test: for each MR KK template, the engine must reproduce every
 * cached formula result Excel saved in the file (sheet 1 H/K/L/M/N/O, TKMR J,
 * Form Penilaian, Lamp1 totals, DropDown List sums): numbers within 1e-9
 * (relative to the value's size), strings, booleans and errors exactly.
 *
 * Inputs are the template's own sample answers, read from the declared input
 * cells only; Sumber BI and Lamp. PJP come from that template's own copies.
 * Excel's cached results are taken from the template dump (openpyxl, made by
 * scripts/dump-template.py), not from exceljs: exceljs drops a cached result
 * of 0 (`<f>…</f><v>0</v>` reads as "no result"). Inputs come from exceljs, so
 * the two readers check each other.
 *
 * The templates are not in git (they hold PJP and BI data): set
 * TIKMI_TEMPLATES_DIR or put them (and their _dump/) in templates/tikmi/2025/,
 * otherwise the test is skipped.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inputCellRefs, type MrDefinition } from "./definitions";
import { XlError, type Scalar } from "./formula/values";
import { mrWorkbook } from "./mr";
import { cachedFromDump, DIR, load, same, tablesFrom, valueAt } from "./test-helpers";
import b2 from "../definitions/2025-mr-b2.json";
import b3 from "../definitions/2025-mr-b3.json";

const cases: [string, MrDefinition][] = [
  ["Bundling 2", b2 as unknown as MrDefinition],
  ["Bundling 3", b3 as unknown as MrDefinition],
];

for (const [name, def] of cases) {
  const path = resolve(DIR, def.templateFile);
  const dumpPath = resolve(DIR, "_dump", def.templateFile.replace(/\.xlsx$/, ".json"));
  describe.skipIf(!existsSync(path) || !existsSync(dumpPath))(`golden: MR KK ${name} (${def.templateFile})`, () => {
    let computed: Map<string, Scalar>;
    let cached: Map<string, Scalar>;

    it("reproduces every cached formula result", async () => {
      const loaded = await load(def.templateFile);
      const inputs = new Map<string, Scalar>();
      for (const ref of inputCellRefs(def)) {
        const v = valueAt(loaded.wb, ref);
        if (v !== null) inputs.set(ref, v);
      }
      const workbook = mrWorkbook(def, inputs, await tablesFrom(loaded));
      computed = workbook.evaluateAll();
      const fromDump = await cachedFromDump(def.templateFile);
      cached = new Map(Object.keys(def.spec.formulas).map((ref) => [ref, fromDump.get(ref) ?? null]));

      const mismatches = [...computed.entries()]
        .filter(([ref, v]) => !same(v, cached.get(ref) ?? null))
        .map(([ref, v]) => `${ref}: engine ${JSON.stringify(v instanceof XlError ? v.code : v)} vs Excel ${JSON.stringify(cached.get(ref) instanceof XlError ? (cached.get(ref) as XlError).code : cached.get(ref))}`);
      expect(computed.size).toBe(Object.keys(def.spec.formulas).length);
      expect(mismatches, mismatches.slice(0, 40).join("\n")).toEqual([]);
    }, 120_000);

    it("matches the headline cells", () => {
      const fp = def.sheets.form;
      const at = (a: string) => computed.get(`${fp}!${a}`);
      if (def.bundling === 2) {
        expect(at("C23")).toBeCloseTo(3.641025641025641, 12);
        expect(at("C36")).toBeCloseTo(4.833333333333333, 12);
        expect(at("C60")).toBeCloseTo(3.630897435897436, 12);
        expect(at("C64")).toBeCloseTo(3.141628205128205, 12);
        expect(at("C65")).toBe("Cukup Baik");
        expect(at("F64")).toBeCloseTo(1.4977948717948717, 12);
        expect(at("F65")).toBe("Buruk");
      } else {
        expect(at("C64")).toBeCloseTo(2.7787499999999996, 12);
        expect(at("C65")).toBe("Kurang Baik");
        expect(at("F64")).toBeCloseTo(2.6212500000000003, 12);
        expect(at("F65")).toBe("Kurang Baik");
      }
    });

    it("tests every indicator's M and O against the cache", () => {
      for (const ind of def.indicators) {
        for (const cell of [ind.mCell, ind.oCell]) {
          if (!cell) continue;
          const ref = `${def.sheets.risiko}!${cell}`;
          expect(same(computed.get(ref)!, cached.get(ref) ?? null), `${ind.id} ${cell}`).toBe(true);
        }
      }
    });
  });
}
