import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { and, eq, gt, lt } from "drizzle-orm";
import { sessions, users } from "@tikmi/db";
import { db } from "@/lib/db";

/**
 * Email + password sign-in with database sessions. The cookie holds a random
 * token; the database stores only its SHA-256, so sessions can be revoked
 * (sign-out, deactivation, password change) and a leaked table signs no one in.
 */

const COOKIE = "tikmi_session";
/** A session idle this long expires; each use within it slides it forward (at most once an hour). */
const IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const SLIDE_AFTER_MS = 60 * 60 * 1000;

export type Role = "admin" | "koordinator" | "pengawas" | "viewer";
export type CurrentUser = { id: string; name: string; email: string; role: Role; mustChangePassword: boolean };

/**
 * Who may do what. Everyone signed in sees every PJP. A pengawas works only on the PJPs assigned to them
 * (assessment's pengawas); the koordinator and the admin work on all of them. Only the koordinator sets
 * Final; the koordinator or the admin reopens a Final assessment (with a reason).
 */
export const can = {
  edit: (u: CurrentUser) => u.role === "admin" || u.role === "koordinator" || u.role === "pengawas",
  /** Act on one PJP's assessment (scores, koreksi, manual upload). */
  workOn: (u: CurrentUser, assignedPengawasId: string | null) =>
    u.role === "admin" || u.role === "koordinator" || (u.role === "pengawas" && assignedPengawasId === u.id),
  finalize: (u: CurrentUser) => u.role === "koordinator",
  reopen: (u: CurrentUser) => u.role === "koordinator" || u.role === "admin",
  manageUsers: (u: CurrentUser) => u.role === "admin",
  viewActivity: (u: CurrentUser) => u.role === "admin" || u.role === "koordinator",
  manageSettings: (u: CurrentUser) => u.role === "admin",
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Starts a session for the user and sets the cookie (server actions / route handlers only). */
export async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + IDLE_MS) });
  // Housekeeping: drop this user's expired sessions.
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
}

/** Signs this browser out. */
export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  jar.delete(COOKIE);
}

/** Signs a user out everywhere except, optionally, this browser (after a password change or deactivation). */
export async function endOtherSessions(userId: string, keepCurrent: boolean) {
  const token = keepCurrent ? (await cookies()).get(COOKIE)?.value : undefined;
  const rows = await db.select({ id: sessions.id, tokenHash: sessions.tokenHash }).from(sessions).where(eq(sessions.userId, userId));
  for (const s of rows) {
    if (token && s.tokenHash === hashToken(token)) continue;
    await db.delete(sessions).where(eq(sessions.id, s.id));
  }
}

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      active: users.active,
      mustChangePassword: users.mustChangePassword,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row || !row.active) return null;
  if (row.expiresAt.getTime() - Date.now() < IDLE_MS - SLIDE_AFTER_MS) {
    await db.update(sessions).set({ expiresAt: new Date(Date.now() + IDLE_MS) }).where(eq(sessions.id, row.sessionId));
  }
  return { id: row.id, name: row.name, email: row.email, role: row.role, mustChangePassword: row.mustChangePassword };
});

/**
 * For pages: the signed-in user, or a redirect to /login (back to `path` after).
 * Someone holding a temporary password is sent to /akun first.
 */
export async function requirePageUser(path: string, allowed?: (u: CurrentUser) => boolean): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (user.mustChangePassword && path !== "/akun") redirect("/akun");
  if (allowed && !allowed(user)) redirect("/");
  return user;
}

/** For API routes: the user, or the 401/403 response to return. */
export async function requireApiUser(
  allowed?: (u: CurrentUser) => boolean,
): Promise<{ user: CurrentUser; denied?: never } | { user?: never; denied: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { denied: NextResponse.json({ error: "Sesi berakhir. Silakan masuk kembali." }, { status: 401 }) };
  if (user.mustChangePassword) return { denied: NextResponse.json({ error: "Ganti password Anda terlebih dahulu." }, { status: 403 }) };
  if (allowed && !allowed(user)) return { denied: NextResponse.json({ error: "Anda tidak punya akses untuk ini." }, { status: 403 }) };
  return { user };
}

/** Safe post-login target: only paths inside this app. */
export function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
