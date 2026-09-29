#!/usr/bin/env tsx
/**
 * One-time backfill of the 2026 form responses (sheet `Raw_Data_IRA` in
 * `[Master] Rekap_IRA.xlsx`) into `form_submissions`, for development seeding
 * only. Live ingest goes through /api/ingest keyed by Apps Script item ID
 * (see the build plan); this script keys by header text, which is only safe
 * for the historical snapshot, not for the 2027 form's duplicate labels.
 */
import ExcelJS from "exceljs";
import { findColumnByHeader } from "@ira/template";
import { createDb, formSubmissions } from "@ira/db";

const SHEET_NAME = "Raw_Data_IRA";
const HEADER_ROW = 1;
// TODO: confirm this matches the real header text in Raw_Data_IRA.
const SANDI_NAMA_HEADER = "Sandi - Nama";

async function main() {
  const [, , masterFilePath, periodId] = process.argv;
  if (!masterFilePath || !periodId) {
    console.error(
      "Usage: tsx scripts/import-2026-responses.ts <[Master] Rekap_IRA.xlsx> <periods.id>",
    );
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(masterFilePath);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet "${SHEET_NAME}" not found in ${masterFilePath}`);
  }

  const sandiCol = findColumnByHeader(sheet, HEADER_ROW, SANDI_NAMA_HEADER);
  if (!sandiCol) {
    throw new Error(`Could not find header "${SANDI_NAMA_HEADER}" in row ${HEADER_ROW}`);
  }

  const headers = new Map<number, string>();
  sheet.getRow(HEADER_ROW).eachCell({ includeEmpty: false }, (cell, col) => {
    headers.set(col, String(cell.value ?? ""));
  });

  const db = createDb();
  let imported = 0;

  for (let rowNumber = HEADER_ROW + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const sandiNama = String(row.getCell(sandiCol).value ?? "");
    if (!sandiNama.trim()) continue;

    const [sandi] = sandiNama.split(" - ");
    const raw: Record<string, unknown> = {};
    for (const [col, header] of headers) {
      raw[header] = row.getCell(col).value;
    }

    await db.insert(formSubmissions).values({
      pjpSandi: sandi.trim(),
      periodId,
      submittedAt: new Date(), // TODO: use the sheet's own timestamp column once confirmed
      rawJsonb: raw,
      sheetRow: rowNumber,
      isLatest: true,
    });
    imported++;
  }

  console.log(`Imported ${imported} response(s) into form_submissions.`);
}

main();
