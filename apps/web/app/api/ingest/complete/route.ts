import { NextResponse } from "next/server";
import { processSubmission } from "@tikmi/ingest";
import { ingestDeps, verifiedJson } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Apps Script, step 3: every file is stored; parse, validate, decide which
 * version is active and apply it. The reply summarises what happened (also
 * visible in the Apps Script execution log).
 */
export async function POST(req: Request) {
  const { body, denied } = await verifiedJson<{ submissionId: string }>(req);
  if (denied) return denied;
  if (!body.submissionId) return NextResponse.json({ error: "submissionId is required" }, { status: 400 });
  try {
    const result = await processSubmission(ingestDeps, body.submissionId);
    if (result.status === "unmatched") return NextResponse.json({ status: "unmatched", message: "Nama PJP belum dikenali: menunggu konfirmasi admin." });
    return NextResponse.json({
      status: "processed",
      assessmentId: result.assessmentId,
      files: result.files.map((f) => ({
        kind: f.kind,
        activated: f.activated,
        notApplied: f.notApplied ?? null,
        excluded: f.decision.excluded,
        acceptance: f.decision.acceptance,
        message: f.decision.message,
        changedCells: f.changedCells,
        koreksiPjpChanged: f.koreksiPjpChanged.length,
      })),
    });
  } catch (err) {
    console.error("ingest/complete failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "processing failed" }, { status: 500 });
  }
}
