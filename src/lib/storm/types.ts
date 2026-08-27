import type { BoundingBox, ConcernType } from "@/contracts/common";
import type { EvidenceObject, Explanation } from "@/contracts/evidence";
import type { EvidenceExplanationStatus } from "@/lib/ai/evidence-explainer";
import type { EvidenceConflict } from "@/lib/evidence/evaluator";

export type StormEvidenceMode = "live";

export interface StormLiveQueryInput {
  placeId: string;
  date: string;
  mode: "live";
  area: BoundingBox;
}

export type StormQueryRequest = StormLiveQueryInput & {
  concern: ConcernType;
  optionalQuestion?: string;
};

export type StormSourceOutcome =
  | "success"
  | "no_observation"
  | "failed"
  | "not_applicable";

export interface StormSourceOutcomes {
  ghcnhWind: StormSourceOutcome;
  officialEventContext: StormSourceOutcome;
}

export interface StormClaimDiscussion {
  title: string;
  assessmentSummary: string;
  assessmentConfidence: EvidenceObject["confidence"]["level"];
  supportedStatements: string[];
  notEstablished: string[];
  documentationChecklist: string[];
  officialGuidance: Array<{ label: string; url: string }>;
}

export type StormQueryResultKind =
  | "success"
  | "inconclusive_evidence"
  | "unsupported_coverage"
  | "source_failure"
  | "unsupported_place"
  | "unsupported_date";

export interface StormQueryResult {
  kind: StormQueryResultKind;
  sourceOutcomes?: StormSourceOutcomes;
  evidence?: EvidenceObject;
  claimDiscussion?: StormClaimDiscussion;
  rejectionReason?: string;
  explanation?: Explanation;
  explanationStatus?: EvidenceExplanationStatus;
  evidenceConflicts?: EvidenceConflict[];
}
