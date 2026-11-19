import Link from "next/link";
import { notFound } from "next/navigation";
import type { Issue, ValidationReport } from "@tikmi/parser";
import { AppHeader } from "@/components/app-header";
import { can, requirePageUser } from "@/lib/auth";
import { loadPjpDetail } from "@/lib/assessmentView";
import { db } from "@/lib/db";
import { uploadPsp } from "./actions";
import { NoteToPjp, UploadForm } from "./client";

export const dynamic = "force-dynamic";

const fmt = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) : "–";
const num = (v: unknown, digits = 2) => (typeof v === "number" ? v.toFixed(digits) : v === null || v === undefined ? "–" : String(v));

const STATUS: Record<string, string> = { draft: "Draft", direview: "Direview", final: "Final" };
const EXCLUDED: Record<string, string> = {
  unreadable: "tidak dapat dibaca",
  not_tikmi: "bukan template TIKMI",
  wrong_kind: "MR/TI tertukar",
  wrong_bundling: "template bundling lain",
};
const SEVERITY: Record<Issue["severity"], { label: string; cls: string }> = {
  error: { label: "Error", cls: "bg-[#fdecea] text-[#a8302a]" },
  warning: { label: "Peringatan", cls: "bg-[#fff4d6] text-[#7a5200]" },
  info: { label: "Info", cls: "bg-plane text-ink-3" },
};

function Report({ report }: { report: ValidationReport | null }) {
  if (!report) return <p className="text-[13px] text-ink-3">Belum ada laporan validasi.</p>;
  const order = (i: Issue) => (i.prominent ? 0 : i.severity === "error" ? 1 : i.severity === "warning" ? 2 : 3);
  const issues = [...report.issues].sort((a, b) => order(a) - order(b));
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-2">
        {report.counts.error} error, {report.counts.warning} peringatan, {report.counts.info} info.
      </p>
      <ul className="space-y-1.5 text-[13px]">
        {issues.map((i, n) => (
          <li key={n} className={i.prominent ? "rounded-lg border border-[#e0b23c] bg-[#fff8e6] p-2.5" : ""}>
            <span className={`mr-2 rounded px-1.5 py-0.5 text-[11.5px] font-medium ${SEVERITY[i.severity].cls}`}>{SEVERITY[i.severity].label}</span>
            {i.needsCorrection && <span className="mr-2 rounded bg-[#fdecea] px-1.5 py-0.5 text-[11.5px] font-medium text-[#a8302a]">Perlu Perbaikan</span>}
            <span className={i.prominent ? "font-medium" : ""}>{i.message}</span>
            {!!i.items?.length && (
              <details className="ml-1 inline">
                <summary className="inline cursor-pointer text-[12px] text-ink-3">({i.items.length})</summary>
                <div className="mt-1 max-h-40 overflow-auto rounded bg-plane p-2 font-mono text-[11.5px] text-ink-2">{i.items.join(" · ")}</div>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

type Detail = NonNullable<Awaited<ReturnType<typeof loadPjpDetail>>>;
type PartView = NonNullable<Detail["parts"]>["mr"];

function PartSection({ title, part }: { title: string; part: PartView }) {
  const active = part.files.find((f) => f.active);
  const report = (active?.report as { validation?: ValidationReport } | null)?.validation ?? null;
  const latest = part.latestNotActive;
  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {active ? (
          <span className={`rounded px-2 py-0.5 text-[12px] font-medium ${active.acceptance === "perlu_perbaikan" ? "bg-[#fdecea] text-[#a8302a]" : "bg-brand-soft text-brand-strong"}`}>
            {active.acceptance === "perlu_perbaikan" ? "Perlu Perbaikan" : "File aktif OK"}
          </span>
        ) : (
          <span className="rounded bg-plane px-2 py-0.5 text-[12px] text-ink-3">Belum ada file yang dipakai</span>
        )}
      </div>
      {latest && (
        <p className="rounded-lg border border-[#e8a39d] bg-[#fdf3f2] p-2.5 text-[13px] text-[#8a2b25]">
          File terbaru tidak dipakai ({EXCLUDED[latest.excluded ?? ""] ?? latest.excluded ?? "lihat laporan"})
          {active ? `; versi aktif tetap versi ${active.version} (${fmt(active.submittedAt)}).` : "."}
        </p>
      )}
      <div>
        <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-3">Laporan validasi file aktif</h3>
        <Report report={report} />
      </div>
      <div>
        <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-3">Kirim catatan ke PJP</h3>
        <NoteToPjp text={report?.noteToPjp ?? ""} />
      </div>
      <div>
        <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-3">Versi</h3>
        <table className="w-full text-[13px]">
          <thead className="text-left text-[12px] text-ink-3">
            <tr>
              <th className="py-1 pr-3">Waktu</th>
              <th className="py-1 pr-3">Sumber</th>
              <th className="py-1 pr-3">File</th>
              <th className="py-1">Keputusan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {part.files.map((f) => (
              <tr key={f.id} className={f.active ? "bg-brand-soft/40" : ""}>
                <td className="py-1.5 pr-3 whitespace-nowrap">{fmt(f.submittedAt)}</td>
                <td className="py-1.5 pr-3">{f.source === "manual" ? `Unggah manual: ${f.uploader ?? "?"}` : `Formulir, versi ${f.version}`}</td>
                <td className="py-1.5 pr-3">
                  <a href={`/api/files/${f.id}`} className="text-[#0563C1] hover:underline">
                    {f.originalName}
                  </a>
                </td>
                <td className="py-1.5">
                  {f.active ? <b>Aktif</b> : f.excluded ? `Tidak dipakai: ${EXCLUDED[f.excluded] ?? f.excluded}` : f.parseStatus === "pending" ? "Menunggu" : "Tidak aktif"}
                  {f.acceptance === "perlu_perbaikan" && <span className="ml-1 text-[#a8302a]">(Perlu Perbaikan)</span>}
                </td>
              </tr>
            ))}
            {!part.files.length && (
              <tr>
                <td colSpan={4} className="py-3 text-ink-3">
                  Belum ada file.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One PJP: its files and versions, validation reports, scores so far and what still blocks Final. */
export default async function PjpPage({ params }: PageProps<"/pjp/[sandi]">) {
  const { sandi } = await params;
  const me = await requirePageUser(`/pjp/${sandi}`);
  const d = await loadPjpDetail(db, sandi);
  if (!d) notFound();
  const mayWork = can.workOn(me, d.assessment?.pengawasId ?? d.pjp.defaultPengawasId);

  return (
    <div className="min-h-screen">
      <AppHeader active="/pjp" user={me} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-9 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link href="/pjp" className="text-[13px] text-ink-3 hover:underline">
              ← Semua PJP
            </Link>
            <h1 className="mt-1 text-[28px] font-semibold tracking-tight">{d.pjp.nama}</h1>
            <p className="mt-1 text-[14px] text-ink-2">
              Sandi {d.pjp.sandi} · Bundling {d.assessment?.bundling ?? d.pjp.bundling ?? "–"} · Pengawas {d.pengawas?.name ?? "belum ditugaskan"} · Status{" "}
              {d.assessment ? STATUS[d.assessment.status] : "belum ada asesmen"}
            </p>
          </div>
          {d.assessment && (
            <Link href={`/pjp/${sandi}/mr`} className="rounded-lg bg-ink px-3 py-2 text-[13.5px] font-medium text-white">
              Kertas Kerja MR
            </Link>
          )}
        </div>

        {d.assessment && (
          <section className="grid gap-4 md:grid-cols-3">
            <div className="card p-4">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">Rating M</h2>
              {d.mr ? (
                <dl className="mt-2 space-y-1 text-[14px]">
                  <div className="flex justify-between gap-2">
                    <dt>Berdasarkan Asesmen Mandiri (C64)</dt>
                    <dd className="font-semibold tabular-nums">
                      {num(d.mr.ratingM.template.score)} <span className="font-normal text-ink-2">{String(d.mr.ratingM.template.predikat ?? "")}</span>
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Berdasarkan Penilaian Pengawas (F64)</dt>
                    <dd className="font-semibold tabular-nums">
                      {num(d.mr.ratingM.validasiPengawas.score)} <span className="font-normal text-ink-2">{String(d.mr.ratingM.validasiPengawas.predikat ?? "")}</span>
                    </dd>
                  </div>
                  {d.mr.tkmr.badge && <p className="mt-2 rounded bg-[#fff4d6] px-2 py-1 text-[12.5px] text-[#7a5200]">{d.mr.tkmr.badge}</p>}
                </dl>
              ) : (
                <p className="mt-2 text-[13px] text-ink-3">Belum ada file MR yang dipakai.</p>
              )}
            </div>
            <div className="card p-4">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">Infrastruktur TI</h2>
              <p className="mt-2 text-[13px] text-ink-2">
                Sheet berlaku: {d.it.applicability.pairs.join(", ")}
                {d.it.applicability.fallback.used ? " (default bundling)" : ""}
                {d.it.applicability.override ? " (ditetapkan pengawas)" : ""}
              </p>
              {d.it.result ? (
                <dl className="mt-2 space-y-1 text-[14px]">
                  <div className="flex justify-between">
                    <dt>Self assessment</dt>
                    <dd className="font-semibold tabular-nums">{num(d.it.result.self.total)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Penilaian pengawas</dt>
                    <dd className="font-semibold tabular-nums">{num(d.it.result.pengawas.total)}</dd>
                  </div>
                  {d.it.result.asSubmitted.pairs.join() !== d.it.result.applicable.join() && (
                    <div className="flex justify-between text-[12.5px] text-ink-3">
                      <dt>Informasi: semua sheet yang diisi</dt>
                      <dd className="tabular-nums">{num(d.it.result.asSubmitted.self.total)}</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="mt-2 text-[13px] text-ink-3">Belum ada file TI yang dipakai.</p>
              )}
            </div>
            <div className="card p-4">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">Final</h2>
              {d.blockers.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] text-ink-2">
                  {d.blockers.map((b, i) => (
                    <li key={i}>{b.message}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] text-brand-strong">Tidak ada yang menghalangi Final.</p>
              )}
            </div>
          </section>
        )}

        {d.parts ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <PartSection title="Manajemen Risiko (MR)" part={d.parts.mr} />
            <PartSection title="Infrastruktur TI" part={d.parts.it} />
          </div>
        ) : (
          <p className="card p-5 text-[14px] text-ink-2">PJP ini belum menyampaikan file pada periode ini.</p>
        )}

        {mayWork && (
          <section className="card space-y-3 p-5">
            <h2 className="text-[17px] font-semibold">Unggah file PSP</h2>
            <p className="text-[13px] text-ink-2">
              Untuk file yang diterima di luar formulir. Diproses sama seperti penyampaian lewat formulir (validasi, versi, file aktif) dan tercatat atas nama Anda.
            </p>
            <UploadForm action={uploadPsp.bind(null, sandi)} />
          </section>
        )}
      </main>
    </div>
  );
}
