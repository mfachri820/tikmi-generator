/**
 * The parser and validation report against real files: the blank 2025 PJP
 * templates (templates/tikmi/2025/) and real 2025 submissions
 * (TIKMI_FIXTURES_DIR, default "…/WORK - BI/TIKMI/Folder PSP"). Neither is
 * in git; missing files skip their tests. Assertions are about structure and
 * findings, never about a PJP's answers.
 */
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readLampPjp } from "@tikmi/pjp-master";
import { definitions2025 as defs } from "./definitions";
import { parseSubmission, type ParsedIt, type ParsedMr } from "./parse";
import { validateIt, validateMr, type ValidationContext } from "./validate";
import { decideFile } from "./acceptance";
import { deriveItApplicability, itApplicability2025 } from "@tikmi/scoring";

const TEMPLATES = process.env.TIKMI_TEMPLATES_DIR ?? resolve(__dirname, "../../../templates/tikmi/2025");
const FIXTURES = process.env.TIKMI_FIXTURES_DIR ?? resolve(__dirname, "../../../../../../TIKMI/Folder PSP");
const period = { posisi: "1 Januari - 31 Desember", dataYear: 2025 };

describe("blank PJP templates", () => {
  const cases = [
    ["Nama PSP LSB Bundling 2_Self Asesmen M_Posisi.xlsx", "mr-b2"],
    ["Nama PSP LSB Bundling 3_Self Asesmen M_Posisi.xlsx", "mr-b3"],
    ["Nama PSP_Self Asesmen Infrastruktur TI_Posisi.xlsx", "it"],
  ] as const;
  for (const [file, key] of cases) {
    const path = resolve(TEMPLATES, file);
    it.skipIf(!existsSync(path))(`recognises ${file} as ${key}, with no findings`, async () => {
      const parsed = await parseSubmission(await readFile(path), defs);
      expect(parsed.detection.key).toBe(key);
      expect(parsed.detection.scores[0].score).toBe(1);
      expect(parsed.structure).toEqual([]);
      expect(parsed.typedFormulas).toEqual([]);
    });
  }

  it.skipIf(!existsSync(resolve(TEMPLATES, cases[0][0])))("a blank template's report: everything still to fill, nothing structural", async () => {
    const parsed = (await parseSubmission(await readFile(resolve(TEMPLATES, cases[1][0])), defs)) as ParsedMr;
    const report = validateMr(parsed, defs.mr[3], { period, expectedBundling: 3, filename: cases[1][0] });
    const codes = report.issues.map((i) => i.code);
    // The blank template is pre-filled: its D4 and every TKMR answer are flagged as untouched defaults.
    expect(codes).toEqual(expect.arrayContaining(["identity_default", "tkmr_self_default", "doc_ref_default", "belum_diisi", "permodalan_empty", "filename"]));
    const self = report.issues.find((i) => i.code === "tkmr_self_default")!;
    expect(self).toMatchObject({ prominent: true });
    expect(self.message).toContain(`(${defs.mr[3].tkmrQuestions.length}/${defs.mr[3].tkmrQuestions.length})`);
    expect(codes).not.toContain("template_mismatch");
    expect(codes).not.toContain("structure");
    expect(report.noteToPjp).toContain("Nama_PSP");
  });
});

/** Real submissions, by folder. `bundling` is what the PJP declared (folder file name). */
const SUBMISSIONS = [
  { folder: "PT Andalusia", nama: "Andalusia Antar Benua", bundling: 3 as const },
  { folder: "PT Jasa Kembar Kilat", nama: "Jasa Kembar Kilat", bundling: 3 as const },
  { folder: "PT Kawan Hai Hai", nama: "Kawan Hai Hai Remittance", bundling: 3 as const },
  { folder: "PT MM", nama: "MM Indonesia", bundling: 3 as const },
];

const lampPath = resolve(TEMPLATES, "Nama PSP LSB Bundling 3_Kertas Kerja M Pengawas_Posisi.xlsx");

describe.skipIf(!existsSync(FIXTURES) || !existsSync(lampPath))("real 2025 submissions", () => {
  const files = (folder: string) => readdirSync(resolve(FIXTURES, folder)).filter((f) => f.endsWith(".xlsx"));
  const ctxFor = async (nama: string, bundling: 2 | 3, filename: string): Promise<ValidationContext> => {
    const lamp = await readLampPjp(await readFile(lampPath));
    const row = lamp.find((r) => r.nama.toLowerCase().includes(nama.toLowerCase()));
    return { period, expectedBundling: bundling, filename, pjp: row ? { sandi: row.sandi, nama: row.nama } : undefined };
  };
  const load = async (folder: string, it: boolean) => {
    const f = files(folder).find((x) => /infrastruktur/i.test(x) === it)!;
    return { file: f, parsed: await parseSubmission(await readFile(resolve(FIXTURES, folder, f)), defs) };
  };

  it("PT Jasa Kembar Kilat: a Bundling 2 template filed as Bundling 3, for the wrong period", async () => {
    const { file, parsed } = await load("PT Jasa Kembar Kilat", false);
    expect(parsed.detection.key).toBe("mr-b2");
    const report = validateMr(parsed as ParsedMr, defs.mr[2], await ctxFor("Jasa Kembar Kilat", 3, file));
    const codes = report.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["template_mismatch", "posisi_not_full_year", "year_mismatch"]));
    expect(report.noteToPjp).toContain("template Bundling 2");
    // Excluded from becoming active while the PJP is Bundling 3; active once the pengawas reassigns it to Bundling 2.
    expect(decideFile({ expectedKind: "mr", expectedBundling: 3, parsed, report })).toMatchObject({ activatable: false, excluded: "wrong_bundling" });
    const as2 = validateMr(parsed as ParsedMr, defs.mr[2], await ctxFor("Jasa Kembar Kilat", 2, file));
    expect(decideFile({ expectedKind: "mr", expectedBundling: 2, parsed, report: as2 })).toMatchObject({ activatable: true, acceptance: "perlu_perbaikan" });
  });

  it("PT Kawan Hai Hai: D4 is the template's default; its typed formulas are read by value", async () => {
    const { file, parsed } = await load("PT Kawan Hai Hai", false);
    expect(parsed.detection.key).toBe("mr-b3");
    const mr = parsed as ParsedMr;
    const report = validateMr(mr, defs.mr[3], await ctxFor("Kawan Hai Hai", 3, file));
    expect(report.issues.find((i) => i.code === "identity_default" && i.severity === "error")?.message).toContain("Bank of America");
    const typed = mr.typedFormulas.find((t) => t.source.endsWith("!H199"));
    expect(typed?.formula).toBe("=9434901499+ 614725789");
    expect(typed?.value).toBe(9434901499 + 614725789);
    expect(mr.cells[`${defs.mr[3].sheets.risiko}!H199`]).toBe(9434901499 + 614725789);
  });

  it("PT Kawan Hai Hai: TK Penerusan TD answered entirely N/A (no scores) makes the IT file Perlu Perbaikan", async () => {
    const mr = (await load("PT Kawan Hai Hai", false)).parsed as ParsedMr;
    const { file, parsed } = await load("PT Kawan Hai Hai", true);
    const applicability = deriveItApplicability(defs.it, itApplicability2025, { mr: { def: defs.mr[mr.bundling], cells: mr.cells } });
    expect(applicability.pairs).toEqual(["General", "Penerusan TD"]);
    const report = validateIt(parsed as ParsedIt, defs.it, await ctxFor("Kawan Hai Hai", 3, file), applicability);
    const issue = report.issues.find((i) => i.code === "it_sheet_no_scores" && i.items?.includes("TK Penerusan TD"));
    expect(issue).toMatchObject({ needsCorrection: true });
    // SM Penerusan TD: 2 scores and 31 N/A answers: not blocking, but "Sebagian besar N/A (31/33)".
    expect(report.issues.some((i) => i.items?.includes("SM Penerusan TD") && i.needsCorrection)).toBe(false);
    expect(report.issues.find((i) => i.code === "it_sheet_mostly_na" && i.items?.includes("SM Penerusan TD"))?.message).toContain("(31/33)");
    // The threshold comes from the period settings.
    const lenient = validateIt(parsed as ParsedIt, defs.it, { ...(await ctxFor("Kawan Hai Hai", 3, file)), settings: { itMostlyNaThreshold: 0.95 } }, applicability);
    expect(lenient.issues.map((i) => i.code)).not.toContain("it_sheet_mostly_na");
    expect(decideFile({ expectedKind: "it", parsed, report })).toMatchObject({ activatable: true, acceptance: "perlu_perbaikan" });
  });

  it.each(["PT Andalusia", "PT MM"])("%s: the right template, identity in order", async (folder) => {
    const s = SUBMISSIONS.find((x) => x.folder === folder)!;
    const { file, parsed } = await load(folder, false);
    expect(parsed.detection.key).toBe("mr-b3");
    const report = validateMr(parsed as ParsedMr, defs.mr[3], await ctxFor(s.nama, 3, file));
    const codes = report.issues.map((i) => i.code);
    for (const c of ["template_mismatch", "d7_mismatch", "posisi_not_full_year", "year_mismatch", "d4_mismatch"] as const) expect(codes).not.toContain(c);
    // Both chose "Lembaga Remitansi": weighted as LSB, noted.
    expect(codes).toContain("bentuk_remitansi");
  });

  it.each(SUBMISSIONS.map((s) => s.folder))("%s: the IT file is recognised and its report is produced", async (folder) => {
    const s = SUBMISSIONS.find((x) => x.folder === folder)!;
    const { file, parsed } = await load(folder, true);
    expect(parsed.detection.key).toBe("it");
    const report = validateIt(parsed as ParsedIt, defs.it, await ctxFor(s.nama, s.bundling, file));
    expect(report.issues.filter((i) => i.code === "structure" && i.severity === "error")).toEqual([]);
  });

  it("summary for review (counts only, no answers)", { timeout: 120_000 }, async () => {
    for (const s of SUBMISSIONS) {
      for (const itFile of [false, true]) {
        const { file, parsed } = await load(s.folder, itFile);
        const ctx = await ctxFor(s.nama, s.bundling, file);
        const report =
          parsed.kind === "mr" ? validateMr(parsed, defs.mr[parsed.bundling], ctx) : validateIt(parsed, defs.it, ctx);
        console.log(`${s.folder} ${parsed.kind}: ${parsed.detection.key} ${(parsed.detection.scores[0].score * 100).toFixed(0)}%, ${Object.keys(parsed.cells).length} cells -> ${report.issues.map((i) => `${i.code}:${i.severity[0]}`).join(" ")}`);
      }
    }
  });
});
