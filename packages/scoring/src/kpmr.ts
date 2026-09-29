import type { KpmrAnswerInput, KpmrQuestionConfig } from "./types.js";

export interface ResolvedKpmrAnswer {
  id: string;
  pillar: string;
  cellRef: string;
  pengawasCellRef: string;
  pjpScore?: number;
  pengawasScore?: number;
  isOverride: boolean;
}

export function resolveKpmrAnswers(
  questions: KpmrQuestionConfig[],
  answers: KpmrAnswerInput[],
): ResolvedKpmrAnswer[] {
  const byId = new Map(answers.map((a) => [a.id, a]));
  return questions.map((q) => {
    const answer = byId.get(q.id);
    const pjpScore = answer?.pjpScore;
    const pengawasScore = answer?.pengawasScore ?? pjpScore;
    return {
      id: q.id,
      pillar: q.pillar,
      cellRef: q.cellRef,
      pengawasCellRef: q.pengawasCellRef,
      pjpScore,
      pengawasScore,
      isOverride: pengawasScore !== pjpScore,
    };
  });
}

/** Average of each pillar's answered (non-n/a) questions. */
export function pillarAverages(
  resolved: ResolvedKpmrAnswer[],
  pick: (a: ResolvedKpmrAnswer) => number | undefined,
): Record<string, number> {
  const byPillar = new Map<string, number[]>();
  for (const a of resolved) {
    const value = pick(a);
    if (value === undefined) continue;
    if (!byPillar.has(a.pillar)) byPillar.set(a.pillar, []);
    byPillar.get(a.pillar)!.push(value);
  }
  const result: Record<string, number> = {};
  for (const [pillar, values] of byPillar) {
    result[pillar] = values.reduce((sum, v) => sum + v, 0) / values.length;
  }
  return result;
}

/** KPMR overall score: the average of the 5 pillar averages. */
export function overallFromPillarAverages(averages: Record<string, number>): number {
  const values = Object.values(averages);
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
