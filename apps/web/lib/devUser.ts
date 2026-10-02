import { eq } from "drizzle-orm";
import { users, type Db } from "@ira/db";

/**
 * No auth system is wired up yet (Auth.js is still an open decision in the
 * build plan). Every write attributes to the single user `scripts/seed-dev.ts`
 * seeds, standing in for a real signed-in pengawas until Auth.js lands.
 */
const DEV_USER_EMAIL = "mfachri820@gmail.com";

export async function getDevUser(db: Db) {
  const [user] = await db.select().from(users).where(eq(users.email, DEV_USER_EMAIL)).limit(1);
  if (!user) {
    throw new Error(`No dev user seeded (email ${DEV_USER_EMAIL}). Run "npm run seed-dev" first.`);
  }
  return user;
}
