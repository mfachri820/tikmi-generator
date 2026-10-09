import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { periods, templateVersions, workbooks } from "@ira/db";
import { aggregateYear, getActiveLtdbbUpload } from "@ira/ltdbb";
import type { ExtractedLayout } from "@ira/template";
import {
  pengawasEditableCellRefs2026,
  scoreCellRefs2026,
  sharedCellRefs2026,
  textCellRefs2026,
} from "@ira/scoring/config/2026-input-cells";
import { applyLayoutOverrides } from "@/lib/layoutOverrides";
import { loadWeights } from "@/lib/weights";
import { db } from "@/lib/db";
import { can, requirePageUser } from "@/lib/auth";
import { loadWorkbookView } from "@/lib/workbookView";
import { VALIDASI_SHEET, validasiSheetValues, withValidasiValues } from "@/lib/validasiSheet";
import { Spreadsheet } from "./spreadsheet";

export default async function WorkbookPage({ params, searchParams }: PageProps<"/workbook/[id]">) {
  const { id } = await params;
  const { sheet: initialSheet } = await searchParams;
  const user = await requirePageUser(`/workbook/${id}`);
  const view = await loadWorkbookView(db, id);
  if (!view) notFound();

  const [row] = await db
    .select({ layoutJson: templateVersions.layoutJson, periodId: workbooks.periodId, dataYear: periods.dataYear })
    .from(workbooks)
    .innerJoin(templateVersions, eq(templateVersions.id, workbooks.templateVersionId))
    .innerJoin(periods, eq(periods.id, workbooks.periodId))
    .where(eq(workbooks.id, id))
    .limit(1);
  // The grid shows the formulas and weights the app (and the export) actually use.
  let layout = applyLayoutOverrides(row.layoutJson as ExtractedLayout, await loadWeights(db, row.periodId));
  // "Validasi Data Transaksi" from the active LTDBB, as the export writes it -- not the template file's snapshot.
  const ltdbb = await getActiveLtdbbUpload(db);
  if (ltdbb) {
    const { rows: transactions } = await aggregateYear(db, ltdbb.id, row.dataYear);
    const rowCount = layout.sheets.find((s) => s.name === VALIDASI_SHEET)?.rowCount ?? 0;
    layout = withValidasiValues(layout, await validasiSheetValues(db, row.dataYear, transactions, rowCount));
  }
  const sheets = layout.sheets.filter((s) => !s.hidden);

  return (
    <Spreadsheet
      initialView={view}
      initialSheet={typeof initialSheet === "string" ? initialSheet : undefined}
      sheets={sheets}
      styles={layout.styles}
      // A viewer gets the same grid with nothing editable.
      editableCellRefs={can.edit(user) ? pengawasEditableCellRefs2026 : []}
      readOnly={!can.edit(user)}
      scoreCellRefs={scoreCellRefs2026}
      textCellRefs={textCellRefs2026}
      sharedCellRefs={sharedCellRefs2026}
    />
  );
}
