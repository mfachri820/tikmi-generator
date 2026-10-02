import { NextResponse } from "next/server";
import { recordCellInput, workbooks } from "@ira/db";
import { eq } from "drizzle-orm";
import {
  pengawasEditableCellRefs2026,
  scoreCellRefs2026,
  sharedCellRefs2026,
  textCellRefs2026,
} from "@ira/scoring/config/2026-input-cells";
import { db } from "@/lib/db";
import { getDevUser } from "@/lib/devUser";
import { isUuid } from "@/lib/ids";
import { loadWorkbookView } from "@/lib/workbookView";

const EDITABLE = new Set(pengawasEditableCellRefs2026);
const SCORE_CELLS = new Set(scoreCellRefs2026);
const TEXT_CELLS = new Set(textCellRefs2026);
const SHARED_CELLS = new Set(sharedCellRefs2026);

interface PatchBody {
  cellRef: string;
  value: string | number | null;
  reason?: string;
}

/** Returns an error message, or null when `value` is acceptable for `cellRef`. */
function validate(cellRef: string, value: unknown): string | null {
  if (value === null) return null;
  if (SCORE_CELLS.has(cellRef)) {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5
      ? null
      : "Nilai harus bilangan bulat 1-5.";
  }
  if (TEXT_CELLS.has(cellRef)) return typeof value === "string" ? null : "Nilai harus berupa teks.";
  return typeof value === "number" || typeof value === "string" ? null : "Nilai tidak valid.";
}

/**
 * Pengawas edit path: the only place outside `scripts/seed-dev.ts` and
 * `/api/ingest` that writes `cell_inputs`, and like them it goes through
 * `recordCellInput` so `audit_log` always gets a matching row.
 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/workbooks/[id]/cells">) {
  const { id } = await ctx.params;
  const body = (await req.json()) as Partial<PatchBody>;

  if (!body.cellRef || !EDITABLE.has(body.cellRef)) {
    return NextResponse.json({ error: `Sel ${body.cellRef ?? ""} tidak dapat diubah.` }, { status: 400 });
  }
  if (body.value === undefined) {
    return NextResponse.json({ error: "Nilai tidak ada." }, { status: 400 });
  }
  const invalid = validate(body.cellRef, body.value);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  const [workbook] = isUuid(id) ? await db.select().from(workbooks).where(eq(workbooks.id, id)).limit(1) : [];
  if (!workbook) {
    return NextResponse.json({ error: "Workbook tidak ditemukan." }, { status: 404 });
  }

  const user = await getDevUser(db);
  await recordCellInput(db, {
    workbookId: id,
    cellRef: body.cellRef,
    value: body.value,
    source: "pengawas",
    userId: user.id,
    reason: body.reason ?? null,
    shared: SHARED_CELLS.has(body.cellRef),
  });

  return NextResponse.json(await loadWorkbookView(db, id));
}
