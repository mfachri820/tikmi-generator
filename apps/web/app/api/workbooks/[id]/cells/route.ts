import { NextResponse } from "next/server";
import { cellInputs, recordCellInput, sharedCellInputs, users, workbooks } from "@tikmi/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  pengawasEditableCellRefs2026,
  scoreCellRefs2026,
  sharedCellRefs2026,
  textCellRefs2026,
} from "@tikmi/scoring/config/2026-input-cells";
import { db } from "@/lib/db";
import { can, requireApiUser } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { loadWorkbookView } from "@/lib/workbookView";

const EDITABLE = new Set(pengawasEditableCellRefs2026);
const SCORE_CELLS = new Set(scoreCellRefs2026);
const TEXT_CELLS = new Set(textCellRefs2026);
const SHARED_CELLS = new Set(sharedCellRefs2026);

interface Edit {
  cellRef: string;
  value: string | number | null;
  /**
   * The workbook version (`view.workbook.updatedAt`) the editor was looking at.
   * If the cell was saved by anyone after that, the edit is a conflict and is
   * not applied. Omitted = save regardless (e.g. "overwrite with my value").
   */
  since?: string;
}

interface PatchBody {
  edits: Edit[];
  reason?: string;
}

export interface CellConflict {
  cellRef: string;
  /** What is stored now, kept instead of the edit. */
  theirValue: unknown;
  yourValue: Edit["value"];
  by: string | null;
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
 *
 * Takes a batch (the grid saves a couple of seconds' worth of edits at once)
 * and applies it in one transaction. Edits whose cell someone else saved after
 * the editor's `since` are skipped and returned as conflicts, so nobody
 * silently overwrites another pengawas. A single `{ cellRef, value }` body is
 * still accepted.
 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/workbooks/[id]/cells">) {
  const { user, denied } = await requireApiUser(can.edit);
  if (denied) return denied;
  const { id } = await ctx.params;
  const raw = (await req.json()) as Partial<PatchBody> & Partial<Edit>;
  const edits: Edit[] = Array.isArray(raw.edits)
    ? raw.edits
    : raw.cellRef !== undefined
      ? [{ cellRef: raw.cellRef, value: raw.value as Edit["value"] }]
      : [];
  if (edits.length === 0) {
    return NextResponse.json({ error: "Tidak ada perubahan." }, { status: 400 });
  }

  for (const edit of edits) {
    if (!edit.cellRef || !EDITABLE.has(edit.cellRef)) {
      return NextResponse.json({ error: `Sel ${edit.cellRef ?? ""} tidak dapat diubah.` }, { status: 400 });
    }
    if (edit.value === undefined) {
      return NextResponse.json({ error: "Nilai tidak ada." }, { status: 400 });
    }
    const invalid = validate(edit.cellRef, edit.value);
    if (invalid) {
      return NextResponse.json({ error: `${edit.cellRef}: ${invalid}` }, { status: 400 });
    }
    if (edit.since !== undefined && Number.isNaN(Date.parse(edit.since))) {
      return NextResponse.json({ error: "Versi workbook tidak valid." }, { status: 400 });
    }
  }

  const [workbook] = isUuid(id) ? await db.select().from(workbooks).where(eq(workbooks.id, id)).limit(1) : [];
  if (!workbook) {
    return NextResponse.json({ error: "Workbook tidak ditemukan." }, { status: 404 });
  }

  const conflicts: CellConflict[] = [];

  await db.transaction(async (tx) => {
    // When, and by whom, each edited cell was last saved.
    const own = edits.filter((e) => !SHARED_CELLS.has(e.cellRef)).map((e) => e.cellRef);
    const shared = edits.filter((e) => SHARED_CELLS.has(e.cellRef)).map((e) => e.cellRef);
    const stored = new Map<string, { value: unknown; updatedAt: Date; by: string | null }>();
    if (own.length) {
      const rows = await tx
        .select({ cellRef: cellInputs.cellRef, value: cellInputs.value, updatedAt: cellInputs.updatedAt, by: users.name })
        .from(cellInputs)
        .leftJoin(users, eq(users.id, cellInputs.updatedBy))
        .where(and(eq(cellInputs.workbookId, id), inArray(cellInputs.cellRef, own)));
      for (const r of rows) stored.set(r.cellRef, r);
    }
    if (shared.length) {
      const rows = await tx
        .select({ cellRef: sharedCellInputs.cellRef, value: sharedCellInputs.value, updatedAt: sharedCellInputs.updatedAt, by: users.name })
        .from(sharedCellInputs)
        .leftJoin(users, eq(users.id, sharedCellInputs.updatedBy))
        .where(and(eq(sharedCellInputs.periodId, workbook.periodId), inArray(sharedCellInputs.cellRef, shared)));
      for (const r of rows) stored.set(r.cellRef, r);
    }

    for (const edit of edits) {
      const current = stored.get(edit.cellRef);
      // Timestamps come back at millisecond precision, the same precision as `since`.
      const changedSince = edit.since !== undefined && current && current.updatedAt.getTime() > Date.parse(edit.since);
      const alreadyThis = JSON.stringify(current?.value ?? null) === JSON.stringify(edit.value);
      if (changedSince && !alreadyThis) {
        conflicts.push({ cellRef: edit.cellRef, theirValue: current.value, yourValue: edit.value, by: current.by });
        continue;
      }
      if (alreadyThis) continue;

      await recordCellInput(tx, {
        workbookId: id,
        cellRef: edit.cellRef,
        value: edit.value,
        source: "pengawas",
        userId: user.id,
        reason: raw.reason ?? null,
        shared: SHARED_CELLS.has(edit.cellRef),
      });
    }
  });

  return NextResponse.json({ view: await loadWorkbookView(db, id), conflicts });
}
