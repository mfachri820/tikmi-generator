import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  exports as exportsTable,
  loadCellValues,
  periods,
  pjp,
  pjpValidationMeta,
  templateVersions,
  workbooks,
} from "@ira/db";
import { aggregateYear, getActiveLtdbbUpload, ltdbbPolicy } from "@ira/ltdbb";
import { fillTemplateBuffer, type CellInputValue, type ExtractedLayout } from "@ira/template";
import { inputCellRefs2026, sharedCellRefs2026 } from "@ira/scoring/config/2026-input-cells";
import { db } from "@/lib/db";
import { getDevUser } from "@/lib/devUser";
import { isUuid } from "@/lib/ids";

export const runtime = "nodejs";
export const maxDuration = 60;

const C2_SHEET = "C2. Form PJP LR";
const VALIDASI_SHEET = "Validasi Data Transaksi";
/** Data rows of "Validasi Data Transaksi": row 1 is the header. */
const VALIDASI_FIRST_ROW = 2;

/**
 * Generates "Excel Individu PJP": the template with every input cell set from
 * `cell_inputs` and "Validasi Data Transaksi" filled from the active LTDBB
 * upload, all in memory (Vercel has no filesystem). Records an `exports` row
 * naming the LTDBB snapshot used.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/workbooks/[id]/export">) {
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
  const { rows: transactions } = await aggregateYear(db, ltdbb.id, period.dataYear);

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

  const meta = new Map(
    (await db.select().from(pjpValidationMeta).where(eq(pjpValidationMeta.dataYear, period.dataYear))).map(
      (m) => [m.sandi, m],
    ),
  );
  // Formula columns stay the template's: C (=A&" - "&B) always, and L/M (=F+H+J, =G+I+K) from template v2 on.
  const validasiFormulaCells = new Set(
    layout.sheets.find((s) => s.name === VALIDASI_SHEET)?.cells.filter((c) => c.formula).map((c) => c.address) ?? [],
  );
  transactions.forEach((t, i) => {
    const r = VALIDASI_FIRST_ROW + i;
    const cell = (col: string, value: CellInputValue) => {
      if (!validasiFormulaCells.has(`${col}${r}`)) values.set(`${VALIDASI_SHEET}!${col}${r}`, value);
    };
    cell("A", Number(t.sandi));
    cell("B", t.nama);
    cell("D", meta.get(t.sandi)?.statusPjp ?? null);
    cell("E", meta.get(t.sandi)?.keterangan ?? null);
    cell("F", t.finJumlahInc);
    cell("G", t.finNilaiInc);
    cell("H", t.finJumlahOut);
    cell("I", t.finNilaiOut);
    cell("J", t.finJumlahDom);
    cell("K", t.finNilaiDom);
    cell("L", t.totalFrekuensi);
    cell("M", t.totalNominal);
  });
  // Blank any template rows past the PJP list so no stale totals survive.
  const validasiRows = layout.sheets.find((s) => s.name === VALIDASI_SHEET)?.rowCount ?? 0;
  for (let r = VALIDASI_FIRST_ROW + transactions.length; r <= validasiRows; r++) {
    for (const col of ["A", "B", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"]) {
      if (!validasiFormulaCells.has(`${col}${r}`)) values.set(`${VALIDASI_SHEET}!${col}${r}`, null);
    }
  }

  const file = await fillTemplateBuffer(
    Buffer.from(template.xlsxBase64, "base64"),
    values,
    new Set(inputCellRefs2026),
  );

  const filename = `IRA_${workbook.pjpSandi} - ${row.pjp.nama}.xlsx`.replace(/[\\/:*?"<>|]/g, "");
  const user = await getDevUser(db);
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
