import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { auditLog, cellInputs, sharedCellInputs, workbooks, type CellInputSource } from "./schema";

export interface RecordCellInputInput {
  workbookId: string;
  cellRef: string;
  value: unknown;
  source: CellInputSource;
  userId?: string | null;
  reason?: string | null;
  /**
   * The cell is shared by every workbook in the workbook's period (see
   * `shared_cell_inputs`): the value is stored once for the period, and the
   * audit row names the workbook it was edited from.
   */
  shared?: boolean;
}

/**
 * The only function that may write `cell_inputs` or `shared_cell_inputs`.
 * Upserts the value (one row per workbook+cellRef, or per period+cellRef for a
 * shared cell) and records user/old/new/reason in `audit_log` in the same
 * transaction -- the build plan's ground rule "every write to an input cell
 * goes through one function." Called by the seed script, the pengawas PATCH
 * route, and the ingest webhook; nothing else should touch either table.
 */
export async function recordCellInput(db: Db, input: RecordCellInputInput) {
  const { workbookId, cellRef, value, source, userId = null, reason = null, shared = false } = input;

  return db.transaction(async (tx) => {
    let oldValue: unknown;
    let row;

    if (shared) {
      const [workbook] = await tx
        .select({ periodId: workbooks.periodId })
        .from(workbooks)
        .where(eq(workbooks.id, workbookId));
      if (!workbook) throw new Error(`Workbook ${workbookId} not found`);
      const { periodId } = workbook;

      const [existing] = await tx
        .select({ value: sharedCellInputs.value })
        .from(sharedCellInputs)
        .where(and(eq(sharedCellInputs.periodId, periodId), eq(sharedCellInputs.cellRef, cellRef)));
      oldValue = existing?.value;

      [row] = await tx
        .insert(sharedCellInputs)
        .values({ periodId, cellRef, value, source, updatedBy: userId })
        .onConflictDoUpdate({
          target: [sharedCellInputs.periodId, sharedCellInputs.cellRef],
          set: { value, source, updatedBy: userId, updatedAt: new Date() },
        })
        .returning();
    } else {
      const [existing] = await tx
        .select({ value: cellInputs.value })
        .from(cellInputs)
        .where(and(eq(cellInputs.workbookId, workbookId), eq(cellInputs.cellRef, cellRef)));
      oldValue = existing?.value;

      [row] = await tx
        .insert(cellInputs)
        .values({ workbookId, cellRef, value, source, updatedBy: userId })
        .onConflictDoUpdate({
          target: [cellInputs.workbookId, cellInputs.cellRef],
          set: { value, source, updatedBy: userId, updatedAt: new Date() },
        })
        .returning();
    }

    await tx.insert(auditLog).values({
      workbookId,
      userId,
      cellRef,
      oldValue: oldValue ?? null,
      newValue: value,
      reason,
    });

    return row;
  });
}

/**
 * Every stored input value a workbook shows, keyed by cell ref: its own
 * `cell_inputs`, with each shared cell taken from its period's
 * `shared_cell_inputs` instead (a per-workbook value for a shared cell is
 * ignored). Used by both the grid and the export, so they never disagree.
 */
export async function loadCellValues(
  db: Db,
  workbook: { id: string; periodId: string },
  sharedCellRefs: readonly string[],
): Promise<Map<string, unknown>> {
  const shared = new Set(sharedCellRefs);
  const own = await db.select().from(cellInputs).where(eq(cellInputs.workbookId, workbook.id));
  const values = new Map<string, unknown>(
    own.filter((c) => !shared.has(c.cellRef)).map((c) => [c.cellRef, c.value]),
  );
  const periodValues = await db
    .select()
    .from(sharedCellInputs)
    .where(eq(sharedCellInputs.periodId, workbook.periodId));
  for (const c of periodValues) {
    if (shared.has(c.cellRef)) values.set(c.cellRef, c.value);
  }
  return values;
}
