import { eq } from "drizzle-orm";
import { loadCellValues, periods, pjp as pjpTable, workbooks, type Db } from "@ira/db";
import { aggregateYear, getActiveLtdbbUpload, type AggregateFlag, type LtdbbUpload, type PjpYearAggregate } from "@ira/ltdbb";
import {
  computeWorkbookScores,
  resolveKpmrAnswers,
  type KpmrAnswerInput,
  type ParameterInput,
  type WorkbookScoringResult,
} from "@ira/scoring";
import { buildScoringConfig2026, parameterShareRefs, scoringConfig2026, type WeightSet } from "@ira/scoring/config/2026";
import { computeC2Derived, dataMismatchToleranceRupiah } from "@ira/scoring/config/2026-c2";
import { sharedCellRefs2026 } from "@ira/scoring/config/2026-input-cells";
import { isUuid } from "./ids";
import { workbookVersion } from "./workbookVersion";
import { loadWeights } from "./weights";
import { explainParameters, type ParameterExplanation } from "./scoreExplain";
import { computeSheetCells2026, type SheetCellValue } from "@ira/scoring/config/2026-sheet";

const C2_SHEET = "C2. Form PJP LR";
const C2_PREFIX = `${C2_SHEET}!C`;

export interface WorkbookView {
  /** `updatedAt` (ISO) is the version this view shows: saves send it back to detect conflicts, polling compares it. */
  workbook: { id: string; pjpSandi: string; pjpNama: string; status: string; updatedAt: string };
  hasDataMismatch: boolean;
  /** The LTDBB data the "Perbedaan Data" check used, or null when no LTDBB upload is active (no penalty then). */
  ltdbb: { filename: string; dataYear: number; totalNominal: number; flags: AggregateFlag[] } | null;
  /** Every value the grid shows that isn't fixed template text: input cells plus live formula results, keyed "Sheet!Address". */
  cells: Record<string, SheetCellValue>;
  /** Pengawas score cells whose value differs from the PJP-derived one (a reason is expected). */
  overriddenCellRefs: string[];
  scores: WorkbookScoringResult;
  /** Per A2 parameter: what its score is based on ("Kenapa nilainya 4?"). */
  parameterInfo: ParameterExplanation[];
}

/**
 * Builds everything the grid renders from the database: current `cell_inputs`
 * for the workbook, the PJP's LTDBB total for the period's data year from the
 * active upload (for the "Perbedaan Data" check -- the same numbers the export
 * writes into "Validasi Data Transaksi"), and the 2026 scoring config -- the same pipeline
 * `scripts/golden-test.ts` proved against the real fixtures, now driven by
 * stored values instead of a workbook file. Shared by the page and the PATCH
 * route so both compute scores the same way.
 */
export async function loadWorkbookView(
  db: Db,
  workbookId: string,
  /**
   * The active LTDBB upload and its per-PJP totals for the period's data year,
   * when the caller already has them (the home page scores every workbook at
   * once); otherwise they are loaded for this one PJP.
   */
  ltdbbContext?: { upload: LtdbbUpload | null; rowsBySandi: Map<string, PjpYearAggregate> },
  /** Weights to score with, when the caller has them (Beranda, the Bobot preview); else the period's saved ones. */
  weightsOverride?: WeightSet,
): Promise<WorkbookView | null> {
  if (!isUuid(workbookId)) return null;
  const [workbook] = await db.select().from(workbooks).where(eq(workbooks.id, workbookId)).limit(1);
  if (!workbook) return null;

  const [pjpRow] = await db.select().from(pjpTable).where(eq(pjpTable.sandi, workbook.pjpSandi)).limit(1);
  const [period] = await db.select().from(periods).where(eq(periods.id, workbook.periodId)).limit(1);
  const activeLtdbb = ltdbbContext ? ltdbbContext.upload : await getActiveLtdbbUpload(db);
  const ltdbbRow = !activeLtdbb
    ? undefined
    : ltdbbContext
      ? ltdbbContext.rowsBySandi.get(workbook.pjpSandi)
      : (await aggregateYear(db, activeLtdbb.id, period.dataYear, { sandi: workbook.pjpSandi })).rows[0];

  const weights = weightsOverride ?? (await loadWeights(db, workbook.periodId));
  const config = buildScoringConfig2026(weights);
  const cellByRef = await loadCellValues(db, workbook, sharedCellRefs2026);

  const rawC2: Record<string, number> = {};
  for (const [ref, value] of cellByRef) {
    if (ref.startsWith(C2_PREFIX) && typeof value === "number") {
      rawC2[ref.slice(C2_SHEET.length + 1)] = value;
    }
  }
  const c2Values: Record<string, number> = { ...rawC2, ...computeC2Derived(rawC2) };

  const parameters: ParameterInput[] = scoringConfig2026.parameters.map((p) => {
    const refs = parameterShareRefs[p.id] ?? [];
    const share = refs.reduce((sum, ref) => sum + (c2Values[ref] ?? 0), 0);
    const pengawasRaw = cellByRef.get(p.cellRef);
    return {
      id: p.id,
      share,
      pengawasScore: typeof pengawasRaw === "number" ? (pengawasRaw as ParameterInput["pengawasScore"]) : undefined,
    };
  });

  const kpmrAnswers: KpmrAnswerInput[] = scoringConfig2026.kpmrQuestions.map((q) => {
    const pjpRaw = cellByRef.get(q.cellRef);
    const pengawasRaw = cellByRef.get(q.pengawasCellRef);
    return {
      id: q.id,
      pjpScore: typeof pjpRaw === "number" ? pjpRaw : undefined,
      pengawasScore: typeof pengawasRaw === "number" ? pengawasRaw : undefined,
    };
  });

  // Replicates C2!H18 (IF(ABS(C18-G18)<=1000,"Sesuai","Perbedaan Data")) against the PJP's LTDBB total;
  // a PJP missing from LTDBB has a 0 total there, exactly as the export writes it.
  const selfReportedTotal = c2Values["C18"] ?? 0;
  const biTotal = activeLtdbb ? (ltdbbRow?.totalNominal ?? 0) : null;
  const hasDataMismatch = biTotal !== null && Math.abs(selfReportedTotal - biTotal) > dataMismatchToleranceRupiah;

  const scores = computeWorkbookScores(config, { parameters, kpmrAnswers, hasDataMismatch });
  const kpmr = resolveKpmrAnswers(scoringConfig2026.kpmrQuestions, kpmrAnswers);
  const pjpNama = pjpRow?.nama ?? workbook.pjpSandi;

  const cells: Record<string, SheetCellValue> = {};
  for (const [ref, value] of cellByRef) {
    if (value === null || typeof value === "string" || typeof value === "number") cells[ref] = value;
  }
  Object.assign(
    cells,
    computeSheetCells2026({
      c2Values,
      scores,
      kpmr,
      sandiNama: `${workbook.pjpSandi} - ${pjpNama}`,
      biTotalNominal: biTotal,
      hasDataMismatch,
      categoryWeights: config.categoryWeights,
    }),
  );

  const overriddenCellRefs = [
    ...scores.parameters.filter((p) => p.isOverride).map((p) => p.cellRef),
    ...kpmr.filter((a) => a.isOverride && a.pjpScore !== undefined).map((a) => a.pengawasCellRef),
  ];

  return {
    workbook: {
      id: workbook.id,
      pjpSandi: workbook.pjpSandi,
      pjpNama,
      status: workbook.status,
      updatedAt: ((await workbookVersion(db, workbook.id)) ?? workbook.updatedAt).toISOString(),
    },
    hasDataMismatch,
    ltdbb: activeLtdbb
      ? {
          filename: activeLtdbb.filename,
          dataYear: period.dataYear,
          totalNominal: biTotal ?? 0,
          flags: ltdbbRow?.flags ?? ["NOT_IN_LTDBB"],
        }
      : null,
    cells,
    overriddenCellRefs,
    scores,
    parameterInfo: explainParameters(config.parameters, c2Values, scores.parameters),
  };
}
