import { eq } from "drizzle-orm";
import { pjp, pjpAliases, type DbOrTx } from "@tikmi/db";
import { buildPjpIndex, normalizeName } from "@tikmi/pjp-master";

export interface PjpMatch {
  sandi: string | null;
  aliasId: string;
  status: "auto" | "confirmed" | "suggested" | "unmatched" | "rejected";
  suggestedSandi: string | null;
}

/**
 * The PJP a form answer names. A known spelling (alias already decided) is used
 * as is; otherwise the name is matched against the PJP master: a normalised
 * match is automatic, a fuzzy one becomes a suggestion for one-click
 * confirmation, anything else waits in the review queue. The spelling is
 * stored either way, so the next submission with it resolves at once.
 */
export async function matchPjp(db: DbOrTx, name: string, source: "form_list" | "form_other"): Promise<PjpMatch> {
  const normalized = normalizeName(name);
  const [known] = await db.select().from(pjpAliases).where(eq(pjpAliases.normalized, normalized));
  if (known && (known.status === "auto" || known.status === "confirmed" || known.decidedBy)) {
    return { sandi: known.sandi, aliasId: known.id, status: known.status, suggestedSandi: known.suggestedSandi };
  }
  const master = await db.select({ sandi: pjp.sandi, nama: pjp.nama }).from(pjp);
  const aliases = await db.select({ sandi: pjpAliases.sandi, alias: pjpAliases.alias }).from(pjpAliases);
  const bySandi = new Map<string, string[]>();
  for (const a of aliases) if (a.sandi) bySandi.set(a.sandi, [...(bySandi.get(a.sandi) ?? []), a.alias]);
  const m = buildPjpIndex(master.map((p) => ({ sandi: p.sandi, nama: p.nama, aliases: bySandi.get(p.sandi) })) ).match(name);
  const status = m.kind;
  const values = {
    alias: name,
    normalized,
    sandi: m.kind === "auto" ? m.sandi : null,
    suggestedSandi: m.kind === "suggested" ? m.sandi : null,
    score: m.kind === "unmatched" ? (m.best?.score ?? null) : m.score,
    status,
    source,
  } as const;
  const [row] = await db
    .insert(pjpAliases)
    .values(values)
    .onConflictDoUpdate({ target: pjpAliases.normalized, set: { sandi: values.sandi, suggestedSandi: values.suggestedSandi, score: values.score, status: values.status } })
    .returning();
  return { sandi: row.sandi, aliasId: row.id, status: row.status, suggestedSandi: row.suggestedSandi };
}
