"use server";

import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { hashPassword, users, verifyPassword } from "@ira/db";
import { db } from "@/lib/db";
import { endSession, safeNext, startSession } from "@/lib/auth";

export type LoginState = { error?: string; email?: string };

/** Compared against when the email doesn't exist, so a wrong email takes as long as a wrong password. */
let dummyHash: Promise<string> | null = null;

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Isi email dan password.", email };

  const [user] = await db.select().from(users).where(eq(sql`lower(${users.email})`, email)).limit(1);
  dummyHash ??= hashPassword("not-a-real-password-1");
  const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  // One message for every failure, so it doesn't reveal which emails have accounts.
  if (!user || !valid || !user.active) return { error: "Email atau password salah, atau akun tidak aktif.", email };

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await startSession(user.id);
  redirect(user.mustChangePassword ? "/akun" : safeNext(form.get("next")));
}

export async function logout() {
  await endSession();
  redirect("/login");
}
