import { NextResponse } from "next/server";
import { storeFile } from "@tikmi/ingest";
import { ingestDeps, verifiedJson } from "@/lib/ingest";

export const runtime = "nodejs";

/** Base64 of a ~3.3 MB file fits Vercel's 4.5 MB request body; larger files use the signed-URL path. */
const MAX_BASE64 = 4_300_000;

/** Apps Script, step 2 (direct mode): one file's bytes, base64. */
export async function POST(req: Request) {
  const { body, denied } = await verifiedJson<{ fileId: string; base64: string }>(req);
  if (denied) return denied;
  if (!body.fileId || typeof body.base64 !== "string") return NextResponse.json({ error: "fileId and base64 are required" }, { status: 400 });
  if (body.base64.length > MAX_BASE64) return NextResponse.json({ error: "File too large for direct upload: use the signed URL" }, { status: 413 });
  try {
    await storeFile(ingestDeps, body.fileId, Buffer.from(body.base64, "base64"));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ingest/file failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "store failed" }, { status: 500 });
  }
}
