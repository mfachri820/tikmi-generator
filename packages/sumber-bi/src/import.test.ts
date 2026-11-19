import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, periods, type Db } from "@tikmi/db";
import { createTestDb } from "@tikmi/db/testing";
import { activateSumberBiUpload, getActiveSumberBi, importSumberBi, loadSumberBiRows } from "./import";

async function file(amount: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data");
  ws.addRow(["id", "ket", "idpelapor", "amount"]);
  ws.addRow(["R.OPS.1.c.55", "QRIS", "777961911", amount]);
  ws.addRow(["R.OPS.1.c.56", "QRIS", "777961911", 2]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

let db: Db;
let close: () => Promise<void>;
let periodId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const [p] = await db
    .insert(periods)
    .values({ code: "2025", dataYear: 2025, posisi: "1 Januari - 31 Desember", deadline: new Date("2026-11-19T16:59:00Z") })
    .returning();
  periodId = p.id;
});
afterAll(async () => close?.());

describe("importSumberBi", () => {
  it("imports, activates, dedupes by sha256 and can switch back", async () => {
    const first = await importSumberBi(db, { periodId, kind: "1_tahun", xlsx: await file(1), filename: "a.xlsx", source: "upload" });
    expect(first.status).toBe("imported");
    expect((await loadSumberBiRows(db, first.upload.id)).map((r) => r.idx)).toEqual(["R.OPS.1.c.55-777961911", "R.OPS.1.c.56-777961911"]);

    const again = await importSumberBi(db, { periodId, kind: "1_tahun", xlsx: await file(1), filename: "a-copy.xlsx", source: "upload" });
    expect(again).toMatchObject({ status: "duplicate", upload: { id: first.upload.id } });

    const second = await importSumberBi(db, { periodId, kind: "1_tahun", xlsx: await file(5), filename: "b.xlsx", source: "upload" });
    expect((await getActiveSumberBi(db, periodId, "1_tahun"))?.id).toBe(second.upload.id);

    await activateSumberBiUpload(db, first.upload.id, null);
    expect((await getActiveSumberBi(db, periodId, "1_tahun"))?.id).toBe(first.upload.id);
    // 6 Bulan is a separate slot.
    expect(await getActiveSumberBi(db, periodId, "6_bulan")).toBeNull();
    expect((await db.select().from(auditLog)).filter((l) => l.event === "sumber_bi").length).toBe(3);
  });

  it("keeps an unreadable file as failed and never activates it", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("x").addRow(["kode", "nilai"]);
    const res = await importSumberBi(db, { periodId, kind: "6_bulan", xlsx: Buffer.from(await wb.xlsx.writeBuffer()), filename: "bad.xlsx", source: "upload" });
    expect(res.status).toBe("failed");
    expect(await getActiveSumberBi(db, periodId, "6_bulan")).toBeNull();
  });
});
