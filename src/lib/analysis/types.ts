import type { ConcernType, HazardId } from "@/contracts/common";
import type { PlaceSelection } from "@/lib/location/selection";
import type { CoverageGapQueryResult } from "@/lib/coverage-gap/types";
import type { DroughtQueryResult } from "@/lib/drought/types";
import type { FireQueryResult } from "@/lib/fire/types";
import type { FloodQueryResult } from "@/lib/flood/types";
import type { HeatQueryResult } from "@/lib/heat/types";

export type AnalysisEvidenceMode = "live" | "fixture";
export type AnalysisOrigin = "human" | "agent";

export interface AnalysisRequest {
  hazardId: HazardId;
  concern: ConcernType;
  placeSelection: PlaceSelection;
  optionalQuestion?: string;
  evidenceMode?: AnalysisEvidenceMode;
}

export type AnalysisOutcome =
  | { hazardId: "fire_smoke"; result: FireQueryResult }
  | { hazardId: "flood_storm"; result: FloodQueryResult }
  | { hazardId: "extreme_heat"; result: HeatQueryResult }
  | { hazardId: "drought_land"; result: DroughtQueryResult }
  | {
      hazardId: "air_quality" | "earth_volcanoes";
      result: CoverageGapQueryResult;
    };

export interface ActiveAnalysis {
  analysisId: string;
  origin: AnalysisOrigin;
  request: AnalysisRequest;
  outcome: AnalysisOutcome;
  completedAt: string;
}

export interface AnalysisExecutionOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}
