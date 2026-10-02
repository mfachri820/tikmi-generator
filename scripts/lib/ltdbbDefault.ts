import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Db } from "@ira/db";
import { importLtdbb } from "@ira/ltdbb";

/**
 * The LTDBB workbook kept in the repo root (gitignored) is the default
 * transaction data until pengawas can upload newer files. Resolved against
 * the working directory, which is the repo root for every npm script.
 */
export const DEFAULT_LTDBB_FILE = process.env.IRA_LTDBB_FILE ?? resolve("Data LTDBB PJP LR JKT.xlsx");

export async function importLtdbbFile(db: Db, path: string, userId: string | null) {
  const { upload, existing } = await importLtdbb(db, {
    buffer: readFileSync(path),
    filename: basename(path),
    source: "seed",
    userId,
  });
  const report = upload.report as { flagCounts?: Record<string, number> } | null;
  console.log(
    existing
      ? `LTDBB file already imported as upload ${upload.id} (same sha256); nothing to do.`
      : `Imported LTDBB upload ${upload.id}: ${upload.rowCount} rows, ${upload.minDate} .. ${upload.maxDate}, now active.`,
  );
  if (!existing && report?.flagCounts) console.log("  Row flags:", JSON.stringify(report.flagCounts));
  return upload;
}
