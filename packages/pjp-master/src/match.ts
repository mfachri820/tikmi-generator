import { compactName, formerName, normalizeName, similarity } from "./normalize";

export interface PjpCandidate {
  sandi: string;
  nama: string;
  /** Other known spellings (aliases already confirmed). */
  aliases?: string[];
}

export type MatchResult =
  /** Normalised name (or a confirmed alias, or the d/h former name) equals a PJP's: safe to use automatically. */
  | { kind: "auto"; sandi: string; score: 1; via: "name" | "alias" | "compact" | "former_name" }
  /** Close enough to propose; an admin confirms with one click. */
  | { kind: "suggested"; sandi: string; score: number; runnerUp?: { sandi: string; score: number } }
  /** Nothing close: an admin picks a PJP or enters the missing Sandi. */
  | { kind: "unmatched"; best?: { sandi: string; score: number } };

/** At or above: proposed for confirmation. Below: unmatched. Never automatic. */
export const SUGGEST_THRESHOLD = 0.8;
/** A suggestion whose runner-up is this close is still only a suggestion, and the UI shows both. */
export const AMBIGUOUS_GAP = 0.05;

export interface PjpIndex {
  match(name: string): MatchResult;
}

/**
 * Builds the matcher over the PJP master. Two PJPs with the same normalised
 * name make that name ambiguous: it is never matched automatically.
 */
export function buildPjpIndex(candidates: PjpCandidate[]): PjpIndex {
  const exact = new Map<string, Set<string>>();
  const compact = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, sandi: string) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(sandi);
  };
  const normalized = candidates.map((c) => ({ sandi: c.sandi, key: normalizeName(c.nama) }));
  for (const c of candidates) {
    for (const name of [c.nama, ...(c.aliases ?? [])]) {
      add(exact, normalizeName(name), c.sandi);
      add(compact, compactName(name), c.sandi);
    }
  }
  const uniqueIn = (map: Map<string, Set<string>>, key: string) => {
    const s = map.get(key);
    return s && s.size === 1 ? [...s][0] : null;
  };
  const unique = (key: string) => uniqueIn(exact, key);

  return {
    match(name) {
      const key = normalizeName(name);
      const direct = unique(key);
      if (direct) {
        const viaName = normalized.some((n) => n.sandi === direct && n.key === key);
        return { kind: "auto", sandi: direct, score: 1, via: viaName ? "name" : "alias" };
      }
      const viaCompact = exact.has(key) ? null : uniqueIn(compact, compactName(name));
      if (viaCompact) return { kind: "auto", sandi: viaCompact, score: 1, via: "compact" };
      const former = formerName(name);
      const viaFormer = former && !exact.has(key) ? unique(former) : null;
      if (viaFormer) return { kind: "auto", sandi: viaFormer, score: 1, via: "former_name" };

      // Best score per PJP (a PJP can appear more than once in Lamp. PJP).
      const best = new Map<string, number>();
      for (const n of normalized) {
        const s = similarity(key, n.key);
        if (s > (best.get(n.sandi) ?? 0)) best.set(n.sandi, s);
      }
      const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
      const [top, second] = ranked;
      if (!top) return { kind: "unmatched" };
      if (top[1] < SUGGEST_THRESHOLD) return { kind: "unmatched", best: { sandi: top[0], score: top[1] } };
      return {
        kind: "suggested",
        sandi: top[0],
        score: top[1],
        runnerUp: second && top[1] - second[1] < AMBIGUOUS_GAP ? { sandi: second[0], score: second[1] } : undefined,
      };
    },
  };
}
