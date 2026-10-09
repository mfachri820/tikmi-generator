import { asc, desc, eq } from "drizzle-orm";
import { formSubmissions, periods, pjp as pjpTable, workbooks, type Db } from "@ira/db";
import { getActiveLtdbbUpload, type AggregateFlag } from "@ira/ltdbb";
import { cachedAggregateYear } from "./immutableCache";
import { loadWorkbookView } from "./workbookView";
import { loadWeights } from "./weights";

/** Where a PJP stands this period: no workbook yet, then the workbook's own status. */
export type Stage = "belum" | "generated" | "in_review" | "final" | "locked";

export interface PjpOverviewRow {
  sandi: string;
  nama: string;
  /** Position in the form's 85-PJP list. */
  no: number;
  statusPjp: string;
  /** ISO timestamp of the latest form submission, if any. */
  submittedAt: string | null;
  stage: Stage;
  workbookId: string | null;
  scores: {
    inherent: { score: number; predikat: string };
    kpmr: { score: number; predikat: string };
    /** `score` is null while KPMR has no answers (the template shows #N/A). */
    final: { score: number | null; predikat: string | null };
    hasDataMismatch: boolean;
  } | null;
  ltdbbFlags: AggregateFlag[];
}

export interface PeriodOverview {
  period: { year: number; dataYear: number; status: string } | null;
  ltdbb: { filename: string } | null;
  rows: PjpOverviewRow[];
}

/**
 * Everything the home page shows for the active period: every PJP in the
 * form's list with its status, latest form submission,
 * workbook stage and live scores. Scores come from `loadWorkbookView`, the same
 * pipeline the grid and the export use, with the LTDBB totals loaded once.
 */
export async function loadPeriodOverview(db: Db): Promise<PeriodOverview> {
  const [[period], pjps] = await Promise.all([
    db.select().from(periods).where(eq(periods.status, "active")).limit(1),
    db.select({ pjp: pjpTable }).from(pjpTable).orderBy(asc(pjpTable.sortOrder)),
  ]);

  if (!period) {
    return {
      period: null,
      ltdbb: null,
      rows: pjps.map(({ pjp }) => ({
        sandi: pjp.sandi,
        nama: pjp.nama,
        no: pjp.sortOrder,
        statusPjp: pjp.status,
          submittedAt: null,
        stage: "belum",
        workbookId: null,
        scores: null,
        ltdbbFlags: [],
      })),
    };
  }

  // Independent lookups in parallel: each one is a database round trip.
  const [periodWorkbooks, submissions, upload, weights] = await Promise.all([
    db.select().from(workbooks).where(eq(workbooks.periodId, period.id)),
    db
      .select({ sandi: formSubmissions.pjpSandi, submittedAt: formSubmissions.submittedAt })
      .from(formSubmissions)
      .where(eq(formSubmissions.periodId, period.id))
      .orderBy(desc(formSubmissions.submittedAt)),
    getActiveLtdbbUpload(db),
    // One weights lookup for the whole period, not one per workbook.
    loadWeights(db, period.id),
  ]);
  const workbookBySandi = new Map(periodWorkbooks.map((w) => [w.pjpSandi, w]));

  const latestSubmission = new Map<string, Date>();
  for (const s of submissions) if (!latestSubmission.has(s.sandi)) latestSubmission.set(s.sandi, s.submittedAt);

  const ltdbbRows = upload ? (await cachedAggregateYear(upload.id, period.dataYear)).rows : [];
  const ltdbbContext = { upload, rowsBySandi: new Map(ltdbbRows.map((r) => [r.sandi, r])) };

  const views = new Map(
    await Promise.all(
      periodWorkbooks.map(async (w) => [w.pjpSandi, await loadWorkbookView(db, w.id, ltdbbContext, weights)] as const),
    ),
  );

  const rows = pjps.map(({ pjp }): PjpOverviewRow => {
    const workbook = workbookBySandi.get(pjp.sandi);
    const view = views.get(pjp.sandi);
    const s = view?.scores;
    return {
      sandi: pjp.sandi,
      nama: pjp.nama,
      no: pjp.sortOrder,
      statusPjp: pjp.status,
      submittedAt: latestSubmission.get(pjp.sandi)?.toISOString() ?? null,
      stage: workbook ? workbook.status : "belum",
      workbookId: workbook?.id ?? null,
      scores: s
        ? {
            inherent: { score: s.inherentScore.pengawas, predikat: s.inherentPredikat.pengawas },
            kpmr: { score: s.kpmrOverall.pengawas, predikat: s.kpmrPredikat.pengawas },
            final: Number.isNaN(s.finalIra.pengawasAdjusted)
              ? { score: null, predikat: null }
              : { score: s.finalIra.pengawasAdjusted, predikat: s.finalIraPredikat.pengawasAdjusted },
            hasDataMismatch: view.hasDataMismatch,
          }
        : null,
      ltdbbFlags: upload ? (ltdbbContext.rowsBySandi.get(pjp.sandi)?.flags ?? ["NOT_IN_LTDBB"]) : [],
    };
  });

  return {
    period: { year: period.year, dataYear: period.dataYear, status: period.status },
    ltdbb: upload ? { filename: upload.filename } : null,
    rows,
  };
}
