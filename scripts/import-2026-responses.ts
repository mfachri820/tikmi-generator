#!/usr/bin/env tsx
/**
 * One-time backfill of the 2026 form responses (sheet `Raw_Data_IRA` in
 * `[Master] Rekap_IRA.xlsx`) into `form_submissions`, for development seeding
 * only. Live ingest goes through /api/ingest keyed by Apps Script item ID
 * (see the build plan); this script keys by header text, which is only safe
 * for the historical snapshot, not for the 2027 form's duplicate labels.
 *
 * A PJP that responded more than once gets one latest submission, chosen by
 * the sheet's Timestamp (row order isn't submission order in the real sheet),
 * and never over a newer one already in the database from /api/ingest.
 * Re-running skips rows already imported.
 */
import ExcelJS from "exceljs";
import { and, eq, sql } from "drizzle-orm";
import { findColumnByHeader } from "@ira/template";
import { createDb, formSubmissions, workbooks } from "@ira/db";

const SHEET_NAME = "Raw_Data_IRA";
const HEADER_ROW = 1;
// Verified against the real Raw_Data_IRA headers (column 1 and 2).
const TIMESTAMP_HEADER = "Timestamp";
const SANDI_HEADER = "Sandi PJP";

interface Response {
  sandi: string;
  submittedAt: Date;
  raw: Record<string, unknown>;
  sheetRow: number;
}

async function main() {
  const args = process.argv.slice(2);
  const [masterFilePath, periodId] = args.filter((a) => !a.startsWith("--"));
  // A dev database seeded with a few workbooks: only bring in those PJPs' responses.
  const onlyWithWorkbook = args.includes("--only-with-workbook");
  if (!masterFilePath || !periodId) {
    console.error(
      "Usage: tsx scripts/import-2026-responses.ts <[Master] Rekap_IRA.xlsx> <periods.id> [--only-with-workbook]",
    );
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(masterFilePath);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet "${SHEET_NAME}" not found in ${masterFilePath}`);
  }

  const sandiCol = findColumnByHeader(sheet, HEADER_ROW, SANDI_HEADER);
  const timestampCol = findColumnByHeader(sheet, HEADER_ROW, TIMESTAMP_HEADER);
  if (!sandiCol || !timestampCol) {
    throw new Error(`Could not find headers "${SANDI_HEADER}" and "${TIMESTAMP_HEADER}" in row ${HEADER_ROW}`);
  }

  const headers = new Map<number, string>();
  sheet.getRow(HEADER_ROW).eachCell({ includeEmpty: false }, (cell, col) => {
    headers.set(col, String(cell.value ?? ""));
  });

  const byPjp = new Map<string, Response[]>();
  for (let rowNumber = HEADER_ROW + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const [sandi] = String(row.getCell(sandiCol).value ?? "").split(" - ");
    if (!sandi.trim()) continue;

    const submittedAt = row.getCell(timestampCol).value;
    if (!(submittedAt instanceof Date)) {
      throw new Error(`Row ${rowNumber}: "${TIMESTAMP_HEADER}" is not a date, so its order can't be known`);
    }

    const raw: Record<string, unknown> = {};
    for (const [col, header] of headers) {
      raw[header] = row.getCell(col).value;
    }
    const responses = byPjp.get(sandi.trim()) ?? [];
    responses.push({ sandi: sandi.trim(), submittedAt, raw, sheetRow: rowNumber });
    byPjp.set(sandi.trim(), responses);
  }

  const db = createDb();
  if (onlyWithWorkbook) {
    const withWorkbook = new Set(
      (await db.select({ sandi: workbooks.pjpSandi }).from(workbooks).where(eq(workbooks.periodId, periodId))).map((w) => w.sandi),
    );
    for (const sandi of byPjp.keys()) if (!withWorkbook.has(sandi)) byPjp.delete(sandi);
  }
  let imported = 0;
  let skipped = 0;
  let multiple = 0;

  for (const [sandi, responses] of byPjp) {
    if (responses.length > 1) multiple++;
    // Newest first; on an identical timestamp the later sheet row wins.
    responses.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime() || b.sheetRow - a.sheetRow);

    await db.transaction(async (tx) => {
      // Same lock as /api/ingest, so a live submission can't land halfway through this PJP.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ingest:${periodId}:${sandi}`}))`);

      const ofThisPjp = and(eq(formSubmissions.pjpSandi, sandi), eq(formSubmissions.periodId, periodId));
      const existing = await tx
        .select({ sheetRow: formSubmissions.sheetRow, submittedAt: formSubmissions.submittedAt, isLatest: formSubmissions.isLatest })
        .from(formSubmissions)
        .where(ofThisPjp);
      const alreadyImported = new Set(existing.map((e) => e.sheetRow));
      const currentLatest = existing.find((e) => e.isLatest)?.submittedAt;

      const toImport = responses.filter((r) => !alreadyImported.has(r.sheetRow));
      skipped += responses.length - toImport.length;
      if (!toImport.length) return;

      const newest = toImport[0];
      const newestWins = !currentLatest || newest.submittedAt >= currentLatest;
      if (newestWins) await tx.update(formSubmissions).set({ isLatest: false }).where(ofThisPjp);

      for (const r of toImport) {
        await tx.insert(formSubmissions).values({
          pjpSandi: sandi,
          periodId,
          submittedAt: r.submittedAt,
          rawJsonb: r.raw,
          sheetRow: r.sheetRow,
          isLatest: newestWins && r === newest,
        });
        imported++;
      }
    });
  }

  console.log(
    `Imported ${imported} response(s) into form_submissions (${skipped} already there); ` +
      `${multiple} PJP responded more than once and are scored on their latest.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
