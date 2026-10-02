import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { cellInputs, ltdbbCodeOverrides, ltdbbMonthly, ltdbbUploads, periods, pjpValidationMeta, workbooks } from "@ira/db";
import { aggregateYear, getActiveLtdbbUpload, ltdbbPolicy, type AggregateFlag } from "@ira/ltdbb";
import { dataMismatchToleranceRupiah } from "@ira/scoring/config/2026-c2";
import { db } from "@/lib/db";
import { getDevUser } from "@/lib/devUser";
import { FLAG_HELP, HELP, type FlagKey } from "@/lib/glossary";
import { InfoTip } from "@/components/info-tip";

/** C2!C18 = SUM(C6:C17): the transaction total the PJP reported in the form. */
const REPORTED_TOTAL_CELLS = Array.from({ length: 12 }, (_, i) => `C2. Form PJP LR!C${6 + i}`);

const FLAG_LABELS: Record<FlagKey, { label: string; tone: string }> = {
  NOT_IN_LTDBB: { label: "Tidak ada di LTDBB", tone: "bg-red-100 text-red-800" },
  INCOMPLETE_YEAR: { label: "< 12 bulan", tone: "bg-amber-100 text-amber-800" },
  CODE_OVERRIDDEN: { label: "Kode dikoreksi", tone: "bg-sky-100 text-sky-800" },
  PENALTY_EXPECTED: { label: "Nilai akhir −1", tone: "bg-red-600 text-white" },
  DERIVED_FROM_NILAI: { label: "Dihitung dari Nilai", tone: "bg-zinc-100 text-zinc-700" },
  MISSING_VALUE: { label: "Nilai kosong", tone: "bg-amber-100 text-amber-800" },
  NON_NUMERIC: { label: "Bukan angka", tone: "bg-amber-100 text-amber-800" },
  NON_INTEGER_FREQ: { label: "Frekuensi desimal", tone: "bg-zinc-100 text-zinc-700" },
  NEGATIVE: { label: "Nilai negatif", tone: "bg-red-100 text-red-800" },
  DATE_MISMATCH: { label: "Tanggal tidak cocok", tone: "bg-amber-100 text-amber-800" },
};

const rupiah = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
const count = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 3 });

/** A flag as it appears in table rows: the explanation is a plain hover title, so 85 rows don't each carry an icon. */
function Badge({ flag }: { flag: FlagKey }) {
  const { label, tone } = FLAG_LABELS[flag];
  return (
    <span title={FLAG_HELP[flag]} className={`cursor-help whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {label}
    </span>
  );
}

function HeaderTip({ children, help, className = "" }: { children: React.ReactNode; help: string; className?: string }) {
  return (
    <th className={`whitespace-nowrap px-2 py-2 ${className}`}>
      {children}
      <InfoTip label={`Penjelasan ${children}`}>{help}</InfoTip>
    </th>
  );
}

/**
 * Read-only check of the active LTDBB data against what goes into "Validasi
 * Data Transaksi": every PJP in the form's list, its totals for the data
 * year, the PJP's own reported total where a workbook exists, and whether the
 * generated file will apply the "Perbedaan Data" −1. Uploading new LTDBB
 * files and editing Status PJP / Keterangan come later.
 */
export default async function LtdbbPreviewPage({ searchParams }: PageProps<"/admin/ltdbb">) {
  await getDevUser(db); // Placeholder auth guard until Auth.js lands.
  const upload = await getActiveLtdbbUpload(db);
  const [activePeriod] = await db.select().from(periods).where(eq(periods.status, "active")).limit(1);
  const uploads = await db.select().from(ltdbbUploads).orderBy(desc(ltdbbUploads.uploadedAt));

  if (!upload) {
    return (
      <main className="min-h-screen bg-white p-8 text-black">
        <h1 className="text-xl font-semibold">Data LTDBB</h1>
        <p className="mt-4 text-sm text-zinc-600">
          Belum ada data LTDBB aktif. Jalankan <code>npm run import-ltdbb</code>; export workbook diblokir sampai ada.
        </p>
      </main>
    );
  }

  const years = (
    await db
      .selectDistinct({ year: ltdbbMonthly.year })
      .from(ltdbbMonthly)
      .where(eq(ltdbbMonthly.uploadId, upload.id))
      .orderBy(desc(ltdbbMonthly.year))
  ).map((y) => y.year);
  const { year: yearParam } = await searchParams;
  const year = Number(yearParam) || activePeriod?.dataYear || years[0];

  const { rows, unknownKodes } = await aggregateYear(db, upload.id, year);

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
    <main className="min-h-screen bg-zinc-50 text-[13px] text-black">
      <header className="flex items-center gap-4 bg-[#217346] px-6 py-3 text-white">
        <Link href="/" className="rounded px-2 py-1 hover:bg-white/15">
          ‹ Beranda
        </Link>
        <h1 className="text-base font-semibold">Data LTDBB — Validasi Data Transaksi</h1>
      </header>

      <div className="space-y-4 p-6">
        <section className="grid gap-4 md:grid-cols-[2fr_3fr]">
          <div className="rounded border border-zinc-200 bg-white p-4">
            <h2 className="font-semibold">Sumber data aktif</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-zinc-500">File</dt>
              <dd>{upload.filename}</dd>
              <dt className="text-zinc-500">Asal</dt>
              <dd>{upload.source === "seed" ? "Data bawaan (repo)" : "Diunggah pengawas"}</dd>
              <dt className="text-zinc-500">Diimpor</dt>
              <dd>{upload.uploadedAt.toLocaleString("id-ID")}</dd>
              <dt className="text-zinc-500">Periode data</dt>
              <dd>
                {upload.minDate?.slice(0, 7)} s.d. {upload.maxDate?.slice(0, 7)} · {upload.rowCount?.toLocaleString("id-ID")} baris
              </dd>
              <dt className="text-zinc-500">
                Penanda baris
                <InfoTip label="Penjelasan penanda baris">{HELP.ltdbbRowFlags}</InfoTip>
              </dt>
              <dd className="flex flex-wrap gap-x-3 gap-y-1">
                {flagCounts.length === 0
                  ? "—"
                  : flagCounts.map(([flag, n]) => (
                      <span key={flag} className="flex items-center gap-1">
                        <Badge flag={flag as AggregateFlag} />
                        <InfoTip label={`Penjelasan ${FLAG_LABELS[flag as AggregateFlag]?.label ?? flag}`}>
                          {flagHelp(flag as AggregateFlag)}
                        </InfoTip>
                        <span className="tabular-nums text-zinc-600">{n.toLocaleString("id-ID")}</span>
                      </span>
                    ))}
              </dd>
            </dl>
            {uploads.length > 1 && (
              <p className="mt-3 text-xs text-zinc-500">{uploads.length - 1} unggahan lain tersimpan (tidak aktif).</p>
            )}
          </div>

          <div className="rounded border border-zinc-200 bg-white p-4">
            <h2 className="font-semibold">Tahun data</h2>
            <div className="mt-2 flex flex-wrap gap-1">
              {years.map((y) => (
                <Link
                  key={y}
                  href={`?year=${y}`}
                  className={`rounded px-2 py-1 ${y === year ? "bg-[#217346] text-white" : "bg-zinc-100 hover:bg-zinc-200"}`}
                >
                  {y}
                  {y === activePeriod?.dataYear ? " (periode aktif)" : ""}
                </Link>
              ))}
            </div>
            <p className="mt-3 text-zinc-600">
              {rows.length} PJP · {notIn} tidak ada di LTDBB
              <InfoTip label="Penjelasan tidak ada di LTDBB">{FLAG_HELP.NOT_IN_LTDBB}</InfoTip> · {incomplete} kurang dari 12 bulan
              <InfoTip label="Penjelasan kurang dari 12 bulan">{FLAG_HELP.INCOMPLETE_YEAR}</InfoTip> ·{" "}
              <span className={penalties ? "font-semibold text-red-700" : ""}>{penalties} akan dikenai −1</span>
              <InfoTip label="Penjelasan dikenai −1">{HELP.ltdbbPenalty}</InfoTip>
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Kebijakan: PJP tidak ada di LTDBB → {ltdbbPolicy.missingPjp === "warn" ? "ditulis nol, tetap dibuat" : "export diblokir"};
              kurang dari 12 bulan → {ltdbbPolicy.incompleteYear === "warn" ? "peringatan saja" : "export diblokir"}.
              <InfoTip label="Penjelasan kebijakan">{HELP.ltdbbPolicy}</InfoTip>
            </p>
            {unknownKodes.length > 0 && (
              <p className="mt-2 text-xs text-amber-800">
                Kode LTDBB tanpa PJP di daftar formulir
                <InfoTip label="Penjelasan kode tanpa PJP">{HELP.ltdbbUnknownKode}</InfoTip>:{" "}
                {unknownKodes.map((u) => `${u.kode} (${u.namaLtdbb})`).join(", ")}
              </p>
            )}
          </div>
        </section>

        <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
          <table className="w-full border-collapse text-right tabular-nums">
            <thead className="sticky top-0 bg-zinc-100 text-left text-xs text-zinc-600">
              <tr>
                <th className="px-2 py-2">No</th>
                <th className="px-2 py-2">Sandi</th>
                <th className="px-2 py-2">Nama PJP</th>
                <HeaderTip help={HELP.statusPjp}>Status</HeaderTip>
                <HeaderTip help={HELP.bulan} className="text-right">Bulan</HeaderTip>
                <th className="px-2 py-2 text-right">Frek. Incoming</th>
                <th className="px-2 py-2 text-right">Nominal Incoming</th>
                <th className="px-2 py-2 text-right">Frek. Outgoing</th>
                <th className="px-2 py-2 text-right">Nominal Outgoing</th>
                <th className="px-2 py-2 text-right">Frek. Domestik</th>
                <th className="px-2 py-2 text-right">Nominal Domestik</th>
                <th className="px-2 py-2 text-right">Total Nominal</th>
                <HeaderTip help={HELP.dilaporkan} className="text-right">Dilaporkan PJP</HeaderTip>
                <HeaderTip help={HELP.selisih} className="text-right">Selisih</HeaderTip>
                <HeaderTip help={HELP.hasil}>Hasil</HeaderTip>
                <HeaderTip help={HELP.catatan}>Catatan</HeaderTip>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const rep = reported.get(r.sandi);
                const diff = rep === undefined ? undefined : rep - r.totalNominal;
                const penalty = diff !== undefined && Math.abs(diff) > dataMismatchToleranceRupiah;
                const m = meta.get(r.sandi);
                return (
                  <tr key={r.sandi} className={`border-t border-zinc-100 ${r.inLtdbb ? "" : "bg-red-50/50"}`}>
                    <td className="px-2 py-1.5 text-zinc-400">{i + 1}</td>
                    <td className="px-2 py-1.5 text-left font-mono text-xs">{r.sandi}</td>
                    <td className="px-2 py-1.5 text-left">{r.nama}</td>
                    <td className="px-2 py-1.5 text-left text-xs text-zinc-600" title={m?.keterangan ?? undefined}>
                      {m?.statusPjp ?? "—"}
                    </td>
                    <td className="px-2 py-1.5" title={r.monthsPresent.join(", ") || "tidak ada"}>
                      {r.monthsPresent.length}/12
                    </td>
                    <td className="px-2 py-1.5">{count(r.finJumlahInc)}</td>
                    <td className="px-2 py-1.5">{rupiah(r.finNilaiInc)}</td>
                    <td className="px-2 py-1.5">{count(r.finJumlahOut)}</td>
                    <td className="px-2 py-1.5">{rupiah(r.finNilaiOut)}</td>
                    <td className="px-2 py-1.5">{count(r.finJumlahDom)}</td>
                    <td className="px-2 py-1.5">{rupiah(r.finNilaiDom)}</td>
                    <td className="px-2 py-1.5 font-medium">{rupiah(r.totalNominal)}</td>
                    <td className="px-2 py-1.5">{rep === undefined ? "—" : rupiah(rep)}</td>
                    <td className={`px-2 py-1.5 ${penalty ? "text-red-700" : ""}`}>
                      {diff === undefined ? "—" : rupiah(diff)}
                    </td>
                    <td className="px-2 py-1.5 text-left">
                      {diff === undefined ? (
                        <span className="text-zinc-400">belum ada workbook</span>
                      ) : penalty ? (
                        <span className="font-medium text-red-700">Perbedaan Data</span>
                      ) : (
                        <span className="text-green-700">Sesuai</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-left">
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
      </div>
    </main>
  );
}
