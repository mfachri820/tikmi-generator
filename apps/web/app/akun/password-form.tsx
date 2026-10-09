"use client";

import { useActionState } from "react";
import { changePassword, type PasswordState } from "./actions";

const inputClass =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";

export function PasswordForm({ forced, minLength }: { forced: boolean; minLength: number }) {
  const [state, action, pending] = useActionState<PasswordState, FormData>(changePassword, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="text-[13px] font-medium text-ink-2">{forced ? "Password sementara" : "Password saat ini"}</span>
        <input name="current" type="password" autoComplete="current-password" required className={`mt-1.5 ${inputClass}`} />
      </label>
      <label className="block">
        <span className="text-[13px] font-medium text-ink-2">Password baru</span>
        <input name="next" type="password" autoComplete="new-password" required minLength={minLength} className={`mt-1.5 ${inputClass}`} />
        <span className="mt-1 block text-[12px] text-ink-3">Minimal {minLength} karakter, berisi huruf dan angka.</span>
      </label>
      <label className="block">
        <span className="text-[13px] font-medium text-ink-2">Ulangi password baru</span>
        <input name="confirm" type="password" autoComplete="new-password" required className={`mt-1.5 ${inputClass}`} />
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg bg-[#fbeaea] px-3 py-2 text-[13px] text-status-critical">
          {state.error}
        </p>
      )}
      {state.done && (
        <p role="status" className="rounded-lg bg-brand-soft px-3 py-2 text-[13px] text-brand-strong">
          Password diganti. Perangkat lain yang masuk dengan akun ini perlu masuk ulang.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-lg bg-brand px-5 text-[14px] font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
      >
        {pending ? "Menyimpan…" : "Ganti password"}
      </button>
    </form>
  );
}
