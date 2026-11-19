import { describe, expect, it } from "vitest";
import { deriveItApplicability, ItApplicabilityConfigError, parseItApplicabilityConfig } from "./applicability";
import { itApplicability2025 as cfg } from "./config";
import type { ItDefinition, MrDefinition } from "./definitions";
import raw from "../config/it-applicability-2025.json";
import itJson from "../definitions/2025-it.json";
import b2json from "../definitions/2025-mr-b2.json";
import b3json from "../definitions/2025-mr-b3.json";

const it_ = itJson as unknown as ItDefinition;
const b2 = b2json as unknown as MrDefinition;
const b3 = b3json as unknown as MrDefinition;

/** MR cells declaring the given services (value per ID; every other asked service TIDAK unless `blank`). */
function declare(def: MrDefinition, values: Record<string, string>, rest: "TIDAK" | "blank" = "TIDAK"): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const [row, id] of def.pjp.rows) {
    if (!id.startsWith("R.OPS.1.a.")) continue;
    const v = values[id] ?? (rest === "blank" ? undefined : "TIDAK");
    if (v !== undefined) m.set(`${def.sheets.risiko}!H${row}`, v);
  }
  return m;
}
const derive = (def: MrDefinition, values: Record<string, string>, rest: "TIDAK" | "blank" = "TIDAK") =>
  deriveItApplicability(it_, cfg, { mr: { def, cells: declare(def, values, rest) } });

describe("config consistency", () => {
  it("asked services are exactly each bundling's R.OPS.1.a.* rows, all defined; every pair key exists", () => {
    for (const def of [b2, b3]) {
      const rows = def.pjp.rows.map(([, id]) => id).filter((id) => id.startsWith("R.OPS.1.a."));
      expect([...cfg.askedByBundling[String(def.bundling)]].sort()).toEqual([...rows].sort());
    }
    const pairs = new Set(it_.pairs.map((p) => p.key));
    for (const id of Object.values(cfg.askedByBundling).flat()) expect(cfg.services[id], id).toBeDefined();
    for (const s of Object.values(cfg.services)) for (const p of s.pairs) expect(pairs).toContain(p);
    for (const b of ["2", "3"]) for (const p of cfg.fallbackWhenAllBlank.byBundling[b]) expect(pairs).toContain(p);
    for (const p of [...cfg.always, ...cfg.never, ...cfg.notByDefault, ...Object.keys(cfg.pengawasFlag)]) expect(pairs).toContain(p);
  });
});

describe("IT applicability from MR service declarations", () => {
  it("General only, when every service is declared TIDAK", () => {
    const a = derive(b3, {});
    expect(a.pairs).toEqual(["General"]);
    expect(a.fallback.used).toBe(false);
    expect(a.byPair.find((p) => p.pair === "PSD-UE")?.reason).toBe("not_by_default");
    expect(a.byPair.find((p) => p.pair === "Infra SP")?.reason).toBe("never");
  });

  it("transfer dana switches on Penerusan TD, matched by ID DATA on each bundling's own row; YA is trimmed and case-insensitive", () => {
    // R.OPS.1.a.9 (crossborder) is row 25 in Bundling 2 and row 24 in Bundling 3.
    for (const def of [b2, b3]) {
      const a = derive(def, { "R.OPS.1.a.9": " ya " });
      expect(a.pairs).toEqual(["General", "Penerusan TD"]);
      expect(a.byPair.find((p) => p.pair === "Penerusan TD")?.services.map((s) => s.id)).toEqual(["R.OPS.1.a.9"]);
    }
  });

  it("PG merchant aggregator & disbursement (a.15) switches on both Penerusan Data and Penerusan TD, with its note", () => {
    const a = derive(b2, { "R.OPS.1.a.15": "YA" });
    expect(a.pairs).toEqual(["General", "Penerusan TD", "Penerusan Data"]);
    expect(a.byPair.find((p) => p.pair === "Penerusan TD")?.services[0].confirm).toContain("disbursement");
  });

  it("proprietary channel switches on PSD-Propchan; acquirers carry their note to confirm", () => {
    const a = derive(b2, { "R.OPS.1.a.19": "YA", "R.OPS.1.a.11": "YA" });
    expect(a.pairs).toEqual(["General", "PSD-Propchan", "Penerusan Data"]);
    expect(a.byPair.find((p) => p.pair === "Penerusan Data")?.services[0].confirm).toContain("PSD-APMK");
  });

  it("a declared service with no IT sheet (SNAP, VA) switches nothing on and is listed for the pengawas", () => {
    const a = derive(b3, { "R.OPS.1.a.22": "YA", "R.OPS.1.a.24": "YA" });
    expect(a.pairs).toEqual(["General"]);
    expect(a.askPengawas.map((x) => x.id)).toEqual(["R.OPS.1.a.22", "R.OPS.1.a.24"]);
  });

  it("Lainnya (free text): an answer counts as declared unless it is a no-value", () => {
    expect(derive(b3, { "R.OPS.1.a.26": "Remitansi via agen" }).askPengawas.map((x) => x.id)).toEqual(["R.OPS.1.a.26"]);
    for (const no of ["NA", " tidak ada ", "-", "Nihil"]) expect(derive(b3, { "R.OPS.1.a.26": no }).askPengawas).toEqual([]);
  });

  it("only the services the bundling asks count", () => {
    // R.OPS.1.a.19 is not asked in Bundling 3, so a value on that ID in a Bundling 3 file is ignored.
    const a = deriveItApplicability(it_, cfg, { bundling: 3, mr: { def: b3, cells: declare(b3, {}) } });
    expect(a.declared.map((d) => d.id)).toEqual(cfg.askedByBundling["3"]);
  });

  it("every declaration blank: the bundling's fallback, with the warning", () => {
    const a2 = derive(b2, {}, "blank");
    expect(a2).toMatchObject({ pairs: ["General", "Penerusan TD", "Penerusan Data"], fallback: { used: true, warning: cfg.fallbackWhenAllBlank.warning } });
    expect(a2.byPair.find((p) => p.pair === "Penerusan TD")?.reason).toBe("fallback");
    expect(derive(b3, {}, "blank").pairs).toEqual(["General", "Penerusan TD"]);
    // One answer is enough to use the declarations instead.
    expect(derive(b3, { "R.OPS.1.a.7": "TIDAK" }, "blank")).toMatchObject({ pairs: ["General"], fallback: { used: false } });
  });

  it("a non-active MR file (wrong template): fallback pairs; its declarations read with its own template, for information", () => {
    // Like Jasa Kembar Kilat: a Bundling 2 template while the PJP is Bundling 3, every service TIDAK.
    const a = deriveItApplicability(it_, cfg, { bundling: 3, inactiveMr: { def: b2, cells: declare(b2, {}) } });
    expect(a).toMatchObject({ pairs: ["General", "Penerusan TD"], declaredFrom: "inactive_mr", fromMr: false, fallback: { used: true }, allTidak: true });
    expect(a.declared.map((d) => d.id)).toEqual(cfg.askedByBundling["2"]);
    // A declared service in the inactive file switches nothing on.
    expect(deriveItApplicability(it_, cfg, { bundling: 3, inactiveMr: { def: b2, cells: declare(b2, { "R.OPS.1.a.19": "YA" }) } }).pairs).toEqual(["General", "Penerusan TD"]);
  });

  it("allTidak only when every service is explicitly TIDAK (a blank or a YA breaks it)", () => {
    expect(derive(b3, {}).allTidak).toBe(true);
    expect(derive(b3, { "R.OPS.1.a.7": "YA" }).allTidak).toBe(false);
    expect(derive(b3, { "R.OPS.1.a.7": "TIDAK" }, "blank").allTidak).toBe(false);
  });

  it("no MR file yet: the bundling's fallback; without a bundling, General only", () => {
    expect(deriveItApplicability(it_, cfg, { bundling: 3 })).toMatchObject({ pairs: ["General", "Penerusan TD"], fromMr: false, fallback: { used: true } });
    expect(deriveItApplicability(it_, cfg)).toMatchObject({ pairs: ["General"], fromMr: false });
  });

  it("TI-SPBI only with the pengawas flag; the override replaces everything", () => {
    const flagged = deriveItApplicability(it_, cfg, { mr: { def: b3, cells: declare(b3, {}) }, flags: { spbiParticipant: true } });
    expect(flagged.pairs).toEqual(["General", "TI-SPBI"]);
    const o = deriveItApplicability(it_, cfg, { mr: { def: b3, cells: declare(b3, { "R.OPS.1.a.7": "YA" }) }, override: { pairs: ["General", "PSD-UE"], note: "PJP juga penerbit UE" } });
    expect(o.pairs).toEqual(["General", "PSD-UE"]);
    expect(o.byPair.filter((p) => p.reason === "override").map((p) => p.pair).sort()).toEqual(["PSD-UE", "Penerusan TD"]);
  });
});

describe("strict config schema", () => {
  const clone = () => JSON.parse(JSON.stringify(raw));
  const problems = (c: unknown) => {
    try {
      parseItApplicabilityConfig(c, it_);
      return [];
    } catch (e) {
      expect(e).toBeInstanceOf(ItApplicabilityConfigError);
      return (e as ItApplicabilityConfigError).problems;
    }
  };

  it("accepts the 2025 config", () => {
    expect(problems(raw)).toEqual([]);
  });

  it("rejects a leftover singular \"pair\" (old format) and a missing \"pairs\"", () => {
    const c = clone();
    c.services["R.OPS.1.a.7"] = { label: "x", pair: "Penerusan TD" };
    expect(problems(c)).toEqual(expect.arrayContaining(['services["R.OPS.1.a.7"]: missing "pairs"', 'services["R.OPS.1.a.7"]: unknown key "pair"']));
  });

  it("rejects unknown keys, unknown sheet pairs, undefined asked services, a missing fallback", () => {
    const c = clone();
    c.extra = 1;
    c.services["R.OPS.1.a.9"].pairs = ["Penerusan Transfer"];
    c.askedByBundling["3"].push("R.OPS.1.a.99");
    delete c.fallbackWhenAllBlank["3"];
    const p = problems(c);
    expect(p).toEqual(
      expect.arrayContaining([
        'config: unknown key "extra"',
        expect.stringContaining('"Penerusan Transfer" is not an IT sheet pair'),
        'askedByBundling.3: "R.OPS.1.a.99" has no entry in services',
        'fallbackWhenAllBlank: missing bundling "3"',
      ]),
    );
  });

  it("rejects wrong types and a missing required field", () => {
    const c = clone();
    delete c.always;
    c.unmappedYa = "ignore";
    c.services["R.OPS.1.a.26"].freetext = "yes";
    expect(problems(c)).toEqual(expect.arrayContaining(['config: missing "always"', 'unmappedYa: must be "askPengawas"', 'services["R.OPS.1.a.26"].freetext: must be true/false']));
  });
});
