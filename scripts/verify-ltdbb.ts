#!/usr/bin/env tsx
/**
 * Checks the active LTDBB upload against the 2026 template's own "Validasi
 * Data Transaksi" sheet (2025 data, filled by hand before this app existed):
 * `aggregateYear(..., 2025)` must reproduce columns F-K within ±1 for at least
 * 76 of the 85 PJPs, hit the spot-check values exactly, and flag exactly the
 * expected NOT_IN_LTDBB / INCOMPLETE_YEAR PJPs. A few PJPs are known to differ
 * because LTDBB was revised after the template was filled; they're reported,
 * not counted as failures.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/verify-ltdbb.ts
 */
import ExcelJS from "exceljs";
import { createDb, templateVersions } from "@ira/db";
import { AMOUNT_TOLERANCE, aggregateYear, getActiveLtdbbUpload, type PjpYearTotals } from "@ira/ltdbb";

const DATA_YEAR = 2025;
const MIN_MATCHING = 76;
const COLUMNS: [string, keyof PjpYearTotals][] = [
  ["F", "finJumlahInc"], ["G", "finNilaiInc"], ["H", "finJumlahOut"],
  ["I", "finNilaiOut"], ["J", "finJumlahDom"], ["K", "finNilaiDom"],
];
const SPOT_CHECKS: Record<string, number[]> = {
  "777958119": [108801, 774682312523, 7250, 44089687700, 3, 59050000],
  "777958122": [12955, 98727824565, 1110, 10459171102, 7, 17447050],
  "777958138": [0, 0, 9, 1838486709, 0, 0],
};
/** LTDBB revised after the template was filled (777930079 also gets the Indomarco override). */
const EXPECTED_DIFFERENCES = new Set(["777930079", "777930065", "777930048", "777958116"]);
const EXPECTED_NOT_IN_LTDBB = ["777930157", "777962497", "777930038", "777962104", "777930045"];
const EXPECTED_INCOMPLETE: Record<string, number[]> = {
  ...Object.fromEntries(
    ["777930115", "777958117", "777930064", "777930112", "777930100", "777930075", "777930051",
     "777930028", "777930118", "777951823", "777958113", "777111113"].map((s) => [s, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]),
  ),
  "777930152": [8, 9, 10, 11, 12],
};

const cached = (v: ExcelJS.CellValue) =>
  v !== null && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v;

async function main() {
  const db = createDb();
  const upload = await getActiveLtdbbUpload(db);
  if (!upload) throw new Error("No active LTDBB upload; run npm run import-ltdbb first.");
  const [template] = await db.select().from(templateVersions).limit(1);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(template.xlsxBase64, "base64") as unknown as ArrayBuffer);
  const sheet = wb.getWorksheet("Validasi Data Transaksi")!;
  const expected = new Map<string, number[]>();
  for (let r = 2; r <= sheet.rowCount; r++) {
    const sandi = String(cached(sheet.getCell(`A${r}`).value) ?? "").trim();
    if (sandi) expected.set(sandi, COLUMNS.map(([col]) => Number(cached(sheet.getCell(`${col}${r}`).value) ?? 0)));
  }

  const { rows, unknownKodes } = await aggregateYear(db, upload.id, DATA_YEAR);
  const failures: string[] = [];
  let matching = 0;
  for (const row of rows) {
    const want = expected.get(row.sandi);
    if (!want) {
      failures.push(`${row.sandi}: not in the template's Validasi sheet`);
      continue;
    }
    const got = COLUMNS.map(([, key]) => row[key]);
    const diffs = COLUMNS.filter((_, i) => Math.abs(got[i] - want[i]) > AMOUNT_TOLERANCE).map(
      ([col], i) => `${col} ${got[COLUMNS.findIndex(([c]) => c === col)]} vs ${want[COLUMNS.findIndex(([c]) => c === col)]}`,
    );
    if (diffs.length === 0) matching++;
    else console.log(`${EXPECTED_DIFFERENCES.has(row.sandi) ? "expected diff" : "DIFF"} ${row.sandi} ${row.nama}: ${diffs.join("; ")}`);
    if (diffs.length && !EXPECTED_DIFFERENCES.has(row.sandi) && !row.flags.includes("NOT_IN_LTDBB")) {
      failures.push(`${row.sandi}: unexpected difference`);
    }
  }
  console.log(`\nF-K within ±${AMOUNT_TOLERANCE}: ${matching}/${rows.length} PJPs (need >= ${MIN_MATCHING})`);
  if (matching < MIN_MATCHING) failures.push(`only ${matching} PJPs match`);

  for (const [sandi, want] of Object.entries(SPOT_CHECKS)) {
    const row = rows.find((r) => r.sandi === sandi)!;
    const got = COLUMNS.map(([, key]) => row[key]);
    const ok = got.every((g, i) => Math.abs(g - want[i]) <= AMOUNT_TOLERANCE);
    console.log(`spot check ${sandi}: ${ok ? "ok" : `FAIL got ${got.join(", ")}`}`);
    if (!ok) failures.push(`spot check ${sandi}`);
  }

  const notIn = rows.filter((r) => r.flags.includes("NOT_IN_LTDBB")).map((r) => r.sandi).sort();
  const okNotIn = JSON.stringify(notIn) === JSON.stringify([...EXPECTED_NOT_IN_LTDBB].sort());
  console.log(`NOT_IN_LTDBB: ${notIn.join(", ")} ${okNotIn ? "(as expected)" : "(UNEXPECTED)"}`);
  if (!okNotIn) failures.push("NOT_IN_LTDBB list");
  const indomarco = rows.find((r) => r.sandi === "777958116");
  console.log(`777958116 Indomarco after override: months ${indomarco?.monthsPresent.join(",") || "none"}`);

  const incomplete = rows.filter((r) => r.flags.includes("INCOMPLETE_YEAR"));
  for (const r of incomplete) {
    const want = EXPECTED_INCOMPLETE[r.sandi];
    const ok = want && JSON.stringify(want) === JSON.stringify(r.monthsPresent);
    if (!ok) failures.push(`INCOMPLETE_YEAR ${r.sandi} months ${r.monthsPresent.join(",")}`);
  }
  const missingIncomplete = Object.keys(EXPECTED_INCOMPLETE).filter((s) => !incomplete.some((r) => r.sandi === s));
  if (missingIncomplete.length) failures.push(`not flagged INCOMPLETE_YEAR: ${missingIncomplete.join(", ")}`);
  console.log(`INCOMPLETE_YEAR: ${incomplete.length} PJPs (expected ${Object.keys(EXPECTED_INCOMPLETE).length})`);
  if (unknownKodes.length) console.log(`LTDBB codes not in the PJP list: ${unknownKodes.map((u) => `${u.kode} ${u.namaLtdbb}`).join("; ")}`);

  console.log(failures.length ? `\nFAILED:\n- ${failures.join("\n- ")}` : "\nAll LTDBB checks passed.");
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
