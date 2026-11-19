import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, max } from "drizzle-orm";
import {
  assessmentParts,
  assessments,
  cellInputs,
  logEvent,
  periodSettings,
  periods,
  pjp,
  pjpAliases,
  recordCellInputs,
  submissionFiles,
  submissions,
  templates,
  users,
  type CellWrite,
  type Db,
  type DbOrTx,
  type TemplateRole,
} from "@tikmi/db";
import {
  decideFile,
  parseSubmission,
  validateIt,
  validateMr,
  type Definitions,
  type FileDecision,
  type ParsedSubmission,
  type ValidationReport,
} from "@tikmi/parser";
import { normalizeName } from "@tikmi/pjp-master";
import { deriveItApplicability, type ItApplicabilityConfig } from "@tikmi/scoring";
import { matchPjp } from "./match";

/** Private file storage (Supabase Storage in production, memory in tests). */
export interface FileStore {
  put(key: string, bytes: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

export interface IngestDeps {
  db: Db;
  store: FileStore;
  defs: Definitions;
  applicability: ItApplicabilityConfig;
}

export type FileKind = "mr" | "it";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface RegisterInput {
  /** Google Form response ID: an edited response arrives again with the same ID (a new version). */
  responseId: string;
  submittedAt: string | Date;
  respondentEmail?: string | null;
  /** Dropdown answer ("Other" when the PJP typed its own name in `pjpOther`). */
  pjpName: string;
  pjpOther?: string | null;
  /** 2 or 3 from "Bundling Aktivitas". */
  bundling?: number | null;
  /** Every answer, keyed by item ID. */
  answers: Record<string, unknown>;
  files: { kind: FileKind; name: string; size: number; driveFileId?: string | null }[];
}

export interface Registered {
  submissionId: string;
  version: number;
  pjpSandi: string | null;
  match: { status: string; suggestedSandi: string | null };
  files: { fileId: string; kind: FileKind; storageKey: string }[];
}

async function activePeriod(db: DbOrTx) {
  const [p] = await db.select().from(periods).where(eq(periods.status, "active")).limit(1);
  if (!p) throw new Error("No active period");
  return p;
}

/**
 * Step 1 of ingest: records the response (as a new version of its response
 * ID), matches the PJP name, and assigns a private storage key per file. The
 * caller then stores the files under those keys and calls processSubmission.
 */
export async function registerSubmission(db: Db, input: RegisterInput): Promise<Registered> {
  const submittedAt = new Date(input.submittedAt);
  if (Number.isNaN(submittedAt.getTime())) throw new Error(`Invalid submittedAt "${String(input.submittedAt)}"`);
  if (!input.files.length) throw new Error("No files in the submission");
  const period = await activePeriod(db);
  const other = input.pjpOther?.trim();
  const useOther = !!other && /^other$/i.test(input.pjpName.trim());
  const match = await matchPjp(db, useOther ? other! : input.pjpName, useOther ? "form_other" : "form_list");

  return db.transaction(async (tx) => {
    const [{ v }] = await tx
      .select({ v: max(submissions.version) })
      .from(submissions)
      .where(and(eq(submissions.periodId, period.id), eq(submissions.responseId, input.responseId)));
    const version = (v ?? 0) + 1;
    const [sub] = await tx
      .insert(submissions)
      .values({
        periodId: period.id,
        responseId: input.responseId,
        version,
        submittedAt,
        respondentEmail: input.respondentEmail ?? null,
        formPjpName: input.pjpName,
        formPjpOther: input.pjpOther ?? null,
        formBundling: input.bundling === 2 || input.bundling === 3 ? input.bundling : null,
        pjpSandi: match.sandi,
        answers: input.answers,
      })
      .returning();
    const files = [];
    for (const f of input.files) {
      const storageKey = `submissions/${period.code}/${input.responseId}/v${version}/${f.kind}-${randomUUID()}.xlsx`;
      const [row] = await tx
        .insert(submissionFiles)
        .values({ submissionId: sub.id, kind: f.kind, originalName: f.name, driveFileId: f.driveFileId ?? null, sizeBytes: f.size, sha256: "", storageKey })
        .returning();
      files.push({ fileId: row.id, kind: f.kind, storageKey });
    }
    await logEvent(tx, {
      event: "ingest",
      newValue: { submissionId: sub.id, responseId: input.responseId, version, pjpName: useOther ? other : input.pjpName, pjpSandi: match.sandi, match: match.status, files: files.map((f) => f.kind) },
      reason: version > 1 ? `respons diubah (versi ${version})` : "respons formulir",
    });
    return { submissionId: sub.id, version, pjpSandi: match.sandi, match: { status: match.status, suggestedSandi: match.suggestedSandi }, files };
  });
}

export interface ManualUploadInput {
  /** The PJP the files belong to (chosen on its page: no name matching). */
  sandi: string;
  userId: string;
  files: { kind: FileKind; name: string; size: number }[];
}

/**
 * A pengawas/admin uploads a PJP's file(s) on the PJP page ("Unggah file PSP"):
 * the same path as a form response (register, store, process), recorded as
 * source "manual" with the uploader, each upload its own response (version 1).
 */
export async function registerManualUpload(db: Db, input: ManualUploadInput): Promise<Registered> {
  if (!input.files.length) throw new Error("No files");
  const period = await activePeriod(db);
  const [master] = await db.select().from(pjp).where(eq(pjp.sandi, input.sandi));
  if (!master) throw new Error(`PJP ${input.sandi} not found`);
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, input.userId));
  const responseId = `manual:${randomUUID()}`;
  return db.transaction(async (tx) => {
    const [sub] = await tx
      .insert(submissions)
      .values({
        periodId: period.id,
        responseId,
        version: 1,
        source: "manual",
        uploadedBy: input.userId,
        submittedAt: new Date(),
        formPjpName: master.nama,
        formBundling: master.bundling,
        pjpSandi: master.sandi,
        answers: {},
      })
      .returning();
    const files = [];
    for (const f of input.files) {
      const storageKey = `submissions/${period.code}/${responseId.replace(":", "-")}/${f.kind}-${randomUUID()}.xlsx`;
      const [row] = await tx.insert(submissionFiles).values({ submissionId: sub.id, kind: f.kind, originalName: f.name, sizeBytes: f.size, sha256: "", storageKey }).returning();
      files.push({ fileId: row.id, kind: f.kind, storageKey });
    }
    await logEvent(tx, {
      event: "ingest",
      newValue: { submissionId: sub.id, source: "manual", pjpSandi: master.sandi, files: files.map((f) => f.kind) },
      reason: `unggah manual oleh ${user?.name ?? "pengguna"}`,
      userId: input.userId,
    });
    return { submissionId: sub.id, version: 1, pjpSandi: master.sandi, match: { status: "manual", suggestedSandi: null }, files };
  });
}

/** Bundling of a PJP for an assessment: master first, then the form's answer. */
function bundlingOf(master: number | null, form: number | null): 2 | 3 | null {
  const b = master ?? form;
  return b === 2 || b === 3 ? b : null;
}

async function templateId(db: DbOrTx, periodId: string, role: TemplateRole): Promise<string> {
  const [t] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.periodId, periodId), eq(templates.role, role)))
    .orderBy(desc(templates.createdAt))
    .limit(1);
  if (!t) throw new Error(`No ${role} template for the period: run scripts/seed-period.ts`);
  return t.id;
}

/** The PJP's assessment for the period, with both parts; created on first use. */
export async function ensureAssessment(db: DbOrTx, periodId: string, sandi: string, bundling: 2 | 3) {
  let [a] = await db.select().from(assessments).where(and(eq(assessments.periodId, periodId), eq(assessments.pjpSandi, sandi)));
  if (!a) {
    const [p] = await db.select().from(pjp).where(eq(pjp.sandi, sandi));
    [a] = await db
      .insert(assessments)
      .values({ periodId, pjpSandi: sandi, bundling, pengawasId: p?.defaultPengawasId ?? null })
      .onConflictDoNothing()
      .returning();
    a ??= (await db.select().from(assessments).where(and(eq(assessments.periodId, periodId), eq(assessments.pjpSandi, sandi))))[0];
  }
  const parts = await db.select().from(assessmentParts).where(eq(assessmentParts.assessmentId, a.id));
  for (const kind of ["mr", "it"] as const) {
    if (parts.some((p) => p.kind === kind)) continue;
    const role: TemplateRole = kind === "it" ? "it_kk" : a.bundling === 2 ? "mr_kk_b2" : "mr_kk_b3";
    const [row] = await db.insert(assessmentParts).values({ assessmentId: a.id, kind, templateId: await templateId(db, periodId, role) }).onConflictDoNothing().returning();
    if (row) parts.push(row);
  }
  const all = await db.select().from(assessmentParts).where(eq(assessmentParts.assessmentId, a.id));
  return { assessment: a, mr: all.find((p) => p.kind === "mr")!, it: all.find((p) => p.kind === "it")! };
}

export interface FileOutcome {
  fileId: string;
  kind: FileKind;
  decision: FileDecision;
  activated: boolean;
  /** Why it was not applied although activatable (older than the active version, pinned, or Final). */
  notApplied?: "older" | "pinned" | "final";
  changedCells: number;
  /** Cells under a pengawas koreksi: kept as the pengawas set them. */
  koreksiKept: string[];
  /** Of those, the ones where the PJP's own value changed in this file (shown to the pengawas). */
  koreksiPjpChanged: string[];
}

export type ProcessResult =
  | { status: "unmatched"; submissionId: string; files: { fileId: string; kind: FileKind; parsed: boolean }[] }
  | { status: "processed"; submissionId: string; assessmentId: string; files: FileOutcome[] };

async function partAssessment(db: DbOrTx, partId: string) {
  const [row] = await db
    .select({ part: assessmentParts, assessment: assessments })
    .from(assessmentParts)
    .innerJoin(assessments, eq(assessments.id, assessmentParts.assessmentId))
    .where(eq(assessmentParts.id, partId));
  return row;
}

/**
 * Applies a file's PJP values to its part: every PJP cell takes the file's
 * value (blank clears), except cells under a pengawas koreksi, which are kept
 * and listed when the PJP's value changed. Pengawas input cells are never
 * touched (they are not PJP cells).
 */
async function applyCells(db: DbOrTx, partId: string, fileId: string, cells: Record<string, unknown>, reason: string) {
  const existing = await db.select().from(cellInputs).where(eq(cellInputs.partId, partId));
  const byRef = new Map(existing.map((c) => [c.cellRef, c]));
  const refs = new Set([...Object.keys(cells), ...existing.filter((c) => c.source === "pjp" || c.source === "koreksi").map((c) => c.cellRef)]);
  const writes: CellWrite[] = [];
  const koreksiKept: string[] = [];
  const koreksiPjpChanged: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const ref of refs) {
    const e = byRef.get(ref);
    const value = cells[ref] ?? null;
    if (e?.source === "koreksi") {
      // The koreksi stays; only the PJP's value underneath it follows the new file.
      koreksiKept.push(ref);
      if (!same(e.pjpValue, value)) {
        koreksiPjpChanged.push(ref);
        await db.update(cellInputs).set({ pjpValue: value }).where(eq(cellInputs.id, e.id));
        await logEvent(db, { event: "koreksi", partId, cellRef: ref, oldValue: e.pjpValue ?? null, newValue: value, reason: `${reason}: nilai PJP di bawah koreksi berubah` });
      }
      continue;
    }
    if (e && e.source !== "pjp") continue;
    writes.push({ cellRef: ref, value, source: "pjp", fileId });
  }
  const changed = await recordCellInputs(db, partId, writes, { reason });
  return { changed: changed.length, koreksiKept, koreksiPjpChanged };
}

/**
 * Step 2 of ingest: parses and validates the stored files of a submission,
 * decides for each whether it becomes the active version, and applies the
 * active one's cells. MR is processed before IT, because IT applicability is
 * derived from the MR service declarations. An unmatched PJP name keeps the
 * submission in the review queue (resolveAlias processes it later).
 */
export async function processSubmission(deps: IngestDeps, submissionId: string): Promise<ProcessResult> {
  const { db, store, defs } = deps;
  const [sub] = await db.select().from(submissions).where(eq(submissions.id, submissionId));
  if (!sub) throw new Error(`Submission ${submissionId} not found`);
  const [period] = await db.select().from(periods).where(eq(periods.id, sub.periodId));
  const files = (await db.select().from(submissionFiles).where(eq(submissionFiles.submissionId, sub.id))).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "mr" ? -1 : 1));

  // Parse every file first (needs no PJP).
  const parsed = new Map<string, { bytes: Buffer | null; parsed?: ParsedSubmission; error?: unknown }>();
  for (const f of files) {
    const bytes = await store.get(f.storageKey);
    if (!bytes) {
      parsed.set(f.id, { bytes: null, error: new Error("File belum diunggah ke penyimpanan") });
      continue;
    }
    try {
      parsed.set(f.id, { bytes, parsed: await parseSubmission(bytes, defs) });
    } catch (error) {
      parsed.set(f.id, { bytes, error });
    }
  }

  if (!sub.pjpSandi) {
    for (const f of files) {
      const p = parsed.get(f.id)!;
      await db
        .update(submissionFiles)
        .set({
          sha256: p.bytes ? createHash("sha256").update(p.bytes).digest("hex") : "",
          parseStatus: p.parsed ? "parsed" : "failed",
          report: { pending: "PJP belum dikenali: menunggu konfirmasi admin", detection: p.parsed?.detection ?? null, error: p.error instanceof Error ? p.error.message : null },
          parsedAt: new Date(),
        })
        .where(eq(submissionFiles.id, f.id));
    }
    return { status: "unmatched", submissionId: sub.id, files: files.map((f) => ({ fileId: f.id, kind: f.kind, parsed: !!parsed.get(f.id)!.parsed })) };
  }

  const [master] = await db.select().from(pjp).where(eq(pjp.sandi, sub.pjpSandi));
  const formBundling = bundlingOf(null, sub.formBundling);
  const mrFile = files.find((f) => f.kind === "mr");
  const detectedMr = mrFile ? parsed.get(mrFile.id)?.parsed : undefined;
  const bundling =
    bundlingOf(master?.bundling ?? null, sub.formBundling) ?? (detectedMr?.kind === "mr" ? detectedMr.bundling : null);
  if (!bundling) throw new Error(`No bundling known for PJP ${sub.pjpSandi}`);
  if (master && !master.bundling && formBundling) {
    await db.update(pjp).set({ bundling: formBundling }).where(eq(pjp.sandi, master.sandi));
    await logEvent(db, { event: "bundling", newValue: { sandi: master.sandi, bundling: formBundling }, reason: "dari jawaban formulir (Bundling Aktivitas)" });
  }
  const { assessment, mr, it } = await ensureAssessment(db, sub.periodId, sub.pjpSandi, bundling);
  const aliases = (await db.select({ alias: pjpAliases.alias }).from(pjpAliases).where(eq(pjpAliases.sandi, sub.pjpSandi))).map((a) => a.alias);
  const pjpCtx = master ? { sandi: master.sandi, nama: master.nama, aliases } : undefined;
  const periodCtx = { posisi: period.posisi, dataYear: period.dataYear };
  const settings = periodSettings(period.settings);

  const outcomes: FileOutcome[] = [];
  for (const f of files) {
    const p = parsed.get(f.id)!;
    const part = f.kind === "mr" ? mr : it;
    let report: ValidationReport | undefined;
    if (p.parsed?.kind === "mr" && f.kind === "mr") {
      report = validateMr(p.parsed, defs.mr[p.parsed.bundling], { expectedBundling: assessment.bundling as 2 | 3, pjp: pjpCtx, period: periodCtx, filename: f.originalName });
    } else if (p.parsed?.kind === "it" && f.kind === "it") {
      const mrCells = new Map((await db.select().from(cellInputs).where(eq(cellInputs.partId, mr.id))).map((c) => [c.cellRef, c.value]));
      const mrDef = defs.mr[assessment.bundling as 2 | 3];
      // No active MR file: applicability falls back as if none had arrived; an MR file in this submission that was
      // excluded is still read (with its own detected template) for information, e.g. "all services TIDAK".
      const currentMr = await db.select({ activeFileId: assessmentParts.activeFileId }).from(assessmentParts).where(eq(assessmentParts.id, mr.id));
      const hasActiveMr = !!currentMr[0]?.activeFileId;
      const thisMr = mrFile ? parsed.get(mrFile.id)?.parsed : undefined;
      const applicability = deriveItApplicability(defs.it, deps.applicability, {
        bundling: assessment.bundling as 2 | 3,
        mr: hasActiveMr ? { def: mrDef, cells: mrCells } : undefined,
        inactiveMr: !hasActiveMr && thisMr?.kind === "mr" ? { def: defs.mr[thisMr.bundling], cells: thisMr.cells } : undefined,
        flags: { spbiParticipant: assessment.spbiParticipant },
        override: (it.applicabilityOverride as { pairs: string[]; note: string } | null) ?? null,
      });
      report = validateIt(p.parsed, defs.it, { pjp: pjpCtx, period: periodCtx, filename: f.originalName, settings }, applicability);
    }
    const decision = decideFile({ expectedKind: f.kind, expectedBundling: assessment.bundling as 2 | 3, parsed: p.parsed, error: p.error, report });
    await db
      .update(submissionFiles)
      .set({
        sha256: p.bytes ? createHash("sha256").update(p.bytes).digest("hex") : "",
        parseStatus: p.parsed ? "parsed" : "failed",
        valid: decision.activatable,
        excluded: decision.excluded,
        acceptance: decision.acceptance,
        report: {
          detection: p.parsed?.detection ?? null,
          error: p.error instanceof Error ? p.error.message : null,
          decision: { activatable: decision.activatable, excluded: decision.excluded, acceptance: decision.acceptance, message: decision.message },
          validation: report ?? null,
          typedFormulas: p.parsed?.typedFormulas ?? [],
        },
        parsedAt: new Date(),
      })
      .where(eq(submissionFiles.id, f.id));

    const outcome: FileOutcome = { fileId: f.id, kind: f.kind, decision, activated: false, changedCells: 0, koreksiKept: [], koreksiPjpChanged: [] };
    if (decision.activatable && p.parsed) {
      const current = await partAssessment(db, part.id);
      const activeSubmittedAt = current.part.activeFileId
        ? (
            await db
              .select({ at: submissions.submittedAt })
              .from(submissionFiles)
              .innerJoin(submissions, eq(submissions.id, submissionFiles.submissionId))
              .where(eq(submissionFiles.id, current.part.activeFileId))
          )[0]?.at
        : null;
      if (current.assessment.status === "final") outcome.notApplied = "final";
      else if (current.part.pinnedBy) outcome.notApplied = "pinned";
      else if (activeSubmittedAt && sub.submittedAt < activeSubmittedAt) outcome.notApplied = "older";
      else {
        const applied = await db.transaction(async (tx) => {
          const r = await applyCells(tx, part.id, f.id, p.parsed!.cells, `ingest versi ${sub.version}`);
          await tx.update(assessmentParts).set({ activeFileId: f.id, updatedAt: new Date() }).where(eq(assessmentParts.id, part.id));
          await tx.update(assessments).set({ updatedAt: new Date() }).where(eq(assessments.id, assessment.id));
          return r;
        });
        outcome.activated = true;
        outcome.changedCells = applied.changed;
        outcome.koreksiKept = applied.koreksiKept;
        outcome.koreksiPjpChanged = applied.koreksiPjpChanged;
      }
    }
    await logEvent(db, {
      event: "version",
      assessmentId: assessment.id,
      partId: part.id,
      newValue: { fileId: f.id, kind: f.kind, version: sub.version, activated: outcome.activated, excluded: decision.excluded, acceptance: decision.acceptance, notApplied: outcome.notApplied ?? null, changedCells: outcome.changedCells },
      reason: outcome.activated ? decision.message : (outcome.notApplied ? { older: "versi lebih lama dari versi aktif", pinned: "versi lain dipilih pengawas", final: "asesmen sudah Final" }[outcome.notApplied] : decision.message),
    });
    outcomes.push(outcome);
  }
  return { status: "processed", submissionId: sub.id, assessmentId: assessment.id, files: outcomes };
}

/** Stores the bytes of a registered file (direct upload path; the signed-URL path writes to storage itself). */
export async function storeFile(deps: Pick<IngestDeps, "db" | "store">, fileId: string, bytes: Buffer) {
  const [f] = await deps.db.select().from(submissionFiles).where(eq(submissionFiles.id, fileId));
  if (!f) throw new Error(`File ${fileId} not found`);
  await deps.store.put(f.storageKey, bytes, XLSX);
  await deps.db.update(submissionFiles).set({ sizeBytes: bytes.length }).where(eq(submissionFiles.id, fileId));
}

/**
 * Admin confirms which PJP an unmatched or suggested name is: the alias is
 * decided, waiting submissions with that name get the PJP and are processed,
 * oldest first (so the latest ends up active).
 */
export async function resolveAlias(deps: IngestDeps, aliasId: string, sandi: string, userId: string | null) {
  const { db } = deps;
  const [alias] = await db.select().from(pjpAliases).where(eq(pjpAliases.id, aliasId));
  if (!alias) throw new Error(`Alias ${aliasId} not found`);
  await db.update(pjpAliases).set({ sandi, status: "confirmed", decidedBy: userId, decidedAt: new Date() }).where(eq(pjpAliases.id, aliasId));
  await logEvent(db, { event: "pjp_master", oldValue: { alias: alias.alias, status: alias.status, suggested: alias.suggestedSandi }, newValue: { alias: alias.alias, sandi }, reason: "nama PJP dikonfirmasi", userId });
  const waiting = (await db.select().from(submissions).where(isNull(submissions.pjpSandi)))
    .filter((s) => normalizeName(/^other$/i.test(s.formPjpName.trim()) && s.formPjpOther ? s.formPjpOther : s.formPjpName) === alias.normalized)
    .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  const results: ProcessResult[] = [];
  for (const s of waiting) {
    await db.update(submissions).set({ pjpSandi: sandi }).where(eq(submissions.id, s.id));
    results.push(await processSubmission(deps, s.id));
  }
  return results;
}

/**
 * The pengawas checked the PJP's licence and it is the other bundling: the PJP
 * master and the assessment change, the MR part moves to that bundling's KK
 * (its cells, keyed by the old KK's addresses, are cleared), and the PJP's MR
 * files are processed again in order, so a file that was excluded as "the
 * other bundling's template" can now become active.
 */
export async function reassignBundling(deps: IngestDeps, assessmentId: string, bundling: 2 | 3, note: string, userId: string | null) {
  const { db } = deps;
  if (!note.trim()) throw new Error("A note is required to change a PJP's bundling");
  const [a] = await db.select().from(assessments).where(eq(assessments.id, assessmentId));
  if (!a) throw new Error(`Assessment ${assessmentId} not found`);
  if (a.status === "final") throw new Error("Assessment is Final");
  if (a.bundling === bundling) return [];
  const role: TemplateRole = bundling === 2 ? "mr_kk_b2" : "mr_kk_b3";
  const tid = await templateId(db, a.periodId, role);
  await db.transaction(async (tx) => {
    await tx.update(pjp).set({ bundling }).where(eq(pjp.sandi, a.pjpSandi));
    await tx.update(assessments).set({ bundling, updatedAt: new Date() }).where(eq(assessments.id, a.id));
    const [mr] = await tx.select().from(assessmentParts).where(and(eq(assessmentParts.assessmentId, a.id), eq(assessmentParts.kind, "mr")));
    await tx.delete(cellInputs).where(eq(cellInputs.partId, mr.id));
    await tx.update(assessmentParts).set({ templateId: tid, activeFileId: null, pinnedBy: null, perbaikanOverride: null }).where(eq(assessmentParts.id, mr.id));
    await logEvent(tx, { event: "bundling", assessmentId: a.id, partId: mr.id, oldValue: a.bundling, newValue: bundling, reason: note, userId });
  });
  // Every submission of this PJP with an MR file, oldest first.
  const subs = await db
    .select({ id: submissions.id })
    .from(submissions)
    .innerJoin(submissionFiles, eq(submissionFiles.submissionId, submissions.id))
    .where(and(eq(submissions.periodId, a.periodId), eq(submissions.pjpSandi, a.pjpSandi), eq(submissionFiles.kind, "mr")))
    .orderBy(asc(submissions.submittedAt));
  const results: ProcessResult[] = [];
  for (const s of subs) results.push(await processSubmission(deps, s.id));
  return results;
}

/** The pengawas accepts the active "Perlu Perbaikan" file anyway (note required). */
export async function setPerbaikanOverride(db: Db, partId: string, note: string, userId: string | null) {
  if (!note.trim()) throw new Error("A note is required");
  const row = await partAssessment(db, partId);
  if (!row?.part.activeFileId) throw new Error("No active file");
  const override = { fileId: row.part.activeFileId, note, by: userId, at: new Date().toISOString() };
  await db.update(assessmentParts).set({ perbaikanOverride: override }).where(eq(assessmentParts.id, partId));
  await logEvent(db, { event: "perbaikan_override", assessmentId: row.assessment.id, partId, newValue: override, reason: note, userId });
}

/** The pengawas sets which IT sheet pairs apply (note required); null returns to the derived set. */
export async function setApplicabilityOverride(db: Db, partId: string, override: { pairs: string[]; note: string } | null, userId: string | null) {
  if (override && !override.note.trim()) throw new Error("A note is required");
  const row = await partAssessment(db, partId);
  const value = override ? { ...override, by: userId, at: new Date().toISOString() } : null;
  await db.update(assessmentParts).set({ applicabilityOverride: value }).where(eq(assessmentParts.id, partId));
  await logEvent(db, { event: "applicability", assessmentId: row.assessment.id, partId, oldValue: row.part.applicabilityOverride ?? null, newValue: value, reason: override?.note ?? "kembali ke sheet berlaku dari deklarasi layanan", userId });
}

/** Every file of a part, newest first, with what happened to it (for the PJP page). */
export async function partFiles(db: DbOrTx, partId: string) {
  const [part] = await db.select().from(assessmentParts).where(eq(assessmentParts.id, partId));
  const [a] = await db.select().from(assessments).where(eq(assessments.id, part.assessmentId));
  const rows = await db
    .select({ file: submissionFiles, submission: submissions })
    .from(submissionFiles)
    .innerJoin(submissions, eq(submissions.id, submissionFiles.submissionId))
    .where(and(eq(submissions.periodId, a.periodId), eq(submissions.pjpSandi, a.pjpSandi), eq(submissionFiles.kind, part.kind)))
    .orderBy(desc(submissions.submittedAt));
  const latest = rows[0];
  return {
    activeFileId: part.activeFileId,
    files: rows.map((r) => ({ ...r.file, submittedAt: r.submission.submittedAt, version: r.submission.version, responseId: r.submission.responseId, active: r.file.id === part.activeFileId })),
    /** The newest file is not the active one: say why on the PJP page. */
    latestNotActive: latest && latest.file.id !== part.activeFileId ? { fileId: latest.file.id, excluded: latest.file.excluded, report: latest.file.report } : null,
  };
}
