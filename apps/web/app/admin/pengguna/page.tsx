import { asc, desc } from "drizzle-orm";
import { users } from "@tikmi/db";
import { AppHeader } from "@/components/app-header";
import { can, requirePageUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { UsersManager } from "./users-manager";

/** Admin: create, edit, deactivate users and reset their passwords. */
export default async function UsersPage() {
  const me = await requirePageUser("/admin/pengguna", can.manageUsers);
  const rows = await db.select().from(users).orderBy(desc(users.active), asc(users.name));

  return (
    <div className="min-h-screen">
      <AppHeader active="/admin/pengguna" user={me} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-9 sm:px-8">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Pengguna</h1>
          <p className="mt-1.5 text-[14.5px] text-ink-2">
            Akun yang bisa masuk ke aplikasi. Pengguna baru dan reset password memakai password sementara yang wajib diganti saat masuk.
          </p>
        </div>
        <UsersManager
          meId={me.id}
          users={rows.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
            initials: u.initials,
            active: u.active,
            hasPassword: !!u.passwordHash,
            mustChangePassword: u.mustChangePassword,
            lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          }))}
        />
      </main>
    </div>
  );
}
