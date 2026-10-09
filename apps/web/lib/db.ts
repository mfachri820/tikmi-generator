import { createDb, type Db } from "@ira/db";

/**
 * One connection pool per server process. In development Next re-runs this
 * module on every code change; without keeping the pool on `globalThis`, each
 * reload opened a new pool and the old ones kept their connections until
 * Postgres ran out ("too many clients already").
 */
const globalForDb = globalThis as unknown as { iraDb?: Db };

export const db: Db = globalForDb.iraDb ?? createDb(undefined, { max: 5 });
globalForDb.iraDb = db;
