"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const inputClass =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="text-[13px] font-medium text-ink-2">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={state.email}
          required
          autoFocus
          className={`mt-1.5 ${inputClass}`}
        />
      </label>
      <label className="block">
        <span className="text-[13px] font-medium text-ink-2">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className={`mt-1.5 ${inputClass}`} />
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg bg-[#fbeaea] px-3 py-2 text-[13px] text-status-critical">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-10 w-full rounded-lg bg-brand text-[14px] font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
      >
        {pending ? "Memeriksa…" : "Masuk"}
      </button>
    </form>
  );
}
