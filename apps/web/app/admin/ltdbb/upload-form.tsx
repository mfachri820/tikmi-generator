"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Result = { tone: "good" | "bad"; text: string };

/** Uploads a new LTDBB workbook; on success it becomes the active data and the page refreshes. */
export function LtdbbUploadForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/ltdbb/upload", { method: "POST", body });
      const data = await res.json().catch(() => ({ error: "Respons server tidak terbaca." }));
      if (!res.ok) {
        setResult({ tone: "bad", text: data.error ?? "Unggahan gagal." });
        return;
      }
      const span = `${String(data.minDate ?? "").slice(0, 7)} s.d. ${String(data.maxDate ?? "").slice(0, 7)}`;
      setResult({
        tone: "good",
        text: data.existing
          ? `File ini sudah pernah diimpor (${span}); sekarang dipakai sebagai data aktif.`
          : `${Number(data.rowCount ?? 0).toLocaleString("id-ID")} baris diimpor (${span}) dan sekarang menjadi data aktif.`,
      });
      setFile(null);
      if (input.current) input.current.value = "";
      router.refresh();
    } catch {
      setResult({ tone: "bad", text: "Tidak bisa menghubungi server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 border-t border-line pt-4">
      <p className="text-[12.5px] font-medium text-ink">Unggah LTDBB baru</p>
      <p className="mt-0.5 text-[12px] text-ink-3">File .xlsx dengan format yang sama. Setelah diunggah, semua nilai memakai data ini.</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 ring-1 ring-line hover:bg-plane">
          <span className="shrink-0 font-medium text-brand">Pilih file</span>
          <span className="truncate text-ink-3">{file ? file.name : "belum dipilih"}</span>
          <input
            ref={input}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
            }}
          />
        </label>
        <button
          type="submit"
          disabled={!file || busy}
          className="rounded-lg bg-brand px-3.5 py-1.5 font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Memproses…" : "Unggah"}
        </button>
      </div>
      {result && (
        <p role="status" className={`mt-2.5 rounded-lg p-2.5 text-[12px] ${result.tone === "good" ? "bg-[#eaf6ee] text-ink" : "bg-[#fbeaea] text-ink"}`}>
          {result.text}
        </p>
      )}
    </form>
  );
}
