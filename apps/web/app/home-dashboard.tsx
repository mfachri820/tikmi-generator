"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { AggregateFlag } from "@ira/ltdbb";
import type { PeriodOverview, PjpOverviewRow, Stage } from "@/lib/periodOverview";
import { FLAG_HELP, HELP } from "@/lib/glossary";
import { InfoTip } from "@/components/info-tip";

const STAGES: { id: Stage; label: string; bar: string; badge: string }[] = [
  { id: "belum", label: "Belum ada workbook", bar: "bg-zinc-200", badge: "bg-zinc-100 text-zinc-600" },
  { id: "generated", label: "Dibuat", bar: "bg-sky-400", badge: "bg-sky-100 text-sky-800" },
  { id: "in_review", label: "Ditinjau", bar: "bg-amber-400", badge: "bg-amber-100 text-amber-800" },
  { id: "final", label: "Final", bar: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-800" },
  { id: "locked", label: "Dikunci", bar: "bg-[#217346]", badge: "bg-[#217346] text-white" },
];
const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));

/** Risk scale (inherent and final IRA), highest risk first, as in the template's predikat table. */
const RISK_PREDIKAT: { label: string; tone: string; bar: string }[] = [
  { label: "Tinggi", tone: "bg-red-100 text-red-800", bar: "bg-red-500" },
  { label: "Menengah ke Tinggi", tone: "bg-orange-100 text-orange-800", bar: "bg-orange-400" },
  { label: "Menengah", tone: "bg-amber-100 text-amber-800", bar: "bg-amber-400" },
  { label: "Rendah ke Menengah", tone: "bg-lime-100 text-lime-800", bar: "bg-lime-500" },
  { label: "Rendah", tone: "bg-emerald-100 text-emerald-800", bar: "bg-emerald-500" },
];
const KPMR_TONES: Record<string, string> = {
  Unsatisfactory: "bg-red-100 text-red-800",
  Marginal: "bg-orange-100 text-orange-800",
  Fair: "bg-amber-100 text-amber-800",
  Satisfactory: "bg-lime-100 text-lime-800",
  Strong: "bg-emerald-100 text-emerald-800",
};
const riskTone = (predikat: string) => RISK_PREDIKAT.find((p) => p.label === predikat)?.tone ?? "bg-zinc-100 text-zinc-600";

const FLAG_LABELS: Partial<Record<AggregateFlag, { label: string; tone: string }>> = {
  NOT_IN_LTDBB: { label: "Tidak ada di LTDBB", tone: "bg-red-50 text-red-700 ring-1 ring-red-200" },
  INCOMPLETE_YEAR: { label: "LTDBB < 12 bulan", tone: "bg-amber-50 text-amber-800 ring-1 ring-amber-200" },
};

/** A quick filter set from the summary cards; cleared by any manual filter change. */
type Focus = "mismatch" | "notInLtdbb" | "incomplete" | "unassigned" | "unscored" | { predikat: string } | null;

type SortKey = "no" | "nama" | "final";

const ALL = "__all__";
const UNASSIGNED = "__none__";

const fmtScore = (n: number) => n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

function Pill({ className, children, title }: { className: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
}

function matchesFocus(row: PjpOverviewRow, focus: Focus): boolean {
  if (!focus) return true;
  if (typeof focus === "object") return row.scores?.final.predikat === focus.predikat;
  switch (focus) {
    case "mismatch":
      return !!row.scores?.hasDataMismatch;
    case "notInLtdbb":
      return row.ltdbbFlags.includes("NOT_IN_LTDBB");
    case "incomplete":
      return row.ltdbbFlags.includes("INCOMPLETE_YEAR");
    case "unassigned":
      return !row.pengawas;
    case "unscored":
      return !!row.scores && row.scores.final.score === null;
  }
}

function focusLabel(focus: Exclude<Focus, null>): string {
  if (typeof focus === "object") return `Nilai Akhir: ${focus.predikat}`;
  return {
    mismatch: "Perbedaan Data",
    notInLtdbb: "Tidak ada di LTDBB",
    incomplete: "LTDBB < 12 bulan",
    unassigned: "Belum ada pengawas",
    unscored: "KPMR belum diisi",
  }[focus];
}

export function HomeDashboard({ overview }: { overview: PeriodOverview }) {
  const router = useRouter();
  const { rows } = overview;
  const period = overview.period!;

  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage | typeof ALL>(ALL);
  const [statusPjp, setStatusPjp] = useState(ALL);
  const [pengawas, setPengawas] = useState(ALL);
  const [focus, setFocus] = useState<Focus>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "no", dir: 1 });

  const stageCounts = useMemo(() => {
    const counts = new Map<Stage, number>(STAGES.map((s) => [s.id, 0]));
    for (const r of rows) counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1);
    return counts;
  }, [rows]);

  const statusOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.statusPjp, (counts.get(r.statusPjp) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const pengawasOptions = useMemo(
    () => [...new Set(rows.map((r) => r.pengawas).filter((p): p is string => !!p))].sort(),
    [rows],
  );

  const scored = rows.filter((r) => r.scores);
  const predikatCounts = RISK_PREDIKAT.map((p) => ({
    ...p,
    count: scored.filter((r) => r.scores!.final.predikat === p.label).length,
  }));
  const unscored = scored.filter((r) => r.scores!.final.score === null).length;
  const maxPredikat = Math.max(1, ...predikatCounts.map((p) => p.count));

  const attention: { id: Exclude<Focus, null | object>; label: string; help: string; count: number; tone: string }[] = [
    { id: "mismatch", label: "Perbedaan Data (nilai akhir −1)", help: FLAG_HELP.PENALTY_EXPECTED, count: scored.filter((r) => r.scores!.hasDataMismatch).length, tone: "text-red-700" },
    { id: "unscored", label: "Workbook dengan KPMR belum diisi", help: HELP.kpmrMissing, count: unscored, tone: "text-amber-700" },
    { id: "notInLtdbb", label: "PJP tidak ada di LTDBB", help: FLAG_HELP.NOT_IN_LTDBB, count: rows.filter((r) => r.ltdbbFlags.includes("NOT_IN_LTDBB")).length, tone: "text-red-700" },
    { id: "incomplete", label: "Data LTDBB kurang dari 12 bulan", help: FLAG_HELP.INCOMPLETE_YEAR, count: rows.filter((r) => r.ltdbbFlags.includes("INCOMPLETE_YEAR")).length, tone: "text-amber-700" },
    { id: "unassigned", label: "PJP belum ada pengawas", help: HELP.unassigned, count: rows.filter((r) => !r.pengawas).length, tone: "text-zinc-700" },
  ];

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter(
      (r) =>
        (!q || r.nama.toLowerCase().includes(q) || r.sandi.includes(q)) &&
        (stage === ALL || r.stage === stage) &&
        (statusPjp === ALL || r.statusPjp === statusPjp) &&
        (pengawas === ALL || (pengawas === UNASSIGNED ? !r.pengawas : r.pengawas === pengawas)) &&
        matchesFocus(r, focus),
    );
    const value = (r: PjpOverviewRow): number | string =>
      sort.key === "no" ? r.no : sort.key === "nama" ? r.nama.toLowerCase() : (r.scores?.final.score ?? Infinity);
    return filtered.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      // Rows without a final score always sink to the bottom.
      if (sort.key === "final" && va !== vb && (va === Infinity || vb === Infinity)) return va === Infinity ? 1 : -1;
      return (va < vb ? -1 : va > vb ? 1 : a.no - b.no) * sort.dir;
    });
  }, [rows, query, stage, statusPjp, pengawas, focus, sort]);

  const filtersActive = query || stage !== ALL || statusPjp !== ALL || pengawas !== ALL || focus;
  const resetFilters = () => {
    setQuery("");
    setStage(ALL);
    setStatusPjp(ALL);
    setPengawas(ALL);
    setFocus(null);
  };
  const applyFocus = (f: Exclude<Focus, null>) => {
    resetFilters();
    setFocus(f);
    document.getElementById("daftar-pjp")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const sortMark = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "");

  const withWorkbook = rows.length - (stageCounts.get("belum") ?? 0);
  const done = (stageCounts.get("final") ?? 0) + (stageCounts.get("locked") ?? 0);

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
      {/* Period heading */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Penilaian IRA {period.year}</h1>
          <p className="mt-0.5 text-zinc-500">
            Data transaksi {period.dataYear} · {rows.length} PJP KI 3 ·{" "}
            <span className="font-medium text-[#217346]">Periode {period.status === "active" ? "aktif" : period.status}</span>
          </p>
        </div>
        <p className="text-zinc-500">
          Sumber LTDBB
          <InfoTip label="Penjelasan sumber LTDBB">{HELP.ltdbbSource}</InfoTip>:{" "}
          {overview.ltdbb ? (
            <Link href="/admin/ltdbb" className="font-medium text-[#217346] hover:underline">
              {overview.ltdbb.filename}
            </Link>
          ) : (
            <Link href="/admin/ltdbb" className="font-medium text-red-700 hover:underline">
              belum ada — export diblokir
            </Link>
          )}
        </p>
      </div>

      {/* Summary */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 lg:col-span-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Progres workbook
            <InfoTip label="Penjelasan tahap workbook">{HELP.stages}</InfoTip>
          </h2>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {done}
            <span className="text-base font-normal text-zinc-400"> / {rows.length} selesai</span>
          </p>
          <p className="text-zinc-500">{withWorkbook} PJP sudah punya workbook</p>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-zinc-100" role="img" aria-label="Sebaran tahap workbook">
            {STAGES.map((s) => {
              const n = stageCounts.get(s.id) ?? 0;
              return n ? <div key={s.id} className={s.bar} style={{ width: `${(n / rows.length) * 100}%` }} title={`${s.label}: ${n}`} /> : null;
            })}
          </div>
          <ul className="mt-3 space-y-0.5">
            {STAGES.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => {
                    resetFilters();
                    setStage(s.id);
                  }}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-zinc-50"
                >
                  <span className={`h-2.5 w-2.5 rounded-sm ${s.bar}`} />
                  <span className="flex-1">{s.label}</span>
                  <span className="tabular-nums text-zinc-500">{stageCounts.get(s.id) ?? 0}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Predikat nilai akhir IRA
            <InfoTip label="Penjelasan nilai akhir IRA">{HELP.finalIra}</InfoTip>
          </h2>
          {scored.length === 0 ? (
            <p className="mt-3 text-zinc-500">Belum ada workbook yang dinilai.</p>
          ) : (
            <ul className="mt-3 space-y-0.5">
              {predikatCounts.map((p) => (
                <li key={p.label}>
                  <button
                    onClick={() => applyFocus({ predikat: p.label })}
                    disabled={!p.count}
                    className="grid w-full grid-cols-[8.5rem_1fr_2rem] items-center gap-2 rounded px-1.5 py-1 text-left enabled:hover:bg-zinc-50 disabled:cursor-default"
                  >
                    <span>{p.label}</span>
                    <span className="h-2 rounded-full bg-zinc-100">
                      <span className={`block h-2 rounded-full ${p.bar}`} style={{ width: `${(p.count / maxPredikat) * 100}%` }} />
                    </span>
                    <span className="text-right tabular-nums text-zinc-500">{p.count}</span>
                  </button>
                </li>
              ))}
              {unscored > 0 && (
                <li className="px-1.5 pt-1 text-zinc-500">
                  + {unscored} workbook belum bisa dinilai (KPMR belum diisi)
                </li>
              )}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-zinc-400">Nilai pengawas, setelah penyesuaian Perbedaan Data.</p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Perlu perhatian
            <InfoTip label="Penjelasan perlu perhatian">{HELP.attention}</InfoTip>
          </h2>
          <ul className="mt-3 space-y-0.5">
            {attention.map((a) => (
              <li key={a.id} className="flex items-center">
                <button
                  onClick={() => applyFocus(a.id)}
                  disabled={!a.count}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left enabled:hover:bg-zinc-50 disabled:cursor-default disabled:text-zinc-400"
                >
                  <span className="flex-1">{a.label}</span>
                  <span className={`tabular-nums font-semibold ${a.count ? a.tone : ""}`}>{a.count}</span>
                </button>
                {/* Beside the button, not inside it: a button can't contain another button. */}
                <InfoTip label={`Penjelasan ${a.label}`}>{a.help}</InfoTip>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* PJP table */}
      <section id="daftar-pjp" className="scroll-mt-4 rounded-lg border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 p-3">
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setFocus(null);
              setQuery(e.target.value);
            }}
            placeholder="Cari sandi atau nama PJP"
            className="h-8 w-full rounded border border-zinc-300 px-2.5 outline-none focus:border-[#217346] focus:ring-1 focus:ring-[#217346] sm:w-64"
          />
          <select
            value={statusPjp}
            onChange={(e) => {
              setFocus(null);
              setStatusPjp(e.target.value);
            }}
            className="h-8 rounded border border-zinc-300 bg-white px-2 outline-none focus:border-[#217346]"
            aria-label="Status PJP"
          >
            <option value={ALL}>Semua status PJP</option>
            {statusOptions.map(([s, n]) => (
              <option key={s} value={s}>
                {s} ({n})
              </option>
            ))}
          </select>
          <select
            value={pengawas}
            onChange={(e) => {
              setFocus(null);
              setPengawas(e.target.value);
            }}
            className="h-8 rounded border border-zinc-300 bg-white px-2 outline-none focus:border-[#217346]"
            aria-label="Pengawas"
          >
            <option value={ALL}>Semua pengawas</option>
            <option value={UNASSIGNED}>Belum ditentukan</option>
            {pengawasOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Tahap">
            {[{ id: ALL, label: "Semua tahap" } as const, ...STAGES].map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setFocus(null);
                  setStage(s.id);
                }}
                aria-pressed={stage === s.id}
                className={`h-8 rounded px-2.5 ${stage === s.id ? "bg-[#217346] text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
              >
                {s.label}
                {s.id !== ALL && <span className="ml-1 tabular-nums opacity-70">{stageCounts.get(s.id) ?? 0}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 text-zinc-500">
          <span>
            Menampilkan <span className="font-medium text-zinc-900">{visible.length}</span> dari {rows.length} PJP
          </span>
          {focus && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#217346]/10 py-0.5 pl-2 pr-1 text-[#217346]">
              {focusLabel(focus)}
              <button onClick={() => setFocus(null)} className="rounded-full px-1 hover:bg-[#217346]/15" aria-label="Hapus filter">
                ×
              </button>
            </span>
          )}
          {filtersActive && (
            <button onClick={resetFilters} className="ml-auto text-[#217346] hover:underline">
              Reset filter
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-t border-zinc-200 text-left">
            <thead className="whitespace-nowrap bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="w-12 px-3 py-2 font-semibold">
                  <button onClick={() => toggleSort("no")} className="uppercase hover:text-zinc-900">
                    No{sortMark("no")}
                  </button>
                </th>
                <th className="px-3 py-2 font-semibold">
                  <button onClick={() => toggleSort("nama")} className="uppercase hover:text-zinc-900">
                    PJP{sortMark("nama")}
                  </button>
                </th>
                <th className="px-3 py-2 font-semibold">
                  Status PJP
                  <InfoTip label="Penjelasan Status PJP">{HELP.statusPjp}</InfoTip>
                </th>
                <th className="px-3 py-2 font-semibold">Pengawas</th>
                <th className="px-3 py-2 font-semibold">
                  Formulir
                  <InfoTip label="Penjelasan Formulir">{HELP.formulir}</InfoTip>
                </th>
                <th className="px-3 py-2 font-semibold">
                  Tahap
                  <InfoTip label="Penjelasan Tahap">{HELP.stages}</InfoTip>
                </th>
                <th className="px-3 py-2 font-semibold">
                  Inheren
                  <InfoTip label="Penjelasan Inheren">{HELP.inherent}</InfoTip>
                </th>
                <th className="px-3 py-2 font-semibold">
                  KPMR
                  <InfoTip label="Penjelasan KPMR">{HELP.kpmr}</InfoTip>
                </th>
                <th className="px-3 py-2 font-semibold">
                  <button onClick={() => toggleSort("final")} className="uppercase hover:text-zinc-900">
                    Nilai akhir{sortMark("final")}
                  </button>
                  <InfoTip label="Penjelasan nilai akhir">{HELP.finalIra}</InfoTip>
                </th>
                <th className="px-3 py-2 font-semibold">
                  Catatan
                  <InfoTip label="Penjelasan Catatan">{HELP.catatan}</InfoTip>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-zinc-500">
                    Tidak ada PJP yang cocok dengan filter.{" "}
                    <button onClick={resetFilters} className="text-[#217346] hover:underline">
                      Reset filter
                    </button>
                  </td>
                </tr>
              )}
              {visible.map((r) => {
                const stageInfo = STAGE_BY_ID.get(r.stage)!;
                const href = r.workbookId ? `/workbook/${r.workbookId}` : null;
                const inactive = r.statusPjp !== "Aktif";
                return (
                  <tr
                    key={r.sandi}
                    onClick={href ? () => router.push(href) : undefined}
                    className={href ? "cursor-pointer hover:bg-[#217346]/[0.04]" : ""}
                  >
                    <td className="px-3 py-2 tabular-nums text-zinc-400">{r.no}</td>
                    <td className="min-w-[14rem] px-3 py-2">
                      {href ? (
                        <Link href={href} onClick={(e) => e.stopPropagation()} className="font-medium hover:text-[#217346] hover:underline">
                          {r.nama}
                        </Link>
                      ) : (
                        <span className={`font-medium ${inactive ? "text-zinc-500" : ""}`}>{r.nama}</span>
                      )}
                      <div className="font-mono text-[11px] text-zinc-400">{r.sandi}</div>
                    </td>
                    <td className="max-w-[9rem] px-3 py-2">
                      {/* Long statuses ("Dicabut atas Permintaan sendiri") wrap instead of widening the table. */}
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight ${
                          inactive ? "bg-zinc-100 text-zinc-500" : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                        }`}
                      >
                        {r.statusPjp}
                      </span>
                    </td>
                    <td className="px-3 py-2">{r.pengawas ?? <span className="text-zinc-400">—</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {r.submittedAt ? fmtDate(r.submittedAt) : <span className="text-zinc-400">Belum masuk</span>}
                    </td>
                    <td className="px-3 py-2">
                      {r.stage === "belum" ? (
                        <span className="whitespace-nowrap text-zinc-400">{stageInfo.label}</span>
                      ) : (
                        <Pill className={stageInfo.badge}>{stageInfo.label}</Pill>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.scores ? (
                        <div className="flex items-center gap-1.5">
                          <span className="tabular-nums">{fmtScore(r.scores.inherent.score)}</span>
                          <Pill className={riskTone(r.scores.inherent.predikat)}>{r.scores.inherent.predikat}</Pill>
                        </div>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.scores ? (
                        r.scores.final.score === null ? (
                          <span className="text-zinc-400">Belum diisi</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="tabular-nums">{fmtScore(r.scores.kpmr.score)}</span>
                            <Pill className={KPMR_TONES[r.scores.kpmr.predikat] ?? "bg-zinc-100 text-zinc-600"}>{r.scores.kpmr.predikat}</Pill>
                          </div>
                        )
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.scores?.final.score != null ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-base font-semibold tabular-nums">{r.scores.final.score}</span>
                          <Pill className={riskTone(r.scores.final.predikat!)}>{r.scores.final.predikat}</Pill>
                        </div>
                      ) : r.scores ? (
                        <span className="cursor-help text-zinc-400" title={HELP.kpmrMissing}>#N/A</span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.scores?.hasDataMismatch && (
                          <Pill className="bg-red-600 text-white" title={FLAG_HELP.PENALTY_EXPECTED}>
                            Perbedaan Data
                          </Pill>
                        )}
                        {r.ltdbbFlags.map((f) =>
                          FLAG_LABELS[f] ? (
                            <Pill key={f} className={FLAG_LABELS[f]!.tone} title={FLAG_HELP[f]}>
                              {FLAG_LABELS[f]!.label}
                            </Pill>
                          ) : null,
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
