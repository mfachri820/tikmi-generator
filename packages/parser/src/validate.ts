import { normalizeName, normalizeSandi } from "@tikmi/pjp-master";
import { computeIt, computeMr, type ItApplicability, type ItDefinition, type ItResult, type MrDefinition, type MrResult } from "@tikmi/scoring";
import type { ParsedIt, ParsedMr } from "./parse";
import type { CellScalar } from "./xlsx";

export type Severity = "error" | "warning" | "info";

export type IssueCode =
  | "template_mismatch"
  | "d7_mismatch"
  | "posisi_not_full_year"
  | "year_mismatch"
  | "d4_mismatch"
  | "d5_mismatch"
  | "d8_d9_mismatch"
  | "bentuk_remitansi"
  | "filename"
  | "belum_diisi"
  | "data_invalid"
  | "perlu_cek_data"
  | "na_without_explanation"
  | "tkmr_score_invalid"
  | "tkmr_score_blank"
  | "tkmr_doc_missing"
  | "permodalan_empty"
  | "typed_formula"
  | "structure"
  | "it_sheet_blank"
  | "it_score_invalid"
  | "it_info_empty"
  | "identity_default"
  | "tkmr_self_default"
  | "doc_ref_default"
  | "it_sheet_extra"
  | "it_service_sheet_blank"
  | "it_applicability_fallback"
  | "it_service_unmapped"
  | "it_sheet_partial"
  | "it_sheet_no_scores"
  | "it_sheet_mostly_na"
  | "it_declared_none_but_filled"
  | "it_as_submitted";

export interface Issue {
  code: IssueCode;
  severity: Severity;
  /** Bahasa Indonesia, shown to the pengawas and (for errors/warnings) in the note to the PJP. */
  message: string;
  /** Indicator / question IDs or cell addresses concerned. */
  items?: string[];
  /** Shown at the top of the PJP page (e.g. TKMR self-scores still the template's 5s). */
  prominent?: boolean;
  /** Makes the file "Perlu Perbaikan": it is used, but the assessment cannot be Final until resubmitted or overridden. */
  needsCorrection?: boolean;
}

export interface ValidationReport {
  issues: Issue[];
  counts: Record<Severity, number>;
  /** "Kirim catatan ke PJP": ready-to-copy text listing the errors and warnings. */
  noteToPjp: string;
}

export interface ValidationContext {
  /** Bundling per the form / PJP master (2 or 3). */
  expectedBundling?: 2 | 3;
  /** The PJP the submission was matched to. */
  pjp?: { sandi: string; nama: string; aliases?: string[] };
  /** Period: Posisi expected in D9 and the data year in E9. */
  period: { posisi: string; dataYear: number };
  /** Uploaded file name (as the form received it). */
  filename?: string;
  /** Period settings that tune the checks (packages/db periodSettings). */
  settings?: { itMostlyNaThreshold?: number };
}

const SHOW = 12;
const list = (xs: string[]) => (xs.length > SHOW ? `${xs.slice(0, SHOW).join(", ")} dan ${xs.length - SHOW} lainnya` : xs.join(", "));
const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const isNa = (v: unknown) => typeof v === "string" && /^n\/?a$/i.test(v.trim());
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * File name convention from the form: "<Nama>_LSB_Bundling_<n>_Self_Asesmen_M_<Posisi>.xlsx" and
 * "<Nama>_Self_Asesmen_Infrastruktur_TI_<Posisi>.xlsx". Google Forms appends " - <uploader>" before the
 * extension; underscores and spaces are treated alike.
 */
export function checkFilename(filename: string, kind: "mr" | "it", bundling?: 2 | 3): string | null {
  const base = filename.replace(/\.xlsx$/i, "").replace(/\s+-\s+[^-]+$/, "");
  const k = base.replace(/[\s_]+/g, "_").toLowerCase();
  if (!/\.xlsx$/i.test(filename)) return "File bukan .xlsx.";
  if (/^nama_psp/.test(k)) return 'Nama file masih "Nama_PSP": ganti dengan nama perusahaan.';
  if (/_posisi$/.test(k)) return 'Nama file masih "Posisi": ganti dengan posisi penilaian (mis. Des2025).';
  if (kind === "mr") {
    const m = /bundling_?(\d)/.exec(k);
    if (!m || !/self_?ases/.test(k)) return `Nama file tidak mengikuti format "<Nama>_LSB_Bundling_${bundling ?? "n"}_Self_Asesmen_M_<Posisi>.xlsx".`;
    if (bundling && Number(m[1]) !== bundling) return `Nama file menyebut Bundling ${m[1]}, padahal PJP Bundling ${bundling}.`;
  } else if (!/self_?ases.*infrastruktur_?ti/.test(k)) return 'Nama file tidak mengikuti format "<Nama>_Self_Asesmen_Infrastruktur_TI_<Posisi>.xlsx".';
  return null;
}

function finish(issues: Issue[], ctx: ValidationContext, what: string): ValidationReport {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  const toPjp = issues.filter((i) => i.severity !== "info");
  const nama = ctx.pjp?.nama ?? "Bapak/Ibu";
  const noteToPjp = toPjp.length
    ? [
        `Yth. ${nama},`,
        "",
        `Berdasarkan pemeriksaan awal atas ${what} yang Saudara sampaikan, terdapat hal-hal berikut yang perlu diperbaiki atau dilengkapi:`,
        "",
        ...toPjp.map((i, n) => `${n + 1}. ${i.message}${i.items?.length ? ` (${list(i.items)})` : ""}`),
        "",
        "Mohon menyampaikan kembali file yang telah diperbaiki melalui formulir yang sama (pengisian ulang formulir dimungkinkan; data yang berlaku adalah penyampaian terakhir).",
        "",
        "Terima kasih.",
      ].join("\n")
    : "";
  return { issues, counts, noteToPjp };
}

/** Submission check for an MR self-assessment. `result` is computed when not given (no BI tables needed). */
export function validateMr(parsed: ParsedMr, def: MrDefinition, ctx: ValidationContext, result?: MrResult): ValidationReport {
  const issues: Issue[] = [];
  const K = def.sheets;
  const cell = (ref: string): CellScalar => parsed.cells[ref] ?? null;
  const id = parsed.identity;

  if (ctx.expectedBundling && parsed.bundling !== ctx.expectedBundling) {
    issues.push({
      code: "template_mismatch",
      severity: "error",
      message: `File yang diunggah adalah template Bundling ${parsed.bundling}, padahal PJP terdaftar/menyatakan Bundling ${ctx.expectedBundling}. Gunakan template Asesmen Mandiri Manajemen Risiko – Bundling ${ctx.expectedBundling}.`,
    });
  }
  const want = ctx.expectedBundling ?? parsed.bundling;
  if (blank(id.bundling) || Number(id.bundling) !== want) {
    issues.push({ code: "d7_mismatch", severity: "error", message: `Bundling Aktivitas (D7) diisi "${String(id.bundling ?? "")}", seharusnya ${want}.` });
  }
  if (typeof id.posisi !== "string" || norm(id.posisi) !== norm(ctx.period.posisi)) {
    issues.push({ code: "posisi_not_full_year", severity: "error", needsCorrection: true, message: `Posisi Penilaian (D9) diisi "${String(id.posisi ?? "")}", seharusnya "${ctx.period.posisi}".` });
  }
  if (Number(id.tahun) !== ctx.period.dataYear) {
    issues.push({ code: "year_mismatch", severity: "error", needsCorrection: true, message: `Tahun laporan (E9) diisi "${String(id.tahun ?? "")}", seharusnya ${ctx.period.dataYear}.` });
  }
  // The blank template is pre-filled (D4 "Bank of America ...", D6, D8, D9, TKMR F = 5 ...): values still equal to it
  // were most likely never entered.
  const defaults = def.pjp.defaults;
  const isDefault = (ref: string) => ref in defaults && !blank(cell(ref)) && String(cell(ref)) === String(defaults[ref]);
  const d4Default = isDefault(`${K.risiko}!D4`);
  if (d4Default) {
    issues.push({ code: "identity_default", severity: "error", message: `Nama PSP (D4) masih bawaan template ("${String(id.namaPsp)}"): pilih nama PSP Saudara dari dropdown.` });
  }
  // D6/D8/D9 still at the template's value: a warning, except where the default is what the period requires
  // (Bundling 3 ships D9 = "1 Januari - 31 Desember" and D8 = "PSP Selain PSP Utama"; Bundling 2 ships the
  // half-year "1 Juli - 31 Desember" and "PSP Utama", which are flagged).
  const fullYear = norm(ctx.period.posisi) === "1 januari - 31 desember";
  const keptIdentity = (["D6", "D8", "D9"] as const).filter((a) => {
    if (!isDefault(`${K.risiko}!${a}`)) return false;
    const v = String(cell(`${K.risiko}!${a}`));
    if (a === "D9" && norm(v) === norm(ctx.period.posisi)) return false;
    if (a === "D8" && fullYear && v === "PSP Selain PSP Utama") return false;
    return true;
  });
  if (keptIdentity.length) {
    const label: Record<string, string> = { D6: "Bentuk Lembaga", D8: "Kategori PSP", D9: "Posisi Penilaian" };
    issues.push({
      code: "identity_default",
      severity: "warning",
      message: `${keptIdentity.map((a) => `${label[a]} (${a})`).join(", ")} masih sama dengan isian bawaan template; pastikan sesuai kondisi PJP.`,
      items: keptIdentity.map((a) => `${a} = ${String(cell(`${K.risiko}!${a}`))}`),
    });
  }

  if (ctx.pjp) {
    const names = [ctx.pjp.nama, ...(ctx.pjp.aliases ?? [])].map(normalizeName);
    if (!d4Default && (typeof id.namaPsp !== "string" || !names.includes(normalizeName(id.namaPsp)))) {
      issues.push({ code: "d4_mismatch", severity: "warning", message: `Nama PSP (D4) dipilih "${String(id.namaPsp ?? "")}", bukan ${ctx.pjp.nama}.` });
    }
    const sandi = normalizeSandi(id.sandi);
    if (sandi && sandi !== ctx.pjp.sandi && !d4Default) {
      issues.push({ code: "d5_mismatch", severity: "warning", message: `Sandi pada file (D5 = ${sandi}) berbeda dengan Sandi PJP ${ctx.pjp.sandi}: data BI akan diambil untuk Sandi ${ctx.pjp.sandi}.` });
    }
  }
  if (ctx.filename) {
    const f = checkFilename(ctx.filename, "mr", ctx.expectedBundling);
    if (f) issues.push({ code: "filename", severity: "warning", message: f });
  }

  const res = result ?? computeMr(def, parsed.cells);
  for (const w of res.warnings) {
    if (w.code === "d8_d9_mismatch") issues.push({ code: "d8_d9_mismatch", severity: "warning", message: w.message });
    if (w.code === "bentuk_remitansi") issues.push({ code: "bentuk_remitansi", severity: "info", message: w.message });
  }

  // Indicator statuses, only where the PJP's own answers are involved (not BI-sourced or pengawas rows).
  const pjpRows = new Set(def.pjpInputRows.rows);
  const status: Record<"Belum Diisi" | "Data Invalid" | "Perlu Cek Data", string[]> = { "Belum Diisi": [], "Data Invalid": [], "Perlu Cek Data": [] };
  for (const ind of def.indicators) {
    if (!ind.oCell || ind.oKind === "pairSecond") continue;
    const pjpInputs = ind.inputs.filter((a) => a.startsWith("H") && pjpRows.has(Number(a.slice(1))));
    if (!pjpInputs.length) continue;
    const o = res.template.cells.get(`${K.risiko}!${ind.oCell}`);
    if (o === "Belum Diisi" && pjpInputs.some((a) => blank(cell(`${K.risiko}!${a}`)))) status["Belum Diisi"].push(ind.id);
    if (o === "Data Invalid") status["Data Invalid"].push(ind.id);
    if (o === "Perlu Cek Data") status["Perlu Cek Data"].push(ind.id);
  }
  if (status["Belum Diisi"].length) issues.push({ code: "belum_diisi", severity: "warning", message: `${status["Belum Diisi"].length} indikator Asesmen Risiko berstatus "Belum Diisi": lengkapi data pada sheet "1 - Asesmen Risiko".`, items: status["Belum Diisi"] });
  if (status["Data Invalid"].length) issues.push({ code: "data_invalid", severity: "warning", message: `${status["Data Invalid"].length} indikator berstatus "Data Invalid" (mis. pembagi 0 atau isian bukan angka).`, items: status["Data Invalid"] });
  if (status["Perlu Cek Data"].length) issues.push({ code: "perlu_cek_data", severity: "warning", message: `${status["Perlu Cek Data"].length} indikator berstatus "Perlu Cek Data".`, items: status["Perlu Cek Data"] });

  const naRows = def.pjpInputRows.rows.filter((r) => isNa(cell(`${K.risiko}!H${r}`)) && blank(cell(`${K.risiko}!I${r}`)));
  if (naRows.length) {
    const ids = new Map(def.pjp.rows.map(([row, dataId]) => [row, dataId]));
    issues.push({ code: "na_without_explanation", severity: "warning", message: `${naRows.length} isian "NA" tanpa penjelasan pada kolom I.`, items: naRows.map((r) => ids.get(r) ?? `baris ${r}`) });
  }

  const invalid: string[] = [];
  const blanks: string[] = [];
  const docs: string[] = [];
  const questions = def.tkmrQuestions;
  questions.forEach((q, i) => {
    const f = cell(`${K.tkmr}!F${q.row}`);
    const label = q.id || `${q.code} baris ${q.row}`;
    if (blank(f)) blanks.push(label);
    else if (!(isNa(f) || (typeof f === "number" && Number.isInteger(f) && f >= 1 && f <= 5) || (typeof f === "string" && /^[1-5]$/.test(f.trim())))) invalid.push(`${label} = "${String(f)}"`);
    const end = (questions[i + 1]?.row ?? q.row + 4) - 1;
    for (let r = q.row; r <= end; r++) if (norm(String(cell(`${K.tkmr}!H${r}`) ?? "")) === "tidak ada") {
      docs.push(label);
      break;
    }
  });
  // TKMR self-scores still the template's values (120 of them are 5): they inflate C64, so this is prominent.
  const selfDefault = questions.filter((q) => isDefault(`${K.tkmr}!F${q.row}`)).map((q) => q.id || `${q.code} baris ${q.row}`);
  if (selfDefault.length) {
    issues.push({
      code: "tkmr_self_default",
      severity: "warning",
      prominent: true,
      message: `Nilai TKMR mandiri sama dengan bawaan template (${selfDefault.length}/${questions.length}): nilai bawaan template adalah 5, sehingga Rating M Asesmen Mandiri (C64) bisa terlalu tinggi. Pastikan setiap nilai benar-benar hasil penilaian PJP.`,
      items: selfDefault,
    });
  }
  let docRefDefault = 0;
  for (const ref of Object.keys(defaults)) if (ref.startsWith(`${K.tkmr}!G`) && isDefault(ref)) docRefDefault++;
  if (docRefDefault) issues.push({ code: "doc_ref_default", severity: "warning", message: `${docRefDefault} No Ref. Dokumen (kolom G sheet TKMR) masih bawaan template: isi dengan nomor dokumen PJP.` });

  if (invalid.length) issues.push({ code: "tkmr_score_invalid", severity: "error", message: `${invalid.length} nilai TKMR (kolom F) di luar 1–5 atau NA.`, items: invalid });
  if (blanks.length) issues.push({ code: "tkmr_score_blank", severity: "warning", message: `${blanks.length} pertanyaan TKMR belum dinilai (kolom F kosong).`, items: blanks });
  if (docs.length) issues.push({ code: "tkmr_doc_missing", severity: "info", message: `${docs.length} pertanyaan TKMR dengan dokumen "Tidak Ada".`, items: docs });

  const perm = Object.values(def.pjp.permodalan).filter((a) => a.startsWith("C") && blank(cell(`${K.permodalan}!${a}`)));
  if (perm.length) issues.push({ code: "permodalan_empty", severity: "warning", message: 'Sheet "3 - Asesmen Permodalan" belum lengkap (KPSP dan laba/rugi 2 tahun terakhir).', items: perm.map((a) => `${K.permodalan}!${a}`) });

  if (parsed.typedFormulas.length) {
    issues.push({ code: "typed_formula", severity: "info", message: `${parsed.typedFormulas.length} sel berisi rumus yang diketik PJP; nilai hasilnya yang dipakai.`, items: parsed.typedFormulas.map((t) => `${t.source}: ${t.formula ?? "(rumus)"} = ${String(t.value)}`) });
  }
  for (const s of parsed.structure) issues.push({ code: "structure", severity: s.code === "missing_sheet" ? "error" : s.code === "row_text_differs" || s.code === "row_id_differs" ? "info" : "warning", message: s.message });

  return finish(issues, ctx, `Asesmen Mandiri Manajemen Risiko – Bundling ${parsed.bundling}`);
}

/** Submission check for an IT self-assessment. */
export function validateIt(
  parsed: ParsedIt,
  def: ItDefinition,
  ctx: ValidationContext,
  applicability?: ItApplicability,
  result?: ItResult,
): ValidationReport {
  const issues: Issue[] = [];
  const res = result ?? computeIt(def, parsed.cells, applicability?.pairs ?? def.defaultApplicable);

  if (applicability?.fallback.used) {
    const why =
      applicability.declaredFrom === "none"
        ? "Belum ada file Manajemen Risiko yang dipakai"
        : applicability.declaredFrom === "inactive_mr"
          ? "File Manajemen Risiko tidak dipakai (template/bundling lain)"
          : null;
    issues.push({
      code: "it_applicability_fallback",
      severity: "warning",
      message: why ? `${why}: sheet TI ditetapkan dari default bundling.` : (applicability.fallback.warning ?? "Sheet TI ditetapkan dari default bundling."),
      items: applicability.pairs,
    });
  }
  // Declared services that switch on no IT sheet: the pengawas decides which sheets apply (config unmappedYa).
  if (applicability?.askPengawas.length) {
    issues.push({
      code: "it_service_unmapped",
      severity: "info",
      message: `${applicability.askPengawas.length} layanan dinyatakan di Asesmen Risiko tetapi tidak dipetakan ke sheet TI mana pun: pengawas menentukan sheet yang berlaku.`,
      items: applicability.askPengawas.map((x) => `${x.id} ${x.label}${typeof x.value === "string" && !/^ya$/i.test(x.value.trim()) ? ` ("${x.value}")` : ""}`),
    });
  }

  // Applicable sheets the PJP left blank, wholly or partly: not dropped from the average silently. The file is
  // "Perlu Perbaikan" and Final waits for a resubmission, pengawas scores (column I) or an override with a note.
  const servicePairs = new Map((applicability?.byPair ?? []).filter((p) => p.reason === "service" && p.applicable).map((p) => [p.pair, p.services]));
  for (const b of res.breakdown) {
    if (!b.selfBlankRows.length) continue;
    const services = servicePairs.get(b.pair);
    if (b.blank && services) {
      issues.push({
        code: "it_service_sheet_blank",
        severity: "warning",
        needsCorrection: true,
        message: `Layanan ${services.map((x) => `"${x.label}"`).join(", ")} dinyatakan YA di Asesmen Risiko, tetapi sheet ${b.sheet} tidak diisi.`,
        items: [b.sheet],
      });
    } else if (b.blank) {
      issues.push({ code: "it_sheet_blank", severity: "warning", needsCorrection: true, message: `Sheet ${b.sheet} berlaku tetapi tidak diisi.`, items: [b.sheet] });
    } else if (b.noSelfScores) {
      continue; // reported below with the all-N/A sheets
    } else {
      issues.push({
        code: "it_sheet_partial",
        severity: "warning",
        needsCorrection: true,
        message: `Sheet ${b.sheet}: ${b.selfBlankRows.length} dari ${b.scorableRows} pertanyaan belum dinilai.`,
        items: b.selfBlankRows.map((r) => `${b.sheet}!${def.columns.self}${r}`),
      });
    }
  }

  // Applicable sheets with not one score (every answer "N/A", maybe some blank): they would drop out of the average.
  for (const b of res.breakdown.filter((x) => x.noSelfScores && !x.blank)) {
    const services = servicePairs.get(b.pair);
    issues.push({
      code: "it_sheet_no_scores",
      severity: "warning",
      needsCorrection: true,
      message: `Sheet ${b.sheet} berlaku${services ? ` (layanan ${services.map((x) => `"${x.label}"`).join(", ")} dinyatakan YA)` : ""}, tetapi seluruh jawabannya N/A atau kosong: tidak ada nilai self-assessment.`,
      items: [b.sheet],
    });
  }

  // Mostly "N/A" (but some scores): no block, a warning. Threshold from the period settings (default 50%).
  const naThreshold = ctx.settings?.itMostlyNaThreshold ?? 0.5;
  for (const b of res.breakdown.filter((x) => !x.noSelfScores && x.scorableRows > 0 && x.selfNaRows / x.scorableRows > naThreshold)) {
    issues.push({
      code: "it_sheet_mostly_na",
      severity: "warning",
      message: `Sheet ${b.sheet}: sebagian besar N/A (${b.selfNaRows}/${b.scorableRows}). Pastikan pertanyaan tersebut memang tidak berlaku bagi PJP.`,
      items: [b.sheet],
    });
  }

  // Sheets the PJP filled that are not applicable, and "declared nothing but filled IT sheets".
  const applicablePairs = new Set(res.applicable);
  const extraPairs = res.asSubmitted.pairs.filter((p) => !applicablePairs.has(p));
  const extraSheets = def.sheets
    .filter((x) => extraPairs.includes(x.pair) && x.rows.some((r) => !r.na && !blank(parsed.cells[`${x.name}!${def.columns.self}${r.row}`])))
    .map((x) => x.name);
  if (extraSheets.length) {
    issues.push({ code: "it_sheet_extra", severity: "info", message: `PJP juga mengisi ${extraSheets.length} sheet yang tidak termasuk sheet berlaku; pengawas dapat menambahkannya bila sesuai.`, items: extraSheets });
  }
  if (applicability?.allTidak) {
    const alwaysPairs = new Set(applicability.byPair.filter((p) => p.reason === "always").map((p) => p.pair));
    const filledBeyond = res.asSubmitted.pairs.filter((p) => !alwaysPairs.has(p));
    if (filledBeyond.length) {
      issues.push({
        code: "it_declared_none_but_filled",
        severity: "warning",
        message: `Semua layanan di Asesmen Risiko (R.OPS.1.a.*) dinyatakan TIDAK${applicability.declaredFrom === "inactive_mr" ? " (pada file MR yang tidak dipakai)" : ""}, tetapi sheet TI ${filledBeyond.join(", ")} diisi: periksa deklarasi layanan atau isian TI.`,
        items: filledBeyond,
      });
    }
  }
  const fmt = (x: number | null) => (x === null ? "–" : x.toFixed(2));
  if (res.asSubmitted.pairs.join() !== res.applicable.join()) {
    issues.push({
      code: "it_as_submitted",
      severity: "info",
      message: `Informasi: nilai self-assessment atas seluruh sheet yang diisi PJP = ${fmt(res.asSubmitted.self.total)} (SM ${fmt(res.asSubmitted.self.sm)}, TK ${fmt(res.asSubmitted.self.tk)}); nilai resmi atas sheet berlaku = ${fmt(res.self.total)}.`,
      items: res.asSubmitted.pairs,
    });
  }

  const bad = res.warnings.filter((w) => w.code === "invalid_score");
  if (bad.length) issues.push({ code: "it_score_invalid", severity: "error", message: `${bad.length} nilai Self Assessment (kolom F) bukan 1–5 atau N/A.`, items: bad.map((w) => w.cell ?? w.message) });
  const missingInfo = (["nama", "alamat", "pic", "kontak"] as const).filter((k) => blank(parsed.info[k]));
  if (missingInfo.length) issues.push({ code: "it_info_empty", severity: "warning", message: 'Sheet "Informasi" belum lengkap (Nama PJP, alamat, nama dan kontak PIC).', items: missingInfo });
  if (ctx.pjp && typeof parsed.info.nama === "string" && normalizeName(parsed.info.nama) && ![ctx.pjp.nama, ...(ctx.pjp.aliases ?? [])].map(normalizeName).includes(normalizeName(parsed.info.nama))) {
    issues.push({ code: "d4_mismatch", severity: "warning", message: `Nama PJP pada sheet Informasi "${parsed.info.nama}" berbeda dengan ${ctx.pjp.nama}.` });
  }
  if (ctx.filename) {
    const f = checkFilename(ctx.filename, "it");
    if (f) issues.push({ code: "filename", severity: "warning", message: f });
  }
  if (parsed.typedFormulas.length) issues.push({ code: "typed_formula", severity: "info", message: `${parsed.typedFormulas.length} sel berisi rumus yang diketik PJP; nilai hasilnya yang dipakai.`, items: parsed.typedFormulas.map((t) => t.source) });
  for (const x of parsed.structure) issues.push({ code: "structure", severity: x.code === "missing_sheet" && !/Infra SP/.test(x.message) ? "error" : "info", message: x.message });
  return finish(issues, ctx, "Asesmen Mandiri Infrastruktur TI");
}
