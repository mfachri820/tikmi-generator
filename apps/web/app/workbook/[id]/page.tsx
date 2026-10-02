import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { templateVersions, workbooks } from "@ira/db";
import type { ExtractedLayout } from "@ira/template";
import {
  pengawasEditableCellRefs2026,
  scoreCellRefs2026,
  sharedCellRefs2026,
  textCellRefs2026,
} from "@ira/scoring/config/2026-input-cells";
import { db } from "@/lib/db";
import { loadWorkbookView } from "@/lib/workbookView";
import { Spreadsheet } from "./spreadsheet";

export default async function WorkbookPage({ params, searchParams }: PageProps<"/workbook/[id]">) {
  const { id } = await params;
  const { sheet: initialSheet } = await searchParams;
  const view = await loadWorkbookView(db, id);
  if (!view) notFound();

  const [row] = await db
    .select({ layoutJson: templateVersions.layoutJson })
    .from(workbooks)
    .innerJoin(templateVersions, eq(templateVersions.id, workbooks.templateVersionId))
    .where(eq(workbooks.id, id))
    .limit(1);
  const layout = row.layoutJson as ExtractedLayout;

  return (
    <Spreadsheet
      initialView={view}
      initialSheet={typeof initialSheet === "string" ? initialSheet : undefined}
      sheets={layout.sheets.filter((s) => !s.hidden)}
      styles={layout.styles}
      editableCellRefs={pengawasEditableCellRefs2026}
      scoreCellRefs={scoreCellRefs2026}
      textCellRefs={textCellRefs2026}
      sharedCellRefs={sharedCellRefs2026}
    />
  );
}
