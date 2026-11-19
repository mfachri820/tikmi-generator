import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { IngestDeps } from "@tikmi/ingest";
import { definitions2025 } from "@tikmi/parser";
import { itApplicability2025 } from "@tikmi/scoring";
import { db } from "@/lib/db";
import { fileStore } from "@/lib/fileStorage";

export const ingestDeps: IngestDeps = {
  db,
  store: fileStore,
  defs: definitions2025,
  applicability: itApplicability2025,
};

/** A request older (or newer) than this is refused, so a captured request cannot be replayed later. */
const MAX_SKEW_MS = 10 * 60 * 1000;

/**
 * Apps Script -> app authentication: header `x-tikmi-timestamp` (ms since
 * epoch) and `x-tikmi-signature` = hex HMAC-SHA256 of `${timestamp}.${body}`,
 * keyed by FORM_INGEST_SECRET. Returns the parsed JSON body, or the error
 * response to send.
 */
export async function verifiedJson<T>(req: Request): Promise<{ body: T; denied?: never } | { body?: never; denied: NextResponse }> {
  const secret = process.env.FORM_INGEST_SECRET;
  if (!secret) return { denied: NextResponse.json({ error: "FORM_INGEST_SECRET is not set" }, { status: 500 }) };
  const raw = await req.text();
  const ts = req.headers.get("x-tikmi-timestamp") ?? "";
  const sig = req.headers.get("x-tikmi-signature") ?? "";
  const when = Number(ts);
  if (!Number.isFinite(when) || Math.abs(Date.now() - when) > MAX_SKEW_MS) {
    return { denied: NextResponse.json({ error: "Missing or stale x-tikmi-timestamp" }, { status: 401 }) };
  }
  const expected = Buffer.from(createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex"), "utf8");
  const actual = Buffer.from(sig, "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { denied: NextResponse.json({ error: "Invalid signature" }, { status: 401 }) };
  }
  try {
    return { body: JSON.parse(raw) as T };
  } catch {
    return { denied: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
}
