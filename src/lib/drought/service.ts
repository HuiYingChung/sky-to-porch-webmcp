import { validateEvidenceObject } from "@/contracts/evidence";
import type { ConcernType } from "@/contracts/common";
import {
  explainEvaluatedEvidence,
  type EvidenceProviderAccessFactory,
  type EvidenceExplanationStatus,
} from "@/lib/ai/evidence-explainer";
import type { ProviderConfig } from "@/lib/ai/provider-router";
import { evaluateEvidence, type EvidenceEvaluationResult } from "@/lib/evidence/evaluator";
import type { DroughtQueryResult } from "./types";

function evaluateDroughtEvidence(result: DroughtQueryResult): EvidenceEvaluationResult {
  const evidence = result.evidence;
  if (!evidence) throw new Error("Drought result has no evidence to evaluate");
  if (evidence.evidenceState === "unsupported_coverage") {
    return { evidence, conflicts: [], inferenceAllowed: false };
  }
  const hasObservationTime = evidence.observations.some(
    (observation) => observation.provenance.observedAt !== "unknown"
  );
  return evaluateEvidence(evidence, {
    evaluatedAt: evidence.assembledAt,
    freshness: hasObservationTime
      ? { basis: "historical_context" }
      : { basis: "no_observation_time" },
  });
}

export async function finalizeDroughtQueryResult(
  adapterResult: DroughtQueryResult,
  concern: ConcernType,
  providerConfig: ProviderConfig | null,
  optionalQuestion?: string,
  deterministicReason?: Extract<EvidenceExplanationStatus, { mode: "deterministic" }>["reason"],
  providerAccessFactory?: EvidenceProviderAccessFactory
): Promise<DroughtQueryResult> {
  const result = structuredClone(adapterResult);
  if (!result.evidence) return result;
  validateEvidenceObject(result.evidence);
  const evaluation = evaluateDroughtEvidence(result);
  const explained = await explainEvaluatedEvidence(
    evaluation,
    concern,
    providerConfig,
    optionalQuestion,
    deterministicReason,
    providerAccessFactory
  );
  const finalEvidence = {
    ...evaluation.evidence,
    explanations: [explained.explanation],
  };
  validateEvidenceObject(finalEvidence);
  return {
    ...result,
    evidence: finalEvidence,
    explanation: explained.explanation,
    explanationStatus: explained.status,
    ...(evaluation.conflicts.length > 0
      ? { evidenceConflicts: evaluation.conflicts }
      : {}),
  };
}
