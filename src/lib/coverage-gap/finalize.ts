/**
 * ADR-0045: attach the guarded evidence explanation chain to an assembled
 * Air Quality / Earth & Volcanoes result. Mirrors finalizeFloodQueryResult:
 * evaluation → guarded explainEvaluatedEvidence → validated re-assembly.
 * Server-only (evaluator + explainer): never import from client components.
 */

import { validateEvidenceObject } from "@/contracts/evidence";
import type { ConcernType } from "@/contracts/common";
import {
  explainEvaluatedEvidence,
  type EvidenceProviderAccessFactory,
  type EvidenceExplanationStatus,
} from "@/lib/ai/evidence-explainer";
import type { ProviderConfig } from "@/lib/ai/provider-router";
import { evaluateEvidence, type EvidenceEvaluationResult } from "@/lib/evidence/evaluator";
import type { CoverageGapQueryResult } from "./types";

function evaluateCoverageGapEvidence(result: CoverageGapQueryResult): EvidenceEvaluationResult {
  const evidence = result.evidence;
  if (!evidence) throw new Error("Coverage-gap result has no evidence to evaluate");

  // Unsupported coverage is already a validated, explicit no-data state; do
  // not convert it into a generic source-disagreement state (flood precedent).
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

export async function finalizeCoverageGapQueryResult(
  adapterResult: CoverageGapQueryResult,
  concern: ConcernType,
  providerConfig: ProviderConfig | null,
  optionalQuestion?: string,
  deterministicReason?: Extract<EvidenceExplanationStatus, { mode: "deterministic" }>["reason"],
  providerAccessFactory?: EvidenceProviderAccessFactory
): Promise<CoverageGapQueryResult> {
  if (!adapterResult.evidence) return adapterResult;

  validateEvidenceObject(adapterResult.evidence);
  const evaluation = evaluateCoverageGapEvidence(adapterResult);
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
    ...adapterResult,
    evidence: finalEvidence,
    explanation: explained.explanation,
    explanationStatus: explained.status,
    ...(evaluation.conflicts.length > 0
      ? { evidenceConflicts: evaluation.conflicts }
      : {}),
  };
}
