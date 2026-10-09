"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { generateTemporaryPassword, hashPassword, users } from "@ira/db";
import { db } from "@/lib/db";
import { can, endOtherSessions, getCurrentUser, type Role } from "@/lib/auth";

export type UserActionState = {
  error?: string;
  message?: string;
  /** Shown once to the admin, who hands it to the user; they must change it at first sign-in. */
  temporaryPassword?: { email: string; password: string };
};

const ROLES: Role[] = ["admin", "pengawas", "viewer"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Active admins other than `userId`: the last one can't be demoted or deactivated, or nobody could manage users. */
async function otherActiveAdmins(userId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.active, true), ne(users.id, userId)));
  return row.n;
}

/** One action for every change on the Pengguna page; `intent` says which. */
export async function manageUser(_prev: UserActionState, form: FormData): Promise<UserActionState> {
  const me = await getCurrentUser();
  if (!me || !can.manageUsers(me)) return { error: "Hanya admin yang bisa mengelola pengguna." };

  const intent = String(form.get("intent") ?? "");
  const userId = String(form.get("userId") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = String(form.get("role") ?? "") as Role;
  const initials = String(form.get("initials") ?? "").trim().toUpperCase() || null;

  const validate = () => {
    if (!name) return "Nama wajib diisi.";
    if (!EMAIL.test(email)) return "Email tidak valid.";
    if (!ROLES.includes(role)) return "Peran tidak valid.";
    return null;
  };
  const emailTaken = async (exceptId?: string) => {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(sql`lower(${users.email})`, email), exceptId ? ne(users.id, exceptId) : undefined))
      .limit(1);
    return !!row;
  };

  if (intent === "create") {
    const problem = validate();
    if (problem) return { error: problem };
    if (await emailTaken()) return { error: `Email ${email} sudah dipakai pengguna lain.` };
    const password = generateTemporaryPassword();
    await db.insert(users).values({ name, email, role, initials, passwordHash: await hashPassword(password), mustChangePassword: true });
    revalidatePath("/admin/pengguna");
    return { message: `${name} ditambahkan.`, temporaryPassword: { email, password } };
  }

  const [target] = userId ? await db.select().from(users).where(eq(users.id, userId)).limit(1) : [];
  if (!target) return { error: "Pengguna tidak ditemukan." };

  if (intent === "update") {
    const problem = validate();
    if (problem) return { error: problem };
    if (await emailTaken(target.id)) return { error: `Email ${email} sudah dipakai pengguna lain.` };
    if (target.role === "admin" && role !== "admin" && target.active && (await otherActiveAdmins(target.id)) === 0) {
      return { error: "Ini satu-satunya admin aktif; tidak bisa diubah menjadi bukan admin." };
    }
    await db.update(users).set({ name, email, role, initials }).where(eq(users.id, target.id));
    revalidatePath("/admin/pengguna");
    return { message: `Data ${name} disimpan.` };
  }

  if (intent === "reset") {
    const password = generateTemporaryPassword();
    await db.update(users).set({ passwordHash: await hashPassword(password), mustChangePassword: true }).where(eq(users.id, target.id));
    await endOtherSessions(target.id, target.id === me.id);
    revalidatePath("/admin/pengguna");
    return { message: `Password ${target.name} direset; semua sesinya diakhiri.`, temporaryPassword: { email: target.email, password } };
  }

  if (intent === "toggle") {
    if (target.id === me.id) return { error: "Anda tidak bisa menonaktifkan akun sendiri." };
    if (target.active && target.role === "admin" && (await otherActiveAdmins(target.id)) === 0) {
      return { error: "Ini satu-satunya admin aktif; tidak bisa dinonaktifkan." };
    }
    await db.update(users).set({ active: !target.active }).where(eq(users.id, target.id));
    if (target.active) await endOtherSessions(target.id, false);
    revalidatePath("/admin/pengguna");
    return { message: target.active ? `${target.name} dinonaktifkan dan langsung dikeluarkan.` : `${target.name} diaktifkan kembali.` };
  }

  return { error: "Aksi tidak dikenal." };
}
