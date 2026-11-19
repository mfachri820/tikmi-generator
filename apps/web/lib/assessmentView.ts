import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  assessmentParts,
  assessments,
  cellInputs,
  periods,
  periodSettings,
  pjp,
  submissionFiles,
  submissions,
  sumberBiRows,
  sumberBiUploads,
  templates,
  users,
  weightSets,
  type Db,
} from "@tikmi/db";
import { assessmentFinalBlockers, partFiles } from "@tikmi/ingest";
import { definitions2025, type ValidationReport } from "@tikmi/parser";
import {
  computeIt,
  computeMr,
  deriveItApplicability,
  isError,
  itApplicability2025,
  LEMBAGA_REMITANSI,
  LSB,
  tkmrPengawasProgress,
  type MrDefinition,
  type MrTables,
  type Scalar,
  type Weights,
} from "@tikmi/scoring";
import { buildLookup, type SumberBiLookup } from "@tikmi/sumber-bi";
import type { ExtractedLayout } from "@tikmi/template";

export const defs = definitions2025;

export async function activePeriod(db: Db) {
  const [p] = await db.select().from(periods).where(eq(periods.status, "active")).limit(1);
  return p ?? null;
}

// ------------------------------------------------------------------ PJP list

export type SubmissionState = "belum" | "tepat_waktu" | "terlambat";

export interface PjpListRow {
  sandi: string;
  nama: string;
  bundling: number | null;
  pengawas: { id: string; name: string } | null;
  status: string | null;
  submission: SubmissionState;
  /** First submission (any source) of the period. */
  firstSubmittedAt: Date | null;
  lastSubmittedAt: Date | null;
  mr: PartBadge;
  it: PartBadge;
}

export interface PartBadge {
  active: boolean;
  acceptance: string | null;
  /** The newest file is excluded (wrong template / bundling / not TIKMI). */
  latestExcluded: string | null;
  errors: number;
  warnings: number;
}

const emptyBadge: PartBadge = { active: false, acceptance: null, latestExcluded: null, errors: 0, warnings: 0 };

/**
 * Every PJP supervised this period (in the form's list) or with an assessment,
 * with where its submission stands. One query per table, merged in memory.
 */
export async function loadPjpList(db: Db, periodId: string, deadline: Date): Promise<PjpListRow[]> {
  const [master, as, parts, subs, files, people] = await Promise.all([
    db.select().from(pjp).orderBy(asc(pjp.sortOrder), asc(pjp.nama)),
    db.select().from(assessments).where(eq(assessments.periodId, periodId)),
    db.select().from(assessmentParts),
    db.select().from(submissions).where(eq(submissions.periodId, periodId)),
    db.select({ id: submissionFiles.id, submissionId: submissionFiles.submissionId, kind: submissionFiles.kind, excluded: submissionFiles.excluded, acceptance: submissionFiles.acceptance, report: submissionFiles.report }).from(submissionFiles),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);
  const byAssessment = new Map(as.map((a) => [a.pjpSandi, a]));
  const subsBySandi = new Map<string, typeof subs>();
  for (const s of subs) if (s.pjpSandi) subsBySandi.set(s.pjpSandi, [...(subsBySandi.get(s.pjpSandi) ?? []), s]);
  const subById = new Map(subs.map((s) => [s.id, s]));
  const fileById = new Map(files.map((f) => [f.id, f]));
  const name = new Map(people.map((u) => [u.id, u.name]));

  const badge = (assessmentId: string | undefined, kind: "mr" | "it", sandi: string): PartBadge => {
    const part = assessmentId ? parts.find((p) => p.assessmentId === assessmentId && p.kind === kind) : undefined;
    const active = part?.activeFileId ? fileById.get(part.activeFileId) : undefined;
    const report = (active?.report as { validation?: ValidationReport } | null)?.validation;
    const own = files
      .filter((f) => f.kind === kind && subById.get(f.submissionId)?.pjpSandi === sandi)
      .sort((a, b) => subById.get(b.submissionId)!.submittedAt.getTime() - subById.get(a.submissionId)!.submittedAt.getTime());
    const latest = own[0];
    return {
      active: !!active,
      acceptance: active?.acceptance ?? null,
      latestExcluded: latest && latest.id !== part?.activeFileId ? latest.excluded : null,
      errors: report?.counts.error ?? 0,
      warnings: report?.counts.warning ?? 0,
    };
  };

  return master
    .filter((p) => p.supervised || byAssessment.has(p.sandi) || subsBySandi.has(p.sandi))
    .map((p) => {
      const a = byAssessment.get(p.sandi);
      const own = (subsBySandi.get(p.sandi) ?? []).sort((x, y) => x.submittedAt.getTime() - y.submittedAt.getTime());
      const first = own[0]?.submittedAt ?? null;
      const pengawasId = a?.pengawasId ?? p.defaultPengawasId;
      return {
        sandi: p.sandi,
        nama: p.nama,
        bundling: a?.bundling ?? p.bundling,
        pengawas: pengawasId ? { id: pengawasId, name: name.get(pengawasId) ?? "?" } : null,
        status: a?.status ?? null,
        submission: !first ? "belum" : first > deadline ? "terlambat" : "tepat_waktu",
        firstSubmittedAt: first,
        lastSubmittedAt: own[own.length - 1]?.submittedAt ?? null,
        mr: a ? badge(a.id, "mr", p.sandi) : emptyBadge,
        it: a ? badge(a.id, "it", p.sandi) : emptyBadge,
      };
    });
}

// ------------------------------------------------------------------ Sumber BI and weights

const lookupCache = new Map<string, Promise<SumberBiLookup>>();

/** The period's active Sumber BI tables, as the KK's VLOOKUPs read them. Cached per upload (uploads never change). */
export async function loadMrTables(db: Db, periodId: string): Promise<MrTables> {
  const active = await db
    .select({ id: sumberBiUploads.id, kind: sumberBiUploads.kind })
    .from(sumberBiUploads)
    .where(and(eq(sumberBiUploads.periodId, periodId), eq(sumberBiUploads.isActive, true)));
  const get = (kind: string) => {
    const u = active.find((x) => x.kind === kind);
    if (!u) return undefined;
    let p = lookupCache.get(u.id);
    if (!p) {
      p = db
        .select()
        .from(sumberBiRows)
        .where(eq(sumberBiRows.uploadId, u.id))
        .orderBy(asc(sumberBiRows.rowNo))
        .then((rows) => buildLookup(rows));
      lookupCache.set(u.id, p);
    }
    return p;
  };
  const [satuTahun, enamBulan] = await Promise.all([get("1_tahun"), get("6_bulan")]);
  return { satuTahun, enamBulan };
}

/** Weights in force for the assessment's bundling and bentuk lembaga ("Lembaga Remitansi" weighs as LSB). */
export async function loadWeights(db: Db, periodId: string, bundling: number, bentuk: unknown): Promise<Weights | undefined> {
  const raw = typeof bentuk === "string" ? bentuk.trim() : "";
  const key = raw.toLowerCase() === LEMBAGA_REMITANSI.toLowerCase() || !raw ? LSB : raw;
  const [row] = await db
    .select({ weights: weightSets.weights })
    .from(weightSets)
    .where(and(eq(weightSets.periodId, periodId), eq(weightSets.bundling, bundling), eq(weightSets.bentukLembaga, key)))
    .orderBy(desc(weightSets.createdAt))
    .limit(1);
  return (row?.weights as Weights | undefined) ?? undefined;
}

async function partCells(db: Db, partId: string) {
  const rows = await db.select({ cellRef: cellInputs.cellRef, value: cellInputs.value, source: cellInputs.source, note: cellInputs.note }).from(cellInputs).where(eq(cellInputs.partId, partId));
  return { values: new Map(rows.map((r) => [r.cellRef, r.value])), rows };
}

// ------------------------------------------------------------------ PJP detail

export async function loadPjpDetail(db: Db, sandi: string) {
  const period = await activePeriod(db);
  if (!period) return null;
  const [p] = await db.select().from(pjp).where(eq(pjp.sandi, sandi));
  if (!p) return null;
  const [a] = await db.select().from(assessments).where(and(eq(assessments.periodId, period.id), eq(assessments.pjpSandi, sandi)));
  const pengawasId = a?.pengawasId ?? p.defaultPengawasId;
  const [pengawas] = pengawasId ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, pengawasId)) : [];
  if (!a) return { period, pjp: p, assessment: null, pengawas: pengawas ?? null, parts: null, blockers: [], mr: null, it: null };

  const parts = await db.select().from(assessmentParts).where(eq(assessmentParts.assessmentId, a.id));
  const mrPart = parts.find((x) => x.kind === "mr")!;
  const itPart = parts.find((x) => x.kind === "it")!;
  const [mrFiles, itFiles, blockers] = await Promise.all([partFiles(db, mrPart.id), partFiles(db, itPart.id), assessmentFinalBlockers(db, defs, a.id)]);
  const uploaderIds = [...mrFiles.files, ...itFiles.files].map((f) => f.submissionId);
  const subRows = uploaderIds.length ? await db.select({ id: submissions.id, source: submissions.source, uploadedBy: submissions.uploadedBy }).from(submissions).where(inArray(submissions.id, uploaderIds)) : [];
  const people = new Map((await db.select({ id: users.id, name: users.name }).from(users)).map((u) => [u.id, u.name]));
  const subInfo = new Map(subRows.map((s) => [s.id, { source: s.source, uploader: s.uploadedBy ? (people.get(s.uploadedBy) ?? "?") : null }]));
  const withSource = <T extends { submissionId: string }>(fs: T[]) => fs.map((f) => ({ ...f, ...(subInfo.get(f.submissionId) ?? { source: "form" as const, uploader: null }) }));

  const def = defs.mr[a.bundling as 2 | 3];
  const [mrCells, itCells, tables] = await Promise.all([partCells(db, mrPart.id), partCells(db, itPart.id), loadMrTables(db, period.id)]);
  let mr = null;
  if (mrPart.activeFileId) {
    const weights = await loadWeights(db, period.id, a.bundling, mrCells.values.get(`${def.sheets.risiko}!D6`));
    const res = computeMr(def, mrCells.values, tables, { sandi: p.sandi, weights, officialBasis: period.officialRatingBasis });
    mr = {
      ratingM: res.template.ratingM,
      official: res.template.official,
      risks: res.template.risks.map((r) => ({ key: r.key, label: r.label, inherent: r.inherent, composite: r.composite, compositePengawas: r.compositePengawas })),
      tkmr: tkmrPengawasProgress(def, mrCells.values),
      warnings: res.warnings,
      corrected: res.corrected.ratingM,
    };
  }
  const applicability = deriveItApplicability(defs.it, itApplicability2025, {
    bundling: a.bundling as 2 | 3,
    mr: mrPart.activeFileId ? { def, cells: mrCells.values } : undefined,
    flags: { spbiParticipant: a.spbiParticipant },
    override: (itPart.applicabilityOverride as { pairs: string[]; note: string } | null) ?? null,
  });
  const itRes = itPart.activeFileId ? computeIt(defs.it, itCells.values, applicability.pairs) : null;

  return {
    period,
    settings: periodSettings(period.settings),
    pjp: p,
    assessment: a,
    pengawas: pengawas ?? null,
    parts: {
      mr: { ...mrPart, ...mrFiles, files: withSource(mrFiles.files) },
      it: { ...itPart, ...itFiles, files: withSource(itFiles.files) },
    },
    blockers,
    mr,
    it: { applicability, result: itRes },
  };
}

// ------------------------------------------------------------------ MR workbook view

export type GridValue = string | number | boolean | null;

const show = (v: Scalar | unknown): GridValue => (isError(v) ? v.code : v === undefined ? null : (v as GridValue));

/** The MR KK of one PJP, read-only: the template layout, the assessment's inputs and every computed formula value. */
export async function loadMrView(db: Db, sandi: string) {
  const period = await activePeriod(db);
  if (!period) return null;
  const [p] = await db.select().from(pjp).where(eq(pjp.sandi, sandi));
  const [a] = p ? await db.select().from(assessments).where(and(eq(assessments.periodId, period.id), eq(assessments.pjpSandi, sandi))) : [];
  if (!p || !a) return null;
  const [part] = await db.select().from(assessmentParts).where(and(eq(assessmentParts.assessmentId, a.id), eq(assessmentParts.kind, "mr")));
  const [template] = await db.select({ layout: templates.layoutJson, filename: templates.filename }).from(templates).where(eq(templates.id, part.templateId));
  const def: MrDefinition = defs.mr[a.bundling as 2 | 3];
  const { values, rows } = await partCells(db, part.id);
  const [tables, weights] = await Promise.all([loadMrTables(db, period.id), loadWeights(db, period.id, a.bundling, values.get(`${def.sheets.risiko}!D6`))]);
  const res = computeMr(def, values, tables, { sandi: p.sandi, weights, officialBasis: period.officialRatingBasis });

  const grid: Record<string, GridValue> = {};
  for (const [ref, v] of values) grid[ref] = show(v);
  for (const [ref, v] of res.template.cells) grid[ref] = show(v);
  // Cells the app replaced (D5 = the PJP's Sandi, weights, Lembaga Remitansi -> LSB): show what was used.
  for (const d of res.deviations.filter((x) => x.modes.includes("template"))) for (const [ref, v] of Object.entries(d.cells)) grid[ref] = show(v);

  const sources: Record<string, "pjp" | "pengawas" | "koreksi" | "system"> = {};
  for (const r of rows) sources[r.cellRef] = r.source;
  return {
    period,
    pjp: p,
    assessment: a,
    hasActiveFile: !!part.activeFileId,
    layout: (template?.layout as ExtractedLayout | null) ?? null,
    templateFile: template?.filename ?? def.templateFile,
    sheets: [def.sheets.risiko, def.sheets.tkmr, def.sheets.permodalan, def.sheets.form, def.sheets.lamp1],
    values: grid,
    sources,
    formulaRefs: Object.keys(def.spec.formulas),
    summary: { ratingM: res.template.ratingM, tkmr: tkmrPengawasProgress(def, values), deviations: res.deviations.map((d) => ({ code: d.code, description: d.description, modes: d.modes })) },
  };
}
