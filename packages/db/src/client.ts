import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export interface CreateDbOptions {
  /** Most connections this pool opens (default 10). */
  max?: number;
  /** Close a connection after it has been idle this many seconds, so pools never hoard slots (default 20). */
  idleTimeout?: number;
}

export function createDb(connectionString = process.env.DATABASE_URL, options: CreateDbOptions = {}) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = postgres(connectionString, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeout ?? 20,
    // Through a transaction-mode pooler (Neon/Supabase "pooled" URLs, PgBouncer) prepared statements break.
    prepare: !/pgbouncer=true|-pooler\./.test(connectionString),
  });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
