#!/usr/bin/env tsx
/**
 * DEVELOPMENT ONLY: loads the Sumber BI data embedded in the 2025 KK templates
 * as the period's active Sumber BI, so the app has something to fill the
 * BI-sourced rows with before the real Jan–Des 2025 file is uploaded on
 * /admin/sumber-bi.
 *
 * `1 Tahun` comes from the Bundling 2 KK (the Bundling 3 copy covers the same
 * 270 pelapor with 299 fewer rows). `6 Bulan` is identical in both KKs. The
 * KKs' typed idx keys (bank UUS rows filed under the parent bank) are kept.
 * Golden tests do not use this: each reads its own template's copy directly.
 *
 * Usage: npx tsx scripts/seed-sumber-bi.ts [--period=2025] [--dry-run]
 */
import { eq } from "drizzle-orm";
import { createDb, periods } from "@tikmi/db";
import { importSumberBi, parseSumberBi, type SumberBiKind } from "@tikmi/sumber-bi";
import { readTemplate, TEMPLATE_FILES } from "./lib/templates2025";

const SHEETS: { kind: SumberBiKind; sheetName: string }[] = [
  { kind: "1_tahun", sheetName: "Sumber BI 1 Tahun" },
  { kind: "6_bulan", sheetName: "Sumber BI (6 Bulan)" },
  { kind: "industri", sheetName: "Industri(6 Bulan)" },
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const code = process.argv.find((a) => a.startsWith("--period="))?.slice("--period=".length) ?? "2025";
  const xlsx = await readTemplate("mr_kk_b2");

  if (dryRun) {
    for (const s of SHEETS) {
      const { report } = await parseSumberBi(xlsx, { ...s, keepIdx: true });
      console.log(`${s.sheetName}: ${report.rows} rows, ${report.distinctDataIds} data IDs, ${report.distinctPelapor} pelapor, flags ${JSON.stringify(report.flags)}`);
    }
    return;
  }

  const db = createDb();
  const [period] = await db.select().from(periods).where(eq(periods.code, code));
  if (!period) throw new Error(`Period ${code} not found: run scripts/seed-period.ts first`);
  for (const s of SHEETS) {
    const res = await importSumberBi(db, {
      periodId: period.id,
      ...s,
      keepIdx: true,
      xlsx,
      filename: `${TEMPLATE_FILES.mr_kk_b2} [${s.sheetName}]`,
      source: "seed",
    });
    console.log(`${s.sheetName}: ${res.status}${res.status === "failed" ? ` (${res.error})` : ` (${res.upload.rowCount} rows)`}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
