#!/usr/bin/env tsx
/**
 * Phase 0 gate: for every 2026 IRA workbook, the engine must reproduce the
 * cached rekap values (A2 F60:F71, R60:R71, S60:S71) and KPMR H46/J46 to
 * 2 decimals. This step extracts those cached values as a golden baseline;
 * comparing them against the @ira/scoring engine's output needs the 2026
 * scoring config and field mappings, which are still open decisions.
 *
 * Reads fixtures from IRA_FIXTURES_DIR, never from this repo (see ground rules).
 */
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

function cellRange(column: string, from: number, to: number): string[] {
  const addresses: string[] = [];
  for (let row = from; row <= to; row++) addresses.push(`${column}${row}`);
  return addresses;
}

const GOLDEN_CELLS: Record<string, string[]> = {
  "A2. PJP ALL peng": [
    ...cellRange("F", 60, 71),
    ...cellRange("R", 60, 71),
    ...cellRange("S", 60, 71),
  ],
  "B. KPMR 2025": ["H46", "J46"],
};

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

async function extractGolden(filePath: string): Promise<Record<string, unknown>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const values: Record<string, unknown> = {};
  for (const [sheetName, addresses] of Object.entries(GOLDEN_CELLS)) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) {
      console.warn(`  ! sheet "${sheetName}" not found in ${filePath}`);
      continue;
    }
    for (const address of addresses) {
      values[`${sheetName}!${address}`] = sheet.getCell(address).value;
    }
  }
  return values;
}

async function main() {
  const fixturesDir = process.env.IRA_FIXTURES_DIR;
  if (!fixturesDir) {
    console.error("Set IRA_FIXTURES_DIR to the folder holding the 66 IRA_<Sandi> workbooks.");
    process.exit(1);
  }

  const files = findWorkbookFiles(fixturesDir);
  console.log(`Found ${files.length} workbook(s) under ${fixturesDir}`);

  const golden: Record<string, Record<string, unknown>> = {};
  for (const file of files) {
    golden[file] = await extractGolden(file);
  }

  const outPath = "golden-values.json";
  writeFileSync(outPath, JSON.stringify(golden, null, 2));
  console.log(`Wrote cached golden values for ${files.length} file(s) to ${outPath}`);
  console.log(
    "TODO once the 2026 scoring config + field mappings exist: run @ira/scoring " +
      "against each file's form inputs and diff against these cached values.",
  );
}

main();
