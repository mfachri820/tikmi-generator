"use client";

import { useActionState, useState } from "react";
import { ROLE_HELP, ROLE_LABELS } from "@/lib/roles";
import { manageUser, type UserActionState } from "./actions";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: keyof typeof ROLE_LABELS;
  initials: string | null;
  active: boolean;
  hasPassword: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

const input =
  "h-9 w-full rounded-lg border border-line-strong bg-surface px-2.5 text-[13.5px] outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";
const button =
  "h-9 rounded-lg px-3.5 text-[13px] font-medium transition disabled:opacity-60";

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })
    : "Belum pernah";

function UserFields({ user }: { user?: UserRow }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1.4fr_1.6fr_1fr_0.6fr]">
      <label>
        <span className="text-[12.5px] text-ink-2">Nama</span>
        <input name="name" defaultValue={user?.name} required className={`mt-1 ${input}`} />
      </label>
      <label>
        <span className="text-[12.5px] text-ink-2">Email</span>
        <input name="email" type="email" defaultValue={user?.email} required className={`mt-1 ${input}`} />
      </label>
      <label>
        <span className="text-[12.5px] text-ink-2">Peran</span>
        <select name="role" defaultValue={user?.role ?? "pengawas"} className={`mt-1 ${input}`}>
          {(Object.keys(ROLE_LABELS) as UserRow["role"][]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="text-[12.5px] text-ink-2">Inisial</span>
        <input name="initials" defaultValue={user?.initials ?? ""} maxLength={4} placeholder="AA" className={`mt-1 ${input} uppercase`} />
      </label>
    </div>
  );
}

export function UsersManager({ users, meId }: { users: UserRow[]; meId: string }) {
  const [state, action, pending] = useActionState<UserActionState, FormData>(manageUser, {});
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-5">
      {state.error && (
        <p role="alert" className="rounded-xl bg-[#fbeaea] px-4 py-3 text-[13.5px] text-status-critical">
          {state.error}
        </p>
      )}
      {state.message && !state.error && (
        <div role="status" className="rounded-xl bg-brand-soft px-4 py-3 text-[13.5px] text-brand-strong">
          <p>{state.message}</p>
          {state.temporaryPassword && (
            <div className="mt-2 rounded-lg bg-surface px-3 py-2.5 text-ink ring-1 ring-line">
              <p className="text-[12.5px] text-ink-2">
                Password sementara untuk <b>{state.temporaryPassword.email}</b>. Berikan langsung ke penggunanya; ini hanya ditampilkan sekali dan harus diganti saat pertama masuk.
              </p>
              <p className="mt-1.5 select-all font-mono text-[18px] font-semibold tracking-wider">{state.temporaryPassword.password}</p>
            </div>
          )}
        </div>
      )}

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-6">
          <h2 className="card-title gap-2 text-[16px]">
            Pengguna <span className="text-[14px] font-normal tabular-nums text-ink-3">{users.length}</span>
          </h2>
          {!adding && (
            <button onClick={() => setAdding(true)} className={`${button} bg-brand text-white hover:bg-brand-strong`}>
              + Tambah pengguna
            </button>
          )}
        </div>

        {adding && (
          <form
            action={(fd) => {
              action(fd);
              setAdding(false);
            }}
            className="mx-6 mt-4 space-y-3 rounded-xl bg-plane p-4 ring-1 ring-line"
          >
            <input type="hidden" name="intent" value="create" />
            <UserFields />
            <p className="text-[12.5px] text-ink-3">Password sementara dibuat otomatis dan ditampilkan setelah disimpan.</p>
            <div className="flex gap-2">
              <button type="submit" disabled={pending} className={`${button} bg-brand text-white hover:bg-brand-strong`}>
                Simpan
              </button>
              <button type="button" onClick={() => setAdding(false)} className={`${button} text-ink-2 hover:bg-surface`}>
                Batal
              </button>
            </div>
          </form>
        )}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[860px] border-t border-line text-left text-[14px]">
            <thead className="bg-plane text-[12.5px] text-ink-2">
              <tr>
                <th className="py-3 pl-6 pr-3 font-medium">Nama</th>
                <th className="px-3 py-3 font-medium">Peran</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Login terakhir</th>
                <th className="px-3 py-3 pr-6 text-right font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) =>
                editing === u.id ? (
                  <tr key={u.id} className="border-t border-line bg-plane">
                    <td colSpan={5} className="px-6 py-4">
                      <form
                        action={(fd) => {
                          action(fd);
                          setEditing(null);
                        }}
                        className="space-y-3"
                      >
                        <input type="hidden" name="intent" value="update" />
                        <input type="hidden" name="userId" value={u.id} />
                        <UserFields user={u} />
                        <div className="flex gap-2">
                          <button type="submit" disabled={pending} className={`${button} bg-brand text-white hover:bg-brand-strong`}>
                            Simpan
                          </button>
                          <button type="button" onClick={() => setEditing(null)} className={`${button} text-ink-2 hover:bg-surface`}>
                            Batal
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={u.id} className={`border-t border-line ${u.active ? "" : "text-ink-3"}`}>
                    <td className="py-3.5 pl-6 pr-3">
                      <p className="font-medium">
                        {u.name}
                        {u.initials && <span className="ml-2 rounded bg-plane px-1.5 py-0.5 text-[11.5px] font-normal text-ink-2 ring-1 ring-line">{u.initials}</span>}
                        {u.id === meId && <span className="ml-2 text-[12px] font-normal text-ink-3">(Anda)</span>}
                      </p>
                      <p className="text-[12.5px] text-ink-3">{u.email}</p>
                    </td>
                    <td className="px-3 py-3.5" title={ROLE_HELP[u.role]}>
                      {ROLE_LABELS[u.role]}
                    </td>
                    <td className="px-3 py-3.5 text-[13px]">
                      {!u.active ? (
                        <span className="text-ink-3">Nonaktif</span>
                      ) : !u.hasPassword ? (
                        <span className="text-[#c98500]">Belum punya password</span>
                      ) : u.mustChangePassword ? (
                        <span className="text-[#c98500]">Menunggu ganti password</span>
                      ) : (
                        <span className="text-brand-strong">Aktif</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-[13px] text-ink-2">{fmtDate(u.lastLoginAt)}</td>
                    <td className="px-3 py-3.5 pr-6">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setEditing(u.id)} className={`${button} text-ink-2 hover:bg-plane hover:text-ink`}>
                          Ubah
                        </button>
                        <form action={action}>
                          <input type="hidden" name="intent" value="reset" />
                          <input type="hidden" name="userId" value={u.id} />
                          <button
                            type="submit"
                            disabled={pending}
                            onClick={(e) => {
                              if (!confirm(`Reset password ${u.name}? Semua sesinya akan diakhiri.`)) e.preventDefault();
                            }}
                            className={`${button} text-ink-2 hover:bg-plane hover:text-ink`}
                          >
                            Reset password
                          </button>
                        </form>
                        {u.id !== meId && (
                          <form action={action}>
                            <input type="hidden" name="intent" value="toggle" />
                            <input type="hidden" name="userId" value={u.id} />
                            <button
                              type="submit"
                              disabled={pending}
                              onClick={(e) => {
                                if (u.active && !confirm(`Nonaktifkan ${u.name}? Ia langsung dikeluarkan dan tidak bisa masuk.`)) e.preventDefault();
                              }}
                              className={`${button} ${u.active ? "text-status-critical hover:bg-[#fbeaea]" : "text-brand hover:bg-brand-soft"}`}
                            >
                              {u.active ? "Nonaktifkan" : "Aktifkan"}
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-6 text-[13.5px] text-ink-2">
        <h2 className="card-title mb-2">Peran</h2>
        <ul className="space-y-1">
          {(Object.keys(ROLE_LABELS) as UserRow["role"][]).map((r) => (
            <li key={r}>
              <b className="text-ink">{ROLE_LABELS[r]}</b>: {ROLE_HELP[r]}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
