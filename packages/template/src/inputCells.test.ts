import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { formatCellRef, parseCellRef } from "./cellRef";
import { readInputCells, writeInputCells } from "./inputCells";

describe("cellRef", () => {
  it("round-trips a sheet name that itself contains no special characters", () => {
    const ref = "C2. Form PJP LR!C6";
    expect(formatCellRef(parseCellRef(ref))).toBe(ref);
  });
});

function buildWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("C2. Form PJP LR");
  sheet.getCell("C6").value = 1000;
  sheet.getCell("D6").value = { formula: "C6/C7", result: 0.5 };
  return workbook;
}

describe("input cells", () => {
  it("reads and writes a plain value cell", () => {
    const workbook = buildWorkbook();
    writeInputCells(workbook, new Map([["C2. Form PJP LR!C6", 2000]]));
    expect(readInputCells(workbook, ["C2. Form PJP LR!C6"]).get("C2. Form PJP LR!C6")).toBe(2000);
  });

  it("refuses to overwrite a formula cell", () => {
    const workbook = buildWorkbook();
    expect(() =>
      writeInputCells(workbook, new Map([["C2. Form PJP LR!D6", 999]])),
    ).toThrow(/formula/i);
  });
});
