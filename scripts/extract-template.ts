#!/usr/bin/env tsx
/**
 * Extracts layout JSON from a template workbook for `template_versions.layout_json`.
 * The input-cell list is supplied as a JSON file of "Sheet!Address" strings rather
 * than hard-coded here -- cell addresses belong in template-version config, not code.
 */
import { readFileSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { extractLayout } from "@tikmi/template";

async function main() {
  const [, , templatePath, inputCellsPath, outPath] = process.argv;
  if (!templatePath || !inputCellsPath || !outPath) {
    console.error(
      "Usage: tsx scripts/extract-template.ts <template.xlsx> <input-cells.json> <layout-out.json>",
    );
    process.exit(1);
  }

  const inputCellRefs: string[] = JSON.parse(readFileSync(inputCellsPath, "utf8"));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const layout = extractLayout(workbook, new Set(inputCellRefs));
  writeFileSync(outPath, JSON.stringify(layout, null, 2));
  console.log(`Wrote layout for ${layout.sheets.length} sheet(s) to ${outPath}`);
}

main();
