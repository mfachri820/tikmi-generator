import { eq } from "drizzle-orm";
import { templateVersions } from "@ira/db";
import type { ExtractedLayout } from "@ira/template";
import { aggregateYear } from "@ira/ltdbb";
import { db } from "@/lib/db";

/**
 * Per-process caches for data that never changes once written, so each page
 * doesn't re-read and re-parse it from Postgres:
 *  - an LTDBB upload is an immutable snapshot (a new file is a new upload id),
 *    so its per-year aggregate is keyed by upload id + data year;
 *  - a template version's layout is only rewritten by `npm run refresh-layout`
 *    (redeploy, or wait for new server instances, after running it).
 * The promise is cached, so concurrent requests share one load; a failed load
 * is dropped so the next request retries. Callers must not mutate the result
 * (applyLayoutOverrides / withValidasiValues already return copies).
 */
const MAX_ENTRIES = 8;
const cache = new Map<string, Promise<unknown>>();

function memo<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  const promise = load().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, promise);
  // Oldest first: an older upload or template version is the one to drop.
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return promise;
}

/** `aggregateYear` for all PJPs; pick one PJP from `rows` rather than passing `sandi`. */
export function cachedAggregateYear(uploadId: string, dataYear: number) {
  return memo(`ltdbb:${uploadId}:${dataYear}`, () => aggregateYear(db, uploadId, dataYear));
}

export function cachedLayout(templateVersionId: string): Promise<ExtractedLayout> {
  return memo(`layout:${templateVersionId}`, async () => {
    const [row] = await db
      .select({ layoutJson: templateVersions.layoutJson })
      .from(templateVersions)
      .where(eq(templateVersions.id, templateVersionId))
      .limit(1);
    if (!row) throw new Error(`Template version ${templateVersionId} not found`);
    return row.layoutJson as ExtractedLayout;
  });
}
