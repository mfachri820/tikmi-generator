import ExcelJS from "exceljs";
import type { CellInputValue } from "./inputCells";
import { writeInputCells } from "./inputCells";

/**
 * Loads the untouched template from memory, writes only the given cells,
 * forces a full recalculation the next time the file is opened in Excel
 * (ExcelJS does not evaluate formulas itself), and returns the .xlsx bytes.
 * No filesystem involved, so it runs in a serverless function.
 */
export async function fillTemplateBuffer(
  templateBytes: Buffer | ArrayBuffer,
  inputValues: Map<string, CellInputValue>,
  inputCellRefs: Set<string>,
  /** Template formulas to replace, "Sheet!Address" -> formula without "=" (e.g. a corrected total). */
  formulaOverrides: Record<string, string> = {},
  /** Template constants to replace, "Sheet!Address" -> value (e.g. a corrected weight). */
  valueOverrides: Record<string, number | string> = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBytes as ArrayBuffer);

  writeInputCells(workbook, inputValues, inputCellRefs);
  const cellAt = (ref: string) => {
    const i = ref.lastIndexOf("!");
    const sheet = workbook.getWorksheet(ref.slice(0, i));
    if (!sheet) throw new Error(`Override: sheet "${ref.slice(0, i)}" not found`);
    return sheet.getCell(ref.slice(i + 1));
  };
  for (const [ref, formula] of Object.entries(formulaOverrides)) cellAt(ref).value = { formula };
  for (const [ref, value] of Object.entries(valueOverrides)) cellAt(ref).value = value;

  workbook.calcProperties.fullCalcOnLoad = true;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** File-to-file variant of `fillTemplateBuffer`, for scripts. */
export async function fillTemplate(
  templatePath: string,
  outputPath: string,
  inputValues: Map<string, CellInputValue>,
  inputCellRefs: Set<string>,
): Promise<void> {
  const { readFile, writeFile } = await import("node:fs/promises");
  await writeFile(outputPath, await fillTemplateBuffer(await readFile(templatePath), inputValues, inputCellRefs));
}
