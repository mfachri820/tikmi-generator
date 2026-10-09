import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import {
  cellInputs,
  fieldMappings,
  formSubmissions,
  periods,
  pjp as pjpTable,
  recordCellInput,
  sharedCellInputs,
  workbooks,
} from "@ira/db";
import { sharedCellRefs2026 } from "@ira/scoring/config/2026-input-cells";
import { db } from "@/lib/db";

const SHARED_CELLS = new Set(sharedCellRefs2026);

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
/** An answer that is there but can't be read: reported back, and the cell is left as it was. */
const INVALID = Symbol("invalid");

const transforms: Record<string, (raw: unknown) => TransformedValue | typeof INVALID> = {
  number: (raw) => {
    if (typeof raw === "number") return raw;
    if (typeof raw !== "string") return INVALID;
    // Indonesian thousands separator, e.g. "143.901" -> 143901 (build plan: "Number response validation").
    const normalized = raw.trim().replace(/\./g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : INVALID;
  },
  /** A KPMR 1-5 scale answer (Forms sends "4"). */
  score: (raw) => {
    const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
    return /^[1-5]$/.test(text) ? Number(text) : INVALID;
  },
  /** A file-upload answer: Forms sends Drive file IDs (an array); stored as links, one per line. */
  drive_link: (raw) => {
    const items = (Array.isArray(raw) ? raw : [raw]).map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
    if (items.length === 0) return INVALID;
    const urls = items.map((v) => (/^https?:\/\//.test(v) ? v : /^[\w-]{10,}$/.test(v) ? `https://drive.google.com/open?id=${v}` : null));
    return urls.every((u) => u !== null) ? urls.join("\n") : INVALID;
  },
};

/** Titles are matched with whitespace collapsed: the form's double/trailing spaces and line breaks don't matter. */
const normalizeKey = (key: string) => key.replace(/\s+/g, " ").trim();

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
 *
 * A PJP that submits more than once is scored on its latest submission (by
 * `submittedAt`): every mapped cell takes that submission's answer, blanks
 * included, except cells a pengawas has edited, which keep the edit. Final
 * and locked workbooks are updated too. An answer that is there but can't be
 * read by its mapping's transform is listed in `invalidAnswers` and leaves the
 * cell unchanged.
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

  const submittedAt = body.submittedAt ? new Date(body.submittedAt) : new Date();
  if (Number.isNaN(submittedAt.getTime())) {
    return NextResponse.json({ error: `Invalid submittedAt "${body.submittedAt}"` }, { status: 400 });
  }

  const [activePeriod] = await db.select().from(periods).where(eq(periods.status, "active")).limit(1);
  if (!activePeriod) {
    return NextResponse.json({ error: "No active period" }, { status: 500 });
  }


  const result = await db.transaction(async (tx) => {
    // One PJP's submissions are handled one at a time, so two arriving together can't interleave their cells.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ingest:${activePeriod.id}:${pjpRow.sandi}`}))`);

    const ofThisPjp = and(eq(formSubmissions.pjpSandi, pjpRow.sandi), eq(formSubmissions.periodId, activePeriod.id));
    const [current] = await tx
      .select({ submittedAt: formSubmissions.submittedAt })
      .from(formSubmissions)
      .where(and(ofThisPjp, eq(formSubmissions.isLatest, true)))
      .limit(1);

    // The latest submission is the one *submitted* last, not the one that arrived last: an Apps Script retry
    // or a backfill can deliver an older response after a newer one. An older one is kept, but changes nothing.
    const isLatest = !current || submittedAt >= current.submittedAt;
    if (isLatest) await tx.update(formSubmissions).set({ isLatest: false }).where(ofThisPjp);
    await tx.insert(formSubmissions).values({
      pjpSandi: pjpRow.sandi,
      periodId: activePeriod.id,
      submittedAt,
      rawJsonb: answers,
      isLatest,
    });
    if (!isLatest) return { latest: false as const };

    let [workbook] = await tx
      .select()
      .from(workbooks)
      .where(and(eq(workbooks.pjpSandi, pjpRow.sandi), eq(workbooks.periodId, activePeriod.id)))
      .limit(1);
    if (!workbook) {
      [workbook] = await tx
        .insert(workbooks)
        .values({
          pjpSandi: pjpRow.sandi,
          periodId: activePeriod.id,
          templateVersionId: activePeriod.templateVersionId,
          status: "generated",
        })
        .returning();
    }

    const mappings = await tx
      .select()
      .from(fieldMappings)
      .where(eq(fieldMappings.templateVersionId, activePeriod.templateVersionId));

    // What each mapped cell holds now, and who put it there.
    const cellsNow = new Map<string, { value: unknown; source: string }>();
    for (const c of await tx.select().from(cellInputs).where(eq(cellInputs.workbookId, workbook.id))) {
      if (!SHARED_CELLS.has(c.cellRef)) cellsNow.set(c.cellRef, c);
    }
    for (const c of await tx.select().from(sharedCellInputs).where(eq(sharedCellInputs.periodId, activePeriod.id))) {
      if (SHARED_CELLS.has(c.cellRef)) cellsNow.set(c.cellRef, c);
    }

    const answerByKey = new Map(Object.entries(answers).map(([key, value]) => [normalizeKey(key), value]));
    let applied = 0;
    let cleared = 0;
    const keptPengawasEdits: string[] = [];
    const invalidAnswers: { question: string; cellRef: string; answer: unknown }[] = [];
    for (const mapping of mappings) {
      // A question left blank (or absent) in the latest submission is blank, not "keep the previous answer";
      // otherwise a workbook would mix two submissions.
      const raw = answerByKey.get(normalizeKey(mapping.formColumn));
      const blank = raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0);
      const transformed = blank
        ? null
        : mapping.transform
          ? (transforms[mapping.transform]?.(raw) ?? INVALID)
          : (raw as TransformedValue);
      // An answer that's there but unreadable (e.g. "lima" for a 1-5 score) is reported, not written as blank.
      if (transformed === INVALID) {
        invalidAnswers.push({ question: mapping.formColumn, cellRef: mapping.targetCell, answer: raw });
        continue;
      }
      const value = transformed;
      const existing = cellsNow.get(mapping.targetCell);

      // A pengawas's correction outlives resubmissions; the new answer is still in form_submissions.
      if (existing?.source === "pengawas") {
        if (JSON.stringify(existing.value ?? null) !== JSON.stringify(value)) keptPengawasEdits.push(mapping.targetCell);
        continue;
      }
      if (JSON.stringify(existing?.value ?? null) === JSON.stringify(value)) continue;

      await recordCellInput(tx, {
        workbookId: workbook.id,
        cellRef: mapping.targetCell,
        value,
        source: "form",
        // No signed-in user: the change comes from the PJP's form (the audit log shows it as such).
        userId: null,
        reason: value === null ? "form ingest: blank in latest submission" : "form ingest",
        shared: SHARED_CELLS.has(mapping.targetCell),
      });
      if (value === null) cleared++;
      else applied++;
    }

    return {
      latest: true as const,
      workbookId: workbook.id,
      mappedCells: applied,
      clearedCells: cleared,
      keptPengawasEdits,
      invalidAnswers,
    };
  });

  return NextResponse.json({ pjpSandi: pjpRow.sandi, ...result });
}
