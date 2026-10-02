import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  fieldMappings,
  formSubmissions,
  periods,
  pjp as pjpTable,
  recordCellInput,
  workbooks,
} from "@ira/db";
import { sharedCellRefs2026 } from "@ira/scoring/config/2026-input-cells";
import { db } from "@/lib/db";
import { getDevUser } from "@/lib/devUser";

interface IngestBody {
  /** "Sandi - Nama", the live form's dropdown value (build plan's 2027 "PJP picker"). */
  sandiNama: string;
  submittedAt?: string;
  /**
   * Keyed by Apps Script item ID in production (per the build plan, so header
   * text changes don't break ingest). This environment has no access to the
   * live form/Apps Script, so `scripts/seed-dev.ts` seeds `field_mappings`
   * keyed by verified Raw_Data_IRA header text instead -- a stand-in, not the
   * real keying, until that access exists.
   */
  answers: Record<string, unknown>;
}

type TransformedValue = string | number | boolean | null;

const transforms: Record<string, (raw: unknown) => TransformedValue> = {
  number: (raw) => {
    if (typeof raw === "number") return raw;
    if (typeof raw !== "string") return null;
    // Indonesian thousands separator, e.g. "143.901" -> 143901 (build plan: "Number response validation").
    const normalized = raw.trim().replace(/\./g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  },
};

function verifySignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * `onFormSubmit` webhook target (build plan: "Apps Script onFormSubmit on the
 * form posts the response ... signed with a shared secret"). Verifies the
 * HMAC, records the raw submission, and applies whatever `field_mappings`
 * match through the same `recordCellInput` audit path as the pengawas PATCH
 * route and the seed script -- never writes `cell_inputs` directly.
 */
export async function POST(req: Request) {
  const secret = process.env.FORM_INGEST_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "FORM_INGEST_SECRET is not set" }, { status: 500 });
  }

  const rawBody = await req.text();
  if (!verifySignature(rawBody, req.headers.get("x-ira-signature"), secret)) {
    return NextResponse.json({ error: "Invalid or missing signature" }, { status: 401 });
  }

  let body: Partial<IngestBody>;
  try {
    body = JSON.parse(rawBody) as Partial<IngestBody>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sandiNama = body.sandiNama;
  const answers = body.answers;
  if (!sandiNama || !answers) {
    return NextResponse.json({ error: "Missing sandiNama or answers" }, { status: 400 });
  }

  const [sandi] = sandiNama.split(" - ");
  const [pjpRow] = await db.select().from(pjpTable).where(eq(pjpTable.sandi, sandi.trim())).limit(1);
  if (!pjpRow) {
    // Ingest rejects an unmatched PJP loudly rather than silently dropping it (build plan ground rule).
    return NextResponse.json({ error: `No PJP matches sandi "${sandi}"` }, { status: 404 });
  }

  const [activePeriod] = await db.select().from(periods).where(eq(periods.status, "active")).limit(1);
  if (!activePeriod) {
    return NextResponse.json({ error: "No active period" }, { status: 500 });
  }

  await db
    .update(formSubmissions)
    .set({ isLatest: false })
    .where(and(eq(formSubmissions.pjpSandi, pjpRow.sandi), eq(formSubmissions.periodId, activePeriod.id)));

  await db.insert(formSubmissions).values({
    pjpSandi: pjpRow.sandi,
    periodId: activePeriod.id,
    submittedAt: body.submittedAt ? new Date(body.submittedAt) : new Date(),
    rawJsonb: answers,
    isLatest: true,
  });

  let [workbook] = await db
    .select()
    .from(workbooks)
    .where(and(eq(workbooks.pjpSandi, pjpRow.sandi), eq(workbooks.periodId, activePeriod.id)))
    .limit(1);
  if (!workbook) {
    [workbook] = await db
      .insert(workbooks)
      .values({
        pjpSandi: pjpRow.sandi,
        periodId: activePeriod.id,
        templateVersionId: activePeriod.templateVersionId,
        status: "generated",
      })
      .returning();
  }

  const mappings = await db
    .select()
    .from(fieldMappings)
    .where(eq(fieldMappings.templateVersionId, activePeriod.templateVersionId));

  const user = await getDevUser(db);
  let applied = 0;
  for (const mapping of mappings) {
    if (!(mapping.formColumn in answers)) continue;
    const raw = answers[mapping.formColumn];
    const value = mapping.transform ? (transforms[mapping.transform]?.(raw) ?? null) : (raw as TransformedValue);
    if (value === null) continue;

    await recordCellInput(db, {
      workbookId: workbook.id,
      cellRef: mapping.targetCell,
      value,
      source: "form",
      userId: user.id,
      reason: "form ingest",
      shared: sharedCellRefs2026.includes(mapping.targetCell),
    });
    applied++;
  }

  return NextResponse.json({ pjpSandi: pjpRow.sandi, workbookId: workbook.id, mappedCells: applied });
}
