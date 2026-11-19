"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { assessments, pjp } from "@tikmi/db";
import { processSubmission, registerManualUpload, storeFile } from "@tikmi/ingest";
import { can, getCurrentUser } from "@/lib/auth";
import { activePeriod } from "@/lib/assessmentView";
import { db } from "@/lib/db";
import { ingestDeps } from "@/lib/ingest";

export interface UploadState {
  error?: string;
  /** One line per file: what happened to it. */
  results?: { kind: "mr" | "it"; name: string; message: string; activated: boolean }[];
}

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * "Unggah file PSP": a pengawas/admin uploads the PJP's MR and/or IT workbook.
 * Same path as a form response (parse, validate, version, activate), recorded
 * as source "manual" with the uploader.
 */
export async function uploadPsp(sandi: string, _prev: UploadState, form: FormData): Promise<UploadState> {
  const me = await getCurrentUser();
  if (!me) return { error: "Sesi berakhir. Silakan masuk kembali." };
  const period = await activePeriod(db);
  if (!period) return { error: "Belum ada periode aktif." };
  const [p] = await db.select().from(pjp).where(eq(pjp.sandi, sandi));
  if (!p) return { error: "PJP tidak ditemukan." };
  const [a] = await db.select({ pengawasId: assessments.pengawasId, status: assessments.status }).from(assessments).where(and(eq(assessments.periodId, period.id), eq(assessments.pjpSandi, sandi)));
  if (!can.workOn(me, a?.pengawasId ?? p.defaultPengawasId)) return { error: "Hanya pengawas PJP ini, koordinator, atau admin yang dapat mengunggah file." };
  if (a?.status === "final") return { error: "Asesmen sudah Final: buka kembali terlebih dahulu." };

  const files: { kind: "mr" | "it"; file: File }[] = [];
  for (const kind of ["mr", "it"] as const) {
    const f = form.get(kind);
    if (f instanceof File && f.size > 0) {
      if (!/\.xlsx$/i.test(f.name)) return { error: `${f.name}: hanya file .xlsx.` };
      if (f.size > MAX_BYTES) return { error: `${f.name}: lebih dari 4 MB.` };
      files.push({ kind, file: f });
    }
  }
  if (!files.length) return { error: "Pilih file MR dan/atau TI." };

  try {
    const reg = await registerManualUpload(db, { sandi, userId: me.id, files: files.map((f) => ({ kind: f.kind, name: f.file.name, size: f.file.size })) });
    for (const r of reg.files) {
      const f = files.find((x) => x.kind === r.kind)!;
      await storeFile(ingestDeps, r.fileId, Buffer.from(await f.file.arrayBuffer()));
    }
    const result = await processSubmission(ingestDeps, reg.submissionId);
    revalidatePath(`/pjp/${sandi}`);
    revalidatePath("/pjp");
    if (result.status !== "processed") return { error: "File tersimpan, tetapi PJP belum dikenali." };
    return {
      results: result.files.map((o) => ({
        kind: o.kind,
        name: files.find((f) => f.kind === o.kind)?.file.name ?? "",
        activated: o.activated,
        message: o.activated
          ? o.decision.message
          : o.notApplied === "older"
            ? "Tidak dipakai: lebih lama dari versi aktif."
            : o.notApplied === "pinned"
              ? "Tidak dipakai: pengawas memilih versi lain."
              : o.notApplied === "final"
                ? "Tidak dipakai: asesmen Final."
                : o.decision.message,
      })),
    };
  } catch (err) {
    console.error("manual upload failed", err);
    return { error: err instanceof Error ? err.message : "Unggah gagal." };
  }
}
