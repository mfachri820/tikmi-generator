"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import type { AggregateFlag } from "@ira/ltdbb";
import type { PeriodOverview, PjpOverviewRow, Stage } from "@/lib/periodOverview";
import { FLAG_HELP, HELP } from "@/lib/glossary";
import { InfoTip } from "@/components/info-tip";
import { PAGE_SIZE, Pagination } from "@/components/pagination";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ClockIcon,
  FileSpreadsheetIcon,
  SearchIcon,
  XIcon,
} from "@/components/icons";

/** Workbook stages in order; the four real stages use the brand-green ordinal ramp, "belum" is the empty track. */
const STAGES: { id: Stage; label: string; color: string }[] = [
  { id: "belum", label: "Belum ada workbook", color: "var(--color-track)" },
  { id: "generated", label: "Dibuat", color: "var(--color-stage-1)" },
  { id: "in_review", label: "Ditinjau", color: "var(--color-stage-2)" },
  { id: "final", label: "Final", color: "var(--color-stage-3)" },
  { id: "locked", label: "Dikunci", color: "var(--color-stage-4)" },
];
const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));

/** The risk scale, highest risk first (A2's predikat table), on the diverging red-gray-blue scale. */
const RISK_PREDIKAT = [
  { label: "Tinggi", color: "var(--color-risk-1)" },
  { label: "Menengah ke Tinggi", color: "var(--color-risk-2)" },
  { label: "Menengah", color: "var(--color-risk-3)" },
  { label: "Rendah ke Menengah", color: "var(--color-risk-4)" },
  { label: "Rendah", color: "var(--color-risk-5)" },
];
/** KPMR quality on the same scale: weakest (red) to strongest (blue). */
const KPMR_COLORS: Record<string, string> = {
  Unsatisfactory: "var(--color-risk-1)",
  Marginal: "var(--color-risk-2)",
  Fair: "var(--color-risk-3)",
  Satisfactory: "var(--color-risk-4)",
  Strong: "var(--color-risk-5)",
};
const riskColor = (predikat: string) => RISK_PREDIKAT.find((p) => p.label === predikat)?.color ?? "var(--color-track)";
/** Text inside a filled score chip: white only on the two dark ends of the scale, ink on the light steps. */
const onRiskColor = (predikat: string) => (predikat === "Tinggi" || predikat === "Rendah" ? "#ffffff" : "var(--color-ink)");

/** LTDBB problems shown per row, as status cues (icon + label, never color alone). */
const FLAG_BADGES: Partial<Record<AggregateFlag, { label: string; level: "serious" | "warning" }>> = {
  NOT_IN_LTDBB: { label: "Tidak ada di LTDBB", level: "serious" },
  INCOMPLETE_YEAR: { label: "LTDBB < 12 bulan", level: "warning" },
};

/** A quick filter set from the summary cards; cleared by any manual filter change. */
type Focus = "mismatch" | "notInLtdbb" | "incomplete" | "unscored" | { predikat: string } | null;

type SortKey = "no" | "nama" | "final";

const ALL = "__all__";

const fmtScore = (n: number) => n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

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
    case "unscored":
      return !!row.scores && row.scores.final.score === null;
  }
}

function focusLabel(focus: Exclude<Focus, null>): string {
  if (typeof focus === "object") return `Nilai akhir: ${focus.predikat}`;
  return {
    mismatch: "Perbedaan Data",
    notInLtdbb: "Tidak ada di LTDBB",
    incomplete: "LTDBB < 12 bulan",
    unscored: "KPMR belum diisi",
  }[focus];
}

/** A status cue: colored icon, ink label. The color never carries the meaning alone. */
function StatusBadge({ level, children, title }: { level: "critical" | "serious" | "warning"; children: ReactNode; title?: string }) {
  const styles = {
    critical: { bg: "bg-[#fbeaea]", icon: "text-status-critical" },
    serious: { bg: "bg-[#fdf0ea]", icon: "text-status-serious" },
    warning: { bg: "bg-[#fef6e2]", icon: "text-[#c98500]" },
  }[level];
  const Icon = level === "warning" ? AlertTriangleIcon : AlertCircleIcon;
  return (
    <span title={title} className={`inline-flex cursor-help items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[12.5px] font-medium text-ink ${styles.bg}`}>
      <Icon className={`text-[13px] ${styles.icon}`} />
      {children}
    </span>
  );
}

/** A score with its predikat as a colored dot; the predikat name is on hover, the number carries the meaning. */
function Score({ value, color, predikat }: { value: number; color: string; predikat: string }) {
  return (
    <span className="inline-flex cursor-default items-center gap-1.5 whitespace-nowrap tabular-nums" title={predikat}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {fmtScore(value)}
    </span>
  );
}

function StatTile({
  label,
  value,
  total,
  tone = "default",
}: {
  label: string;
  value: number;
  total?: number;
  tone?: "default" | "critical";
}) {
  return (
    <div className="card px-5 py-4">
      <p className="text-[13.5px] text-ink-2">{label}</p>
      <p
        className={`mt-2 text-[28px] font-semibold leading-none tracking-tight tabular-nums ${
          tone === "critical" && value > 0 ? "text-status-critical" : ""
        }`}
      >
        {value}
        {total !== undefined && <span className="text-[16px] font-normal text-ink-3"> / {total}</span>}
      </p>
    </div>
  );
}

/** Column help, faded out until the header row is hovered or focused (always visible on touch screens). */
function HeaderTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="th-tip transition-opacity">
      <InfoTip label={label}>{children}</InfoTip>
    </span>
  );
}

export function HomeDashboard({ overview }: { overview: PeriodOverview }) {
  const router = useRouter();
  const { rows } = overview;
  const period = overview.period!;

  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage | typeof ALL>(ALL);
  const [statusPjp, setStatusPjp] = useState(ALL);
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

  const scored = rows.filter((r) => r.scores);
  const predikatCounts = RISK_PREDIKAT.map((p) => ({
    ...p,
    count: scored.filter((r) => r.scores!.final.predikat === p.label).length,
  }));
  const unscored = scored.filter((r) => r.scores!.final.score === null).length;
  const maxPredikat = Math.max(1, ...predikatCounts.map((p) => p.count));
  const mismatchCount = scored.filter((r) => r.scores!.hasDataMismatch).length;
  const submitted = rows.filter((r) => r.submittedAt).length;

  const attention: {
    id: Exclude<Focus, null | object>;
    label: string;
    help: string;
    count: number;
    level: "critical" | "serious" | "warning";
  }[] = [
    { id: "mismatch", label: "Perbedaan Data (nilai akhir −1)", help: FLAG_HELP.PENALTY_EXPECTED, count: mismatchCount, level: "critical" },
    { id: "unscored", label: "Workbook dengan KPMR belum diisi", help: HELP.kpmrMissing, count: unscored, level: "warning" },
    { id: "notInLtdbb", label: "PJP tidak ada di LTDBB", help: FLAG_HELP.NOT_IN_LTDBB, count: rows.filter((r) => r.ltdbbFlags.includes("NOT_IN_LTDBB")).length, level: "serious" },
    { id: "incomplete", label: "Data LTDBB kurang dari 12 bulan", help: FLAG_HELP.INCOMPLETE_YEAR, count: rows.filter((r) => r.ltdbbFlags.includes("INCOMPLETE_YEAR")).length, level: "warning" },
  ];
  const flagged = attention.filter((a) => a.count > 0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter(
      (r) =>
        (!q || r.nama.toLowerCase().includes(q) || r.sandi.includes(q)) &&
        (stage === ALL || r.stage === stage) &&
        (statusPjp === ALL || r.statusPjp === statusPjp) &&
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
  }, [rows, query, stage, statusPjp, focus, sort]);

  // Any change to filters or sorting -- undoing one included -- starts again at page 1
  // (React's "adjust state while rendering" pattern, so there's no effect and no flash of the old page).
  const filterKey = JSON.stringify([query, stage, statusPjp, focus, sort]);
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  if (paging.key !== filterKey) setPaging({ key: filterKey, page: 1 });
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const page = paging.key === filterKey ? Math.min(paging.page, pageCount) : 1;
  const pageRows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const goToPage = (p: number) => {
    setPaging({ key: filterKey, page: p });
    document.getElementById("daftar-pjp")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const filtersActive = query || stage !== ALL || statusPjp !== ALL || focus;
  const resetFilters = () => {
    setQuery("");
    setStage(ALL);
    setStatusPjp(ALL);
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

  const selectClass =
    "h-10 rounded-lg border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-9 sm:px-8">
      {/* Period heading */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Penilaian IRA {period.year}</h1>
          <p className="mt-1.5 text-[14.5px] text-ink-2">
            {period.status === "active" ? "Periode aktif" : `Periode ${period.status}`} · data {period.dataYear} ·{" "}
            {rows.length} PJP KI 3
          </p>
        </div>
        <Link
          href="/admin/ltdbb"
          title={HELP.ltdbbSource}
          className="group inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[13.5px] text-ink-2 transition hover:text-ink"
        >
          <FileSpreadsheetIcon className={`text-[15px] ${overview.ltdbb ? "text-brand" : "text-status-critical"}`} />
          {overview.ltdbb ? (
            <span>
              LTDBB: <span className="font-medium text-ink-2">{overview.ltdbb.filename}</span>
            </span>
          ) : (
            <span className="font-medium text-status-critical">LTDBB belum ada — export diblokir</span>
          )}
          <ChevronRightIcon className="text-[14px] transition group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/* Key numbers */}
      <section className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        <StatTile label="Formulir masuk" value={submitted} total={rows.length} />
        <StatTile label="Workbook dibuat" value={withWorkbook} total={rows.length} />
        <StatTile label="Selesai dinilai" value={done} total={rows.length} />
        <StatTile label="Perbedaan Data" value={mismatchCount} tone="critical" />
      </section>

      {/* Summary */}
      <section className="grid gap-5 lg:grid-cols-3">
        <div className="card p-6">
          <h2 className="card-title">
            Progres workbook
            <InfoTip label="Penjelasan tahap workbook">{HELP.stages}</InfoTip>
          </h2>
          {/* Stacked bar: stage segments separated by 2px surface gaps; "belum" is the remaining track. */}
          <div className="mt-5 flex h-3.5 gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label="Sebaran tahap workbook">
            {STAGES.filter((s) => s.id !== "belum").map((s) => {
              const n = stageCounts.get(s.id) ?? 0;
              return n ? (
                <div
                  key={s.id}
                  style={{ width: `${(n / rows.length) * 100}%`, backgroundColor: s.color, minWidth: 4 }}
                  title={`${s.label}: ${n}`}
                />
              ) : null;
            })}
            <div className="flex-1" style={{ backgroundColor: "var(--color-track)" }} title={`Belum ada workbook: ${stageCounts.get("belum") ?? 0}`} />
          </div>
          <ul className="mt-5 space-y-1">
            {STAGES.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => {
                    resetFilters();
                    setStage(s.id);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[14px] transition hover:bg-plane"
                >
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: s.color }} />
                  <span className="flex-1 text-ink-2">{s.label}</span>
                  <span className="tabular-nums font-medium">{stageCounts.get(s.id) ?? 0}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-6">
          <h2 className="card-title">
            Predikat nilai akhir IRA
            <InfoTip label="Penjelasan nilai akhir IRA">{HELP.finalIra}</InfoTip>
          </h2>
          {scored.length === 0 ? (
            <p className="mt-6 text-[14px] text-ink-2">Belum ada workbook yang dinilai.</p>
          ) : (
            <ul className="mt-5 space-y-1">
              {predikatCounts.map((p) => (
                <li key={p.label}>
                  <button
                    onClick={() => applyFocus({ predikat: p.label })}
                    disabled={!p.count}
                    title={`${p.label}: ${p.count} PJP`}
                    className="grid w-full grid-cols-[10.5rem_1fr] items-center gap-3 rounded-md px-2.5 py-2 text-left text-[14px] transition enabled:hover:bg-plane disabled:cursor-default"
                  >
                    <span className="text-ink-2">{p.label}</span>
                    <span className="flex items-center gap-2">
                      {/* Bar grows from a square baseline to a 4px rounded end; the count sits at its tip. */}
                      {p.count > 0 && (
                        <span
                          className="h-2.5 rounded-r-[4px]"
                          style={{ width: `calc((100% - 2rem) * ${p.count / maxPredikat})`, backgroundColor: p.color }}
                        />
                      )}
                      <span className={`tabular-nums ${p.count ? "font-medium" : "text-ink-3"}`}>{p.count}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-6">
          <h2 className="card-title">
            Perlu perhatian
            <InfoTip label="Penjelasan perlu perhatian">{HELP.attention}</InfoTip>
          </h2>
          {/* Only what needs action; each row filters the PJP list, its explanation is on hover. */}
          {flagged.length === 0 ? (
            <p className="mt-5 flex items-center gap-2 text-[14px] text-ink-2">
              <CheckCircleIcon className="text-[15px] text-status-good" />
              Tidak ada yang perlu ditindaklanjuti.
            </p>
          ) : (
            <ul className="mt-5 space-y-1">
              {flagged.map((a) => {
                const Icon = a.level === "warning" ? AlertTriangleIcon : a.level === "critical" ? AlertCircleIcon : ClockIcon;
                const iconColor = { critical: "text-status-critical", serious: "text-status-serious", warning: "text-[#c98500]" }[a.level];
                return (
                  <li key={a.id}>
                    <button
                      onClick={() => applyFocus(a.id)}
                      title={a.help}
                      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[14px] transition hover:bg-plane"
                    >
                      <Icon className={`shrink-0 text-[15px] ${iconColor}`} />
                      <span className="flex-1 text-ink-2">{a.label}</span>
                      <span className="tabular-nums font-semibold text-ink">{a.count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* PJP table */}
      <section id="daftar-pjp" className="card scroll-mt-20 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-6">
          <h2 className="card-title gap-2 text-[16px]">
            Daftar PJP
            <span className="text-[14px] font-normal tabular-nums text-ink-3">
              {filtersActive ? `${visible.length} dari ${rows.length}` : rows.length}
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {focus && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft py-1 pl-3 pr-1 text-[13px] font-medium text-brand-strong">
                {focusLabel(focus)}
                <button onClick={() => setFocus(null)} className="rounded-full p-0.5 hover:bg-brand/15" aria-label="Hapus filter">
                  <XIcon className="text-[12px]" />
                </button>
              </span>
            )}
            {filtersActive && (
              <button onClick={resetFilters} className="text-[13.5px] font-medium text-brand hover:underline">
                Reset filter
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 px-6 pb-5 pt-5">
          <label className="relative w-full sm:w-64">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-ink-3" />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setFocus(null);
                setQuery(e.target.value);
              }}
              placeholder="Cari sandi atau nama PJP"
              className="h-10 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-[14px] outline-none transition placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <select
            value={statusPjp}
            onChange={(e) => {
              setFocus(null);
              setStatusPjp(e.target.value);
            }}
            className={selectClass}
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
            value={stage}
            onChange={(e) => {
              setFocus(null);
              setStage(e.target.value as Stage | typeof ALL);
            }}
            className={selectClass}
            aria-label="Tahap"
          >
            <option value={ALL}>Semua tahap</option>
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({stageCounts.get(s.id) ?? 0})
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px] border-t border-line text-left text-[14px]">
            <thead className="whitespace-nowrap bg-plane text-[12.5px] font-medium text-ink-2 [@media(hover:hover)]:[&:not(:hover):not(:focus-within)_.th-tip]:opacity-0">
              <tr>
                <th className="w-14 py-3 pl-6 pr-3 font-medium">
                  <button onClick={() => toggleSort("no")} className="hover:text-ink">
                    No{sortMark("no")}
                  </button>
                </th>
                <th className="px-3 py-3 font-medium">
                  <button onClick={() => toggleSort("nama")} className="hover:text-ink">
                    PJP{sortMark("nama")}
                  </button>
                  <HeaderTip label="Penjelasan Status PJP">{HELP.statusPjp}</HeaderTip>
                </th>
                <th className="px-3 py-3 font-medium">
                  Formulir
                  <HeaderTip label="Penjelasan Formulir">{HELP.formulir}</HeaderTip>
                </th>
                <th className="px-3 py-3 font-medium">
                  Tahap
                  <HeaderTip label="Penjelasan Tahap">{HELP.stages}</HeaderTip>
                </th>
                <th className="px-3 py-3 font-medium">
                  Inheren
                  <HeaderTip label="Penjelasan Inheren">{HELP.inherent}</HeaderTip>
                </th>
                <th className="px-3 py-3 font-medium">
                  KPMR
                  <HeaderTip label="Penjelasan KPMR">{HELP.kpmr}</HeaderTip>
                </th>
                <th className="px-3 py-3 font-medium">
                  <button onClick={() => toggleSort("final")} className="hover:text-ink">
                    Nilai akhir{sortMark("final")}
                  </button>
                  <HeaderTip label="Penjelasan nilai akhir">{HELP.finalIra}</HeaderTip>
                </th>
                <th className="px-3 py-3 font-medium">
                  Catatan
                  <HeaderTip label="Penjelasan Catatan">{HELP.catatan}</HeaderTip>
                </th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-5 py-14 text-center text-ink-3">
                    <SearchIcon className="mx-auto mb-2 text-[22px]" />
                    Tidak ada PJP yang cocok dengan filter.{" "}
                    <button onClick={resetFilters} className="font-medium text-brand hover:underline">
                      Reset filter
                    </button>
                  </td>
                </tr>
              )}
              {pageRows.map((r) => {
                const stageInfo = STAGE_BY_ID.get(r.stage)!;
                const href = r.workbookId ? `/workbook/${r.workbookId}` : null;
                const inactive = r.statusPjp !== "Aktif";
                return (
                  <tr
                    key={r.sandi}
                    onClick={href ? () => router.push(href) : undefined}
                    className={`group transition-colors odd:bg-surface even:bg-plane ${href ? "cursor-pointer hover:bg-brand-soft" : ""}`}
                  >
                    <td className="py-4 pl-6 pr-3 tabular-nums text-ink-3">{r.no}</td>
                    <td className="min-w-[15rem] px-3 py-4">
                      {href ? (
                        <Link href={href} onClick={(e) => e.stopPropagation()} className="font-medium text-ink hover:text-brand">
                          {r.nama}
                        </Link>
                      ) : (
                        <span className={`font-medium ${inactive ? "text-ink-3" : "text-ink"}`}>{r.nama}</span>
                      )}
                      <div className="mt-0.5 text-[12px] text-ink-3">
                        <span className="font-mono">{r.sandi}</span>
                        {/* Most PJP are Aktif; only the exceptions get a word. */}
                        {inactive && <> · {r.statusPjp}</>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4">
                      {r.submittedAt ? (
                        <span className="text-ink-2">{fmtDate(r.submittedAt)}</span>
                      ) : (
                        <span className="text-ink-3">Belum masuk</span>
                      )}
                    </td>
                    <td className="px-3 py-4">
                      {r.stage === "belum" ? (
                        <span className="whitespace-nowrap text-ink-3">{stageInfo.label}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-plane px-2 py-0.5 text-[13px] font-medium text-ink ring-1 ring-line">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stageInfo.color }} />
                          {stageInfo.label}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-4">
                      {r.scores ? (
                        <Score value={r.scores.inherent.score} color={riskColor(r.scores.inherent.predikat)} predikat={r.scores.inherent.predikat} />
                      ) : (
                        <span className="text-line-strong">—</span>
                      )}
                    </td>
                    <td className="px-3 py-4">
                      {r.scores ? (
                        r.scores.final.score === null ? (
                          <span className="text-ink-3">Belum diisi</span>
                        ) : (
                          <Score
                            value={r.scores.kpmr.score}
                            color={KPMR_COLORS[r.scores.kpmr.predikat] ?? "var(--color-track)"}
                            predikat={r.scores.kpmr.predikat}
                          />
                        )
                      ) : (
                        <span className="text-line-strong">—</span>
                      )}
                    </td>
                    <td className="px-3 py-4">
                      {r.scores?.final.score != null ? (
                        <div className="flex items-center gap-2.5">
                          <span
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-[15px] font-semibold"
                            style={{ backgroundColor: riskColor(r.scores.final.predikat!), color: onRiskColor(r.scores.final.predikat!) }}
                          >
                            {r.scores.final.score}
                          </span>
                          <span className="text-[13px] leading-tight text-ink-2">{r.scores.final.predikat}</span>
                        </div>
                      ) : r.scores ? (
                        <span className="cursor-help text-ink-3" title={HELP.kpmrMissing}>
                          #N/A
                        </span>
                      ) : (
                        <span className="text-line-strong">—</span>
                      )}
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex flex-wrap gap-1">
                        {r.scores?.hasDataMismatch && (
                          <StatusBadge level="critical" title={FLAG_HELP.PENALTY_EXPECTED}>
                            Perbedaan Data
                          </StatusBadge>
                        )}
                        {r.ltdbbFlags.map((f) => {
                          const badge = FLAG_BADGES[f];
                          return badge ? (
                            <StatusBadge key={f} level={badge.level} title={FLAG_HELP[f]}>
                              {badge.label}
                            </StatusBadge>
                          ) : null;
                        })}
                      </div>
                    </td>
                    <td className="pr-5 text-ink-3">
                      {href && <ChevronRightIcon className="text-[16px] opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={visible.length} onChange={goToPage} />
      </section>
    </main>
  );
}
