"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { hashPassword, passwordProblem, users, verifyPassword } from "@ira/db";
import { db } from "@/lib/db";
import { endOtherSessions, getCurrentUser } from "@/lib/auth";

export type PasswordState = { error?: string; done?: boolean };

export async function changePassword(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, me.id)).limit(1);
  if (!(await verifyPassword(current, row?.passwordHash))) return { error: "Password saat ini salah." };
  const problem = passwordProblem(next);
  if (problem) return { error: problem };
  if (next !== confirm) return { error: "Konfirmasi password tidak sama." };
  if (next === current) return { error: "Password baru harus berbeda dari yang sekarang." };

  await db.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false }).where(eq(users.id, me.id));
  // Any other browser signed in as this user must sign in again with the new password.
  await endOtherSessions(me.id, true);
  if (me.mustChangePassword) redirect("/");
  return { done: true };
}
