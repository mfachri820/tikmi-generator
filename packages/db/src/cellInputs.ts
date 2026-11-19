import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  assessmentParts,
  assessments,
  auditLog,
  cellInputs,
  type AuditEvent,
  type CellSource,
} from "./schema";

/** A connection or an open transaction: callers that hold a lock pass their transaction through. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A write to a Final assessment. Only a koordinator/admin reopen (status back to direview) allows it again. */
export class AssessmentFinalError extends Error {
  constructor(public readonly assessmentId: string) {
    super(`Assessment ${assessmentId} is final and read-only`);
    this.name = "AssessmentFinalError";
  }
}

export class NoteRequiredError extends Error {
  constructor(public readonly cellRef: string) {
    super(`A koreksi of ${cellRef} needs a note`);
    this.name = "NoteRequiredError";
  }
}

export interface RecordCellInputInput {
  partId: string;
  cellRef: string;
  value: unknown;
  source: CellSource;
  /** Required for `koreksi`; optional otherwise (e.g. why a score differs). */
  note?: string | null;
  /** For `pjp` values: the submission file they were parsed from. */
  fileId?: string | null;
  userId?: string | null;
  /** Written to the audit log; defaults to `note`. */
  reason?: string | null;
}

/**
 * The only function that writes `cell_inputs`. Upserts the value (one row per
 * part + cell) and logs old/new/who/why in `audit_log` in the same
 * transaction. Refuses a koreksi without a note and any write to a Final
 * assessment. Returns null (and logs nothing) when the value, source and note
 * are unchanged.
 */
export async function recordCellInput(db: DbOrTx, input: RecordCellInputInput) {
  const { partId, cellRef, value, source, note = null, fileId = null, userId = null } = input;
  if (source === "koreksi" && !note?.trim()) throw new NoteRequiredError(cellRef);

  return db.transaction(async (tx) => {
    const [part] = await tx
      .select({ assessmentId: assessmentParts.assessmentId, status: assessments.status })
      .from(assessmentParts)
      .innerJoin(assessments, eq(assessments.id, assessmentParts.assessmentId))
      .where(eq(assessmentParts.id, partId));
    if (!part) throw new Error(`Assessment part ${partId} not found`);
    if (part.status === "final") throw new AssessmentFinalError(part.assessmentId);

    const [existing] = await tx
      .select({ value: cellInputs.value, source: cellInputs.source, note: cellInputs.note, pjpValue: cellInputs.pjpValue })
      .from(cellInputs)
      .where(and(eq(cellInputs.partId, partId), eq(cellInputs.cellRef, cellRef)));
    // A koreksi remembers the PJP's own value underneath it.
    const pjpValue = source === "koreksi" ? (existing?.source === "pjp" ? existing.value : (existing?.pjpValue ?? null)) : null;
    if (
      existing &&
      JSON.stringify(existing.value ?? null) === JSON.stringify(value ?? null) &&
      existing.source === source &&
      (existing.note ?? null) === (note ?? null)
    ) {
      return null;
    }

    const now = sql`now()`;
    const [row] = await tx
      .insert(cellInputs)
      .values({ partId, cellRef, value, source, note, pjpValue, fileId, updatedBy: userId, updatedAt: now })
      .onConflictDoUpdate({
        target: [cellInputs.partId, cellInputs.cellRef],
        set: { value, source, note, pjpValue, fileId, updatedBy: userId, updatedAt: now },
      })
      .returning();

    await tx.insert(auditLog).values({
      event: source === "koreksi" ? "koreksi" : "cell",
      assessmentId: part.assessmentId,
      partId,
      cellRef,
      oldValue: existing?.value ?? null,
      newValue: value ?? null,
      reason: input.reason ?? note,
      userId,
    });
    return row;
  });
}

export interface CellWrite {
  cellRef: string;
  value: unknown;
  source: CellSource;
  note?: string | null;
  fileId?: string | null;
}

/**
 * Many cell writes to one part in one transaction (ingest writes ~2,000 cells per file): same rules as
 * recordCellInput (Final refused, koreksi needs a note, unchanged cells skipped), one audit row per changed
 * cell, inserted in bulk. Returns the refs that changed.
 */
export async function recordCellInputs(
  db: DbOrTx,
  partId: string,
  writes: CellWrite[],
  opts: { userId?: string | null; reason?: string | null; allowFinal?: boolean } = {},
): Promise<string[]> {
  for (const w of writes) if (w.source === "koreksi" && !w.note?.trim()) throw new NoteRequiredError(w.cellRef);
  if (!writes.length) return [];
  return db.transaction(async (tx) => {
    const [part] = await tx
      .select({ assessmentId: assessmentParts.assessmentId, status: assessments.status })
      .from(assessmentParts)
      .innerJoin(assessments, eq(assessments.id, assessmentParts.assessmentId))
      .where(eq(assessmentParts.id, partId));
    if (!part) throw new Error(`Assessment part ${partId} not found`);
    if (part.status === "final" && !opts.allowFinal) throw new AssessmentFinalError(part.assessmentId);

    const existing = new Map(
      (await tx.select().from(cellInputs).where(eq(cellInputs.partId, partId))).map((c) => [c.cellRef, c]),
    );
    const changed = writes.filter((w) => {
      const e = existing.get(w.cellRef);
      if (!e) return w.value !== null && w.value !== undefined;
      return JSON.stringify(e.value ?? null) !== JSON.stringify(w.value ?? null) || e.source !== w.source || (e.note ?? null) !== (w.note ?? null);
    });
    if (!changed.length) return [];
    const now = sql`now()`;
    const userId = opts.userId ?? null;
    const BATCH = 500;
    for (let i = 0; i < changed.length; i += BATCH) {
      const chunk = changed.slice(i, i + BATCH);
      await tx
        .insert(cellInputs)
        .values(chunk.map((w) => ({ partId, cellRef: w.cellRef, value: w.value ?? null, source: w.source, note: w.note ?? null, fileId: w.fileId ?? null, updatedBy: userId, updatedAt: now })))
        .onConflictDoUpdate({
          target: [cellInputs.partId, cellInputs.cellRef],
          set: {
            value: sql`excluded.value`,
            source: sql`excluded.source`,
            note: sql`excluded.note`,
            fileId: sql`excluded.file_id`,
            updatedBy: sql`excluded.updated_by`,
            updatedAt: now,
          },
        });
      await tx.insert(auditLog).values(
        chunk.map((w) => ({
          event: (w.source === "koreksi" ? "koreksi" : "cell") as AuditEvent,
          assessmentId: part.assessmentId,
          partId,
          cellRef: w.cellRef,
          oldValue: existing.get(w.cellRef)?.value ?? null,
          newValue: w.value ?? null,
          reason: opts.reason ?? w.note ?? null,
          userId,
        })),
      );
    }
    return changed.map((w) => w.cellRef);
  });
}

export interface LogEventInput {
  event: AuditEvent;
  assessmentId?: string | null;
  partId?: string | null;
  cellRef?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  userId?: string | null;
}

/** Any non-cell event for the activity log (ingest, version, status, finalize, reopen, Sumber BI, ...). */
export async function logEvent(db: DbOrTx, e: LogEventInput) {
  await db.insert(auditLog).values({
    event: e.event,
    assessmentId: e.assessmentId ?? null,
    partId: e.partId ?? null,
    cellRef: e.cellRef ?? null,
    oldValue: e.oldValue ?? null,
    newValue: e.newValue ?? null,
    reason: e.reason ?? null,
    userId: e.userId ?? null,
  });
}

/** Every stored input of a part, keyed by cell ref. Used by the grid and the export, so they never disagree. */
export async function loadCellValues(db: DbOrTx, partId: string): Promise<Map<string, unknown>> {
  const rows = await db.select().from(cellInputs).where(eq(cellInputs.partId, partId));
  return new Map(rows.map((r) => [r.cellRef, r.value]));
}
