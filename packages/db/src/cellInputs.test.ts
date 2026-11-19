import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { AssessmentFinalError, NoteRequiredError, loadCellValues, recordCellInput } from "./cellInputs";
import { assessmentParts, assessments, auditLog, periods, pjp, templates, users } from "./schema";
import { createTestDb } from "./testing";
import type { Db } from "./client";

let db: Db;
let close: () => Promise<void>;
let partId: string;
let assessmentId: string;
let userId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const [period] = await db
    .insert(periods)
    .values({ code: "2025", dataYear: 2025, posisi: "1 Januari - 31 Desember", deadline: new Date("2026-11-19T16:59:00Z"), status: "active" })
    .returning();
  const [user] = await db.insert(users).values({ name: "Pengawas A", email: "a@example.test", role: "pengawas" }).returning();
  userId = user.id;
  await db.insert(pjp).values({ sandi: "777958125", nama: "MM Indonesia", source: "lamp_pjp", supervised: true });
  const [template] = await db
    .insert(templates)
    .values({ periodId: period.id, role: "mr_kk_b3", filename: "kk.xlsx", sha256: "x", storageKey: "templates/kk.xlsx" })
    .returning();
  const [a] = await db.insert(assessments).values({ periodId: period.id, pjpSandi: "777958125", bundling: 3, pengawasId: userId }).returning();
  assessmentId = a.id;
  const [part] = await db.insert(assessmentParts).values({ assessmentId, kind: "mr", templateId: template.id }).returning();
  partId = part.id;
});

afterAll(async () => close?.());

describe("migrations", () => {
  it("leave only TIKMI tables (IRA tables dropped)", async () => {
    const res = await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`);
    const names = (res as unknown as { rows: { table_name: string }[] }).rows.map((r) => r.table_name);
    for (const ira of ["workbooks", "ltdbb_uploads", "field_mappings", "shared_cell_inputs", "template_versions"]) {
      expect(names).not.toContain(ira);
    }
    for (const t of ["assessments", "assessment_parts", "cell_inputs", "pjp_aliases", "sumber_bi_rows", "submissions", "weight_sets"]) {
      expect(names).toContain(t);
    }
  });
});

describe("recordCellInput", () => {
  it("upserts and logs old/new/who/why", async () => {
    await recordCellInput(db, { partId, cellRef: "1 - Asesmen Risiko!H22", value: "YA", source: "pjp" });
    await recordCellInput(db, { partId, cellRef: "1 - Asesmen Risiko!H22", value: "TIDAK", source: "koreksi", note: "Sesuai izin", userId });
    const values = await loadCellValues(db, partId);
    expect(values.get("1 - Asesmen Risiko!H22")).toBe("TIDAK");
    const log = await db.select().from(auditLog).where(eq(auditLog.partId, partId));
    expect(log.map((l) => [l.event, l.oldValue, l.newValue])).toEqual([
      ["cell", null, "YA"],
      ["koreksi", "YA", "TIDAK"],
    ]);
    expect(log[1].reason).toBe("Sesuai izin");
  });

  it("does nothing when nothing changed", async () => {
    const before = await db.select().from(auditLog);
    expect(await recordCellInput(db, { partId, cellRef: "1 - Asesmen Risiko!H22", value: "TIDAK", source: "koreksi", note: "Sesuai izin", userId })).toBeNull();
    expect((await db.select().from(auditLog)).length).toBe(before.length);
  });

  it("refuses a koreksi without a note", async () => {
    await expect(recordCellInput(db, { partId, cellRef: "1 - Asesmen Risiko!H23", value: 1, source: "koreksi", note: "  " })).rejects.toBeInstanceOf(
      NoteRequiredError,
    );
  });

  it("refuses any write to a Final assessment", async () => {
    await db.update(assessments).set({ status: "final" }).where(eq(assessments.id, assessmentId));
    await expect(recordCellInput(db, { partId, cellRef: "2 - Asesmen Manajemen Risiko!L19", value: 4, source: "pengawas", userId })).rejects.toBeInstanceOf(
      AssessmentFinalError,
    );
    await db.update(assessments).set({ status: "direview" }).where(eq(assessments.id, assessmentId));
  });
});
