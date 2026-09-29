#!/usr/bin/env tsx
/**
 * Phase 0 gate: for every 2026 IRA workbook, @ira/scoring must reproduce the
 * cached rekap values (A2 F60:F71, R60:R71, S60:S71) and KPMR H46/J46 to
 * 2 decimals. This reads each fixture's raw C2/A2/KPMR cell values (not its
 * formulas), builds a WorkbookScoringInput, runs it through the engine using
 * config/2026.ts, and diffs the result against the cached values.
 *
 * Reads fixtures from IRA_FIXTURES_DIR, never from this repo (see ground rules).
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { computeWorkbookScores, type ParameterInput, type KpmrAnswerInput } from "@ira/scoring";
import { scoringConfig2026, parameterShareRefs } from "../packages/scoring/config/2026";
import {
  computeC2Derived,
  totalTransactionCellRef,
  dataMismatchToleranceRupiah,
} from "../packages/scoring/config/2026-c2";

const A2_SHEET = "A2. PJP ALL peng";
const KPMR_SHEET = "B. KPMR 2025";
const C2_SHEET = "C2. Form PJP LR";
const VALIDASI_SHEET = "Validasi Data Transaksi";
const TOLERANCE = 0.005; // "to 2 decimals"

function numericCellValue(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw === "object" && "result" in (raw as Record<string, unknown>)) {
    const result = (raw as { result: unknown }).result;
    return typeof result === "number" ? result : 0;
  }
  return typeof raw === "number" ? raw : 0;
}

function rawCellValue(raw: unknown): unknown {
  if (raw != null && typeof raw === "object" && "result" in (raw as Record<string, unknown>)) {
    return (raw as { result: unknown }).result;
  }
  return raw;
}

/**
 * Finds the pengawas score column on the A2 sheet by header text, not letter:
 * one 2026 file (PT Omnipay Transfer Dana) has an extra column shifting
 * pengawas scores from O to P.
 */
function findPengawasColumn(sheet: ExcelJS.Worksheet): string {
  const headerRow = sheet.getRow(3);
  const matches: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    const text = rawCellValue(cell.value);
    if (typeof text === "string" && text.trim() === "Nilai\n(1-5)") {
      matches.push(cell.address.replace(/\d+/, ""));
    }
  });
  if (matches.length < 2) {
    throw new Error(`Expected 2 "Nilai (1-5)" header columns, found ${matches.length}`);
  }
  return matches[matches.length - 1];
}

function cellRange(column: string, from: number, to: number): string[] {
  const addresses: string[] = [];
  for (let row = from; row <= to; row++) addresses.push(`${column}${row}`);
  return addresses;
}

/** Reads every plain-number cell in C2's column C -- the sheet's actual typed inputs, skipping formulas and labels. */
function readRawC2Values(c2: ExcelJS.Worksheet): Record<string, number> {
  const raw: Record<string, number> = {};
  for (let row = 1; row <= c2.rowCount; row++) {
    const value = c2.getCell(`C${row}`).value;
    if (typeof value === "number") raw[`C${row}`] = value;
  }
  return raw;
}

/**
 * Replicates C2!H18's `XLOOKUP` against BI's reference sheet: finds the row
 * whose "Sandi - Nama" matches and returns its Total Nominal (column M).
 */
function findBiTotalNominal(workbook: ExcelJS.Workbook, sandiNama: string): number {
  const sheet = workbook.getWorksheet(VALIDASI_SHEET);
  if (!sheet) throw new Error(`Sheet "${VALIDASI_SHEET}" not found`);
  for (let row = 2; row <= sheet.rowCount; row++) {
    if (rawCellValue(sheet.getCell(`C${row}`).value) === sandiNama) {
      return numericCellValue(sheet.getCell(`M${row}`).value);
    }
  }
  throw new Error(`No "${VALIDASI_SHEET}" row matches "${sandiNama}"`);
}

function findWorkbookFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...findWorkbookFiles(full));
    } else if (entry.startsWith("IRA_") && entry.endsWith(".xlsx")) {
      files.push(full);
    }
  }
  return files;
}

interface Check {
  label: string;
  expected: unknown;
  actual: unknown;
}

function checkNumber(label: string, expected: unknown, actual: number, checks: Check[]) {
  const exp = typeof expected === "number" ? expected : Number(expected);
  const pass = Number.isFinite(exp) ? Math.abs(exp - actual) <= TOLERANCE : expected == null;
  checks.push({ label, expected, actual: pass ? actual : `${actual} (FAIL)` });
  return pass;
}

function checkLabel(label: string, expected: unknown, actual: string, checks: Check[]) {
  const pass = expected === actual;
  checks.push({ label, expected, actual: pass ? actual : `${actual} (FAIL)` });
  return pass;
}

async function scoreFile(filePath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const c2 = workbook.getWorksheet(C2_SHEET)!;
  const a2 = workbook.getWorksheet(A2_SHEET)!;
  const kpmrSheet = workbook.getWorksheet(KPMR_SHEET)!;
  const pengawasColumn = findPengawasColumn(a2);

  // Derive every share from C2's raw typed C-column values (never a cached D-column
  // or H18 result), so this proves the C2 formula porting, not just A2/KPMR.
  const rawC = readRawC2Values(c2);
  const derivedC2 = computeC2Derived(rawC);
  const c2Values: Record<string, number> = { ...rawC, ...derivedC2 };

  const parameters: ParameterInput[] = scoringConfig2026.parameters.map((p) => {
    const row = Number(p.id);
    const pengawasRaw = a2.getRow(row).getCell(pengawasColumn).value;
    const pengawasScore = numericCellValue(pengawasRaw) as ParameterInput["pengawasScore"];
    if (p.kind === "manual") {
      return { id: p.id, pengawasScore };
    }
    const refs = parameterShareRefs[p.id] ?? [];
    const share = refs.reduce((sum, ref) => sum + (c2Values[ref] ?? 0), 0);
    return { id: p.id, share, pengawasScore };
  });

  const kpmrAnswers: KpmrAnswerInput[] = scoringConfig2026.kpmrQuestions.map((q) => {
    const hCell = kpmrSheet.getCell(q.cellRef.split("!")[1]).value;
    const jCell = kpmrSheet.getCell(q.pengawasCellRef.split("!")[1]).value;
    const pjpRaw = rawCellValue(hCell);
    const pengawasRaw = rawCellValue(jCell);
    return {
      id: q.id,
      pjpScore: typeof pjpRaw === "number" ? pjpRaw : undefined,
      pengawasScore: typeof pengawasRaw === "number" ? pengawasRaw : undefined,
    };
  });

  // Replicates C2!H18: IF(ABS(C18-G18)<=1000,"Sesuai","Perbedaan Data").
  const sandiNama = rawCellValue(c2.getCell("B2").value) as string;
  const biTotalNominal = findBiTotalNominal(workbook, sandiNama);
  const selfReportedTotal = c2Values[totalTransactionCellRef];
  const hasDataMismatch = Math.abs(selfReportedTotal - biTotalNominal) > dataMismatchToleranceRupiah;

  const result = computeWorkbookScores(scoringConfig2026, {
    parameters,
    kpmrAnswers,
    hasDataMismatch,
  });

  const checks: Check[] = [];
  let allPass = true;
  const cat = (name: keyof typeof scoringConfig2026.categoryWeights, side: "pjp" | "pengawas") =>
    scoringConfig2026.categoryWeights[name] * result.categoryScores[side][name];

  const categoryRows: [string, keyof typeof scoringConfig2026.categoryWeights][] = [
    ["60", "TPPU"],
    ["61", "TPPT"],
    ["62", "PPSPM"],
    ["63", "Struktural"],
  ];

  for (const [row, category] of categoryRows) {
    allPass &&= checkNumber(
      `F${row} (${category})`,
      numericCellValue(a2.getCell(`F${row}`).value),
      cat(category, "pjp"),
      checks,
    );
    allPass &&= checkNumber(
      `R${row} (${category})`,
      numericCellValue(a2.getCell(`R${row}`).value),
      cat(category, "pengawas"),
      checks,
    );
  }

  allPass &&= checkNumber("F64", numericCellValue(a2.getCell("F64").value), result.inherentScore.pjp, checks);
  allPass &&= checkLabel(
    "F65",
    rawCellValue(a2.getCell("F65").value),
    result.inherentPredikat.pjp,
    checks,
  );
  allPass &&= checkNumber("F67", numericCellValue(a2.getCell("F67").value), result.kpmrOverall.pjp, checks);
  allPass &&= checkLabel("F68", rawCellValue(a2.getCell("F68").value), result.kpmrPredikat.pjp, checks);
  allPass &&= checkNumber("F70", numericCellValue(a2.getCell("F70").value), result.finalIra.pjp, checks);
  allPass &&= checkLabel(
    "F71",
    rawCellValue(a2.getCell("F71").value),
    result.finalIraPredikat.pjp,
    checks,
  );

  allPass &&= checkNumber("R64", numericCellValue(a2.getCell("R64").value), result.inherentScore.pengawas, checks);
  allPass &&= checkLabel(
    "R65",
    rawCellValue(a2.getCell("R65").value),
    result.inherentPredikat.pengawas,
    checks,
  );
  allPass &&= checkNumber("R67", numericCellValue(a2.getCell("R67").value), result.kpmrOverall.pengawas, checks);
  allPass &&= checkLabel("R68", rawCellValue(a2.getCell("R68").value), result.kpmrPredikat.pengawas, checks);
  allPass &&= checkNumber("R70", numericCellValue(a2.getCell("R70").value), result.finalIra.pengawasRaw, checks);
  allPass &&= checkLabel(
    "R71",
    rawCellValue(a2.getCell("R71").value),
    result.finalIraPredikat.pengawasRaw,
    checks,
  );

  allPass &&= checkNumber("S70", numericCellValue(a2.getCell("S70").value), result.finalIra.pengawasAdjusted, checks);
  allPass &&= checkLabel(
    "S71",
    rawCellValue(a2.getCell("S71").value),
    result.finalIraPredikat.pengawasAdjusted,
    checks,
  );

  return { allPass, checks };
}

async function main() {
  const fixturesDir = process.env.IRA_FIXTURES_DIR;
  if (!fixturesDir) {
    console.error("Set IRA_FIXTURES_DIR to the folder holding the 66 IRA_<Sandi> workbooks.");
    process.exit(1);
  }

  const files = findWorkbookFiles(fixturesDir);
  console.log(`Found ${files.length} workbook(s) under ${fixturesDir}\n`);

  let passCount = 0;
  const failures: { file: string; checks: Check[] }[] = [];

  for (const file of files) {
    try {
      const { allPass, checks } = await scoreFile(file);
      if (allPass) {
        passCount++;
      } else {
        failures.push({ file, checks: checks.filter((c) => String(c.actual).includes("FAIL")) });
      }
    } catch (err) {
      failures.push({
        file,
        checks: [{ label: "error", expected: "-", actual: String(err) }],
      });
    }
  }

  console.log(`PASS: ${passCount}/${files.length}\n`);

  for (const f of failures.slice(0, 10)) {
    console.log(`FAIL ${f.file}`);
    for (const c of f.checks) {
      console.log(`  ${c.label}: expected=${JSON.stringify(c.expected)} actual=${c.actual}`);
    }
  }
  if (failures.length > 10) {
    console.log(`... and ${failures.length - 10} more failing file(s)`);
  }
}

main();
