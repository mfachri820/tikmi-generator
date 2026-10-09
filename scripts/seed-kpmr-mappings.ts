#!/usr/bin/env tsx
/**
 * Adds (or refreshes) the 2027 form's KPMR question -> "B. KPMR 2025" H/I
 * mappings in `field_mappings` for the active period's template version.
 * Safe to re-run: it replaces the KPMR rows and leaves the C2 ones alone.
 * `seed-dev` calls the same function for fresh databases.
 *
 * Usage: npx tsx scripts/seed-kpmr-mappings.ts           (add/refresh)
 *        npx tsx scripts/seed-kpmr-mappings.ts --remove  (take them out again)
 */
import { eq } from "drizzle-orm";
import { createDb, periods } from "@ira/db";
import { replaceKpmrMappings } from "./lib/kpmrMappings";

async function main() {
  const db = createDb();
  const [period] = await db.select().from(periods).where(eq(periods.status, "active")).limit(1);
  if (!period) throw new Error("No active period. Run seed-dev first.");

  const { removed, added } = await replaceKpmrMappings(db, period.templateVersionId, {
    remove: process.argv.includes("--remove"),
  });
  console.log(`KPMR field_mappings: removed ${removed}, added ${added}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
