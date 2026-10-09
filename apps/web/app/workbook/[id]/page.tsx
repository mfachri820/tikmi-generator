import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { periods, workbooks } from "@ira/db";
import { getActiveLtdbbUpload } from "@ira/ltdbb";
import {
  pengawasEditableCellRefs2026,
  scoreCellRefs2026,
  sharedCellRefs2026,
  textCellRefs2026,
} from "@ira/scoring/config/2026-input-cells";
import { applyLayoutOverrides } from "@/lib/layoutOverrides";
import { loadWeights } from "@/lib/weights";
import { db } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import { cachedAggregateYear, cachedLayout } from "@/lib/immutableCache";
import { can, requirePageUser } from "@/lib/auth";
import { loadWorkbookView } from "@/lib/workbookView";
import { VALIDASI_SHEET, validasiSheetValues, withValidasiValues } from "@/lib/validasiSheet";
import { Spreadsheet } from "./spreadsheet";

export default async function WorkbookPage({ params, searchParams }: PageProps<"/workbook/[id]">) {
  const { id } = await params;
  const { sheet: initialSheet } = await searchParams;
  const user = await requirePageUser(`/workbook/${id}`);
  const [view, [row], ltdbb] = await Promise.all([
    loadWorkbookView(db, id),
    isUuid(id)
      ? db
          .select({ templateVersionId: workbooks.templateVersionId, periodId: workbooks.periodId, dataYear: periods.dataYear })
          .from(workbooks)
          .innerJoin(periods, eq(periods.id, workbooks.periodId))
          .where(eq(workbooks.id, id))
          .limit(1)
      : [],
    getActiveLtdbbUpload(db),
  ]);
  if (!view || !row) notFound();

  // The grid shows the formulas and weights the app (and the export) actually use.
  const [baseLayout, weights] = await Promise.all([cachedLayout(row.templateVersionId), loadWeights(db, row.periodId)]);
  let layout = applyLayoutOverrides(baseLayout, weights);
  // "Validasi Data Transaksi" from the active LTDBB, as the export writes it -- not the template file's snapshot.
  if (ltdbb) {
    const { rows: transactions } = await cachedAggregateYear(ltdbb.id, row.dataYear);
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
