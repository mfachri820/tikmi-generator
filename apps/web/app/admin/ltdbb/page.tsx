import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { cellInputs, ltdbbCodeOverrides, ltdbbMonthly, ltdbbUploads, periods, pjpValidationMeta, users, workbooks } from "@ira/db";
import { getActiveLtdbbUpload, type AggregateFlag } from "@ira/ltdbb";
import { cachedAggregateYear } from "@/lib/immutableCache";
import { dataMismatchToleranceRupiah } from "@ira/scoring/config/2026-c2";
import { db } from "@/lib/db";
import { can, requirePageUser } from "@/lib/auth";
import { FLAG_HELP, HELP, type FlagKey } from "@/lib/glossary";
import { InfoTip } from "@/components/info-tip";
import { PAGE_SIZE, Pagination } from "@/components/pagination";
import { AppHeader } from "@/components/app-header";
import { activateUpload } from "./actions";
import { LtdbbUploadForm } from "./upload-form";
import { PjpSearch } from "./pjp-search";
import { AlertCircleIcon, AlertTriangleIcon, CheckCircleIcon, FileSpreadsheetIcon, SearchIcon } from "@/components/icons";

/** C2!C18 = SUM(C6:C17): the transaction total the PJP reported in the form. */
const REPORTED_TOTAL_CELLS = Array.from({ length: 12 }, (_, i) => `C2. Form PJP LR!C${6 + i}`);

/** Problems are status cues (icon + label); "note" flags only explain how a number was read. */
const FLAG_LABELS: Record<FlagKey, { label: string; level: "critical" | "serious" | "warning" | "note" }> = {
  PENALTY_EXPECTED: { label: "Nilai akhir −1", level: "critical" },
  NOT_IN_LTDBB: { label: "Tidak ada di LTDBB", level: "serious" },
  INCOMPLETE_YEAR: { label: "< 12 bulan", level: "warning" },
  MISSING_VALUE: { label: "Nilai kosong", level: "warning" },
  NON_NUMERIC: { label: "Bukan angka", level: "warning" },
  NEGATIVE: { label: "Nilai negatif", level: "warning" },
  DATE_MISMATCH: { label: "Tanggal tidak cocok", level: "warning" },
  CODE_OVERRIDDEN: { label: "Kode dikoreksi", level: "note" },
  DERIVED_FROM_NILAI: { label: "Dihitung dari Nilai", level: "note" },
  NON_INTEGER_FREQ: { label: "Frekuensi desimal", level: "note" },
};

const LEVEL_STYLE = {
  critical: { bg: "bg-[#fbeaea]", icon: "text-status-critical" },
  serious: { bg: "bg-[#fdf0ea]", icon: "text-status-serious" },
  warning: { bg: "bg-[#fef6e2]", icon: "text-[#c98500]" },
  note: { bg: "bg-plane ring-1 ring-line", icon: "" },
} as const;

const rupiah = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
const count = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 3 });

/** A flag as it appears in table rows: the explanation is a plain hover title, so 85 rows don't each carry an icon. */
function Badge({ flag }: { flag: FlagKey }) {
  const { label, level } = FLAG_LABELS[flag];
  const style = LEVEL_STYLE[level];
  const Icon = level === "warning" ? AlertTriangleIcon : AlertCircleIcon;
  return (
    <span
      title={FLAG_HELP[flag]}
      className={`inline-flex cursor-help items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-ink ${style.bg}`}
    >
      {level !== "note" && <Icon className={`text-[12px] ${style.icon}`} />}
      {label}
    </span>
  );
}

function HeaderTip({ children, help, className = "" }: { children: string; help: string; className?: string }) {
  return (
    <th className={`whitespace-nowrap px-3 py-2.5 font-medium ${className}`}>
      {children}
      <InfoTip label={`Penjelasan ${children}`}>{help}</InfoTip>
    </th>
  );
}

function Tile({ label, value, help, tone = "default" }: { label: string; value: number; help?: string; tone?: "default" | "critical" | "serious" | "warning" }) {
  const color = { default: "text-ink", critical: "text-status-critical", serious: "text-[#c25a2e]", warning: "text-[#b07400]" }[tone];
  return (
    <div className="card px-4 py-3.5">
      <p className="flex items-center text-[12.5px] text-ink-2">
        {label}
        {help && <InfoTip label={`Penjelasan ${label}`}>{help}</InfoTip>}
      </p>
      <p className={`mt-1 text-[24px] font-semibold leading-none tracking-tight ${value ? color : "text-ink"}`}>{value}</p>
    </div>
  );
}

/**
 * Read-only check of the active LTDBB data against what goes into "Validasi
 * Data Transaksi": every PJP in the form's list, its totals for the data
 * year, the PJP's own reported total where a workbook exists, and whether the
 * generated file will apply the "Perbedaan Data" −1. Pengawas and admin can
 * upload a new LTDBB file or switch back to an earlier one. Editing Status
 * PJP / Keterangan comes later.
 */
export default async function LtdbbPreviewPage({ searchParams }: PageProps<"/admin/ltdbb">) {
  const user = await requirePageUser("/admin/ltdbb");
  const upload = await getActiveLtdbbUpload(db);
  const [activePeriod] = await db.select().from(periods).where(eq(periods.status, "active")).limit(1);
  const uploads = await db
    .select({ upload: ltdbbUploads, by: users.name })
    .from(ltdbbUploads)
    .leftJoin(users, eq(users.id, ltdbbUploads.uploadedBy))
    .orderBy(desc(ltdbbUploads.uploadedAt));
  const canUpload = can.edit(user);

  if (!upload) {
    return (
      <div className="min-h-screen">
        <AppHeader active="/admin/ltdbb" user={user} />
        <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <div className="card mx-auto max-w-md p-8 text-center">
            <FileSpreadsheetIcon className="mx-auto text-[28px] text-status-critical" />
            <h1 className="mt-3 text-lg font-semibold">Belum ada data LTDBB aktif</h1>
            <p className="mt-2 text-[13px] text-ink-2">
              {canUpload ? "Unggah file LTDBB di bawah" : "Minta pengawas mengunggah file LTDBB"}. Export workbook diblokir sampai data ada.
            </p>
            {canUpload && (
              <div className="text-left">
                <LtdbbUploadForm />
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  const years = (
    await db
      .selectDistinct({ year: ltdbbMonthly.year })
      .from(ltdbbMonthly)
      .where(eq(ltdbbMonthly.uploadId, upload.id))
      .orderBy(desc(ltdbbMonthly.year))
  ).map((y) => y.year);
  const { year: yearParam, page: pageParam, q: qParam } = await searchParams;
  const q = (typeof qParam === "string" ? qParam : "").trim();
  const year = Number(yearParam) || activePeriod?.dataYear || years[0];

  const { rows } = await cachedAggregateYear(upload.id, year);
  // The search keeps each PJP's number from the full list, so "No" still points at the same row.
  const needle = q.toLowerCase();
  const numbered = rows.map((r, i) => ({ r, no: i + 1 }));
  const shown = needle
    ? numbered.filter(({ r }) => r.sandi.includes(needle) || r.nama.toLowerCase().includes(needle))
    : numbered;
  const qs = (params: Record<string, string | number>) =>
    "?" + new URLSearchParams({ ...(q ? { q } : {}), ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(Math.max(Number(pageParam) || 1, 1), pageCount);
  const firstIndex = (page - 1) * PAGE_SIZE;
  const pageRows = shown.slice(firstIndex, firstIndex + PAGE_SIZE);

  // The PJP-reported total (C2!C18) for PJPs that have a workbook in this data year's period.
  const reported = new Map<string, number>();
  const [period] = await db.select().from(periods).where(eq(periods.dataYear, year)).limit(1);
  if (period) {
    const sums = await db
      .select({ sandi: workbooks.pjpSandi, total: sql<number>`sum((${cellInputs.value})::text::double precision)` })
      .from(cellInputs)
      .innerJoin(workbooks, eq(workbooks.id, cellInputs.workbookId))
      .where(
        and(
          eq(workbooks.periodId, period.id),
          inArray(cellInputs.cellRef, REPORTED_TOTAL_CELLS),
          sql`jsonb_typeof(${cellInputs.value}) = 'number'`,
        ),
      )
      .groupBy(workbooks.pjpSandi);
    for (const s of sums) reported.set(s.sandi, Number(s.total));
  }
  const meta = new Map(
    (await db.select().from(pjpValidationMeta).where(eq(pjpValidationMeta.dataYear, year))).map((m) => [m.sandi, m]),
  );

  // "Kode dikoreksi" names the corrections actually in effect.
  const codeOverrides = await db.select().from(ltdbbCodeOverrides);
  const flagHelp = (flag: FlagKey) =>
    flag === "CODE_OVERRIDDEN" && codeOverrides.length
      ? `${FLAG_HELP[flag]} Koreksi aktif: ${codeOverrides.map((o) => `${o.namaLtdbb} → ${o.kode}`).join("; ")}.`
      : FLAG_HELP[flag];

  const report = upload.report as { flagCounts?: Record<string, number> } | null;
  const flagCounts = Object.entries(report?.flagCounts ?? {});
  const notIn = rows.filter((r) => !r.inLtdbb).length;
  const incomplete = rows.filter((r) => r.flags.includes("INCOMPLETE_YEAR")).length;
  const penalties = rows.filter((r) => {
    const rep = reported.get(r.sandi);
    return rep !== undefined && Math.abs(rep - r.totalNominal) > dataMismatchToleranceRupiah;
  }).length;

  return (
    <div className="min-h-screen">
      <AppHeader
        active="/admin/ltdbb"
        user={user}
      />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 text-[13px] sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-brand">Validasi Data Transaksi</p>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Data LTDBB</h1>
            <p className="mt-1 text-[13.5px] text-ink-2">
              Total transaksi per PJP untuk tahun {year}, dibandingkan dengan yang dilaporkan PJP di formulir.
            </p>
          </div>
          {/* Year switcher */}
          <nav className="flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-surface p-0.5 ring-1 ring-line" aria-label="Tahun data">
            {years.map((y) => {
              const active = y === year;
              return (
                <Link
                  key={y}
                  href={qs({ year: y })}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12.5px] transition ${
                    active ? "bg-brand font-medium text-white" : "text-ink-2 hover:bg-plane hover:text-ink"
                  }`}
                >
                  {y}
                  {y === activePeriod?.dataYear && <span className={active ? "text-white/80" : "text-ink-3"}> · aktif</span>}
                </Link>
              );
            })}
          </nav>
        </div>

        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile label="PJP di daftar formulir" value={rows.length} />
          <Tile label="Tidak ada di LTDBB" value={notIn} help={FLAG_HELP.NOT_IN_LTDBB} tone="serious" />
          <Tile label="Kurang dari 12 bulan" value={incomplete} help={FLAG_HELP.INCOMPLETE_YEAR} tone="warning" />
          <Tile label="Akan dikenai −1" value={penalties} help={HELP.ltdbbPenalty} tone="critical" />
        </section>

        <section>
          <div className="card p-5">
            <h2 className="card-title">Sumber data aktif</h2>
            <dl className="mt-3 grid grid-cols-[7.5rem_1fr] gap-x-4 gap-y-2">
              <dt className="text-ink-3">File</dt>
              <dd className="flex items-center gap-1.5 font-medium">
                <FileSpreadsheetIcon className="text-[15px] text-brand" />
                {upload.filename}
              </dd>
              <dt className="text-ink-3">Asal</dt>
              <dd className="text-ink-2">{upload.source === "seed" ? "Data bawaan (repo)" : `Diunggah oleh ${uploads.find((u) => u.upload.id === upload.id)?.by ?? "pengguna dihapus"}`}</dd>
              <dt className="text-ink-3">Diimpor</dt>
              <dd className="text-ink-2">{upload.uploadedAt.toLocaleString("id-ID")}</dd>
              <dt className="text-ink-3">Periode data</dt>
              <dd className="text-ink-2">
                {upload.minDate?.slice(0, 7)} s.d. {upload.maxDate?.slice(0, 7)} · {upload.rowCount?.toLocaleString("id-ID")} baris
              </dd>
              <dt className="flex items-start text-ink-3">
                Penanda baris
                <InfoTip label="Penjelasan penanda baris">{HELP.ltdbbRowFlags}</InfoTip>
              </dt>
              <dd className="flex flex-wrap gap-x-3 gap-y-1.5">
                {flagCounts.length === 0
                  ? "—"
                  : flagCounts.map(([flag, n]) => (
                      <span key={flag} className="flex items-center">
                        <Badge flag={flag as AggregateFlag} />
                        <InfoTip label={`Penjelasan ${FLAG_LABELS[flag as AggregateFlag]?.label ?? flag}`}>
                          {flagHelp(flag as AggregateFlag)}
                        </InfoTip>
                        <span className="ml-1.5 tabular-nums text-ink-2">{n.toLocaleString("id-ID")}</span>
                      </span>
                    ))}
              </dd>
            </dl>
            {uploads.length > 1 && (
              <details className="mt-4 border-t border-line pt-3 text-[12px]">
                <summary className="cursor-pointer text-ink-3 hover:text-ink">{uploads.length - 1} unggahan lain tersimpan (tidak aktif)</summary>
                <ul className="mt-2 divide-y divide-line">
                  {uploads
                    .filter((u) => !u.upload.isActive)
                    .map(({ upload: u, by }) => (
                      <li key={u.id} className="flex items-center gap-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-ink">{u.filename}</p>
                          <p className="text-ink-3">
                            {u.uploadedAt.toLocaleString("id-ID")} · {u.source === "seed" ? "data bawaan" : (by ?? "pengguna dihapus")}
                            {u.status === "ready"
                              ? ` · ${u.minDate?.slice(0, 7)} s.d. ${u.maxDate?.slice(0, 7)}`
                              : ` · gagal: ${(u.report as { error?: string } | null)?.error ?? "tidak terbaca"}`}
                          </p>
                        </div>
                        {canUpload && u.status === "ready" && (
                          <form action={activateUpload}>
                            <input type="hidden" name="id" value={u.id} />
                            <button type="submit" className="rounded-md px-2 py-1 font-medium text-brand ring-1 ring-line hover:bg-plane">
                              Aktifkan
                            </button>
                          </form>
                        )}
                      </li>
                    ))}
                </ul>
              </details>
            )}
            {canUpload && <LtdbbUploadForm />}
          </div>

        </section>

        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5">
            <div>
              <h2 className="card-title text-[15px]">Total per PJP · {year}</h2>
              <p className="mt-0.5 text-[12.5px] text-ink-3">
                {q ? `${shown.length} dari ${rows.length} PJP cocok dengan "${q}". ` : ""}Frekuensi dalam transaksi, nominal dalam Rupiah.
              </p>
            </div>
            <PjpSearch initial={q} />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-t border-line text-right text-[12.5px] tabular-nums">
              <thead className="bg-plane/70 text-left text-[11.5px] text-ink-3">
                <tr>
                  <th className="py-2.5 pl-5 pr-3 font-medium">No</th>
                  <th className="px-3 py-2.5 font-medium">Sandi</th>
                  <th className="px-3 py-2.5 font-medium">Nama PJP</th>
                  <HeaderTip help={HELP.statusPjp}>Status</HeaderTip>
                  <HeaderTip help={HELP.bulan} className="text-right">Bulan</HeaderTip>
                  <th className="px-3 py-2.5 text-right font-medium">Frek. Incoming</th>
                  <th className="px-3 py-2.5 text-right font-medium">Nominal Incoming</th>
                  <th className="px-3 py-2.5 text-right font-medium">Frek. Outgoing</th>
                  <th className="px-3 py-2.5 text-right font-medium">Nominal Outgoing</th>
                  <th className="px-3 py-2.5 text-right font-medium">Frek. Domestik</th>
                  <th className="px-3 py-2.5 text-right font-medium">Nominal Domestik</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total Nominal</th>
                  <HeaderTip help={HELP.dilaporkan} className="text-right">Dilaporkan PJP</HeaderTip>
                  <HeaderTip help={HELP.selisih} className="text-right">Selisih</HeaderTip>
                  <HeaderTip help={HELP.hasil}>Hasil</HeaderTip>
                  <HeaderTip help={HELP.catatan} className="pr-5">Catatan</HeaderTip>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={16} className="px-5 py-14 text-center text-ink-3">
                      <SearchIcon className="mx-auto mb-2 text-[22px]" />
                      Tidak ada PJP dengan sandi atau nama &quot;{q}&quot;.
                    </td>
                  </tr>
                )}
                {pageRows.map(({ r, no }) => {
                  const rep = reported.get(r.sandi);
                  const diff = rep === undefined ? undefined : rep - r.totalNominal;
                  const penalty = diff !== undefined && Math.abs(diff) > dataMismatchToleranceRupiah;
                  const m = meta.get(r.sandi);
                  return (
                    <tr key={r.sandi} className="transition-colors odd:bg-surface even:bg-plane hover:bg-brand-soft">
                      <td className="py-2 pl-5 pr-3 text-left text-ink-3">{no}</td>
                      <td className="px-3 py-2 text-left font-mono text-[11.5px] text-ink-2">{r.sandi}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-left font-medium">{r.nama}</td>
                      <td className="px-3 py-2 text-left text-[12px] text-ink-2" title={m?.keterangan ?? undefined}>
                        {m?.statusPjp ?? "—"}
                      </td>
                      <td className={`px-3 py-2 ${r.monthsPresent.length < 12 ? "text-[#b07400]" : "text-ink-2"}`} title={r.monthsPresent.join(", ") || "tidak ada"}>
                        {r.monthsPresent.length}/12
                      </td>
                      <td className="px-3 py-2 text-ink-2">{count(r.finJumlahInc)}</td>
                      <td className="px-3 py-2">{rupiah(r.finNilaiInc)}</td>
                      <td className="px-3 py-2 text-ink-2">{count(r.finJumlahOut)}</td>
                      <td className="px-3 py-2">{rupiah(r.finNilaiOut)}</td>
                      <td className="px-3 py-2 text-ink-2">{count(r.finJumlahDom)}</td>
                      <td className="px-3 py-2">{rupiah(r.finNilaiDom)}</td>
                      <td className="px-3 py-2 font-semibold">{rupiah(r.totalNominal)}</td>
                      <td className="px-3 py-2">{rep === undefined ? <span className="text-ink-3">—</span> : rupiah(rep)}</td>
                      <td className={`px-3 py-2 ${penalty ? "font-medium text-status-critical" : ""}`}>
                        {diff === undefined ? <span className="text-ink-3">—</span> : rupiah(diff)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-left">
                        {diff === undefined ? (
                          <span className="text-ink-3">belum ada workbook</span>
                        ) : penalty ? (
                          <span className="inline-flex items-center gap-1 font-medium text-ink">
                            <AlertCircleIcon className="text-[13px] text-status-critical" />
                            Perbedaan Data
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-medium text-ink">
                            <CheckCircleIcon className="text-[13px] text-status-good" />
                            Sesuai
                          </span>
                        )}
                      </td>
                      <td className="py-2 pl-3 pr-5 text-left">
                        <div className="flex flex-wrap gap-1">
                          {penalty && <Badge flag="PENALTY_EXPECTED" />}
                          {r.flags.map((f) => (
                            <Badge key={f} flag={f} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={shown.length} hrefFor={(p) => qs({ year, page: p })} />
        </section>
      </main>
    </div>
  );
}
