import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { requirePageUser } from "@/lib/auth";
import { activePeriod, loadPjpList, type PartBadge, type PjpListRow } from "@/lib/assessmentView";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const fmtDate = (d: Date | null) =>
  d ? d.toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) : "–";

const SUBMISSION: Record<PjpListRow["submission"], { label: string; cls: string }> = {
  belum: { label: "Belum menyampaikan", cls: "bg-plane text-ink-3 ring-line" },
  tepat_waktu: { label: "Tepat waktu", cls: "bg-brand-soft text-brand-strong ring-brand/20" },
  terlambat: { label: "Terlambat", cls: "bg-[#fdecea] text-[#a8302a] ring-[#a8302a]/20" },
};

const STATUS: Record<string, string> = { draft: "Draft", direview: "Direview", final: "Final" };

function Part({ label, b }: { label: string; b: PartBadge }) {
  if (!b.active && !b.latestExcluded) return <span className="text-ink-3">{label}: –</span>;
  const tone = b.latestExcluded
    ? "text-[#a8302a]"
    : b.acceptance === "perlu_perbaikan"
      ? "text-[#9a6700]"
      : "text-brand-strong";
  const text = b.latestExcluded
    ? "file terbaru tidak dipakai"
    : b.acceptance === "perlu_perbaikan"
      ? "Perlu Perbaikan"
      : "OK";
  return (
    <span className={tone} title={b.active ? `${b.errors} error, ${b.warnings} peringatan pada file aktif` : undefined}>
      {label}: {text}
      {b.active && (b.errors || b.warnings) ? <span className="ml-1 text-ink-3">({b.errors}E/{b.warnings}P)</span> : null}
    </span>
  );
}

/** Every PJP of the period: who supervises it, whether it submitted in time, and the state of its MR and IT files. */
export default async function PjpListPage({ searchParams }: PageProps<"/pjp">) {
  const me = await requirePageUser("/pjp");
  const { q: qParam, saya: sayaParam, status: statusParam } = await searchParams;
  const q = typeof qParam === "string" ? qParam.trim().toLowerCase() : "";
  const saya = sayaParam === "1";
  const status = typeof statusParam === "string" ? statusParam : "";
  const period = await activePeriod(db);
  if (!period) {
    return (
      <div className="min-h-screen">
        <AppHeader active="/pjp" user={me} />
        <main className="mx-auto max-w-7xl px-4 py-9 sm:px-8">Belum ada periode aktif. Jalankan scripts/seed-period.ts.</main>
      </div>
    );
  }
  const all = await loadPjpList(db, period.id, period.deadline);
  const rows = all.filter(
    (r) =>
      (!q || r.nama.toLowerCase().includes(q) || r.sandi.includes(q)) &&
      (!saya || r.pengawas?.id === me.id) &&
      (!status || (status === "belum" ? r.submission === "belum" : status === "perbaikan" ? r.mr.acceptance === "perlu_perbaikan" || r.it.acceptance === "perlu_perbaikan" || !!r.mr.latestExcluded || !!r.it.latestExcluded : r.status === status)),
  );
  const counts = {
    total: all.length,
    belum: all.filter((r) => r.submission === "belum").length,
    terlambat: all.filter((r) => r.submission === "terlambat").length,
    final: all.filter((r) => r.status === "final").length,
  };
  const link = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q && { q }), ...(saya && { saya: "1" }), ...(status && { status }), ...over });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/pjp${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="min-h-screen">
      <AppHeader active="/pjp" user={me} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-9 sm:px-8">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">PJP</h1>
          <p className="mt-1.5 text-[14.5px] text-ink-2">
            Asesmen Mandiri posisi {period.posisi} {period.dataYear}. Batas penyampaian {fmtDate(period.deadline)} WIB. {counts.total} PJP, {counts.belum} belum
            menyampaikan, {counts.terlambat} terlambat, {counts.final} Final.
          </p>
        </div>

        <form className="flex flex-wrap items-center gap-2 text-[13.5px]" action="/pjp">
          <input name="q" defaultValue={q} placeholder="Cari nama atau sandi" className="w-64 rounded-lg border border-line-strong bg-surface px-3 py-1.5" />
          {saya && <input type="hidden" name="saya" value="1" />}
          <select name="status" defaultValue={status} className="rounded-lg border border-line-strong bg-surface px-2 py-1.5">
            <option value="">Semua status</option>
            <option value="belum">Belum menyampaikan</option>
            <option value="perbaikan">Perlu perbaikan / file tidak dipakai</option>
            <option value="draft">Draft</option>
            <option value="direview">Direview</option>
            <option value="final">Final</option>
          </select>
          <button className="rounded-lg bg-ink px-3 py-1.5 font-medium text-white">Terapkan</button>
          <Link href={link({ saya: saya ? "" : "1" })} className={`rounded-lg px-3 py-1.5 ring-1 ${saya ? "bg-brand-soft text-brand-strong ring-brand/30" : "text-ink-2 ring-line"}`}>
            PJP saya
          </Link>
        </form>

        <div className="card overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead className="border-b border-line bg-plane text-left text-[12px] uppercase tracking-wide text-ink-3">
              <tr>
                <th className="px-3 py-2.5">PJP</th>
                <th className="px-3 py-2.5">Bundling</th>
                <th className="px-3 py-2.5">Pengawas</th>
                <th className="px-3 py-2.5">Penyampaian</th>
                <th className="px-3 py-2.5">File</th>
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.sandi} className="hover:bg-plane/60">
                  <td className="px-3 py-2.5">
                    <Link href={`/pjp/${r.sandi}`} className="font-medium text-ink hover:underline">
                      {r.nama}
                    </Link>
                    <div className="text-[12px] text-ink-3 tabular-nums">{r.sandi}</div>
                  </td>
                  <td className="px-3 py-2.5">{r.bundling ?? "–"}</td>
                  <td className="px-3 py-2.5">{r.pengawas?.name ?? <span className="text-ink-3">belum ditugaskan</span>}</td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 text-[12px] ring-1 ${SUBMISSION[r.submission].cls}`}>{SUBMISSION[r.submission].label}</span>
                    {r.lastSubmittedAt && <div className="mt-0.5 text-[12px] text-ink-3">terakhir {fmtDate(r.lastSubmittedAt)}</div>}
                  </td>
                  <td className="space-y-0.5 px-3 py-2.5 text-[12.5px]">
                    <div>
                      <Part label="MR" b={r.mr} />
                    </div>
                    <div>
                      <Part label="TI" b={r.it} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5">{r.status ? STATUS[r.status] : <span className="text-ink-3">–</span>}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-ink-3">
                    Tidak ada PJP yang cocok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
