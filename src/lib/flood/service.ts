import { validateEvidenceObject } from "@/contracts/evidence";
import type { ConcernType } from "@/contracts/common";
import {
  explainEvaluatedEvidence,
  type EvidenceProviderAccessFactory,
  type EvidenceExplanationStatus,
} from "@/lib/ai/evidence-explainer";
import type { ProviderConfig } from "@/lib/ai/provider-router";
import { evaluateEvidence, type EvidenceEvaluationResult } from "@/lib/evidence/evaluator";
import { separateFloodEvidence } from "./claim-separation";
import type { FloodQueryResult } from "./types";

function evaluateFloodEvidence(result: FloodQueryResult): EvidenceEvaluationResult {
  const evidence = result.evidence;
  if (!evidence) throw new Error("Flood result has no evidence to evaluate");

  // Unsupported coverage is already a validated, explicit no-data state. Its
  // partial GPM attribution describes the unsupported era and must not be
  // converted into a generic source-disagreement state.
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

export async function finalizeFloodQueryResult(
  adapterResult: FloodQueryResult,
  concern: ConcernType,
  providerConfig: ProviderConfig | null,
  optionalQuestion?: string,
  deterministicReason?: Extract<EvidenceExplanationStatus, { mode: "deterministic" }>["reason"],
  providerAccessFactory?: EvidenceProviderAccessFactory
): Promise<FloodQueryResult> {
  if (!adapterResult.evidence) return adapterResult;

  validateEvidenceObject(adapterResult.evidence);
  const evaluation = evaluateFloodEvidence(adapterResult);
  const assessments = separateFloodEvidence(evaluation.evidence);
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
    assessments,
    explanation: explained.explanation,
    explanationStatus: explained.status,
    ...(evaluation.conflicts.length > 0
      ? { evidenceConflicts: evaluation.conflicts }
      : {}),
  };
}
