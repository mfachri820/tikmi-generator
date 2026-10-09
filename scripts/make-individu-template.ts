#!/usr/bin/env tsx
/**
 * Turns one BI "APU PPT dan Net Risk PTD Individu" report (PTD_AssesmenIndividu_*.xlsx)
 * into the blank template the app fills: labels, layout and styles kept, every
 * PJP-specific value removed (name, printer, scores, predikat). Writes it as a
 * base64 TypeScript module so it ships with the app (no file system on Vercel).
 *
 * Usage: npx tsx scripts/make-individu-template.ts "<PTD_AssesmenIndividu_....xlsx>"
 */
import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";

async function main() {
  const source = process.argv[2];
  if (!source) throw new Error("Pass the path of a PTD_AssesmenIndividu report.");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(source);
  const ws = wb.worksheets[0];

  // Header values (column B): ": <value>", re-filled per PJP.
  for (const r of [4, 5, 6, 7]) ws.getCell(`B${r}`).value = ":";
  // Every number below the header, and the predikat texts of the judgement blocks.
  let cleared = 0;
  ws.eachRow((row, r) => {
    if (r < 10) return;
    row.eachCell((cell) => {
      if (typeof cell.value === "number") {
        cell.value = null;
        cleared++;
      }
    });
  });
  for (const ref of ["C156", "C157", "C163", "C164"]) ws.getCell(ref).value = null;

  const out = Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
  writeFileSync(
    "apps/web/lib/individuTemplate.ts",
    `/**\n * Blank "APU PPT dan Net Risk PTD Individu" template, made by scripts/make-individu-template.ts\n * from BI's own report. Contains no PJP data. Regenerate rather than edit.\n */\nexport const INDIVIDU_TEMPLATE_BASE64 =\n  "${out}";\n`,
  );
  console.log(`Template written: ${cleared} values cleared, ${Math.round(out.length / 1024)} KB base64.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
