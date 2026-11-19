import { createHash } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { logEvent, sumberBiRows, sumberBiUploads, type Db, type DbOrTx } from "@tikmi/db";
import { parseSumberBi, type ParseOptions, type SumberBiKind, type SumberBiRow } from "./parse";

export type SumberBiUpload = typeof sumberBiUploads.$inferSelect;

export interface ImportSumberBiInput extends ParseOptions {
  periodId: string;
  xlsx: Buffer;
  filename: string;
  source: "seed" | "upload";
  /** Private storage object holding the original (uploads); null for seeds. */
  storageKey?: string | null;
  userId?: string | null;
  /** Make it the active data for (period, kind) once parsed. Default true. */
  activate?: boolean;
}

export type ImportSumberBiResult =
  | { status: "imported"; upload: SumberBiUpload }
  /** Identical file already imported for this period and kind: nothing new stored. */
  | { status: "duplicate"; upload: SumberBiUpload }
  | { status: "failed"; upload: SumberBiUpload; error: string };

const BATCH = 1000;

/**
 * Stores a Sumber BI file as a new snapshot: one `sumber_bi_uploads` row
 * (deduplicated by sha256 per period + kind) and its rows in file order. A
 * file that does not parse is kept as `failed` with the reason, and is never
 * activated. Activation and the activity-log entry happen in one transaction.
 */
export async function importSumberBi(db: Db, input: ImportSumberBiInput): Promise<ImportSumberBiResult> {
  const sha256 = createHash("sha256").update(input.xlsx).digest("hex");
  const [existing] = await db
    .select()
    .from(sumberBiUploads)
    .where(and(eq(sumberBiUploads.periodId, input.periodId), eq(sumberBiUploads.kind, input.kind), eq(sumberBiUploads.sha256, sha256)));
  if (existing) return { status: "duplicate", upload: existing };

  const [upload] = await db
    .insert(sumberBiUploads)
    .values({
      periodId: input.periodId,
      kind: input.kind,
      source: input.source,
      filename: input.filename,
      storageKey: input.storageKey ?? null,
      sha256,
      uploadedBy: input.userId ?? null,
      status: "parsing",
    })
    .returning();

  let parsed;
  try {
    parsed = await parseSumberBi(input.xlsx, input);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const [failed] = await db
      .update(sumberBiUploads)
      .set({ status: "failed", report: { error } })
      .where(eq(sumberBiUploads.id, upload.id))
      .returning();
    return { status: "failed", upload: failed, error };
  }

  const ready = await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.rows.length; i += BATCH) {
      await tx.insert(sumberBiRows).values(parsed.rows.slice(i, i + BATCH).map((r) => ({ uploadId: upload.id, ...r })));
    }
    const [row] = await tx
      .update(sumberBiUploads)
      .set({ status: "ready", rowCount: parsed.rows.length, report: parsed.report })
      .where(eq(sumberBiUploads.id, upload.id))
      .returning();
    if (input.activate ?? true) await activate(tx, row);
    await logEvent(tx, {
      event: "sumber_bi",
      newValue: { uploadId: row.id, kind: row.kind, filename: row.filename, rows: parsed.rows.length, active: input.activate ?? true },
      reason: input.source === "seed" ? "seed dari template" : "upload",
      userId: input.userId ?? null,
    });
    return input.activate ?? true ? { ...row, isActive: true } : row;
  });
  return { status: "imported", upload: ready };
}

async function activate(tx: DbOrTx, upload: SumberBiUpload) {
  await tx
    .update(sumberBiUploads)
    .set({ isActive: false })
    .where(and(eq(sumberBiUploads.periodId, upload.periodId), eq(sumberBiUploads.kind, upload.kind), eq(sumberBiUploads.isActive, true)));
  await tx.update(sumberBiUploads).set({ isActive: true }).where(eq(sumberBiUploads.id, upload.id));
}

/** Makes an earlier, successfully parsed upload the active one again. */
export async function activateSumberBiUpload(db: Db, uploadId: string, userId: string | null): Promise<SumberBiUpload> {
  return db.transaction(async (tx) => {
    const [upload] = await tx.select().from(sumberBiUploads).where(eq(sumberBiUploads.id, uploadId));
    if (!upload) throw new Error(`Sumber BI upload ${uploadId} not found`);
    if (upload.status !== "ready") throw new Error(`Upload ${uploadId} is ${upload.status}, not ready`);
    await activate(tx, upload);
    await logEvent(tx, { event: "sumber_bi", newValue: { uploadId, kind: upload.kind, activated: true }, userId });
    return { ...upload, isActive: true };
  });
}

export async function getActiveSumberBi(db: DbOrTx, periodId: string, kind: SumberBiKind): Promise<SumberBiUpload | null> {
  const [row] = await db
    .select()
    .from(sumberBiUploads)
    .where(and(eq(sumberBiUploads.periodId, periodId), eq(sumberBiUploads.kind, kind), eq(sumberBiUploads.isActive, true)));
  return row ?? null;
}

export async function listSumberBiUploads(db: DbOrTx, periodId: string): Promise<SumberBiUpload[]> {
  return db.select().from(sumberBiUploads).where(eq(sumberBiUploads.periodId, periodId)).orderBy(desc(sumberBiUploads.uploadedAt));
}

/** An upload's rows in file order (VLOOKUP order). */
export async function loadSumberBiRows(db: DbOrTx, uploadId: string): Promise<SumberBiRow[]> {
  const rows = await db
    .select({
      rowNo: sumberBiRows.rowNo,
      dataId: sumberBiRows.dataId,
      ket: sumberBiRows.ket,
      idpelapor: sumberBiRows.idpelapor,
      idx: sumberBiRows.idx,
      amount: sumberBiRows.amount,
      amountText: sumberBiRows.amountText,
    })
    .from(sumberBiRows)
    .where(eq(sumberBiRows.uploadId, uploadId))
    .orderBy(asc(sumberBiRows.rowNo));
  return rows;
}
