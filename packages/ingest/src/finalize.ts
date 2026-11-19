import { eq } from "drizzle-orm";
import { assessmentParts, assessments, cellInputs, submissionFiles, type DbOrTx } from "@tikmi/db";
import type { Definitions } from "@tikmi/parser";
import { computeIt, deriveItApplicability, finalizeBlockers as mrFinalizeBlockers, itApplicability2025, type ItApplicabilityConfig } from "@tikmi/scoring";

export interface FinalBlocker {
  code: "mr_missing" | "it_missing" | "perlu_perbaikan" | "tkmr_pengawas_incomplete" | "it_unscored";
  part?: "mr" | "it";
  message: string;
}

/**
 * Why an assessment cannot be set to Final (empty = it can): each part needs an
 * active file; a "Perlu Perbaikan" file (wrong Posisi/year) blocks until the
 * PJP resubmits or the pengawas accepts that file with a note; and every
 * pengawas TKMR score must be filled (F64 counts blanks as 0); and every
 * scorable row of an applicable IT sheet needs a score, from the PJP (F) or the
 * pengawas (I), checked on the current cells, unless the pengawas accepted the
 * active IT file with a note.
 */
export async function assessmentFinalBlockers(db: DbOrTx, defs: Definitions, assessmentId: string, config: ItApplicabilityConfig = itApplicability2025): Promise<FinalBlocker[]> {
  const [a] = await db.select().from(assessments).where(eq(assessments.id, assessmentId));
  if (!a) throw new Error(`Assessment ${assessmentId} not found`);
  const parts = await db.select().from(assessmentParts).where(eq(assessmentParts.assessmentId, a.id));
  const out: FinalBlocker[] = [];
  for (const kind of ["mr", "it"] as const) {
    const part = parts.find((p) => p.kind === kind);
    const label = kind === "mr" ? "Manajemen Risiko" : "Infrastruktur TI";
    if (!part?.activeFileId) {
      out.push({ code: kind === "mr" ? "mr_missing" : "it_missing", part: kind, message: `Belum ada file ${label} yang dapat dipakai.` });
      continue;
    }
    const [file] = await db.select().from(submissionFiles).where(eq(submissionFiles.id, part.activeFileId));
    const override = part.perbaikanOverride as { fileId?: string } | null;
    const overridden = override?.fileId === file?.id;
    const cells = new Map((await db.select().from(cellInputs).where(eq(cellInputs.partId, part.id))).map((c) => [c.cellRef, c.value]));
    if (kind === "mr") {
      if (file?.acceptance === "perlu_perbaikan" && !overridden) {
        out.push({ code: "perlu_perbaikan", part: kind, message: `File ${label} berstatus Perlu Perbaikan: tunggu penyampaian ulang PJP, atau pengawas menerima file ini dengan catatan.` });
      }
      for (const b of mrFinalizeBlockers(defs.mr[a.bundling as 2 | 3], cells)) out.push({ code: b.code, part: "mr", message: b.message });
      continue;
    }
    // IT: judged on the current cells, so pengawas scores in column I clear it without a resubmission.
    const mrPart = parts.find((p) => p.kind === "mr");
    const mrCells = mrPart?.activeFileId ? new Map((await db.select().from(cellInputs).where(eq(cellInputs.partId, mrPart.id))).map((c) => [c.cellRef, c.value])) : null;
    const applicability = deriveItApplicability(defs.it, config, {
      bundling: a.bundling as 2 | 3,
      mr: mrCells ? { def: defs.mr[a.bundling as 2 | 3], cells: mrCells } : undefined,
      flags: { spbiParticipant: a.spbiParticipant },
      override: (part.applicabilityOverride as { pairs: string[]; note: string } | null) ?? null,
    });
    const unscored = computeIt(defs.it, cells, applicability.pairs).unscored;
    if (unscored.length && !overridden) {
      const parts = unscored.map((u) => (u.reason === "no_scores" ? `${u.sheet}: tidak ada nilai (semua N/A atau kosong)` : `${u.sheet}: ${u.rows.length} pertanyaan kosong`));
      out.push({
        code: "it_unscored",
        part: "it",
        message: `Perlu Perbaikan: sheet TI yang berlaku belum dinilai (${parts.join("; ")}). Tunggu penyampaian ulang PJP, beri Nilai Pengawas, atau terima file ini dengan catatan.`,
      });
    }
  }
  return out;
}
