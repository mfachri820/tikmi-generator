#!/usr/bin/env tsx
/**
 * Creates a user, or resets an existing one's password, from the command line:
 * the way in when no admin can sign in (fresh database, forgotten password).
 * Without --password a temporary one is generated and printed; the user must
 * change it at first sign-in.
 *
 * Usage: npx tsx scripts/create-user.ts --email=a@b.c --name="Nama" [--role=admin|pengawas|viewer] [--password=...]
 */
import { eq, sql } from "drizzle-orm";
import { createDb, generateTemporaryPassword, hashPassword, passwordProblem, users } from "@ira/db";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const role = (arg("role") ?? "admin") as "admin" | "pengawas" | "viewer";
  const given = arg("password");
  if (!email || !["admin", "pengawas", "viewer"].includes(role)) {
    console.error('Usage: npx tsx scripts/create-user.ts --email=a@b.c --name="Nama" [--role=admin|pengawas|viewer] [--password=...]');
    process.exit(1);
  }
  if (given && passwordProblem(given)) {
    console.error(passwordProblem(given));
    process.exit(1);
  }
  const password = given ?? generateTemporaryPassword();
  const passwordHash = await hashPassword(password);

  const db = createDb();
  const [existing] = await db.select().from(users).where(eq(sql`lower(${users.email})`, email)).limit(1);
  if (existing) {
    await db
      .update(users)
      .set({ passwordHash, mustChangePassword: !given, active: true, role, ...(arg("name") ? { name: arg("name")! } : {}) })
      .where(eq(users.id, existing.id));
    console.log(`Updated ${existing.name} <${email}> (${role}).`);
  } else {
    const name = arg("name");
    if (!name) {
      console.error("--name is required for a new user.");
      process.exit(1);
    }
    await db.insert(users).values({ name, email, role, passwordHash, mustChangePassword: !given });
    console.log(`Created ${name} <${email}> (${role}).`);
  }
  console.log(given ? "Password set as given." : `Temporary password: ${password}  (must be changed at first sign-in)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
