import { describe, expect, it } from "vitest";
import { buildPjpIndex } from "./match";
import { formerName, normalizeName, normalizeSandi } from "./normalize";
import { planPjpMaster } from "./plan";
import { readFormPjpNames } from "./sources";

describe("normalizeName", () => {
  it.each([
    ["PT Indogo Ekspress Remittance", "indogo express remittance"],
    ["Indogo Ekspress Remittance, PT", "indogo express remittance"],
    ["PT. INDOGO EKSPRESS REMITTANCE", "indogo express remittance"],
    ["PT Atom Teknologi Indonesia (d/h PT Silot Technology Indonesia)", "atom teknologi indonesia"],
    ["PT Omnipay Transfer Dana (d/h Hayyu Indo)", "omnipay transfer dana"],
    ["PT Zen e-Transfer Nusantara", "zen e transfer nusantara"],
    ["KSP Sahabat Mitra Sejati", "ksp sahabat mitra sejati"],
    ["PT Pegadaian (Persero)", "pegadaian"],
  ])("%s -> %s", (input, expected) => expect(normalizeName(input)).toBe(expected));

  it("extracts the former (d/h) name", () => {
    expect(formerName("PT Atom Teknologi Indonesia (d/h PT Silot Technology Indonesia)")).toBe("silot technology indonesia");
    expect(formerName("PT MM Indonesia")).toBeNull();
  });
});

describe("normalizeSandi", () => {
  it("pads numbers and digit strings to 9 digits", () => {
    expect(normalizeSandi(69000000)).toBe("069000000");
    expect(normalizeSandi(" 777958125 ")).toBe("777958125");
    expect(normalizeSandi("PT X")).toBeNull();
    expect(normalizeSandi(null)).toBeNull();
  });
});

describe("buildPjpIndex", () => {
  const index = buildPjpIndex([
    { sandi: "777000001", nama: "Kawan Hai Hai Remittance" },
    { sandi: "777000002", nama: "PT Silot Technology Indonesia" },
    { sandi: "777000003", nama: "Baiili Remittance Indonesia" },
    { sandi: "777000004", nama: "Prima Express Remit" },
    { sandi: "777000005", nama: "Prima Express Remittance" },
  ]);

  it("matches normalised names automatically", () => {
    expect(index.match("PT Kawan Hai Hai Remittance")).toMatchObject({ kind: "auto", sandi: "777000001", via: "name" });
  });

  it("matches through the d/h former name", () => {
    expect(index.match("PT Atom Teknologi Indonesia (d/h PT Silot Technology Indonesia)")).toMatchObject({
      kind: "auto",
      sandi: "777000002",
      via: "former_name",
    });
  });

  it("only suggests a typo, never matches it automatically", () => {
    expect(index.match("PT Baiili Remintance Indonesia")).toMatchObject({ kind: "suggested", sandi: "777000003" });
  });

  it("flags a close runner-up", () => {
    const tie = buildPjpIndex([
      { sandi: "777000011", nama: "Alpha Remit One" },
      { sandi: "777000012", nama: "Alpha Remit Ona" },
    ]);
    const m = tie.match("PT Alpha Remit On");
    expect(m.kind).toBe("suggested");
    if (m.kind === "suggested") expect(m.runnerUp).toBeDefined();
    // A clearly better candidate has no runner-up: "Remitt" is far closer to "Remit" than to "Remittance".
    const clear = index.match("PT Prima Express Remitt");
    expect(clear).toMatchObject({ kind: "suggested", sandi: "777000004", runnerUp: undefined });
  });

  it("treats spelling variants and spacing as the same name", () => {
    const idx = buildPjpIndex([
      { sandi: "777930107", nama: "NANDY DANA EKSPRES" },
      { sandi: "777111112", nama: "Omni Pay Transfer Dana" },
      { sandi: "777930069", nama: "ZEN ETRANSFER NUSANTARA" },
    ]);
    expect(idx.match("PT Nandy Dana Express")).toMatchObject({ kind: "auto", sandi: "777930107", via: "name" });
    expect(idx.match("PT Omnipay Transfer Dana (d/h Hayyu Indo)")).toMatchObject({ kind: "auto", sandi: "777111112", via: "compact" });
    expect(idx.match("PT Zen e-Transfer Nusantara")).toMatchObject({ kind: "auto", sandi: "777930069", via: "compact" });
  });

  it("suggests (never auto-matches) a name with an extra word", () => {
    const idx = buildPjpIndex([{ sandi: "777958118", nama: "Priority Valasindo" }]);
    expect(idx.match("PT Priority Valasindo Remittance")).toMatchObject({ kind: "suggested", sandi: "777958118" });
  });

  it("leaves unknown names unmatched", () => {
    expect(index.match("PT Super Mega Express").kind).toBe("unmatched");
  });
});

describe("planPjpMaster", () => {
  const lamp = [
    { sandi: "777000001", nama: "Kawan Hai Hai Remittance", kategori: "PJP LR", row: 5 },
    { sandi: "777000001", nama: "PT Kawan Hai Hai Remitance", kategori: "PJP LR", row: 6 },
    { sandi: "777000003", nama: "Baiili Remittance Indonesia", kategori: "PJP LR", row: 7 },
    { sandi: "033000000", nama: "Bank of America, N.A. Cabang Jakarta", kategori: "Bank PTD", row: 8 },
  ];
  const plan = planPjpMaster(lamp, ["PT Kawan Hai Hai Remittance", "PT Baiili Remintance Indonesia", "PT Super Mega Express"]);

  it("creates one PJP per Sandi and keeps other spellings as aliases", () => {
    expect(plan.pjp.map((p) => p.sandi).sort()).toEqual(["033000000", "777000001", "777000003"]);
    expect(plan.sandiWithSeveralNames).toEqual([{ sandi: "777000001", names: ["Kawan Hai Hai Remittance", "PT Kawan Hai Hai Remitance"] }]);
  });

  it("marks form-listed PJPs as supervised, in form order", () => {
    const khh = plan.pjp.find((p) => p.sandi === "777000001")!;
    expect(khh).toMatchObject({ supervised: true, formName: "PT Kawan Hai Hai Remittance", sortOrder: 1 });
    expect(plan.pjp.find((p) => p.sandi === "033000000")!.supervised).toBe(false);
  });

  it("counts exact, normalised, suggested and unmatched form names", () => {
    expect(plan.stats).toMatchObject({ formNames: 3, exact: 0, normalized: 1, suggested: 1, unmatched: 1 });
    expect(plan.aliases.find((a) => a.alias === "PT Super Mega Express")).toMatchObject({ status: "unmatched", sandi: null });
    expect(plan.aliases.find((a) => a.alias === "PT Baiili Remintance Indonesia")).toMatchObject({ status: "suggested", suggestedSandi: "777000003" });
  });
});

describe("readFormPjpNames", () => {
  it("reads the numbered dropdown options up to Other", () => {
    const text = "Nama Penyelenggara PJP Pengawasan Wilker DKI Jakarta\n\n*\n1.\nPT A\n2.\nPT B (d/h C)\n3.\nOther\nNama Penyelenggara ... (Jika memilih Other)";
    expect(readFormPjpNames(text)).toEqual(["PT A", "PT B (d/h C)"]);
  });
});
