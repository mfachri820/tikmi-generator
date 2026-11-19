import { NextResponse } from "next/server";
import { registerSubmission, type RegisterInput } from "@tikmi/ingest";
import { db } from "@/lib/db";
import { signedUploadUrl } from "@/lib/fileStorage";
import { verifiedJson } from "@/lib/ingest";

export const runtime = "nodejs";

/**
 * Apps Script, step 1: a form response (or an edited one: same responseId, new
 * version). Returns where to send each file: a one-time signed URL into the
 * private bucket (`mode: "signed"`, PUT the bytes there), or `mode: "direct"`
 * (POST the file to /api/ingest/file) when storage is not configured or the
 * caller asks for it for a small file.
 */
export async function POST(req: Request) {
  const { body, denied } = await verifiedJson<RegisterInput & { preferDirect?: boolean }>(req);
  if (denied) return denied;
  if (!body.responseId || !body.pjpName || !Array.isArray(body.files)) {
    return NextResponse.json({ error: "responseId, pjpName and files are required" }, { status: 400 });
  }
  try {
    const reg = await registerSubmission(db, body);
    const files = [];
    for (const f of reg.files) {
      const signed = body.preferDirect ? null : await signedUploadUrl(f.storageKey);
      files.push(signed ? { fileId: f.fileId, kind: f.kind, mode: "signed", uploadUrl: signed.url } : { fileId: f.fileId, kind: f.kind, mode: "direct" });
    }
    return NextResponse.json({ submissionId: reg.submissionId, version: reg.version, pjpSandi: reg.pjpSandi, match: reg.match, files });
  } catch (err) {
    console.error("ingest/start failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "ingest failed" }, { status: 500 });
  }
}
