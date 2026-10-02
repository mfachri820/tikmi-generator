import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { ltdbbCodeOverrides, ltdbbMonthly, ltdbbUploads, type Db } from "@ira/db";
import { LtdbbParseError, parseLtdbb } from "./parse";

export type LtdbbUpload = typeof ltdbbUploads.$inferSelect;

const INSERT_BATCH = 1000;

export async function getActiveLtdbbUpload(db: Db): Promise<LtdbbUpload | null> {
  const [active] = await db.select().from(ltdbbUploads).where(eq(ltdbbUploads.isActive, true)).limit(1);
  return active ?? null;
}

/** Makes `uploadId` the one active upload (the partial unique index allows only one). */
export async function activateLtdbbUpload(db: Db, uploadId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(ltdbbUploads).set({ isActive: false }).where(eq(ltdbbUploads.isActive, true));
    await tx.update(ltdbbUploads).set({ isActive: true }).where(eq(ltdbbUploads.id, uploadId));
  });
}

/**
 * Parses an LTDBB workbook and stores it as a new `ltdbb_uploads` snapshot,
 * active by default. The same file (by sha256) is never imported twice: the
 * existing upload is returned instead. A file that can't be parsed is kept as
 * a `failed` upload with the reason in `report.error`, and the error is
 * rethrown. Used by `scripts/import-ltdbb.ts` for the default data, and by the
 * upload route once pengawas can upload new files.
 */
export async function importLtdbb(
  db: Db,
  input: {
    buffer: Buffer;
    filename: string;
    source: "seed" | "upload";
    blobUrl?: string | null;
    userId?: string | null;
    activate?: boolean;
  },
): Promise<{ upload: LtdbbUpload; existing: boolean }> {
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const [existing] = await db.select().from(ltdbbUploads).where(eq(ltdbbUploads.sha256, sha256)).limit(1);
  if (existing) return { upload: existing, existing: true };

  const [upload] = await db
    .insert(ltdbbUploads)
    .values({
      filename: input.filename,
      source: input.source,
      blobUrl: input.blobUrl ?? null,
      sha256,
      uploadedBy: input.userId ?? null,
      status: "parsing",
    })
    .returning();

  const overrides = new Map(
    (await db.select().from(ltdbbCodeOverrides)).map((o) => [o.namaLtdbb, o.kode] as const),
  );

  let parsed: Awaited<ReturnType<typeof parseLtdbb>>;
  try {
    parsed = await parseLtdbb(input.buffer, overrides);
  } catch (err) {
    const message = err instanceof LtdbbParseError ? err.message : `Gagal membaca file: ${String(err)}`;
    await db.update(ltdbbUploads).set({ status: "failed", report: { error: message } }).where(eq(ltdbbUploads.id, upload.id));
    throw err instanceof LtdbbParseError ? err : new LtdbbParseError(message);
  }

  const { rows, report } = parsed;
  const ready = await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      await tx.insert(ltdbbMonthly).values(rows.slice(i, i + INSERT_BATCH).map((row) => ({ uploadId: upload.id, ...row })));
    }
    const [updated] = await tx
      .update(ltdbbUploads)
      .set({
        status: "ready",
        rowCount: report.rowCount,
        minDate: report.minDate,
        maxDate: report.maxDate,
        report,
      })
      .where(eq(ltdbbUploads.id, upload.id))
      .returning();
    return updated;
  });

  if (input.activate ?? true) {
    await activateLtdbbUpload(db, ready.id);
    ready.isActive = true;
  }
  return { upload: ready, existing: false };
}
