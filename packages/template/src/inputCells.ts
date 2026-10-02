import type { Workbook } from "exceljs";
import { parseCellRef } from "./cellRef";

export type CellInputValue = string | number | boolean | Date | null;

/**
 * Writes values into input cells only. `inputCellRefs` is the admin-curated
 * allow-list (see the build plan's Input cells section and `extractLayout`'s
 * own `inputCellRefs` set) -- a ref in that list may be written even if it
 * currently holds a formula, since some input cells (e.g. A2!O, which
 * defaults to `=L` until a pengawas types an explicit override, same for
 * KPMR!J defaulting to H) legitimately start as a formula and are only ever
 * overwritten once someone provides a value. Anything NOT in the allow-list
 * that holds a formula is refused -- the app must never type over the parts
 * of the template that are genuinely "formulas, not typed cells".
 */
export function writeInputCells(
  workbook: Workbook,
  values: Map<string, CellInputValue>,
  inputCellRefs: Set<string>,
): void {
  for (const [ref, value] of values) {
    const { sheet, address } = parseCellRef(ref);
    const worksheet = workbook.getWorksheet(sheet);
    if (!worksheet) {
      throw new Error(`Template has no sheet named "${sheet}" (cell ${ref})`);
    }
    const cell = worksheet.getCell(address);
    const isFormula = typeof cell.value === "object" && cell.value !== null && "formula" in cell.value;
    if (isFormula && !inputCellRefs.has(ref)) {
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
