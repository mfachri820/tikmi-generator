#!/usr/bin/env tsx
/**
 * Re-extracts `template_versions.layout_json` from each version's stored
 * template bytes (`xlsx_base64`) in place, so a change to `extractLayout`
 * reaches an existing database without reseeding (which would replace every
 * workbook).
 *
 * Usage: DATABASE_URL=... npx tsx scripts/refresh-layout.ts
 */
import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { createDb, templateVersions } from "@tikmi/db";
import { extractLayout } from "@tikmi/template";
import { inputCellRefs2026 } from "../packages/scoring/config/2026-input-cells";

async function main() {
  const db = createDb();
  for (const version of await db.select().from(templateVersions)) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(version.xlsxBase64, "base64") as unknown as ArrayBuffer);
    const layoutJson = extractLayout(workbook, new Set(inputCellRefs2026));
    await db.update(templateVersions).set({ layoutJson }).where(eq(templateVersions.id, version.id));
    console.log(`Refreshed layout for template version ${version.id} (${version.year}).`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
