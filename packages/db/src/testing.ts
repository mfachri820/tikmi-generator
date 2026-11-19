import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";
import type { Db } from "./client";

const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * An in-memory Postgres (PGlite) with every migration applied, for tests: no
 * Docker or database server needed. Typed as `Db` so the same functions run
 * against it; the drivers differ but drizzle's query API is the same.
 */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Db, close: () => client.close() };
}
