import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { exports as exportsTable, periods, templateVersions, workbooks } from "@ira/db";
import type { ExtractedLayout } from "@ira/template";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import { buildIndividuReport } from "@/lib/individuReport";
import { loadWorkbookView } from "@/lib/workbookView";
import { applyLayoutOverrides } from "@/lib/layoutOverrides";
import { loadWeights } from "@/lib/weights";

export const runtime = "nodejs";

/** BI's "APU PPT dan Net Risk PTD Individu" report for this workbook's PJP, printed by the signed-in user. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, denied } = await requireApiUser();
  if (denied) return denied;
  const { id } = await ctx.params;
  const view = isUuid(id) ? await loadWorkbookView(db, id) : null;
  if (!view) return NextResponse.json({ error: "Workbook tidak ditemukan." }, { status: 404 });

  const [row] = await db
    .select({ layoutJson: templateVersions.layoutJson, year: periods.year, periodId: workbooks.periodId })
    .from(workbooks)
    .innerJoin(templateVersions, eq(templateVersions.id, workbooks.templateVersionId))
    .innerJoin(periods, eq(periods.id, workbooks.periodId))
    .where(eq(workbooks.id, id))
    .limit(1);

  const weights = await loadWeights(db, row.periodId);
  const file = await buildIndividuReport({
    pjpNama: view.workbook.pjpNama,
    year: row.year,
    printedBy: user.name,
    printedAt: new Date(),
    scores: view.scores,
    parameterInfo: view.parameterInfo,
    cells: view.cells,
    layout: applyLayoutOverrides(row.layoutJson as ExtractedLayout, weights),
    weights,
  });

  await db.insert(exportsTable).values({ kind: "individu_pjp", scope: view.workbook.pjpSandi, status: "done", createdBy: user.id });

  const filename = `BSSS - PJP Individu - ${view.workbook.pjpSandi} - ${view.workbook.pjpNama}.xlsx`.replace(/[\\/:*?"<>|]/g, "");
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
