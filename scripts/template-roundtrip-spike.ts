#!/usr/bin/env tsx
/**
 * Phase 0 spike: does writing one input cell into a real 2026 template with
 * ExcelJS (packages/template's fillTemplate) lose anything else -- styles,
 * data validation, hidden sheets, merges, defined names, conditional
 * formatting, column widths, freeze panes? Opens a fixture, snapshots its
 * structure, runs it through fillTemplate, re-opens the output, and diffs.
 *
 * Reads its input from IRA_FIXTURES_DIR and writes its output under the
 * system temp dir, never into this repo (see ground rules).
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { fillTemplate } from "@ira/template";

const A2_SHEET = "A2. PJP ALL peng";
const C2_SHEET = "C2. Form PJP LR";

interface SheetSnapshot {
  name: string;
  state: string;
  merges: string[];
  columnWidths: (number | undefined)[];
  rowHeights: Record<number, number | undefined>;
  freezePane: unknown;
  dataValidationCount: number;
  dataValidationEntries: unknown[];
  conditionalFormattingCount: number;
  conditionalFormattingEntries: unknown[];
  cellStyleSamples: Record<string, unknown>;
}

function snapshotSheet(sheet: ExcelJS.Worksheet, sampleAddresses: string[]): SheetSnapshot {
  const merges = Object.keys((sheet as unknown as { _merges?: Record<string, unknown> })._merges ?? {});

  const columnWidths: (number | undefined)[] = [];
  for (let i = 1; i <= sheet.columnCount; i++) {
    columnWidths.push(sheet.getColumn(i).width);
  }

  const rowHeights: Record<number, number | undefined> = {};
  for (let r = 1; r <= Math.min(sheet.rowCount, 75); r++) {
    rowHeights[r] = sheet.getRow(r).height;
  }

  const dvModel = (sheet as unknown as { dataValidations?: { model?: Record<string, unknown> } })
    .dataValidations?.model;
  const dvEntries = dvModel ? Object.entries(dvModel) : [];

  const cfModel = (sheet as unknown as { conditionalFormattings?: unknown[] }).conditionalFormattings;

  const cellStyleSamples: Record<string, unknown> = {};
  for (const addr of sampleAddresses) {
    const cell = sheet.getCell(addr);
    cellStyleSamples[addr] = {
      numFmt: cell.numFmt,
      font: cell.font,
      fill: cell.fill,
      border: cell.border,
      alignment: cell.alignment,
    };
  }

  return {
    name: sheet.name,
    state: sheet.state,
    merges,
    columnWidths,
    rowHeights,
    freezePane: sheet.views,
    dataValidationCount: dvEntries.length,
    dataValidationEntries: dvEntries,
    conditionalFormattingCount: Array.isArray(cfModel) ? cfModel.length : 0,
    conditionalFormattingEntries: Array.isArray(cfModel) ? cfModel : [],
    cellStyleSamples,
  };
}

function snapshotWorkbook(workbook: ExcelJS.Workbook) {
  const sheets: SheetSnapshot[] = [];
  workbook.eachSheet((sheet) => {
    const samples =
      sheet.name === A2_SHEET
        ? ["B5", "D6", "L7", "O7", "F60", "H60", "I67"]
        : sheet.name === C2_SHEET
          ? ["B2", "C6", "E5", "C76"]
          : [];
    sheets.push(snapshotSheet(sheet, samples));
  });
  return {
    sheets,
    definedNames: workbook.definedNames.model,
    calcFullOnLoad: workbook.calcProperties?.fullCalcOnLoad,
  };
}

/** Recursively sorts object keys and array elements so serialization-order noise doesn't look like a real diff. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => [k, canonicalize(v)] as const,
    );
    entries.sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries);
  }
  return value;
}

function diff(label: string, before: unknown, after: unknown, issues: string[]) {
  const b = JSON.stringify(canonicalize(before));
  const a = JSON.stringify(canonicalize(after));
  if (b !== a) {
    issues.push(`${label}\n  before: ${b?.slice(0, 500)}\n  after:  ${a?.slice(0, 500)}`);
  }
}

async function main() {
  const fixturesDir = process.env.IRA_FIXTURES_DIR;
  const filePath = process.argv[2];
  if (!fixturesDir && !filePath) {
    console.error(
      "Usage: IRA_FIXTURES_DIR=<dir> tsx scripts/template-roundtrip-spike.ts [path-to-one-fixture.xlsx]",
    );
    process.exit(1);
  }
  const sourcePath =
    filePath ??
    join(
      fixturesDir!,
      "AA",
      "IRA_777958116 - PT Indomarco Prismatama.xlsx",
    );

  console.log(`Source: ${sourcePath}`);

  const before = new ExcelJS.Workbook();
  await before.xlsx.readFile(sourcePath);
  const beforeSnapshot = snapshotWorkbook(before);

  const outPath = join(tmpdir(), `ira-roundtrip-spike-${Date.now()}.xlsx`);
  const inputRef = `${C2_SHEET}!C6`;
  const beforeValue = before.getWorksheet(C2_SHEET)!.getCell("C6").value;
  const newValue = (typeof beforeValue === "number" ? beforeValue : 0) + 12345;

  await fillTemplate(sourcePath, outPath, new Map([[inputRef, newValue]]), new Set([inputRef]));
  console.log(`Wrote ${inputRef} = ${newValue} (was ${JSON.stringify(beforeValue)}) -> ${outPath}`);

  const after = new ExcelJS.Workbook();
  await after.xlsx.readFile(outPath);
  const afterSnapshot = snapshotWorkbook(after);

  const issues: string[] = [];

  console.log(
    "\nSheet visibility:",
    beforeSnapshot.sheets.map((s) => `${s.name}=${s.state}`).join(", "),
  );

  diff("sheet count/order/hidden state", beforeSnapshot.sheets.map((s) => [s.name, s.state]), afterSnapshot.sheets.map((s) => [s.name, s.state]), issues);
  diff("defined names", beforeSnapshot.definedNames, afterSnapshot.definedNames, issues);
  diff("fullCalcOnLoad (expected to flip true->true, or false->true)", beforeSnapshot.calcFullOnLoad, afterSnapshot.calcFullOnLoad, issues);

  for (let i = 0; i < beforeSnapshot.sheets.length; i++) {
    const b = beforeSnapshot.sheets[i];
    const a = afterSnapshot.sheets.find((s) => s.name === b.name);
    if (!a) {
      issues.push(`sheet "${b.name}" missing after round-trip`);
      continue;
    }
    diff(`[${b.name}] merges`, b.merges, a.merges, issues);
    diff(`[${b.name}] columnWidths`, b.columnWidths, a.columnWidths, issues);
    diff(`[${b.name}] rowHeights`, b.rowHeights, a.rowHeights, issues);
    diff(`[${b.name}] freezePane/views`, b.freezePane, a.freezePane, issues);
    diff(`[${b.name}] dataValidationCount`, b.dataValidationCount, a.dataValidationCount, issues);
    diff(`[${b.name}] dataValidationEntries`, b.dataValidationEntries, a.dataValidationEntries, issues);
    diff(`[${b.name}] conditionalFormattingEntries`, b.conditionalFormattingEntries, a.conditionalFormattingEntries, issues);
    for (const addr of Object.keys(b.cellStyleSamples)) {
      diff(`[${b.name}] style ${addr}`, b.cellStyleSamples[addr], a.cellStyleSamples[addr], issues);
    }
  }

  // Confirm the actual write took effect and formulas were left alone.
  const writtenValue = after.getWorksheet(C2_SHEET)!.getCell("C6").value;
  console.log(`\nWritten value now reads: ${JSON.stringify(writtenValue)}`);
  const a2Formula = after.getWorksheet(A2_SHEET)!.getCell("L7").value;
  console.log(`A2!L7 formula preserved: ${JSON.stringify(a2Formula)}`);

  console.log(`\n${issues.length} difference(s) found:\n`);
  for (const issue of issues) {
    console.log(issue + "\n");
  }

  console.log(`Output file left at: ${outPath} (inspect it in Excel if useful, then delete)`);
}

main();
