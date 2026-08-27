import type { ConcernType } from "@/contracts/common";
import { validateEvidenceObject } from "@/contracts/evidence";
import { explainEvaluatedEvidence } from "@/lib/ai/evidence-explainer";
import { evaluateEvidence, type EvidenceEvaluationResult } from "@/lib/evidence/evaluator";
import type { StormClaimDiscussion, StormQueryResult } from "./types";

function evaluateStormEvidence(result: StormQueryResult): EvidenceEvaluationResult {
  const evidence = result.evidence;
  if (!evidence) throw new Error("Wind & Storm result has no evidence to evaluate");
  if (evidence.evidenceState === "unsupported_coverage") {
    return { evidence, conflicts: [], inferenceAllowed: false };
  }
  return evaluateEvidence(evidence, {
    evaluatedAt: evidence.assembledAt,
    freshness: evidence.observations.some(
      (observation) => observation.provenance.observedAt !== "unknown"
    )
      ? { basis: "historical_context" }
      : { basis: "no_observation_time" },
  });
}

function buildClaimDiscussion(result: StormQueryResult): StormClaimDiscussion {
  const evidence = result.evidence;
  const event = evidence?.observations.find(
    (observation) => observation.provenance.sourceId === "nws_tropical_cyclone_report"
  );
  const gust = evidence?.observations.find(
    (observation) => observation.variableName === "Peak observed wind gust"
  );
  const speed = evidence?.observations.find(
    (observation) => observation.variableName === "Peak observed wind speed"
  );
  const supportedStatements = [
    ...(event
      ? ["An official NWS post-event report documents Hurricane Beryl and regional wind damage in the governed Southeast Texas area on the selected date."]
      : []),
    ...(gust?.value !== undefined
      ? [`The selected in-area GHCNh station recorded a peak wind gust of ${gust.value} ${gust.unit} on the selected UTC date.`]
      : []),
    ...(speed?.value !== undefined
      ? [`The selected in-area GHCNh station recorded a peak wind speed of ${speed.value} ${speed.unit} on the selected UTC date.`]
      : []),
  ];
  return {
    title: "Storm claim discussion preparation",
    supportedStatements: supportedStatements.length > 0
      ? supportedStatements
      : ["No property-relevant wind observation was returned. Missing evidence is not evidence that damaging wind did not occur."],
    notEstablished: [
      "Whether the selected roof was damaged during the storm.",
      "Whether wind, rain, age, installation, maintenance, or another cause produced any observed damage.",
      "Whether a policy covers the loss, which deductible applies, or what an insurer will decide.",
    ],
    documentationChecklist: [
      "Photograph and video the damage before permanent repairs, when it is safe to do so.",
      "Write a dated room-by-room and exterior damage list; keep the original files and timestamps.",
      "Keep receipts for reasonable temporary repairs and avoid permanent work before the insurer documents the loss unless safety requires it.",
      "Gather pre-storm roof, maintenance, inspection, and installation records if available.",
      "Ask a qualified inspector or contractor to document observed damage and possible causes without promising insurance coverage.",
      "Review the policy's wind/hail coverage, exclusions, reporting duties, and deductible with the insurer or a qualified adviser.",
    ],
    officialGuidance: [
      {
        label: "Texas Department of Insurance — filing a homeowners claim",
        url: "https://agate.tdi.texas.gov/pubs/consumer/cb025.html",
      },
      {
        label: "Texas Department of Insurance — replacing your roof",
        url: "https://agate.tdi.texas.gov/tips/replacing-your-roof.html",
      },
    ],
  };
}

export async function finalizeStormQueryResult(
  adapterResult: StormQueryResult,
  concern: ConcernType,
  optionalQuestion?: string
): Promise<StormQueryResult> {
  if (!adapterResult.evidence) return adapterResult;
  validateEvidenceObject(adapterResult.evidence);
  const evaluation = evaluateStormEvidence(adapterResult);
  const explained = await explainEvaluatedEvidence(evaluation, concern, optionalQuestion);
  const finalEvidence = {
    ...evaluation.evidence,
    explanations: [explained.explanation],
  };
  validateEvidenceObject(finalEvidence);
  return {
    ...adapterResult,
    evidence: finalEvidence,
    ...(concern === "home" ? { claimDiscussion: buildClaimDiscussion({ ...adapterResult, evidence: finalEvidence }) } : {}),
    explanation: explained.explanation,
    explanationStatus: explained.status,
    ...(evaluation.conflicts.length > 0 ? { evidenceConflicts: evaluation.conflicts } : {}),
  };
}
