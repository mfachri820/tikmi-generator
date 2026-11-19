/**
 * Deviations from the KK, tested both ways (template mode = the KK; corrected
 * mode = the documented deviation). Synthetic inputs over the committed
 * definitions: no template files needed.
 */
import { describe, expect, it } from "vitest";
import type { MrDefinition } from "./definitions";
import { computeMr, finalizeBlockers, LSB, RISKS, tkmrPengawasProgress, type Weights } from "./summary";
import b2json from "../definitions/2025-mr-b2.json";
import b3json from "../definitions/2025-mr-b3.json";

const b2 = b2json as unknown as MrDefinition;
const b3 = b3json as unknown as MrDefinition;
const fp = (def: MrDefinition, a: string) => `${def.sheets.form}!${a}`;
const rs = (def: MrDefinition, a: string) => `${def.sheets.risiko}!${a}`;
const tk = (def: MrDefinition, a: string) => `${def.sheets.tkmr}!${a}`;

/** A small, valid MR answer set: identity, every TKMR F = 4 and L = 3, permodalan 3. */
function baseInputs(def: MrDefinition, over: Record<string, unknown> = {}): Map<string, unknown> {
  const m = new Map<string, unknown>([
    [rs(def, "D4"), "PT Contoh"],
    [rs(def, "D6"), LSB],
    [rs(def, "D7"), def.bundling],
    [rs(def, "D8"), "PSP Selain PSP Utama"],
    [rs(def, "D9"), "1 Januari - 31 Desember"],
    [rs(def, "E9"), 2025],
    [`${def.sheets.permodalan}!E6`, 3],
  ]);
  for (const q of def.tkmrQuestions) {
    m.set(tk(def, `F${q.row}`), 4);
    m.set(tk(def, `L${q.row}`), 3);
  }
  for (const [k, v] of Object.entries(over)) m.set(k, v);
  return m;
}

const indicator = (def: MrDefinition, id: string) => {
  const i = def.indicators.find((x) => x.id === id);
  if (!i) throw new Error(`${id} not in definition`);
  return i;
};

describe("Lembaga Remitansi (B3 PJP template option without weights)", () => {
  it("is weighted as Lembaga Selain Bank in both modes, with a note", () => {
    const remit = computeMr(b3, baseInputs(b3, { [rs(b3, "D6")]: "Lembaga Remitansi" }));
    const lsb = computeMr(b3, baseInputs(b3));
    expect(remit.template.risks[0].weight).toBe(0.32);
    expect(remit.template.ratingM.template.score).toBeCloseTo(lsb.template.ratingM.template.score as number, 12);
    expect(remit.deviations.map((d) => d.code)).toContain("bentuk_remitansi");
    expect(remit.warnings.map((w) => w.code)).toContain("bentuk_remitansi");
  });

  it("the KK alone gives no weights for it (why the mapping exists)", () => {
    const res = computeMr(b3, baseInputs(b3, { [rs(b3, "D6")]: "Bank" }));
    expect(res.template.risks[0].weight).toBe("NA");
    expect(res.warnings.map((w) => w.code)).toContain("weights_missing");
  });
});

describe("weights from the period config", () => {
  it("replace C10:L10 and move the profile accordingly", () => {
    const kk = computeMr(b3, baseInputs(b3));
    const weights = Object.fromEntries(RISKS.map((r) => [r.key, r.key === "OPS" ? 1 : 0])) as Weights;
    const cfg = computeMr(b3, baseInputs(b3), {}, { weights });
    expect(cfg.template.profile.mandiri).toBeCloseTo(cfg.template.risks[0].composite as number, 12);
    expect(cfg.template.profile.mandiri).not.toBeCloseTo(kk.template.profile.mandiri as number, 6);
  });
});

describe("PU-PT (template: H23 = H36 = 3, H52 = 0)", () => {
  it("template mode keeps the constants; corrected mode uses the pengawas input", () => {
    const res = computeMr(b2, baseInputs(b2), {}, { puPt: 2 });
    const pupt = (m: "template" | "corrected") => res[m].risks.find((r) => r.key === "PUPT")!;
    expect(pupt("template")).toMatchObject({ inherent: 3, tkmrMandiri: 3, tkmrPengawas: 0, composite: 3, compositePengawas: 1.5 });
    expect(pupt("corrected")).toMatchObject({ inherent: 2, tkmrMandiri: 2, tkmrPengawas: 2, composite: 2, compositePengawas: 2 });
  });

  it("defaults to 3 and says so", () => {
    const res = computeMr(b2, baseInputs(b2));
    expect(res.corrected.risks.find((r) => r.key === "PUPT")!.compositePengawas).toBe(3);
    expect(res.warnings.map((w) => w.code)).toContain("pupt_template_constant");
  });
});

describe("period divisor and BI source (template: from D8; corrected: from D9)", () => {
  const ind = indicator(b2, "I.OPS.6.8");
  const h = rs(b2, ind.inputs.find((c) => c.startsWith("H"))!);
  const m = rs(b2, ind.mCell);

  it("PSP Utama reporting Jan–Des: template divides by 6 months, corrected by 12, with a warning", () => {
    const res = computeMr(b2, baseInputs(b2, { [rs(b2, "D8")]: "PSP Utama", [h]: 525600 }));
    expect(res.template.cells.get(m)).toBeCloseTo(525600 / 259200, 12);
    expect(res.corrected.cells.get(m)).toBeCloseTo(1, 12);
    expect(res.warnings.find((w) => w.code === "d8_d9_mismatch")).toBeDefined();
  });

  it("consistent D8/D9: both modes agree and nothing is flagged", () => {
    const res = computeMr(b2, baseInputs(b2, { [h]: 525600 }));
    expect(res.template.cells.get(m)).toBeCloseTo(1, 12);
    expect(res.corrected.cells.get(m)).toBeCloseTo(1, 12);
    expect(res.warnings.find((w) => w.code === "d8_d9_mismatch")).toBeUndefined();
  });

  it("BI-sourced rows switch table with the effective category", () => {
    const bi = b2.biRows[0];
    const sandi = "777000001";
    const table = (amount: number) => ({ getByKey: (k: string) => (k === `${bi.dataId}-${sandi}` ? { found: true as const, value: amount } : { found: false as const }) });
    const inputs = baseInputs(b2, { [rs(b2, "D8")]: "PSP Utama" });
    const res = computeMr(b2, inputs, { satuTahun: table(111), enamBulan: table(222), lampPjp: () => sandi });
    expect(res.template.cells.get(rs(b2, `H${bi.row}`))).toBe(222);
    expect(res.corrected.cells.get(rs(b2, `H${bi.row}`))).toBe(111);
  });
});

describe("empty risks and Rating M", () => {
  it("risks without inherent data count as 0 and are flagged (template behaviour kept)", () => {
    const res = computeMr(b3, baseInputs(b3));
    expect(res.template.risks.find((r) => r.key === "OPS")!.inherent).toBe(0);
    expect(res.warnings.filter((w) => w.code === "risk_no_data").map((w) => w.risk)).toContain("OPS");
  });

  it("reports both Rating M values from the KK's own cells; none is official until the period decides", () => {
    const unset = computeMr(b3, baseInputs(b3));
    expect(unset.template.official).toBeNull();
    expect(unset.template.ratingM.template.score).toBe(unset.template.cells.get(fp(b3, "C64")));
    expect(unset.template.ratingM.validasiPengawas.score).toBe(unset.template.cells.get(fp(b3, "F64")));
    const val = computeMr(b3, baseInputs(b3), {}, { officialBasis: "validasi_pengawas" });
    expect(val.template.official).toMatchObject({ basis: "validasi_pengawas", score: val.template.ratingM.validasiPengawas.score });
  });

  it("flags a score outside 1–5 (I.PK.4.1 passes the BI value through unchecked)", () => {
    const pk = indicator(b2, "I.PK.4.1");
    const res = computeMr(b2, baseInputs(b2, { [rs(b2, pk.inputs[0])]: 12 }));
    expect(res.warnings.find((w) => w.code === "score_out_of_range")?.message).toContain("I.PK.4.1");
  });
});

describe("Final needs every pengawas TKMR score (column L)", () => {
  it("blocks Final and shows x/total while any L is blank", () => {
    const inputs = baseInputs(b2);
    const [first, second] = b2.tkmrQuestions;
    inputs.delete(tk(b2, `L${first.row}`));
    inputs.set(tk(b2, `L${second.row}`), "NA");
    const p = tkmrPengawasProgress(b2, inputs);
    expect(p).toMatchObject({ total: 122, filled: 121, missingRows: [first.row], complete: false, badge: "TKMR pengawas belum lengkap (121/122)" });
    expect(finalizeBlockers(b2, inputs).map((b) => b.code)).toEqual(["tkmr_pengawas_incomplete"]);
  });

  it("allows Final once all are 1–5 or NA (Bundling 3 has 121 questions)", () => {
    expect(tkmrPengawasProgress(b3, baseInputs(b3))).toMatchObject({ total: 121, complete: true, badge: null });
    expect(finalizeBlockers(b3, baseInputs(b3))).toEqual([]);
    const out = baseInputs(b3, { [tk(b3, `L${b3.tkmrQuestions[0].row}`)]: 7 });
    expect(tkmrPengawasProgress(b3, out).complete).toBe(false);
  });
});
