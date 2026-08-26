import type { BoundingBox, ConcernType } from "@/contracts/common";
import type { EvidenceObject, Explanation } from "@/contracts/evidence";
import type { EvidenceExplanationStatus } from "@/lib/ai/evidence-explainer";
import type { EvidenceConflict } from "@/lib/evidence/evaluator";

export type CoverageGapHazardId = "air_quality" | "earth_volcanoes";
export type CoverageGapSourceOutcome =
  | "success"
  | "no_observation"
  | "source_failure"
  | "credential_gate_closed"
  | "not_attempted"
  | "out_of_scope";

export interface CoverageGapQueryInput {
  placeId: "custom-area";
  area: BoundingBox;
  date: string;
  concern: ConcernType;
  optionalQuestion?: string;
}

export interface CoverageGapMeaning {
  concern: ConcernType;
  summary: string;
  optionalQuestionAcknowledged: boolean;
}

export interface CoverageGapQueryResult {
  kind:
    | "success"
    | "inconclusive_evidence"
    | "no_observation"
    | "unsupported_coverage"
    | "unsupported_date"
    | "source_failure";
  hazardId: CoverageGapHazardId;
  date: string;
  area: BoundingBox;
  retrievalAttempted: boolean;
  sourceOutcomes: Record<string, CoverageGapSourceOutcome>;
  meaning: CoverageGapMeaning;
  limitations: string[];
  rejectionReason: string;
  evidence?: EvidenceObject;
  // ADR-0045: air/earth participate in the same guarded explanation chain as
  // the other hazards. All three fields are absent when no validated Evidence
  // Object exists (unsupported_date and client-synthesized failures).
  explanation?: Explanation;
  explanationStatus?: EvidenceExplanationStatus;
  evidenceConflicts?: EvidenceConflict[];
}
