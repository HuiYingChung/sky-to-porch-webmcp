/// <reference types="webmcp-types" />

import {
  CONCERN_TYPES,
  HAZARD_IDS,
  type ConcernType,
  type HazardId,
} from "@/contracts/common";
import type { EvidenceObject, Observation } from "@/contracts/evidence";
import type { ActiveAnalysis, AnalysisRequest } from "@/lib/analysis/types";
import {
  buildAgentCoordinateSelection,
  buildGeocodedPlaceSelection,
  type PlaceSelection,
} from "@/lib/location/selection";

export const ANALYZE_HAZARD_TOOL_NAME = "analyze_environmental_hazard";
const DEFAULT_RADIUS_KM = 25;
const MAX_OUTPUT_CHARACTERS = 2_400;
export const ANSWER_ORDER = [
  "strongest_supported_assessment",
  "observation_values_times_and_official_citations",
  "direct_observation_then_labelled_inference",
  "confidence_and_evidence_that_would_change_it",
] as const;
const ANALYSIS_SCOPES = ["related_context", "single_hazard_only"] as const;
type AnalysisScope = (typeof ANALYSIS_SCOPES)[number];
const STRICT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Product-owned default relationships. These are retrieval companions. Any
 * causal assessment must be made explicitly from supported evidence; the
 * companion list itself is not a causal verdict and does not recurse.
 */
export const DEFAULT_RELATED_HAZARDS: Readonly<Record<HazardId, readonly HazardId[]>> = {
  fire_smoke: ["air_quality"],
  flood_storm: ["wind_storm"],
  wind_storm: ["flood_storm"],
  extreme_heat: ["drought_land"],
  drought_land: ["extreme_heat"],
  air_quality: ["fire_smoke"],
  earth_volcanoes: ["air_quality", "extreme_heat"],
};

const INPUT_KEYS = new Set([
  "place",
  "hazard",
  "concern",
  "latitude",
  "longitude",
  "radius_km",
  "start_date",
  "end_date",
  "question",
  "analysis_scope",
  "related_hazards",
]);

export interface AnalyzeHazardToolDependencies {
  runAnalysis: (
    request: AnalysisRequest,
    origin?: "agent",
    signal?: AbortSignal
  ) => Promise<ActiveAnalysis | null>;
  runAnalysisBundle?: (
    requests: AnalysisRequest[],
    origin?: "agent",
    signal?: AbortSignal
  ) => Promise<ActiveAnalysis[] | null>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface ParsedInput {
  place: string;
  hazard: HazardId;
  analysisScope: AnalysisScope;
  relatedHazards: HazardId[];
  concern: ConcernType;
  latitude?: number;
  longitude?: number;
  radiusKm: number;
  startDate?: string;
  endDate?: string;
  question?: string;
}

interface GeocodeCandidate {
  label: string;
  lon: number;
  lat: number;
}

export interface AgentPlaceChoice {
  choice_id: string;
  label: string;
  retry_with: {
    latitude: number;
    longitude: number;
  };
}

interface ToolFailure {
  status:
    | "invalid_input"
    | "place_not_found"
    | "place_lookup_failed"
    | "needs_place_choice"
    | "superseded";
  message: string;
  ui_updated: false;
  no_data_is_not_no_danger: true;
  choices?: AgentPlaceChoice[];
  requires_user_input?: true;
  required_next_action?: "ask_user_to_choose_place_and_wait";
  must_not_select_place?: true;
  must_not_retry_before_user_reply?: true;
  after_user_choice?: {
    required_next_action: "retry_analysis_with_selected_place";
    continue_task: true;
    set_place_to_selected_label: true;
    include_selected_retry_with: true;
    preserve_other_arguments: true;
  };
}

interface CompactObservation {
  name: string;
  value: number | string;
  unit?: string;
  source: string;
  observed_at: string;
}

interface CompactCitation {
  source: string;
  product: string;
  observed_at: string;
  retrieved_at: string;
  url: string | null;
}

interface ToolSuccess {
  status: string;
  analysis_id: string;
  ui_updated: true;
  evidence_scope:
    | "regional_wind_observations"
    | "regional_water_and_rain_observations"
    | "regional_heat_observations"
    | "regional_drought_and_land_observations"
    | "regional_fire_and_smoke_observations"
    | "regional_air_quality_observations"
    | "regional_earth_and_volcano_observations";
  request: {
    place: string;
    hazard: HazardId;
    concern: ConcernType;
    radius_km: number;
    time: string;
  };
  evidence: null | {
    state: EvidenceObject["evidenceState"];
    mode: EvidenceObject["dataMode"];
    confidence: EvidenceObject["confidence"]["level"];
    freshness: EvidenceObject["freshness"]["status"];
    observations: CompactObservation[];
  };
  support: {
    level: "official_observations_returned" | "partial_official_evidence" | "no_observations_returned";
    confidence: EvidenceObject["confidence"]["level"] | "insufficient";
    observation_count: number;
    source_count: number;
  };
  answer_order: typeof ANSWER_ORDER;
  citations: CompactCitation[];
  limitations: string[];
  no_data_is_not_no_danger?: true;
}

type EvidenceScope = ToolSuccess["evidence_scope"];

interface CompactEvidenceChain {
  hazard: HazardId;
  evidence_scope: EvidenceScope;
  status: string;
  observation: CompactObservation | null;
  citation: CompactCitation | null;
  confidence: EvidenceObject["confidence"]["level"] | "insufficient";
  limitation: string | null;
}

interface ToolEvidenceBundle {
  status: "related_environmental_evidence_bundle";
  analysis_id: string;
  ui_updated: true;
  evidence_scope: "separate_related_hazard_chains";
  relationship: "related_evidence_for_assessment";
  support: {
    level: "multi_chain_official_context" | "partial_official_context" | "no_observations_returned";
    assessment_confidence: "moderate" | "low" | "insufficient";
    basis:
      | "independent_official_sources_across_every_chain"
      | "official_observations_in_multiple_chains"
      | "incomplete_related_context";
    chains_with_observations: number;
    total_chains: number;
    source_count: number;
  };
  inference_guidance: "state_strongest_supported_inference_and_confidence";
  answer_order: typeof ANSWER_ORDER;
  use_decision: "person_decides_how_to_use_related_evidence";
  request: {
    place: string;
    hazard: HazardId;
    analysis_scope: "related_context";
    concern: ConcernType;
    radius_km: number;
    time: string;
  };
  included_chains: HazardId[];
  chains: CompactEvidenceChain[];
  claim_discussion_available: boolean;
  related_evidence_visible_in_shared_view: true;
  no_data_is_not_no_danger?: true;
}

export type AnalyzeHazardToolOutput = ToolFailure | ToolSuccess | ToolEvidenceBundle;

export const ANALYZE_HAZARD_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["place", "hazard"],
  properties: {
    place: {
      type: "string",
      minLength: 2,
      maxLength: 200,
      description: "Place name to search, or a label for supplied coordinates.",
    },
    hazard: {
      type: "string",
      enum: HAZARD_IDS,
      description: "Primary hazard: smoke+air uses fire_smoke; wind+flood wind_storm; heat+drought extreme_heat; volcano+air/heat earth_volcanoes.",
    },
    analysis_scope: {
      type: "string",
      enum: ANALYSIS_SCOPES,
      default: "related_context",
      description: "Use single_hazard_only for one named hazard or measurement; related_context for broad impact, multiple, or related-condition questions.",
    },
    related_hazards: {
      type: "array",
      items: { type: "string", enum: HAZARD_IDS },
      uniqueItems: true,
      maxItems: 3,
      description: "Omit unless the person explicitly names a non-default related hazard. Never add hazards already covered by product defaults. Maximum three.",
    },
    concern: {
      type: "string",
      enum: CONCERN_TYPES,
      description: "Optional explanation lens. Infer when explicit; ask only if a broad goal needs it. Narrow evidence questions may omit it and use general.",
    },
    latitude: {
      type: "number",
      minimum: -90,
      maximum: 90,
      description: "Latitude the person supplied, or from a candidate they selected in a later message; requires longitude. Never infer it to bypass ambiguity.",
    },
    longitude: {
      type: "number",
      minimum: -180,
      maximum: 180,
      description: "Longitude the person supplied, or from a candidate they selected in a later message; requires latitude. Never infer it to bypass ambiguity.",
    },
    radius_km: {
      type: "number",
      minimum: 1,
      maximum: 250,
      default: DEFAULT_RADIUS_KM,
      description: "Analysis radius in kilometres; defaults to 25.",
    },
    start_date: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      description: "Completed UTC start date. Supply with end_date.",
    },
    end_date: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      description: "Completed UTC end date. Supply with start_date.",
    },
    question: {
      type: "string",
      maxLength: 500,
      description: "Optional. Preserve the person's wording when possible; shorten only to 500 characters. Never invent evidence.",
    },
  },
} as const;

function failure(
  status: ToolFailure["status"],
  message: string,
  choices?: AgentPlaceChoice[]
): ToolFailure {
  return {
    status,
    message,
    ui_updated: false,
    no_data_is_not_no_danger: true,
    ...(choices ? { choices } : {}),
  };
}

function placeChoiceFailure(
  query: string,
  choices: AgentPlaceChoice[]
): ToolFailure {
  return {
    status: "needs_place_choice",
    message: `PAUSE FOR USER: I found ${choices.length} possible places for “${query}”. Do not select a place or retry yet. Ask the person to choose one label below, then wait for a new user message. After the person replies, continue the unfinished task: call this tool again, set place to the selected label, include that choice's retry_with coordinates, and keep every other input unchanged.`,
    ui_updated: false,
    no_data_is_not_no_danger: true,
    requires_user_input: true,
    required_next_action: "ask_user_to_choose_place_and_wait",
    must_not_select_place: true,
    must_not_retry_before_user_reply: true,
    after_user_choice: {
      required_next_action: "retry_analysis_with_selected_place",
      continue_task: true,
      set_place_to_selected_label: true,
      include_selected_retry_with: true,
      preserve_other_arguments: true,
    },
    choices,
  };
}

function placeChoices(candidates: GeocodeCandidate[]): AgentPlaceChoice[] {
  return candidates.map((candidate, index) => ({
    choice_id: `place-${index + 1}`,
    label: truncate(candidate.label, 120),
    retry_with: {
      latitude: candidate.lat,
      longitude: candidate.lon,
    },
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrictUtcDate(value: string): boolean {
  if (!STRICT_DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function latestCompletedUtcDate(now: Date): string {
  const date = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - 1
  ));
  return date.toISOString().slice(0, 10);
}

function parseInput(
  raw: Record<string, unknown>,
  now: Date
): ParsedInput | ToolFailure {
  const unexpected = Object.keys(raw).find((key) => !INPUT_KEYS.has(key));
  if (unexpected) {
    return failure("invalid_input", `Unexpected input field: ${unexpected}.`);
  }

  if (
    typeof raw.place !== "string" ||
    raw.place.trim().length < 2 ||
    raw.place.trim().length > 200 ||
    CONTROL_CHAR_RE.test(raw.place)
  ) {
    return failure("invalid_input", "place must be 2–200 characters without control characters.");
  }
  if (
    typeof raw.hazard !== "string" ||
    !(HAZARD_IDS as readonly string[]).includes(raw.hazard)
  ) {
    return failure("invalid_input", `hazard must be one of: ${HAZARD_IDS.join(", ")}.`);
  }
  const analysisScope = raw.analysis_scope ?? "related_context";
  if (
    typeof analysisScope !== "string" ||
    !(ANALYSIS_SCOPES as readonly string[]).includes(analysisScope)
  ) {
    return failure("invalid_input", `analysis_scope must be one of: ${ANALYSIS_SCOPES.join(", ")}.`);
  }
  if (
    raw.related_hazards !== undefined &&
    (!Array.isArray(raw.related_hazards) ||
      raw.related_hazards.length > 3 ||
      new Set(raw.related_hazards).size !== raw.related_hazards.length ||
      raw.related_hazards.some(
        (hazard) => typeof hazard !== "string" || !(HAZARD_IDS as readonly string[]).includes(hazard)
      ))
  ) {
    return failure("invalid_input", "related_hazards must contain up to three unique supported hazards.");
  }
  const relatedHazards = (raw.related_hazards ?? []) as HazardId[];
  if (relatedHazards.includes(raw.hazard as HazardId)) {
    return failure("invalid_input", "related_hazards must not repeat the primary hazard.");
  }
  if (analysisScope === "single_hazard_only" && relatedHazards.length > 0) {
    return failure("invalid_input", "single_hazard_only cannot include related_hazards.");
  }
  const plannedRelatedCount = new Set([
    ...DEFAULT_RELATED_HAZARDS[raw.hazard as HazardId],
    ...relatedHazards,
  ]).size;
  if (plannedRelatedCount > 3) {
    return failure("invalid_input", "A related-context request can include at most three context hazards.");
  }
  const concern = raw.concern ?? "general";
  if (
    typeof concern !== "string" ||
    !(CONCERN_TYPES as readonly string[]).includes(concern)
  ) {
    return failure("invalid_input", `concern must be one of: ${CONCERN_TYPES.join(", ")}.`);
  }

  const hasLatitude = raw.latitude !== undefined;
  const hasLongitude = raw.longitude !== undefined;
  if (hasLatitude !== hasLongitude) {
    return failure("invalid_input", "latitude and longitude must be supplied together.");
  }
  if (
    hasLatitude &&
    (typeof raw.latitude !== "number" ||
      !Number.isFinite(raw.latitude) ||
      raw.latitude < -90 ||
      raw.latitude > 90 ||
      typeof raw.longitude !== "number" ||
      !Number.isFinite(raw.longitude) ||
      raw.longitude < -180 ||
      raw.longitude > 180)
  ) {
    return failure("invalid_input", "latitude or longitude is outside the valid WGS-84 range.");
  }

  const radiusKm = raw.radius_km ?? DEFAULT_RADIUS_KM;
  if (
    typeof radiusKm !== "number" ||
    !Number.isFinite(radiusKm) ||
    radiusKm < 1 ||
    radiusKm > 250
  ) {
    return failure("invalid_input", "radius_km must be a finite number from 1 to 250.");
  }

  const hasStart = raw.start_date !== undefined;
  const hasEnd = raw.end_date !== undefined;
  if (hasStart !== hasEnd) {
    return failure("invalid_input", "start_date and end_date must be supplied together.");
  }
  if (
    hasStart &&
    (typeof raw.start_date !== "string" ||
      typeof raw.end_date !== "string" ||
      !isStrictUtcDate(raw.start_date) ||
      !isStrictUtcDate(raw.end_date))
  ) {
    return failure("invalid_input", "Dates must be real calendar dates in YYYY-MM-DD format.");
  }
  const latestCompleted = latestCompletedUtcDate(now);
  if (
    typeof raw.start_date === "string" &&
    typeof raw.end_date === "string" &&
    (raw.start_date > raw.end_date || raw.end_date > latestCompleted)
  ) {
    return failure(
      "invalid_input",
      `Use an ordered range ending on or before the latest completed UTC date, ${latestCompleted}.`
    );
  }
  if (
    typeof raw.start_date === "string" &&
    typeof raw.end_date === "string" &&
    (analysisScope === "related_context" ||
      (raw.hazard !== "fire_smoke" && raw.hazard !== "flood_storm")) &&
    raw.start_date !== raw.end_date
  ) {
    return failure(
      "invalid_input",
      analysisScope === "related_context"
        ? "related_context accepts one completed UTC date so every evidence chain has the same temporal anchor."
        : `${raw.hazard} accepts exactly one completed UTC date.`
    );
  }

  if (
    raw.question !== undefined &&
    (typeof raw.question !== "string" ||
      raw.question.trim().length === 0 ||
      raw.question.trim().length > 500 ||
      CONTROL_CHAR_RE.test(raw.question))
  ) {
    return failure("invalid_input", "question must be 1–500 characters without control characters.");
  }

  return {
    place: raw.place.trim(),
    hazard: raw.hazard as HazardId,
    analysisScope: analysisScope as AnalysisScope,
    relatedHazards,
    concern: concern as ConcernType,
    ...(hasLatitude
      ? {
          latitude: raw.latitude as number,
          longitude: raw.longitude as number,
        }
      : {}),
    radiusKm,
    ...(typeof raw.start_date === "string"
      ? { startDate: raw.start_date, endDate: raw.end_date as string }
      : {}),
    ...(typeof raw.question === "string" ? { question: raw.question.trim() } : {}),
  };
}

function selectionTime(
  input: ParsedInput,
  now: Date
): { type: "latest" | "custom"; startTs?: string; endTs?: string; display: string } {
  if (input.startDate && input.endDate) {
    return {
      type: "custom",
      startTs: `${input.startDate}T00:00:00.000Z`,
      endTs: `${input.endDate}T23:59:59.000Z`,
      display: input.startDate === input.endDate
        ? input.startDate
        : `${input.startDate}/${input.endDate}`,
    };
  }
  if (input.hazard === "fire_smoke" && input.analysisScope === "single_hazard_only") {
    return { type: "latest", display: "latest completed source date" };
  }
  const completed = latestCompletedUtcDate(now);
  return {
    type: "custom",
    startTs: `${completed}T00:00:00.000Z`,
    endTs: `${completed}T23:59:59.000Z`,
    display: completed,
  };
}

function buildSelection(
  input: ParsedInput,
  candidate: GeocodeCandidate,
  time: ReturnType<typeof selectionTime>,
  coordinateOrigin: "agent" | "geocoder"
): PlaceSelection {
  const args = [
    candidate.label,
    { lon: candidate.lon, lat: candidate.lat },
    input.radiusKm,
    time.type,
    time.startTs,
    time.endTs,
  ] as const;
  return coordinateOrigin === "agent"
    ? buildAgentCoordinateSelection(...args)
    : buildGeocodedPlaceSelection(...args);
}

async function resolvePlace(
  input: ParsedInput,
  fetchImpl: typeof fetch,
  signal: AbortSignal
): Promise<GeocodeCandidate | ToolFailure> {
  if (input.latitude !== undefined && input.longitude !== undefined) {
    return { label: input.place, lat: input.latitude, lon: input.longitude };
  }

  let response: Response;
  try {
    response = await fetchImpl("/api/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: input.place }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return failure("place_lookup_failed", "Place search failed; no evidence query was run.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return failure("place_lookup_failed", "Place search returned an unreadable response; no evidence query was run.");
  }
  if (!response.ok || !isRecord(payload) || payload.ok !== true || !Array.isArray(payload.results)) {
    return failure("place_lookup_failed", "Place search was unavailable; no evidence query was run.");
  }

  const candidates = payload.results
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .filter(
      (item) =>
        typeof item.label === "string" &&
        typeof item.lon === "number" &&
        typeof item.lat === "number" &&
        Number.isFinite(item.lon) &&
        Number.isFinite(item.lat)
    )
    .slice(0, 3)
    .map((item) => ({
      label: item.label as string,
      lon: item.lon as number,
      lat: item.lat as number,
    }));

  if (candidates.length === 0) {
    return failure("place_not_found", `No place candidate was found for “${input.place}”.`);
  }
  if (candidates.length > 1) {
    return placeChoiceFailure(input.place, placeChoices(candidates));
  }
  return candidates[0];
}

function truncate(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1)}…`;
}

function compactObservation(observation: Observation): CompactObservation {
  return {
    name: truncate(observation.variableName, 70),
    value: observation.value ?? truncate(observation.textValue ?? "unavailable", 80),
    ...(observation.unit ? { unit: truncate(observation.unit, 30) } : {}),
    source: observation.provenance.sourceId,
    observed_at: observation.provenance.observedAt,
  };
}

function compactCitation(observation: Observation): CompactCitation {
  const sourceUrl = observation.provenance.sourceUrl;
  return {
    source: observation.provenance.sourceId,
    product: truncate(observation.provenance.product, 90),
    observed_at: observation.provenance.observedAt,
    retrieved_at: observation.provenance.retrievedAt,
    url: typeof sourceUrl === "string" && sourceUrl.length <= 500 ? sourceUrl : null,
  };
}

export function evidenceScopeForHazard(hazard: HazardId): EvidenceScope {
  switch (hazard) {
    case "wind_storm":
      return "regional_wind_observations";
    case "flood_storm":
      return "regional_water_and_rain_observations";
    case "extreme_heat":
      return "regional_heat_observations";
    case "drought_land":
      return "regional_drought_and_land_observations";
    case "fire_smoke":
      return "regional_fire_and_smoke_observations";
    case "air_quality":
      return "regional_air_quality_observations";
    case "earth_volcanoes":
      return "regional_earth_and_volcano_observations";
  }
}

function resultDetails(analysis: ActiveAnalysis): {
  kind: string;
  evidence?: EvidenceObject;
  limitations: string[];
  rejectionReason?: string;
} {
  const result = analysis.outcome.result;
  const common = result as {
    kind: string;
    evidence?: EvidenceObject;
    rejectionReason?: string;
    limitations?: string[];
  };
  return {
    kind: common.kind,
    ...(common.evidence ? { evidence: common.evidence } : {}),
    limitations: common.evidence
      ? common.evidence.limitations.map((item) => item.description)
      : common.limitations ?? [],
    ...(common.rejectionReason ? { rejectionReason: common.rejectionReason } : {}),
  };
}

function compactSuccess(
  analysis: ActiveAnalysis,
  timeDisplay: string
): ToolSuccess {
  const details = resultDetails(analysis);
  const evidence = details.evidence;
  const limitations = [
    ...(details.rejectionReason ? [details.rejectionReason] : []),
    ...details.limitations,
  ];
  const citations = evidence
    ? evidence.observations
        .filter((observation, index, observations) =>
          observations.findIndex((candidate) =>
            candidate.provenance.sourceId === observation.provenance.sourceId
          ) === index
        )
        .slice(0, 2)
        .map(compactCitation)
    : [];
  const observationCount = evidence?.observations.length ?? 0;
  const sourceCount = new Set(
    evidence?.observations.map((observation) => observation.provenance.sourceId) ?? []
  ).size;
  const supportLevel = observationCount === 0
    ? "no_observations_returned" as const
    : evidence?.evidenceState === "observations_returned"
      ? "official_observations_returned" as const
      : "partial_official_evidence" as const;

  const base: ToolSuccess = {
    status: details.kind,
    analysis_id: analysis.analysisId,
    ui_updated: true,
    evidence_scope: evidenceScopeForHazard(analysis.request.hazardId),
    request: {
      place: truncate(analysis.request.placeSelection.label, 100),
      hazard: analysis.request.hazardId,
      concern: analysis.request.concern,
      radius_km: analysis.request.placeSelection.analysisArea.radiusKm,
      time: timeDisplay,
    },
    evidence: evidence
      ? {
          state: evidence.evidenceState,
          mode: evidence.dataMode,
          confidence: evidence.confidence.level,
          freshness: evidence.freshness.status,
          observations: evidence.observations.slice(0, 3).map(compactObservation),
        }
      : null,
    support: {
      level: supportLevel,
      confidence: evidence?.confidence.level ?? "insufficient",
      observation_count: observationCount,
      source_count: sourceCount,
    },
    answer_order: ANSWER_ORDER,
    citations,
    limitations: limitations.slice(0, 2).map((item) => truncate(item, 180)),
    ...(observationCount === 0 ? { no_data_is_not_no_danger: true as const } : {}),
  };

  if (JSON.stringify(base).length <= MAX_OUTPUT_CHARACTERS) return base;
  const reduced: ToolSuccess = {
    ...base,
    evidence: base.evidence
      ? { ...base.evidence, observations: base.evidence.observations.slice(0, 1) }
      : null,
    limitations: base.limitations.slice(0, 1).map((item) => truncate(item, 120)),
    citations: base.citations.slice(0, 1),
  };
  if (JSON.stringify(reduced).length <= MAX_OUTPUT_CHARACTERS) return reduced;
  const compact: ToolSuccess = {
    ...reduced,
    analysis_id: truncate(reduced.analysis_id, 120),
    limitations: reduced.limitations.slice(0, 1).map((item) => truncate(item, 80)),
    citations: reduced.citations.map((citation) => ({
      ...citation,
      product: truncate(citation.product, 60),
    })),
  };
  if (JSON.stringify(compact).length <= MAX_OUTPUT_CHARACTERS) return compact;
  return {
    ...compact,
    citations: compact.citations.map((citation) => ({ ...citation, url: null })),
    limitations: [],
  };
}

function compactEvidenceChain(analysis: ActiveAnalysis): CompactEvidenceChain {
  const details = resultDetails(analysis);
  const evidence = details.evidence;
  const observation = evidence?.observations[0];
  const limitation = details.rejectionReason ?? details.limitations[0] ?? null;
  return {
    hazard: analysis.request.hazardId,
    evidence_scope: evidenceScopeForHazard(analysis.request.hazardId),
    status: details.kind,
    observation: observation ? compactObservation(observation) : null,
    citation: observation ? compactCitation(observation) : null,
    confidence: evidence?.confidence.level ?? "insufficient",
    limitation: limitation ? truncate(limitation, 130) : null,
  };
}

function compactEvidenceBundle(
  analyses: ActiveAnalysis[],
  primary: ActiveAnalysis,
  timeDisplay: string
): ToolEvidenceBundle {
  const includedChains = analyses.map((analysis) => analysis.request.hazardId);
  const chainEvidence = analyses.map(resultDetails).map((details) => details.evidence);
  const chainsWithObservations = chainEvidence.filter(
    (evidence) => (evidence?.observations.length ?? 0) > 0
  ).length;
  const sourceCount = new Set(chainEvidence.flatMap(
    (evidence) => evidence?.observations.map((observation) => observation.provenance.sourceId) ?? []
  )).size;
  const supportLevel = chainsWithObservations === 0
    ? "no_observations_returned" as const
    : chainsWithObservations === analyses.length
      ? "multi_chain_official_context" as const
      : "partial_official_context" as const;
  const assessmentConfidence = chainsWithObservations === analyses.length && sourceCount >= 4
    ? "moderate" as const
    : chainsWithObservations >= 2 && sourceCount >= 2
      ? "low" as const
      : "insufficient" as const;
  const supportBasis = assessmentConfidence === "moderate"
    ? "independent_official_sources_across_every_chain" as const
    : assessmentConfidence === "low"
      ? "official_observations_in_multiple_chains" as const
      : "incomplete_related_context" as const;
  const bundle: ToolEvidenceBundle = {
    status: "related_environmental_evidence_bundle",
    analysis_id: `related-bundle:${analyses.map((analysis) => analysis.analysisId).join(":")}`,
    ui_updated: true,
    evidence_scope: "separate_related_hazard_chains",
    relationship: "related_evidence_for_assessment",
    support: {
      level: supportLevel,
      assessment_confidence: assessmentConfidence,
      basis: supportBasis,
      chains_with_observations: chainsWithObservations,
      total_chains: analyses.length,
      source_count: sourceCount,
    },
    inference_guidance: "state_strongest_supported_inference_and_confidence",
    answer_order: ANSWER_ORDER,
    use_decision: "person_decides_how_to_use_related_evidence",
    request: {
      place: truncate(primary.request.placeSelection.label, 100),
      hazard: primary.request.hazardId,
      analysis_scope: "related_context",
      concern: primary.request.concern,
      radius_km: primary.request.placeSelection.analysisArea.radiusKm,
      time: timeDisplay,
    },
    included_chains: includedChains,
    chains: analyses.map(compactEvidenceChain),
    claim_discussion_available:
      primary.outcome.hazardId === "wind_storm" && Boolean(primary.outcome.result.claimDiscussion),
    related_evidence_visible_in_shared_view: true,
    ...(chainsWithObservations === 0 ? { no_data_is_not_no_danger: true as const } : {}),
  };
  if (JSON.stringify(bundle).length <= MAX_OUTPUT_CHARACTERS) return bundle;
  const reduced: ToolEvidenceBundle = {
    ...bundle,
    chains: bundle.chains.map((chain) => ({
      ...chain,
      observation: null,
    })),
  };
  if (JSON.stringify(reduced).length <= MAX_OUTPUT_CHARACTERS) return reduced;

  const compact: ToolEvidenceBundle = {
    ...reduced,
    analysis_id: truncate(reduced.analysis_id, 120),
    chains: reduced.chains.map((chain) => ({
      ...chain,
      citation: chain.citation
        ? { ...chain.citation, product: truncate(chain.citation.product, 60) }
        : null,
      limitation: chain.limitation ? truncate(chain.limitation, 90) : null,
    })),
  };
  if (JSON.stringify(compact).length <= MAX_OUTPUT_CHARACTERS) return compact;

  const primaryUrlOnly: ToolEvidenceBundle = {
    ...compact,
    chains: compact.chains.map((chain) => ({
      ...chain,
      citation: chain.citation && chain.hazard !== primary.request.hazardId
        ? { ...chain.citation, url: null }
        : chain.citation,
    })),
  };
  if (JSON.stringify(primaryUrlOnly).length <= MAX_OUTPUT_CHARACTERS) return primaryUrlOnly;

  return {
    ...primaryUrlOnly,
    analysis_id: truncate(primaryUrlOnly.analysis_id, 60),
    request: {
      ...primaryUrlOnly.request,
      place: truncate(primaryUrlOnly.request.place, 60),
    },
    chains: primaryUrlOnly.chains.map((chain) => ({
      ...chain,
      citation: chain.citation
        ? { ...chain.citation, product: truncate(chain.citation.product, 30), url: null }
        : null,
      limitation: null,
    })),
  };
}

function plannedHazards(input: ParsedInput): HazardId[] {
  if (input.analysisScope === "single_hazard_only") return [input.hazard];
  const related = [...new Set([
    ...DEFAULT_RELATED_HAZARDS[input.hazard],
    ...input.relatedHazards,
  ])].filter((hazard) => hazard !== input.hazard);
  return [...related, input.hazard];
}

export async function executeAnalyzeHazardTool(
  rawInput: Record<string, unknown>,
  options: WebMCP.ToolExecuteCallbackOptions | undefined,
  dependencies: AnalyzeHazardToolDependencies
): Promise<AnalyzeHazardToolOutput> {
  // Current supported browser agents may invoke the callback with only the
  // schema input even though older WebMCP type packages require callback
  // options. Keep per-invocation cancellation when the client supplies it,
  // while retaining a never-aborted signal for the one-argument surface.
  const signal = options?.signal ?? new AbortController().signal;
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Tool execution cancelled", "AbortError");
  }
  const now = dependencies.now?.() ?? new Date();
  const input = parseInput(rawInput, now);
  if ("status" in input) return input;

  const resolved = await resolvePlace(
    input,
    dependencies.fetchImpl ?? fetch,
    signal
  );
  if ("status" in resolved) return resolved;

  const time = selectionTime(input, now);
  let placeSelection: PlaceSelection;
  try {
    placeSelection = buildSelection(
      input,
      resolved,
      time,
      input.latitude !== undefined ? "agent" : "geocoder"
    );
  } catch (error) {
    return failure(
      "invalid_input",
      error instanceof Error ? error.message : "The place, radius, or date selection was invalid."
    );
  }

  const hazards = plannedHazards(input);
  if (hazards.length > 1) {
    const commonRequest = {
      concern: input.concern,
      placeSelection,
      ...(input.question ? { optionalQuestion: input.question } : {}),
      evidenceMode: "live" as const,
    };
    const requests = hazards.map((hazardId, index): AnalysisRequest => {
      const role = index === 0
        ? "start_context"
        : index === hazards.length - 1
          ? "primary"
          : "context";
      return {
        ...commonRequest,
        hazardId,
        evidenceBundle: {
          primaryHazardId: input.hazard,
          includedHazardIds: hazards,
          role,
        },
      };
    });
    let analyses: ActiveAnalysis[] | null;
    if (dependencies.runAnalysisBundle) {
      analyses = await dependencies.runAnalysisBundle(requests, "agent", signal);
    } else {
      analyses = [];
      for (const request of requests) {
        const analysis = await dependencies.runAnalysis(
          request,
          "agent",
          signal
        );
        if (analysis === null) {
          analyses = null;
          break;
        }
        analyses.push(analysis);
      }
    }
    if (analyses === null) {
      return failure(
        "superseded",
        "A newer request replaced the related-context investigation before every evidence chain completed."
      );
    }
    return compactEvidenceBundle(analyses, analyses[analyses.length - 1], time.display);
  }

  const analysis = await dependencies.runAnalysis(
    {
      hazardId: input.hazard,
      concern: input.concern,
      placeSelection,
      ...(input.question ? { optionalQuestion: input.question } : {}),
      evidenceMode: "live",
    },
    "agent",
    signal
  );
  if (analysis === null) {
    if (signal.aborted) {
      throw signal.reason ?? new DOMException("Tool execution cancelled", "AbortError");
    }
    return failure(
      "superseded",
      "A newer human or agent request replaced this analysis before it completed."
    );
  }
  return compactSuccess(analysis, time.display);
}

export function createAnalyzeHazardTool(
  dependencies: AnalyzeHazardToolDependencies
): WebMCP.ModelContextTool {
  return {
    name: ANALYZE_HAZARD_TOOL_NAME,
    title: "Analyze environmental hazard",
    description:
      "Analyze place/hazard and update shared UI; skip discovery. Never infer coordinates for a named place; use only user-given coordinates or a candidate the user later selects. On needs_place_choice, do not choose or retry before a new user reply: ask and wait. After their choice, this task is still unfinished: immediately call this tool again with the selected label and retry_with coordinates, keep other arguments, and finish the result. Use single_hazard_only for one named hazard/measurement; related_context for broad or multiple conditions. Infer concern when clear; ask once for a broad goal, else general. Answer with evidence, citations, inference, confidence, and separate chains.",
    inputSchema: ANALYZE_HAZARD_INPUT_SCHEMA,
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: true,
    },
    execute: (input, options) => executeAnalyzeHazardTool(input, options, dependencies),
  };
}

export { MAX_OUTPUT_CHARACTERS };
