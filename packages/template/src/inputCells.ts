import type { Workbook } from "exceljs";
import { parseCellRef } from "./cellRef";

export type CellInputValue = string | number | boolean | Date | null;

/**
 * Writes values into input cells only. Refuses to overwrite a cell that
 * already holds a formula -- the app must never type over the parts of the
 * template that are "formulas, not typed cells" (see the build plan's Input
 * cells section).
 */
export function writeInputCells(
  workbook: Workbook,
  values: Map<string, CellInputValue>,
): void {
  for (const [ref, value] of values) {
    const { sheet, address } = parseCellRef(ref);
    const worksheet = workbook.getWorksheet(sheet);
    if (!worksheet) {
      throw new Error(`Template has no sheet named "${sheet}" (cell ${ref})`);
    }
    const cell = worksheet.getCell(address);
    if (typeof cell.value === "object" && cell.value !== null && "formula" in cell.value) {
      throw new Error(`Refusing to overwrite formula cell ${ref}`);
    }
    cell.value = value;
  }
}

export function readInputCells(
  workbook: Workbook,
  refs: string[],
): Map<string, CellInputValue> {
  const result = new Map<string, CellInputValue>();
  for (const ref of refs) {
    const { sheet, address } = parseCellRef(ref);
    const worksheet = workbook.getWorksheet(sheet);
    if (!worksheet) {
      throw new Error(`Template has no sheet named "${sheet}" (cell ${ref})`);
    }
    result.set(ref, worksheet.getCell(address).value as CellInputValue);
  }
  return result;
}
