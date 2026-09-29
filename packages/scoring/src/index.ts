import { combineCategories, computeCategoryScores } from "./categoryScore.js";
import { finalIraScore } from "./finalIra.js";
import { overallFromPillarAverages, pillarAverages, resolveKpmrAnswers } from "./kpmr.js";
import { resolveParameter, type ResolvedParameter } from "./parameterScore.js";
import { predikatFromScore } from "./predikat.js";
import type { ScoringConfig, WorkbookScoringInput } from "./types.js";

export * from "./types.js";
export { computeShare } from "./shares.js";
export { resolveParameter, scoreFromShare } from "./parameterScore.js";
export { computeCategoryScores, combineCategories } from "./categoryScore.js";
export { predikatFromScore } from "./predikat.js";
export {
  resolveKpmrAnswers,
  pillarAverages,
  overallFromPillarAverages,
  type ResolvedKpmrAnswer,
} from "./kpmr.js";
export { finalIraScore } from "./finalIra.js";

export interface WorkbookScoringResult {
  parameters: ResolvedParameter[];
  categoryScores: ReturnType<typeof computeCategoryScores>;
  inherentScore: { pjp: number; pengawas: number };
  inherentPredikat: { pjp: string; pengawas: string };
  kpmrPillarAverages: { pjp: Record<string, number>; pengawas: Record<string, number> };
  kpmrOverall: { pjp: number; pengawas: number };
  kpmrPredikat: { pjp: string; pengawas: string };
  finalIra: { pjp: number; pengawas: number };
}

/**
 * Runs the full IRA pipeline: parameter shares -> category scores -> inherent
 * predikat, plus KPMR pillar averages -> KPMR predikat, then looks up the final
 * IRA score. Mirrors "How the final score is built" in the build plan, but every
 * number that drives it comes from `config`, never from this file.
 */
export function computeWorkbookScores(
  config: ScoringConfig,
  input: WorkbookScoringInput,
): WorkbookScoringResult {
  const inputById = new Map(input.parameters.map((p) => [p.id, p]));
  const resolvedParameters = config.parameters.map((p) =>
    resolveParameter(p, inputById.get(p.id)),
  );

  const categories = Object.keys(config.categoryWeights);
  const categoryScores = computeCategoryScores(resolvedParameters, categories);

  const inherentScore = {
    pjp: combineCategories(categoryScores.pjp, config.categoryWeights),
    pengawas: combineCategories(categoryScores.pengawas, config.categoryWeights),
  };
  const inherentPredikat = {
    pjp: predikatFromScore(inherentScore.pjp, config.inherentPredikatRules),
    pengawas: predikatFromScore(inherentScore.pengawas, config.inherentPredikatRules),
  };

  const resolvedKpmr = resolveKpmrAnswers(config.kpmrQuestions, input.kpmrAnswers);
  const kpmrPillarAverages = {
    pjp: pillarAverages(resolvedKpmr, (a) => a.pjpScore),
    pengawas: pillarAverages(resolvedKpmr, (a) => a.pengawasScore),
  };
  const kpmrOverall = {
    pjp: overallFromPillarAverages(kpmrPillarAverages.pjp),
    pengawas: overallFromPillarAverages(kpmrPillarAverages.pengawas),
  };
  const kpmrPredikat = {
    pjp: predikatFromScore(kpmrOverall.pjp, config.kpmrPredikatRules),
    pengawas: predikatFromScore(kpmrOverall.pengawas, config.kpmrPredikatRules),
  };

  const finalIra = {
    pjp: finalIraScore(
      inherentPredikat.pjp,
      kpmrPredikat.pjp,
      config.finalIraMatrix,
      input.hasDataMismatch,
      config.dataMismatchPenalty,
    ),
    pengawas: finalIraScore(
      inherentPredikat.pengawas,
      kpmrPredikat.pengawas,
      config.finalIraMatrix,
      input.hasDataMismatch,
      config.dataMismatchPenalty,
    ),
  };

  return {
    parameters: resolvedParameters,
    categoryScores,
    inherentScore,
    inherentPredikat,
    kpmrPillarAverages,
    kpmrOverall,
    kpmrPredikat,
    finalIra,
  };
}
