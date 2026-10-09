import { desc, eq } from "drizzle-orm";
import { users, weightSettings, type Db } from "@ira/db";
import { withDefaultWeights, type WeightSet } from "@ira/scoring/config/2026";

/** The weights in force for a period: the newest save on the "Bobot" page, else the defaults. */
export async function loadWeights(db: Db, periodId: string): Promise<WeightSet> {
  const [row] = await db
    .select({ weights: weightSettings.weights })
    .from(weightSettings)
    .where(eq(weightSettings.periodId, periodId))
    .orderBy(desc(weightSettings.createdAt))
    .limit(1);
  return withDefaultWeights(row?.weights as Partial<WeightSet> | undefined);
}

/** The last few saves for a period, newest first, with who saved them. */
export async function weightHistory(db: Db, periodId: string, limit = 8) {
  return db
    .select({ id: weightSettings.id, createdAt: weightSettings.createdAt, note: weightSettings.note, by: users.name })
    .from(weightSettings)
    .leftJoin(users, eq(users.id, weightSettings.createdBy))
    .where(eq(weightSettings.periodId, periodId))
    .orderBy(desc(weightSettings.createdAt))
    .limit(limit);
}
