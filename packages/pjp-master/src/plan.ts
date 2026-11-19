import { buildPjpIndex, type MatchResult } from "./match";
import { normalizeName } from "./normalize";
import type { LampPjpRow } from "./sources";

export interface PlannedPjp {
  sandi: string;
  nama: string;
  kategoriLamp: string | null;
  /** The form's spelling, when this PJP was matched automatically from the form list. */
  formName: string | null;
  supervised: boolean;
  sortOrder: number | null;
}

export interface PlannedAlias {
  alias: string;
  normalized: string;
  status: "auto" | "suggested" | "unmatched";
  sandi: string | null;
  suggestedSandi: string | null;
  score: number | null;
  source: "lamp_pjp" | "form_list";
  /** Position in the form's dropdown (1-based), for form names. */
  formOrder?: number;
}

export interface PjpMasterPlan {
  pjp: PlannedPjp[];
  aliases: PlannedAlias[];
  stats: {
    lampRows: number;
    lampPjp: number;
    formNames: number;
    /** Form name equals a Lamp name character for character. */
    exact: number;
    /** Equal after normalisation (includes `exact`). */
    normalized: number;
    suggested: number;
    unmatched: number;
  };
  /** Same Sandi listed under different names in Lamp. PJP (kept as aliases). */
  sandiWithSeveralNames: { sandi: string; names: string[] }[];
  /** Normalised names shared by two Sandi in Lamp. PJP: never matched automatically. */
  ambiguousNames: { normalized: string; sandi: string[] }[];
}

/**
 * What the PJP master and alias table should hold, from `Lamp. PJP` and the
 * form's dropdown. Pure: the seed script writes it, tests check it.
 *
 * - Every Lamp. PJP Sandi becomes a PJP (first name listed wins as `nama`; other
 *   names become aliases).
 * - A form name that matches automatically marks its PJP `supervised` and is
 *   stored as an `auto` alias.
 * - Fuzzy matches are stored as `suggested` (one-click confirmation), the rest
 *   as `unmatched` (admin picks a PJP or enters the missing Sandi).
 */
export function planPjpMaster(lamp: LampPjpRow[], formNames: string[]): PjpMasterPlan {
  const bySandi = new Map<string, { nama: string; kategori: string | null; names: Set<string> }>();
  for (const r of lamp) {
    const e = bySandi.get(r.sandi);
    if (e) e.names.add(r.nama);
    else bySandi.set(r.sandi, { nama: r.nama, kategori: r.kategori, names: new Set([r.nama]) });
  }

  const byNorm = new Map<string, Set<string>>();
  for (const r of lamp) {
    const k = normalizeName(r.nama);
    if (!byNorm.has(k)) byNorm.set(k, new Set());
    byNorm.get(k)!.add(r.sandi);
  }

  const index = buildPjpIndex([...bySandi.entries()].map(([sandi, e]) => ({ sandi, nama: e.nama, aliases: [...e.names] })));
  const lampNames = new Set(lamp.map((r) => r.nama.trim()));

  const pjp = new Map<string, PlannedPjp>(
    [...bySandi.entries()].map(([sandi, e]) => [
      sandi,
      { sandi, nama: e.nama, kategoriLamp: e.kategori, formName: null, supervised: false, sortOrder: null },
    ]),
  );

  const aliases = new Map<string, PlannedAlias>();
  for (const [sandi, e] of bySandi) {
    for (const name of e.names) {
      const normalized = normalizeName(name);
      if (aliases.has(normalized)) continue;
      const ambiguous = (byNorm.get(normalized)?.size ?? 0) > 1;
      aliases.set(normalized, {
        alias: name,
        normalized,
        status: ambiguous ? "unmatched" : "auto",
        sandi: ambiguous ? null : sandi,
        suggestedSandi: null,
        score: ambiguous ? null : 1,
        source: "lamp_pjp",
      });
    }
  }

  const stats = { lampRows: lamp.length, lampPjp: bySandi.size, formNames: formNames.length, exact: 0, normalized: 0, suggested: 0, unmatched: 0 };
  formNames.forEach((name, i) => {
    if (lampNames.has(name.trim())) stats.exact++;
    const m: MatchResult = index.match(name);
    const normalized = normalizeName(name);
    if (m.kind === "auto") {
      stats.normalized++;
      const p = pjp.get(m.sandi)!;
      p.supervised = true;
      p.formName = name;
      p.sortOrder = i + 1;
    } else if (m.kind === "suggested") stats.suggested++;
    else stats.unmatched++;
    // A form spelling replaces a Lamp spelling with the same key: the form name is what ingest will see.
    aliases.set(normalized, {
      alias: name,
      normalized,
      status: m.kind,
      sandi: m.kind === "auto" ? m.sandi : null,
      suggestedSandi: m.kind === "suggested" ? m.sandi : null,
      score: m.kind === "unmatched" ? (m.best?.score ?? null) : m.score,
      source: "form_list",
      formOrder: i + 1,
    });
  });

  return {
    pjp: [...pjp.values()],
    aliases: [...aliases.values()],
    stats,
    sandiWithSeveralNames: [...bySandi.entries()].filter(([, e]) => e.names.size > 1).map(([sandi, e]) => ({ sandi, names: [...e.names] })),
    ambiguousNames: [...byNorm.entries()].filter(([, s]) => s.size > 1).map(([normalized, s]) => ({ normalized, sandi: [...s] })),
  };
}
