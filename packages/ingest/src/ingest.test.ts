/**
 * Ingest end to end on an in-memory Postgres (PGlite) and an in-memory file
 * store. The scenarios with real files need the 2025 templates and the real
 * submissions (TIKMI_FIXTURES_DIR); they are skipped without them. The
 * review-queue scenario needs no files.
 */
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { assessmentParts, assessments, auditLog, cellInputs, periods, pjp, pjpAliases, recordCellInput, submissionFiles, submissions, templates, users, type Db } from "@tikmi/db";
import { createTestDb } from "@tikmi/db/testing";
import { definitions2025 as defs } from "@tikmi/parser";
import { readLampPjp } from "@tikmi/pjp-master";
import { itApplicability2025 } from "@tikmi/scoring";
import {
  assessmentFinalBlockers,
  MemoryStore,
  partFiles,
  processSubmission,
  reassignBundling,
  registerManualUpload,
  registerSubmission,
  resolveAlias,
  setPerbaikanOverride,
  storeFile,
  type IngestDeps,
  type RegisterInput,
} from "./index";

const TEMPLATES = process.env.TIKMI_TEMPLATES_DIR ?? resolve(__dirname, "../../../templates/tikmi/2025");
const FIXTURES = process.env.TIKMI_FIXTURES_DIR ?? resolve(__dirname, "../../../../../../TIKMI/Folder PSP");
const LAMP = resolve(TEMPLATES, "Nama PSP LSB Bundling 3_Kertas Kerja M Pengawas_Posisi.xlsx");
const haveFiles = existsSync(FIXTURES) && existsSync(LAMP);

let db: Db;
let close: () => Promise<void>;
let deps: IngestDeps;
const store = new MemoryStore();
let andalusiaSandi: string | null = null;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  deps = { db, store, defs, applicability: itApplicability2025 };
  const [p] = await db
    .insert(periods)
    .values({ code: "2025", dataYear: 2025, posisi: "1 Januari - 31 Desember", deadline: new Date("2026-11-19T23:59:00+07:00"), status: "active" })
    .returning();
  for (const role of ["mr_kk_b2", "mr_kk_b3", "it_kk"] as const) {
    await db.insert(templates).values({ periodId: p.id, role, filename: `${role}.xlsx`, sha256: role, storageKey: `templates/${role}.xlsx` });
  }
  if (haveFiles) {
    const lamp = await readLampPjp(await readFile(LAMP));
    for (const r of lamp) await db.insert(pjp).values({ sandi: r.sandi, nama: r.nama, kategoriLamp: r.kategori, source: "lamp_pjp" }).onConflictDoNothing();
  } else {
    await db.insert(pjp).values({ sandi: "777000001", nama: "Contoh Remitansi", source: "lamp_pjp" });
  }
});
afterAll(async () => close?.());

const fixture = (folder: string, it: boolean) => {
  const f = readdirSync(resolve(FIXTURES, folder)).find((x) => x.endsWith(".xlsx") && !x.startsWith("~$") && /infrastruktur/i.test(x) === it)!;
  return { name: f, path: resolve(FIXTURES, folder, f) };
};

/** Registers a response, stores its files (direct path), processes it. */
async function submit(input: Omit<RegisterInput, "files">, files: { kind: "mr" | "it"; name: string; bytes: Buffer }[]) {
  const reg = await registerSubmission(db, { ...input, files: files.map((f) => ({ kind: f.kind, name: f.name, size: f.bytes.length })) });
  for (const f of reg.files) await storeFile(deps, f.fileId, files.find((x) => x.kind === f.kind)!.bytes);
  return { reg, result: await processSubmission(deps, reg.submissionId) };
}

/** The same workbook with sheet 1 H<row> cleared (as if the PJP left it blank). */
async function blankAt(bytes: Buffer, row: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  wb.getWorksheet("1 - Asesmen Risiko")!.getCell(`H${row}`).value = null;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function notTikmi(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Sheet1").addRow(["laporan lain"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("review queue (no files needed)", () => {
  it("an unknown name waits; once confirmed the submission is processed", async () => {
    const { reg, result } = await submit(
      { responseId: "r-unknown", submittedAt: "2026-11-10T03:00:00Z", pjpName: "Other", pjpOther: "PT Benar Benar Baru", bundling: 3, answers: {} },
      [{ kind: "mr", name: "x.xlsx", bytes: await notTikmi() }],
    );
    expect(reg.pjpSandi).toBeNull();
    expect(result.status).toBe("unmatched");
    const [alias] = await db.select().from(pjpAliases).where(eq(pjpAliases.alias, "PT Benar Benar Baru"));
    expect(alias).toMatchObject({ status: "unmatched", source: "form_other" });

    const sandi = haveFiles ? (await db.select().from(pjp).limit(1))[0].sandi : "777000001";
    const [after] = await resolveAlias(deps, alias.id, sandi, null);
    expect(after.status).toBe("processed");
    if (after.status === "processed") expect(after.files[0]).toMatchObject({ activated: false, decision: { excluded: "not_tikmi" } });
  });
});

describe.skipIf(!haveFiles)("real submissions", () => {
  it("Andalusia: MR and IT become active; cells written; Final blocked until the pengawas scores TKMR", async () => {
    const mr = fixture("PT Andalusia", false);
    const it_ = fixture("PT Andalusia", true);
    const { reg, result } = await submit(
      { responseId: "r-andalusia", submittedAt: "2026-11-15T03:00:00Z", pjpName: "PT Andalusia Antar Benua", bundling: 3, answers: {} },
      [
        { kind: "mr", name: mr.name, bytes: await readFile(mr.path) },
        { kind: "it", name: it_.name, bytes: await readFile(it_.path) },
      ],
    );
    expect(reg.match.status).toBe("auto");
    andalusiaSandi = reg.pjpSandi;
    expect(result.status).toBe("processed");
    if (result.status !== "processed") return;
    const [mrOut, itOut] = result.files;
    expect(mrOut).toMatchObject({ kind: "mr", activated: true, decision: { acceptance: "ok" } });
    expect(mrOut.changedCells).toBeGreaterThan(1000);
    expect(itOut).toMatchObject({ kind: "it", activated: true });
    // IT applicability came from the MR declarations: the report knows which services were declared.
    const [itFile] = await db.select().from(submissionFiles).where(eq(submissionFiles.id, itOut.fileId));
    const codes = ((itFile.report as { validation: { issues: { code: string }[] } }).validation.issues).map((i) => i.code);
    expect(codes).not.toContain("structure");
    // Andalusia declared transfer dana (a.7) but left Penerusan TD blank: IT is Perlu Perbaikan.
    const itCodes = ((itFile.report as { validation: { issues: { code: string }[] } }).validation.issues).map((i) => i.code);
    expect(itCodes).toContain("it_service_sheet_blank");
    expect(itFile.acceptance).toBe("perlu_perbaikan");
    const blockers = await assessmentFinalBlockers(db, defs, result.assessmentId);
    expect(blockers.map((b) => b.code)).toEqual(["tkmr_pengawas_incomplete", "it_unscored"]);
    // The pengawas scores the blank rows (column I): the IT blocker clears without a resubmission.
    const [itPart] = await db.select().from(assessmentParts).where(and(eq(assessmentParts.assessmentId, result.assessmentId), eq(assessmentParts.kind, "it")));
    const missing = (await import("@tikmi/scoring")).computeIt(defs.it, new Map((await db.select().from(cellInputs).where(eq(cellInputs.partId, itPart.id))).map((c) => [c.cellRef, c.value])), ["General", "Penerusan TD"]).unscored;
    for (const u of missing) for (const r of u.rows) await recordCellInput(db, { partId: itPart.id, cellRef: `${u.sheet}!I${r}`, value: 3, source: "pengawas", userId: null });
    expect((await assessmentFinalBlockers(db, defs, result.assessmentId)).map((b) => b.code)).toEqual(["tkmr_pengawas_incomplete"]);
  });

  it("an edited response with a non-TIKMI file: excluded, the previous version stays active", async () => {
    const { reg, result } = await submit(
      { responseId: "r-andalusia", submittedAt: "2026-11-16T03:00:00Z", pjpName: "PT Andalusia Antar Benua", bundling: 3, answers: {} },
      [{ kind: "mr", name: "salah.xlsx", bytes: await notTikmi() }],
    );
    expect(reg.version).toBe(2);
    if (result.status !== "processed") throw new Error("not processed");
    expect(result.files[0]).toMatchObject({ activated: false, decision: { excluded: "not_tikmi" } });
    const [part] = await db.select().from(assessmentParts).where(and(eq(assessmentParts.assessmentId, result.assessmentId), eq(assessmentParts.kind, "mr")));
    const pf = await partFiles(db, part.id);
    expect(pf.latestNotActive).toMatchObject({ excluded: "not_tikmi" });
    expect(pf.files.find((f) => f.active)?.version).toBe(1);
  });

  it("a koreksi survives a resubmission; an older version arriving late changes nothing", async () => {
    const [a] = await db.select().from(assessments).where(eq(assessments.pjpSandi, andalusiaSandi!));
    const [part] = await db.select().from(assessmentParts).where(and(eq(assessmentParts.assessmentId, a.id), eq(assessmentParts.kind, "mr")));
    const ref = `${defs.mr[3].sheets.risiko}!H${defs.mr[3].pjpInputRows.rows[0]}`;
    await recordCellInput(db, { partId: part.id, cellRef: ref, value: "TIDAK", source: "koreksi", note: "Sesuai izin", userId: null });
    const mr = fixture("PT Andalusia", false);
    const bytes = await readFile(mr.path);
    const again = await submit({ responseId: "r-andalusia", submittedAt: "2026-11-17T03:00:00Z", pjpName: "PT Andalusia Antar Benua", bundling: 3, answers: {} }, [{ kind: "mr", name: mr.name, bytes }]);
    if (again.result.status !== "processed") throw new Error("not processed");
    expect(again.result.files[0].activated).toBe(true);
    expect(again.result.files[0].koreksiKept).toContain(ref);
    // Same file again: the PJP's value under the koreksi did not change.
    expect(again.result.files[0].koreksiPjpChanged).not.toContain(ref);
    const [kept] = await db.select().from(cellInputs).where(and(eq(cellInputs.partId, part.id), eq(cellInputs.cellRef, ref)));
    expect(kept).toMatchObject({ value: "TIDAK", source: "koreksi" });
    expect(kept.pjpValue).not.toBeNull();

    // A version where the PJP left that answer blank: the koreksi stays, the change underneath is flagged.
    const edited = await submit({ responseId: "r-andalusia", submittedAt: "2026-11-17T04:00:00Z", pjpName: "PT Andalusia Antar Benua", bundling: 3, answers: {} }, [{ kind: "mr", name: mr.name, bytes: await blankAt(bytes, defs.mr[3].pjpInputRows.rows[0]) }]);
    if (edited.result.status !== "processed") throw new Error("not processed");
    expect(edited.result.files[0].koreksiPjpChanged).toContain(ref);
    const [still] = await db.select().from(cellInputs).where(and(eq(cellInputs.partId, part.id), eq(cellInputs.cellRef, ref)));
    expect(still).toMatchObject({ value: "TIDAK", source: "koreksi", pjpValue: null });

    const late = await submit({ responseId: "r-andalusia-old", submittedAt: "2026-11-01T03:00:00Z", pjpName: "PT Andalusia Antar Benua", bundling: 3, answers: {} }, [{ kind: "mr", name: mr.name, bytes }]);
    if (late.result.status !== "processed") throw new Error("not processed");
    expect(late.result.files[0]).toMatchObject({ activated: false, notApplied: "older" });
  });

  it("a manual upload on the PJP page goes the same way, as source manual with the uploader", async () => {
    const [u] = await db.insert(users).values({ name: "Pengawas Satu", email: "satu@example.test", role: "pengawas" }).returning();
    const mr = fixture("PT Andalusia", false);
    const bytes = await readFile(mr.path);
    const reg = await registerManualUpload(db, { sandi: andalusiaSandi!, userId: u.id, files: [{ kind: "mr", name: mr.name, size: bytes.length }] });
    await storeFile(deps, reg.files[0].fileId, bytes);
    const res = await processSubmission(deps, reg.submissionId);
    if (res.status !== "processed") throw new Error("not processed");
    expect(res.files[0]).toMatchObject({ kind: "mr", activated: true });
    const [sub] = await db.select().from(submissions).where(eq(submissions.id, reg.submissionId));
    expect(sub).toMatchObject({ source: "manual", uploadedBy: u.id, version: 1 });
    const log = (await db.select().from(auditLog)).find((l) => l.event === "ingest" && (l.newValue as { submissionId?: string }).submissionId === reg.submissionId);
    expect(log).toMatchObject({ reason: "unggah manual oleh Pengawas Satu", userId: u.id });
  });

  it("Jasa Kembar Kilat: the Bundling 2 file is excluded; after reassigning to Bundling 2 it is active but Perlu Perbaikan", async () => {
    const mr = fixture("PT Jasa Kembar Kilat", false);
    const it_ = fixture("PT Jasa Kembar Kilat", true);
    const { result } = await submit(
      { responseId: "r-jkk", submittedAt: "2026-11-18T03:00:00Z", pjpName: "PT Jasa Kembar Kilat", bundling: 3, answers: {} },
      [
        { kind: "mr", name: mr.name, bytes: await readFile(mr.path) },
        { kind: "it", name: it_.name, bytes: await readFile(it_.path) },
      ],
    );
    if (result.status !== "processed") throw new Error(`not processed: ${result.status}`);
    expect(result.files[0]).toMatchObject({ kind: "mr", activated: false, decision: { excluded: "wrong_bundling" } });
    // IT before the reassignment: no active MR, so the Bundling 3 fallback decides; the excluded Bundling 2 file is
    // read with its own template and shows every service TIDAK, while IT sheets beyond General are filled.
    const itIssues = async (fileId: string) => {
      const [f] = await db.select().from(submissionFiles).where(eq(submissionFiles.id, fileId));
      return (f.report as { validation: { issues: { code: string; message: string }[] } }).validation.issues;
    };
    const before = await itIssues(result.files[1].fileId);
    expect(before.find((i) => i.code === "it_applicability_fallback")?.message).toContain("File Manajemen Risiko tidak dipakai");
    expect(before.find((i) => i.code === "it_declared_none_but_filled")?.message).toContain("pada file MR yang tidak dipakai");
    expect((await assessmentFinalBlockers(db, defs, result.assessmentId)).map((b) => b.code)).toContain("mr_missing");

    const [again] = await reassignBundling(deps, result.assessmentId, 2, "Izin PJP: Bundling 2 (dicek pengawas)", null);
    if (again.status !== "processed") throw new Error("not processed");
    expect(again.files[0]).toMatchObject({ kind: "mr", activated: true, decision: { acceptance: "perlu_perbaikan" } });
    // After it: the active Bundling 2 MR declares every service TIDAK, so only General applies, and the filled
    // Penerusan TD sheets are flagged.
    const after = await itIssues(again.files[1].fileId);
    expect(after.map((i) => i.code)).not.toContain("it_applicability_fallback");
    expect(after.find((i) => i.code === "it_declared_none_but_filled")?.message).not.toContain("tidak dipakai");
    const blockers = (await assessmentFinalBlockers(db, defs, result.assessmentId)).map((b) => b.code);
    expect(blockers).toEqual(expect.arrayContaining(["perlu_perbaikan", "tkmr_pengawas_incomplete"]));

    const [part] = await db.select().from(assessmentParts).where(and(eq(assessmentParts.assessmentId, result.assessmentId), eq(assessmentParts.kind, "mr")));
    await setPerbaikanOverride(db, part.id, "Periode dikonfirmasi PJP lewat surat", null);
    const codes = (await assessmentFinalBlockers(db, defs, result.assessmentId)).filter((b) => b.part === "mr").map((b) => b.code);
    expect(codes).not.toContain("perlu_perbaikan");
  });
});
