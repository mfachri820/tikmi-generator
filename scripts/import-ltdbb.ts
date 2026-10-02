#!/usr/bin/env tsx
/**
 * Imports an LTDBB transaction workbook (sheet Trx_PJPJKT) into
 * `ltdbb_uploads`/`ltdbb_monthly` and makes it the active snapshot that fills
 * "Validasi Data Transaksi". Run it against the deployed (Vercel) Postgres by
 * pointing DATABASE_URL at it -- that's how the default data reaches
 * production. Re-running with the same file is a no-op (matched by sha256).
 *
 * Usage: DATABASE_URL=... npx tsx scripts/import-ltdbb.ts [path-to.xlsx]
 *        (defaults to IRA_LTDBB_FILE, else "Data LTDBB PJP LR JKT.xlsx" in the repo root)
 */
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createDb, users } from "@ira/db";
import { DEFAULT_LTDBB_FILE, importLtdbbFile } from "./lib/ltdbbDefault";

const DEV_USER_EMAIL = "mfachri820@gmail.com";

async function main() {
  const path = process.argv[2] ?? DEFAULT_LTDBB_FILE;
  if (!existsSync(path)) {
    console.error(`LTDBB file not found: ${path}`);
    process.exit(1);
  }
  const db = createDb();
  const [user] = await db.select().from(users).where(eq(users.email, DEV_USER_EMAIL)).limit(1);
  await importLtdbbFile(db, path, user?.id ?? null);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
