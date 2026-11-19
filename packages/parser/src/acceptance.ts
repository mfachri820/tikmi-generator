import { UnrecognisedTemplateError, type ParsedSubmission } from "./parse";
import type { Issue, ValidationReport } from "./validate";
import { XlsxReadError } from "./xlsx";

/**
 * What happens to an uploaded file. Two separate questions:
 *
 * - Can it become the active version? Only not when it is not a TIKMI file
 *   (or not readable), is the other kind (IT in the MR slot), or is the other
 *   bundling's MR template. Then the previous valid version stays active.
 * - Is it acceptable? A file with the wrong Posisi (D9) or year (E9) is used,
 *   but is "Perlu Perbaikan": Final is blocked until the PJP resubmits or the
 *   pengawas overrides with a note.
 */
export type Exclusion = "unreadable" | "not_tikmi" | "wrong_kind" | "wrong_bundling";
export type Acceptance = "ok" | "perlu_perbaikan";

export interface FileDecision {
  activatable: boolean;
  excluded: Exclusion | null;
  acceptance: Acceptance | null;
  /** The issues that make it "Perlu Perbaikan". */
  corrections: Issue[];
  /** Bahasa Indonesia, for the PJP page. */
  message: string;
}

const EXCLUSION_TEXT: Record<Exclusion, string> = {
  unreadable: "File tidak dapat dibaca sebagai .xlsx",
  not_tikmi: "File bukan template TIKMI",
  wrong_kind: "File diunggah pada kolom yang salah (MR/IT tertukar)",
  wrong_bundling: "File adalah template bundling lain",
};

export function decideFile(input: {
  expectedKind: "mr" | "it";
  /** The PJP's bundling (master, after any pengawas reassignment). */
  expectedBundling?: 2 | 3;
  parsed?: ParsedSubmission;
  /** The parse error, when parsing failed. */
  error?: unknown;
  report?: ValidationReport;
}): FileDecision {
  const exclude = (excluded: Exclusion, detail = ""): FileDecision => ({
    activatable: false,
    excluded,
    acceptance: null,
    corrections: [],
    message: `${EXCLUSION_TEXT[excluded]}${detail}; tidak dipakai, versi sebelumnya (bila ada) tetap aktif.`,
  });
  if (!input.parsed) {
    if (input.error instanceof UnrecognisedTemplateError) return exclude("not_tikmi");
    if (input.error instanceof XlsxReadError) return exclude("unreadable");
    return exclude("unreadable", input.error instanceof Error ? ` (${input.error.message})` : "");
  }
  const p = input.parsed;
  if (p.kind !== input.expectedKind) return exclude("wrong_kind", ` (berisi ${p.kind === "mr" ? "Manajemen Risiko" : "Infrastruktur TI"})`);
  if (p.kind === "mr" && input.expectedBundling && p.bundling !== input.expectedBundling) {
    return exclude("wrong_bundling", ` (Bundling ${p.bundling}, PJP terdaftar Bundling ${input.expectedBundling}; pengawas dapat mengubah bundling PJP setelah memeriksa izinnya)`);
  }
  const corrections = (input.report?.issues ?? []).filter((i) => i.needsCorrection);
  return {
    activatable: true,
    excluded: null,
    acceptance: corrections.length ? "perlu_perbaikan" : "ok",
    corrections,
    message: corrections.length ? `Dipakai, tetapi Perlu Perbaikan: ${corrections.map((c) => c.message).join(" ")}` : "Dipakai.",
  };
}
