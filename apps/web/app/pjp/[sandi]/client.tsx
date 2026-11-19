"use client";

import { useActionState, useState } from "react";
import type { UploadState } from "./actions";

/** "Unggah file PSP": MR and/or IT workbook, processed like a form submission. */
export function UploadForm({ action }: { action: (prev: UploadState, form: FormData) => Promise<UploadState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3 text-[13.5px]">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="font-medium">Asesmen Mandiri Manajemen Risiko (MR)</span>
          <input name="mr" type="file" accept=".xlsx" className="mt-1 block w-full text-[13px]" />
        </label>
        <label className="block">
          <span className="font-medium">Asesmen Mandiri Infrastruktur TI</span>
          <input name="it" type="file" accept=".xlsx" className="mt-1 block w-full text-[13px]" />
        </label>
      </div>
      <button disabled={pending} className="rounded-lg bg-ink px-3 py-1.5 font-medium text-white disabled:opacity-60">
        {pending ? "Memproses…" : "Unggah dan proses"}
      </button>
      {state.error && <p className="text-[#a8302a]">{state.error}</p>}
      {state.results?.map((r) => (
        <p key={r.kind} className={r.activated ? "text-brand-strong" : "text-[#a8302a]"}>
          {r.kind === "mr" ? "MR" : "TI"} ({r.name}): {r.message}
        </p>
      ))}
    </form>
  );
}

/** "Kirim catatan ke PJP": the ready text, with a copy button. */
export function NoteToPjp({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return <p className="text-[13px] text-ink-3">Tidak ada catatan untuk PJP.</p>;
  return (
    <div className="space-y-2">
      <textarea readOnly value={text} rows={Math.min(14, text.split("\n").length + 1)} className="w-full rounded-lg border border-line-strong bg-plane p-2.5 font-mono text-[12.5px]" />
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="rounded-lg px-3 py-1.5 text-[13px] font-medium ring-1 ring-line hover:bg-plane"
      >
        {copied ? "Tersalin" : "Salin catatan"}
      </button>
    </div>
  );
}
