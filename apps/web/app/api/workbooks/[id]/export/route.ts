import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  exports as exportsTable,
  loadCellValues,
  periods,
  pjp,
  templateVersions,
  workbooks,
} from "@ira/db";
import { getActiveLtdbbUpload, ltdbbPolicy } from "@ira/ltdbb";
import { cachedAggregateYear } from "@/lib/immutableCache";
import { fillTemplateBuffer, type CellInputValue, type ExtractedLayout } from "@ira/template";
import { inputCellRefs2026, sharedCellRefs2026 } from "@ira/scoring/config/2026-input-cells";
import { formulaOverridesFor, valueOverridesFor } from "@ira/scoring/config/2026-sheet";
import { layoutText } from "@/lib/layoutOverrides";
import { loadWeights } from "@/lib/weights";
import { db } from "@/lib/db";
import { VALIDASI_SHEET, validasiSheetValues } from "@/lib/validasiSheet";
import { requireApiUser } from "@/lib/auth";
import { isUuid } from "@/lib/ids";

export const runtime = "nodejs";
export const maxDuration = 60;

const C2_SHEET = "C2. Form PJP LR";

/**
 * Generates "Excel Individu PJP": the template with every input cell set from
 * `cell_inputs` and "Validasi Data Transaksi" filled from the active LTDBB
 * upload, all in memory (Vercel has no filesystem). Records an `exports` row
 * naming the LTDBB snapshot used.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/workbooks/[id]/export">) {
  const { user, denied } = await requireApiUser();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Workbook tidak ditemukan." }, { status: 404 });
  }

  const [row] = await db
    .select({ workbook: workbooks, template: templateVersions, period: periods, pjp })
    .from(workbooks)
    .innerJoin(templateVersions, eq(templateVersions.id, workbooks.templateVersionId))
    .innerJoin(periods, eq(periods.id, workbooks.periodId))
    .innerJoin(pjp, eq(pjp.sandi, workbooks.pjpSandi))
    .where(eq(workbooks.id, id))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "Workbook tidak ditemukan." }, { status: 404 });
  }
  const { workbook, template, period } = row;

  const ltdbb = await getActiveLtdbbUpload(db);
  if (!ltdbb) {
    return NextResponse.json({ error: "Upload LTDBB terlebih dahulu." }, { status: 409 });
  }
  const { rows: transactions } = await cachedAggregateYear(ltdbb.id, period.dataYear);

  const own = transactions.find((t) => t.sandi === workbook.pjpSandi);
  if (ltdbbPolicy.missingPjp === "block" && own && !own.inLtdbb) {
    return NextResponse.json({ error: `PJP ini tidak ada di data LTDBB ${period.dataYear}.` }, { status: 409 });
  }
  if (ltdbbPolicy.incompleteYear === "block" && own?.flags.includes("INCOMPLETE_YEAR")) {
    return NextResponse.json({ error: `Data LTDBB ${period.dataYear} PJP ini kurang dari 12 bulan.` }, { status: 409 });
  }

  const values = new Map<string, CellInputValue>();

  // Every input cell gets this workbook's value -- or is blanked, so nothing from the PJP file
  // the template was taken from leaks through. Input cells that hold the template's own
  // default formula (e.g. A2!O "=L") keep it unless a value overrides it.
  const layout = template.layoutJson as ExtractedLayout;
  // The weights in force for this period go into the file (A2 D/E, category weights, headings, KPMR H46/J46).
  const weights = await loadWeights(db, workbook.periodId);
  const templateFormulaCells = new Set(
    layout.sheets.flatMap((s) => s.cells.filter((c) => c.isInput && c.formula).map((c) => `${s.name}!${c.address}`)),
  );
  const stored = await loadCellValues(db, workbook, sharedCellRefs2026);
  for (const ref of inputCellRefs2026) {
    const value = stored.get(ref);
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      values.set(ref, value);
    } else if (!templateFormulaCells.has(ref)) {
      values.set(ref, null);
    }
  }
  // C2!G18 looks the PJP up in Validasi column C (=A&" - "&B), so B2 must use the same name.
  values.set(`${C2_SHEET}!B2`, `${workbook.pjpSandi} - ${row.pjp.nama}`);

  // "Validasi Data Transaksi" from the active LTDBB, the same values the grid shows. Formula columns stay
  // the template's: C (=A&" - "&B) always, and L/M (=F+H+J, =G+I+K) from template v2 on.
  const validasiSheet = layout.sheets.find((s) => s.name === VALIDASI_SHEET);
  const validasiFormulaCells = new Set(validasiSheet?.cells.filter((c) => c.formula).map((c) => c.address) ?? []);
  const validasi = await validasiSheetValues(db, period.dataYear, transactions, validasiSheet?.rowCount ?? 0);
  for (const [address, value] of validasi) {
    if (!validasiFormulaCells.has(address)) values.set(`${VALIDASI_SHEET}!${address}`, value);
  }

  const file = await fillTemplateBuffer(
    Buffer.from(template.xlsxBase64, "base64"),
    values,
    new Set(inputCellRefs2026),
    formulaOverridesFor(weights),
    valueOverridesFor(weights, layoutText(layout)),
  );

  const filename = `IRA_${workbook.pjpSandi} - ${row.pjp.nama}.xlsx`.replace(/[\\/:*?"<>|]/g, "");
  const [exportRow] = await db
    .insert(exportsTable)
    .values({
      kind: "xlsx_individu",
      scope: workbook.pjpSandi,
      status: "done",
      createdBy: user.id,
      ltdbbUploadId: ltdbb.id,
    })
    .returning();

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Export-Id": exportRow.id,
    },
  });
}
