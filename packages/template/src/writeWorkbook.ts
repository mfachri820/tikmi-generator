import ExcelJS from "exceljs";
import type { CellInputValue } from "./inputCells.js";
import { writeInputCells } from "./inputCells.js";

/**
 * Opens the untouched template, writes only the given input cells, forces a
 * full recalculation the next time the file is opened in Excel (ExcelJS does
 * not evaluate formulas itself), and saves to `outputPath`.
 */
export async function fillTemplate(
  templatePath: string,
  outputPath: string,
  inputValues: Map<string, CellInputValue>,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  writeInputCells(workbook, inputValues);

  workbook.calcProperties.fullCalcOnLoad = true;
  await workbook.xlsx.writeFile(outputPath);
}
