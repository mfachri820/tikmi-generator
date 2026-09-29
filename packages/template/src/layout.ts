import type { Workbook } from "exceljs";

export interface LayoutCell {
  address: string;
  value: unknown;
  isFormula: boolean;
  /** True for a cell an admin marked as an input cell for this template version. */
  isInput: boolean;
}

export interface LayoutMerge {
  /** exceljs represents a merge range as e.g. "A1:C1". */
  range: string;
}

export interface LayoutSheet {
  name: string;
  hidden: boolean;
  rowCount: number;
  columnCount: number;
  merges: LayoutMerge[];
  cells: LayoutCell[];
}

export interface ExtractedLayout {
  sheets: LayoutSheet[];
}

/**
 * Walks every sheet and cell in a workbook and produces the layout JSON the
 * grid renders from (`template_versions.layout_json`). `inputCellRefs` is the
 * admin-curated set of "Sheet!Address" cells that are actually typed into
 * (see the build plan's Input cells table) -- everything else is read-only
 * template text or a formula the scoring engine recomputes.
 */
export function extractLayout(workbook: Workbook, inputCellRefs: Set<string>): ExtractedLayout {
  const sheets: LayoutSheet[] = [];

  workbook.eachSheet((worksheet) => {
    const merges: LayoutMerge[] = Object.keys(
      (worksheet as unknown as { _merges?: Record<string, unknown> })._merges ?? {},
    ).map((range) => ({ range }));

    const cells: LayoutCell[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const address = cell.address;
        const isFormula =
          typeof cell.value === "object" && cell.value !== null && "formula" in cell.value;
        cells.push({
          address,
          value: cell.value,
          isFormula,
          isInput: inputCellRefs.has(`${worksheet.name}!${address}`),
        });
      });
    });

    sheets.push({
      name: worksheet.name,
      hidden: worksheet.state !== "visible",
      rowCount: worksheet.rowCount,
      columnCount: worksheet.columnCount,
      merges,
      cells,
    });
  });

  return { sheets };
}
