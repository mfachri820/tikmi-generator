import { createDb } from "@ira/db";

/** One pooled connection per server process, like apps/collab's own `createDb()` call. */
export const db = createDb();
