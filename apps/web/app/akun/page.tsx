import { MIN_PASSWORD_LENGTH } from "@ira/db";
import { AppHeader } from "@/components/app-header";
import { requirePageUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/roles";
import { PasswordForm } from "./password-form";

export default async function AccountPage() {
  const user = await requirePageUser("/akun");

  return (
    <div className="min-h-screen">
      <AppHeader active="/akun" user={user} />
      <main className="mx-auto max-w-xl space-y-6 px-4 py-9 sm:px-8">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Akun saya</h1>
          <p className="mt-1.5 text-[14px] text-ink-2">
            {user.name} · {user.email} · {ROLE_LABELS[user.role]}
          </p>
        </div>
        {user.mustChangePassword && (
          <p className="rounded-xl bg-[#fef6e2] px-4 py-3 text-[13.5px] text-ink">
            Anda masuk dengan password sementara dari admin. Buat password Anda sendiri untuk melanjutkan.
          </p>
        )}
        <section className="card p-6">
          <h2 className="card-title mb-4">Ganti password</h2>
          <PasswordForm forced={user.mustChangePassword} minLength={MIN_PASSWORD_LENGTH} />
        </section>
      </main>
    </div>
  );
}
