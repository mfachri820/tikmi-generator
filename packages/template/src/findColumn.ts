import type { Worksheet } from "exceljs";

/**
 * Locates a column by its header text rather than its letter. One 2026 file
 * (777111112, PT Omnipay Transfer Dana) has an extra column in A2, shifting
 * pengawas scores from O to P -- any sheet reader that assumes fixed letters
 * will silently read the wrong column there.
 */
export function findColumnByHeader(
  worksheet: Worksheet,
  headerRowNumber: number,
  headerText: string,
): number | undefined {
  const row = worksheet.getRow(headerRowNumber);
  let found: number | undefined;
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    if (found !== undefined) return;
    if (String(cell.value ?? "").trim() === headerText.trim()) {
      found = colNumber;
    }
  });
  return found;
}
