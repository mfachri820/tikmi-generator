import { combineCategories, computeCategoryScores } from "./categoryScore";
import { applyDataMismatchPenalty, finalIraFromMatrix } from "./finalIra";
import { overallFromPillarAverages, pillarAverages, resolveKpmrAnswers } from "./kpmr";
import { resolveParameter, type ResolvedParameter } from "./parameterScore";
import { predikatFromScore } from "./predikat";
import type { ScoringConfig, WorkbookScoringInput } from "./types";

export * from "./types";
export { resolveParameter, scoreFromRule } from "./parameterScore";
export { computeCategoryScores, combineCategories } from "./categoryScore";
export { predikatFromScore } from "./predikat";
export {
  resolveKpmrAnswers,
  pillarAverages,
  overallFromPillarAverages,
  type ResolvedKpmrAnswer,
} from "./kpmr";
export { finalIraFromMatrix, applyDataMismatchPenalty } from "./finalIra";

export interface WorkbookScoringResult {
  parameters: ResolvedParameter[];
  categoryScores: ReturnType<typeof computeCategoryScores>;
  inherentScore: { pjp: number; pengawas: number };
  inherentPredikat: { pjp: string; pengawas: string };
  kpmrPillarAverages: { pjp: Record<string, number>; pengawas: Record<string, number> };
  kpmrOverall: { pjp: number; pengawas: number };
  kpmrPredikat: { pjp: string; pengawas: string };
  /**
   * Three distinct values, matching the template's F70/R70/S70: `pjp` and
   * `pengawasRaw` are plain matrix lookups; `pengawasAdjusted` is the only
   * one the "Perbedaan Data" penalty ever applies to.
   */
  finalIra: { pjp: number; pengawasRaw: number; pengawasAdjusted: number };
  finalIraPredikat: { pjp: string; pengawasRaw: string; pengawasAdjusted: string };
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

  const finalIraPjp = finalIraFromMatrix(
    inherentPredikat.pjp,
    kpmrPredikat.pjp,
    config.finalIraMatrix,
  );
  const finalIraPengawasRaw = finalIraFromMatrix(
    inherentPredikat.pengawas,
    kpmrPredikat.pengawas,
    config.finalIraMatrix,
  );
  const finalIraPengawasAdjusted = applyDataMismatchPenalty(
    finalIraPengawasRaw,
    input.hasDataMismatch,
    config.dataMismatchPenalty,
  );

  const finalIra = {
    pjp: finalIraPjp,
    pengawasRaw: finalIraPengawasRaw,
    pengawasAdjusted: finalIraPengawasAdjusted,
  };
  const finalIraPredikat = {
    pjp: predikatFromScore(finalIraPjp, config.inherentPredikatRules),
    pengawasRaw: predikatFromScore(finalIraPengawasRaw, config.inherentPredikatRules),
    pengawasAdjusted: predikatFromScore(finalIraPengawasAdjusted, config.inherentPredikatRules),
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
    finalIraPredikat,
  };
}
