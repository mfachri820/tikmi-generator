import type { ParameterConfig, ParameterRule } from "@ira/scoring";
import { parameterShareRefs } from "@ira/scoring/config/2026";

/**
 * "Kenapa nilainya 4?" for each A2 parameter: the C2 values its formula reads,
 * their total, the scoring bands, and the score the PJP's data lands on. Built
 * on the server from the same config the scoring engine uses.
 */

export interface ParameterExplanation {
  /** A2 row of the parameter. */
  row: number;
  manual: boolean;
  /** The C2 cells the formula reads ("D10", "C132"), with their values. Shares (D) are fractions. */
  sources: { cell: string; value: number; isShare: boolean }[];
  /** What the bands compare: the sum of the sources. */
  total: number;
  totalIsShare: boolean;
  bands: { text: string; score: number }[];
  pjpScore: number;
  pengawasScore: number;
  /** A known template defect for this parameter, in plain words. */
  note?: string;
}

/** Template quirks that make a parameter ignore the PJP's data (see DATA-PIPELINE.md §7). */
const KNOWN_ISSUES: Record<string, string> = {
  "52": "Rumus templat membaca C2!D139, yang tidak pernah terisi; jawaban PJP ada di C139. Nilai PJP selalu 5.",
  "53": "Rumus templat membaca C2!D140:D141, yang tidak pernah terisi; jawaban PJP ada di C140:C141. Nilai PJP selalu 5.",
  "57": "Rumus templat membaca C2!D145, yang tidak pernah terisi; jawaban PJP ada di C145. Nilai PJP selalu 5.",
  "45": "Rumus templat menjumlahkan persentase D35 + D49 dengan jumlah PEP mentah (C58), jadi satu PEP saja sudah membuat nilainya 1.",
};

const pct = (x: number) => `${(x * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
const num = (x: number) => x.toLocaleString("id-ID", { maximumFractionDigits: 2 });

function bandsFor(rule: ParameterRule, asShare: boolean): { text: string; score: number }[] {
  if (rule.kind === "maxShare") {
    const t = rule.thresholds;
    // A count rule ("more than 1 line of business", open-ended last band) reads as plain numbers, not percentages.
    const f = asShare && t.every((band) => Number.isFinite(band.maxShare)) ? pct : num;
    return t.map((band, i) => {
      if (i === t.length - 1 && i > 0) return { text: `> ${f(t[i - 1].maxShare)}`, score: band.score };
      if (band.maxShare === 0) return { text: f === pct ? "0% / tidak ada" : "0", score: band.score };
      return { text: `≤ ${f(band.maxShare)}`, score: band.score };
    });
  }
  const f = asShare ? pct : num;
  const b = rule.breakpoints;
  return b.map((band, i) => {
    const next = b[i + 1];
    if (!next) return { text: `≥ ${f(band.minShare)}`, score: band.score };
    if (i === 0) return { text: `< ${f(next.minShare)}`, score: band.score };
    return { text: `${f(band.minShare)} – < ${f(next.minShare)}`, score: band.score };
  });
}

export function explainParameters(
  config: ParameterConfig[],
  c2Values: Record<string, number>,
  resolved: { id: string; pjpValue: number; pengawasValue: number }[],
): ParameterExplanation[] {
  const byId = new Map(resolved.map((p) => [p.id, p]));
  return config.map((p) => {
    const refs = parameterShareRefs[p.id] ?? [];
    const sources = refs.map((cell) => ({ cell, value: c2Values[cell] ?? 0, isShare: cell.startsWith("D") }));
    const total = sources.reduce((sum, s) => sum + s.value, 0);
    const totalIsShare = sources.length > 0 && sources.every((s) => s.isShare);
    const r = byId.get(p.id);
    return {
      row: Number(p.id),
      manual: p.kind === "manual",
      sources,
      total,
      totalIsShare,
      bands: p.kind === "form" ? bandsFor(p.rule, totalIsShare) : [],
      pjpScore: r?.pjpValue ?? 5,
      pengawasScore: r?.pengawasValue ?? 5,
      note: KNOWN_ISSUES[p.id],
    };
  });
}
