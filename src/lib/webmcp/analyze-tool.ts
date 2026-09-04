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
export const COMPARE_HAZARD_TOOL_NAME = "compare_environmental_evidence";
const DEFAULT_RADIUS_KM = 25;
const MAX_OUTPUT_CHARACTERS = 2_400;
export const ANSWER_ORDER = [
  "strongest_supported_assessment",
  "observation_values_times_and_official_citations",
  "direct_observation_then_labelled_inference",
  "confidence_and_evidence_that_would_change_it",
] as const;
const ANALYSIS_SCOPES = ["single_hazard_only", "related_context"] as const;
type AnalysisScope = (typeof ANALYSIS_SCOPES)[number];
const HAZARD_NAMES: Record<HazardId, string> = {
  fire_smoke: "Fire & Smoke",
  flood_storm: "Flood & Heavy Rain",
  wind_storm: "Wind & Storm",
  extreme_heat: "Extreme Heat",
  drought_land: "Drought & Land",
  air_quality: "Air Quality",
  earth_volcanoes: "Earth & Volcanoes",
};
const STRICT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F-\u009F]/;
const COORDINATE_PLACE_RE = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/;
const GENERIC_STORM_QUESTION_RE = /\b(?:hurricane|severe weather|storms?|stormy|thunderstorms?|tropical storm)\b|(?:暴風雨|风暴|風暴|雷暴|雷雨|惡劣天氣|恶劣天气)/iu;
const EXPLICIT_STORM_CHAIN_RE = /\b(?:flood|flooding|gage|gauge|gust|hail|inundation|rain|rainfall|river|stream|tornado|water|wind)\b|(?:強風|强风|陣風|阵风|冰雹|龍捲風|龙卷风|降雨|雨量|淹水|洪水|水位|河川)/iu;

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
  "place_choice_id",
  "hazard",
  "concern",
  "radius_km",
  "time",
  "question",
  "analysis_scope",
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
  placeChoiceId?: string;
  hazard: HazardId;
  analysisScope: AnalysisScope;
  concern: ConcernType;
  latitude?: number;
  longitude?: number;
  radiusKm: number;
  startDate?: string;
  endDate?: string;
  question?: string;
}

interface GeocodeCandidate {
  id?: string;
  label: string;
  lon: number;
  lat: number;
}

export interface AgentPlaceChoice {
  choice_id: string;
  label: string;
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
  reason?: "rate_limited";
  choices?: AgentPlaceChoice[];
  requires_user_input?: true;
  required_next_action?: "ask_user_to_choose_place_and_wait";
  must_not_select_place?: true;
  must_not_retry_before_user_reply?: true;
  after_user_choice?: {
    required_next_action: "retry_analysis_with_selected_place";
    continue_task: true;
    set_place_choice_id_to_selected_choice_id: true;
    preserve_original_place: true;
    preserve_other_arguments: true;
    retry_with_original_arguments: {
      place: string;
      hazard: HazardId;
      analysis_scope: AnalysisScope;
      concern: ConcernType;
      radius_km: number;
      time: string;
      question?: string;
    };
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
  required_answer_boundary?: "no_observations_do_not_prove_safety";
  required_final_answer_sentence?: "No observations were returned; this does not prove safety or no danger.";
}

type EvidenceScope = ToolSuccess["evidence_scope"];

interface CompactEvidenceChain {
  hazard: HazardId;
  name: string;
  evidence_scope: EvidenceScope;
  status_summary: string;
  observation?: CompactObservation | null;
  citation?: CompactCitation | null;
  confidence: EvidenceObject["confidence"]["level"] | "insufficient";
  limitation?: string | null;
}

interface CrossSourceSynthesis {
  directly_observed: string[];
  supported_inference: string;
  still_unknown: string[];
  source_status: {
    official_sources_returned: number;
    failed_or_incomplete_checks: string[];
  };
  what_would_change_conclusion: string[];
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
  answer_order?: typeof ANSWER_ORDER;
  overall_summary: string;
  synthesis: CrossSourceSynthesis;
  must_report_every_chain: true;
  required_chain_reporting: "report_each_included_chain";
  agent_response_contract?: {
    style: "plain_english";
    avoid_internal_names?: true;
    use_chain_name?: true;
    use_status_summary?: true;
    use_overall_summary?: true;
    summary_first: true;
    per_chain_fields?: "status_strongest_evidence_time_source_limitation";
  };
  use_decision?: "person_decides_how_to_use_related_evidence";
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
  claim_discussion_available?: boolean;
  related_evidence_visible_in_shared_view?: true;
  no_data_is_not_no_danger?: true;
  required_answer_boundary?: "no_observations_do_not_prove_safety";
  required_final_answer_sentence?: "No observations were returned; this does not prove safety or no danger.";
}

export type AnalyzeHazardToolOutput = ToolFailure | ToolSuccess | ToolEvidenceBundle;

export const ANALYZE_HAZARD_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["place", "hazard", "time"],
  properties: {
    place: {
      type: "string",
      minLength: 2,
      maxLength: 200,
      description: "Initial call: pass the named place as stated, even if ambiguous; do not qualify it first. Strip context: 'near my Houston home' becomes 'Houston'. After a choice, keep this original query.",
    },
    place_choice_id: {
      type: ["string", "null"],
      pattern: "^place-[A-Za-z0-9._-]{3,120}$",
      description: "Initial call: use null. Only after needs_place_choice: copy the selected choice_id exactly. Never derive it from a place, label, demo, or coordinates; never invent or edit it.",
    },
    hazard: {
      type: "string",
      enum: HAZARD_IDS,
      description: "Choose a named/implied hazard; never infer from season/place/concern/generic conditions. Smoke + air uses fire_smoke/related_context. Volcano + air/heat uses earth_volcanoes/related_context. If none, ask and wait.",
    },
    analysis_scope: {
      type: "string",
      enum: ANALYSIS_SCOPES,
      description: "For generic storm/severe weather, use related_context so separate wind and water chains run at any radius. Use single_hazard_only only for explicit wind/gust or rain/flood/gage asks; Wind without question widens.",
    },
    concern: {
      type: "string",
      enum: CONCERN_TYPES,
      description: "Use pets for dog/cat/animal; health for person/family; home whenever home/roof/property/insurer appears; travel for travel. Never map pet symptoms to health. Otherwise general.",
    },
    radius_km: {
      type: "number",
      minimum: 1,
      maximum: 250,
      default: DEFAULT_RADIUS_KM,
      description: "Analysis radius in kilometres; defaults to 25.",
    },
    time: {
      type: "string",
      pattern: "^(latest_completed|\\d{4}-\\d{2}-\\d{2}(?:/\\d{4}-\\d{2}-\\d{2})?)$",
      description: "After needs_place_choice, copy retry_with_original_arguments.time exactly. Otherwise use latest_completed unless the person stated dates; never invent a date or use today.",
    },
    question: {
      type: "string",
      maxLength: 500,
      description: "Optional, except MUST copy the person's wording for unqualified storm/thunderstorm/severe weather so deterministic routing can include separate wind and water chains. Shorten only to 500 characters.",
    },
  },
} as const;

const COMPARISON_SCENARIO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["place", "time"],
  properties: {
    place: ANALYZE_HAZARD_INPUT_SCHEMA.properties.place,
    place_choice_id: ANALYZE_HAZARD_INPUT_SCHEMA.properties.place_choice_id,
    radius_km: ANALYZE_HAZARD_INPUT_SCHEMA.properties.radius_km,
    time: ANALYZE_HAZARD_INPUT_SCHEMA.properties.time,
  },
} as const;

export const COMPARE_HAZARD_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["baseline", "comparison", "hazard"],
  properties: {
    baseline: {
      ...COMPARISON_SCENARIO_SCHEMA,
      description: "The first place/time/radius scenario. Preserve any radius the person supplied.",
    },
    comparison: {
      ...COMPARISON_SCENARIO_SCHEMA,
      description: "The second place/time/radius scenario. It may differ by place, time, radius, or several of those.",
    },
    hazard: ANALYZE_HAZARD_INPUT_SCHEMA.properties.hazard,
    analysis_scope: ANALYZE_HAZARD_INPUT_SCHEMA.properties.analysis_scope,
    concern: ANALYZE_HAZARD_INPUT_SCHEMA.properties.concern,
    question: ANALYZE_HAZARD_INPUT_SCHEMA.properties.question,
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
  input: ParsedInput,
  choices: AgentPlaceChoice[],
  refreshed = false
): ToolFailure {
  const time = input.startDate && input.endDate
    ? input.startDate === input.endDate
      ? input.startDate
      : `${input.startDate}/${input.endDate}`
    : "latest_completed";
  return {
    status: "needs_place_choice",
    message: `PAUSE FOR USER: ${refreshed ? "The previous place choice no longer matches the refreshed results. I now found" : "I found"} ${choices.length} possible places for “${input.place}”. Do not select a place or retry yet. Ask the person to choose one option below, then wait for a new user message. After the person replies, continue the unfinished task: call this tool again, copy retry_with_original_arguments exactly (especially time=${time}), and add the selected choice_id as place_choice_id.`,
    ui_updated: false,
    no_data_is_not_no_danger: true,
    requires_user_input: true,
    required_next_action: "ask_user_to_choose_place_and_wait",
    must_not_select_place: true,
    must_not_retry_before_user_reply: true,
    after_user_choice: {
      required_next_action: "retry_analysis_with_selected_place",
      continue_task: true,
      set_place_choice_id_to_selected_choice_id: true,
      preserve_original_place: true,
      preserve_other_arguments: true,
      retry_with_original_arguments: {
        place: input.place,
        hazard: input.hazard,
        analysis_scope: input.analysisScope,
        concern: input.concern,
        radius_km: input.radiusKm,
        time,
        ...(input.question ? { question: input.question } : {}),
      },
    },
    choices,
  };
}

function placeChoiceId(candidate: GeocodeCandidate): string {
  const stableId = candidate.id ??
    `coordinate-${candidate.lat.toFixed(7)}-${candidate.lon.toFixed(7)}`;
  return `place-${stableId}`;
}

function placeChoices(candidates: GeocodeCandidate[]): AgentPlaceChoice[] {
  return candidates.map((candidate) => ({
    choice_id: placeChoiceId(candidate),
    label: truncate(candidate.label, 120),
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

function explicitCoordinate(place: string): GeocodeCandidate | ToolFailure | null {
  const match = COORDINATE_PLACE_RE.exec(place);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return failure("invalid_input", "The explicit latitude, longitude place is outside the valid WGS-84 range.");
  }
  return { label: place, lat, lon };
}

function shouldUseRelatedStormContext(
  hazard: HazardId,
  analysisScope: AnalysisScope,
  question: string | undefined
): boolean {
  if (analysisScope !== "single_hazard_only") return false;

  // Agent adherence must never be the only thing preserving storm evidence.
  // Wind is the primary hazard for an unqualified storm question. A narrow
  // Wind or Flood call with no preserved question therefore fails open to
  // both chains. Explicit wind/gust/hail/tornado and rain/flood/gage questions
  // remain narrow. Radius is deliberately irrelevant: the same rule applies
  // throughout the complete validated 1–250 km input range.
  if (
    (hazard === "wind_storm" || hazard === "flood_storm") &&
    question === undefined
  ) return true;
  if (hazard !== "wind_storm" && hazard !== "flood_storm") return false;
  return question !== undefined &&
    GENERIC_STORM_QUESTION_RE.test(question) &&
    !EXPLICIT_STORM_CHAIN_RE.test(question);
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
  const place = raw.place.trim();
  const coordinate = explicitCoordinate(place);
  if (coordinate && "status" in coordinate) return coordinate;
  if (
    raw.place_choice_id !== undefined &&
    raw.place_choice_id !== null &&
    (typeof raw.place_choice_id !== "string" ||
      !/^place-[A-Za-z0-9._-]{3,120}$/.test(raw.place_choice_id))
  ) {
    return failure("invalid_input", "place_choice_id must be copied unchanged from a prior needs_place_choice result.");
  }
  if (coordinate && typeof raw.place_choice_id === "string") {
    return failure("invalid_input", "place_choice_id cannot be combined with an explicit coordinate place.");
  }
  const analysisScope = raw.analysis_scope ?? "related_context";
  if (
    typeof analysisScope !== "string" ||
    !(ANALYSIS_SCOPES as readonly string[]).includes(analysisScope)
  ) {
    return failure("invalid_input", `analysis_scope must be one of: ${ANALYSIS_SCOPES.join(", ")}.`);
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
  const question = typeof raw.question === "string" ? raw.question.trim() : undefined;
  const effectiveAnalysisScope = shouldUseRelatedStormContext(
    raw.hazard as HazardId,
    analysisScope as AnalysisScope,
    question
  )
    ? "related_context"
    : analysisScope as AnalysisScope;
  const concern = raw.concern ?? "general";
  if (
    typeof concern !== "string" ||
    !(CONCERN_TYPES as readonly string[]).includes(concern)
  ) {
    return failure("invalid_input", `concern must be one of: ${CONCERN_TYPES.join(", ")}.`);
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

  if (typeof raw.time !== "string") {
    return failure("invalid_input", "time must be latest_completed, YYYY-MM-DD, or YYYY-MM-DD/YYYY-MM-DD.");
  }
  const timeParts = raw.time === "latest_completed" ? [] : raw.time.split("/");
  if (
    timeParts.length > 2 ||
    timeParts.some((part) => !isStrictUtcDate(part))
  ) {
    return failure("invalid_input", "time dates must be real calendar dates in YYYY-MM-DD format.");
  }
  const startDate = timeParts[0];
  const endDate = timeParts.at(-1);
  const latestCompleted = latestCompletedUtcDate(now);
  if (
    startDate !== undefined &&
    endDate !== undefined &&
    (startDate > endDate || endDate > latestCompleted)
  ) {
    return failure(
      "invalid_input",
      `Use an ordered range ending on or before the latest completed UTC date, ${latestCompleted}.`
    );
  }
  if (
    startDate !== undefined &&
    endDate !== undefined &&
    (effectiveAnalysisScope === "related_context" ||
      (raw.hazard !== "fire_smoke" && raw.hazard !== "flood_storm")) &&
    startDate !== endDate
  ) {
    return failure(
      "invalid_input",
      effectiveAnalysisScope === "related_context"
        ? "related_context accepts one completed UTC date so every evidence chain has the same temporal anchor."
        : `${raw.hazard} accepts exactly one completed UTC date.`
    );
  }

  return {
    place,
    ...(typeof raw.place_choice_id === "string"
      ? { placeChoiceId: raw.place_choice_id }
      : {}),
    hazard: raw.hazard as HazardId,
    analysisScope: effectiveAnalysisScope,
    concern: concern as ConcernType,
    ...(coordinate ? { latitude: coordinate.lat, longitude: coordinate.lon } : {}),
    radiusKm,
    ...(startDate !== undefined && endDate !== undefined
      ? { startDate, endDate }
      : {}),
    ...(question ? { question } : {}),
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

  if (response.status === 429) {
    return {
      ...failure("place_lookup_failed", "Place search was rate-limited; no evidence query was run."),
      reason: "rate_limited",
    };
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
      ...(typeof item.id === "string" && /^[A-Za-z0-9._-]{3,120}$/.test(item.id)
        ? { id: item.id }
        : {}),
      label: item.label as string,
      lon: item.lon as number,
      lat: item.lat as number,
    }));

  if (candidates.length === 0) {
    return failure("place_not_found", `No place candidate was found for “${input.place}”.`);
  }
  if (input.placeChoiceId !== undefined) {
    const selected = candidates.find(
      (candidate) => placeChoiceId(candidate) === input.placeChoiceId
    );
    if (selected) return selected;
    return placeChoiceFailure(input, placeChoices(candidates), true);
  }
  if (candidates.length > 1) {
    return placeChoiceFailure(input, placeChoices(candidates));
  }
  return candidates[0];
}

function namedPlaceResolutionKey(input: ParsedInput): string | null {
  if (input.latitude !== undefined && input.longitude !== undefined) {
    return null;
  }
  const normalizedPlace = input.place
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
  return normalizedPlace;
}

function canShareNamedPlaceResolution(
  baseline: ParsedInput,
  comparison: ParsedInput
): boolean {
  const baselineKey = namedPlaceResolutionKey(baseline);
  if (baselineKey === null || baselineKey !== namedPlaceResolutionKey(comparison)) {
    return false;
  }
  return comparison.placeChoiceId === undefined ||
    baseline.placeChoiceId === comparison.placeChoiceId;
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

function observationPriority(observation: Observation): number {
  const source = observation.provenance.sourceId;
  if (source === "nws_local_storm_reports") return 0;
  if (
    source === "noaa_ncei_global_hourly" ||
    source === "usgs_instantaneous_values" ||
    source === "canada_geomet" ||
    source === "noaa_uscrn_heat_exposure" ||
    source === "nws_station_observations"
  ) return 1;
  if (source === "nws_tropical_cyclone_report") return 2;
  if (source === "nasa_lance_flood_extent") return 3;
  return 4;
}

export function orderedEvidenceObservations(evidence: EvidenceObject): Observation[] {
  return [...evidence.observations].sort((left, right) =>
    observationPriority(left) - observationPriority(right) ||
    left.provenance.observedAt.localeCompare(right.provenance.observedAt) ||
    left.observationId.localeCompare(right.observationId)
  );
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
  const orderedObservations = evidence ? orderedEvidenceObservations(evidence) : [];
  const citations = evidence
    ? orderedObservations
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
          observations: orderedObservations.slice(0, 3).map(compactObservation),
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
    ...(observationCount === 0
      ? {
          no_data_is_not_no_danger: true as const,
          required_answer_boundary: "no_observations_do_not_prove_safety" as const,
          required_final_answer_sentence: "No observations were returned; this does not prove safety or no danger." as const,
        }
      : {}),
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
  const observation = evidence ? orderedEvidenceObservations(evidence)[0] : undefined;
  const limitation = details.rejectionReason ?? details.limitations[0] ?? null;
  return {
    hazard: analysis.request.hazardId,
    name: HAZARD_NAMES[analysis.request.hazardId],
    evidence_scope: evidenceScopeForHazard(analysis.request.hazardId),
    status_summary: ({
      success: "observations returned",
      no_observation: "no matching observation returned",
      unsupported_coverage: "not supported for this area",
      source_failure: "source retrieval failed",
      invalid_request: "invalid request",
      not_applicable: "not applicable",
    } as Record<string, string>)[details.kind] ?? details.kind.replaceAll("_", " "),
    observation: observation ? compactObservation(observation) : null,
    citation: observation ? compactCitation(observation) : null,
    confidence: evidence?.confidence.level ?? "insufficient",
    limitation: limitation ? truncate(limitation, 130) : null,
  };
}

function synthesizeAnalyses(analyses: ActiveAnalysis[]): CrossSourceSynthesis {
  const chains = analyses.map((analysis) => ({
    analysis,
    details: resultDetails(analysis),
  }));
  const withObservations = chains.filter(
    ({ details }) => (details.evidence?.observations.length ?? 0) > 0
  );
  const failedOrIncomplete = new Set<string>();
  for (const { details } of chains) {
    for (const attribution of details.evidence?.missionAttributions ?? []) {
      if (attribution.retrievalStatus === "failed" || attribution.retrievalStatus === "partial") {
        failedOrIncomplete.add(truncate(attribution.missionName, 55));
      }
    }
    for (const limitation of details.evidence?.limitations ?? []) {
      if (/\b(?:failed|failure|partially completed)\b/iu.test(limitation.description)) {
        failedOrIncomplete.add(truncate(limitation.source, 55));
      }
    }
  }
  const directlyObserved = withObservations.slice(0, 3).map(({ analysis, details }) => {
    const observation = orderedEvidenceObservations(details.evidence!)[0];
    return truncate(
      `${HAZARD_NAMES[analysis.request.hazardId]}: ${observation.variableName} from ${observation.provenance.sourceId} at ${observation.provenance.observedAt}`,
      145
    );
  });
  const missingChains = chains
    .filter(({ details }) => (details.evidence?.observations.length ?? 0) === 0)
    .map(({ analysis }) => HAZARD_NAMES[analysis.request.hazardId]);
  return {
    directly_observed: directlyObserved,
    supported_inference: withObservations.length >= 2
      ? "Independent official observations across multiple chains support combined regional context; they do not establish causation or property-level impact."
      : withObservations.length === 1
        ? "One chain has direct observations; cross-chain reinforcement is not established."
        : "No cross-chain inference is supported because no direct observation was returned.",
    still_unknown: [
      ...(missingChains.length > 0
        ? [`No direct observation returned for: ${missingChains.join(", ")}.`]
        : []),
      "Property-level impact, route safety, and causation remain unknown.",
    ].slice(0, 2),
    source_status: {
      official_sources_returned: new Set(withObservations.flatMap(({ details }) =>
        details.evidence?.observations.map((observation) => observation.provenance.sourceId) ?? []
      )).size,
      failed_or_incomplete_checks: [...failedOrIncomplete].slice(0, 3),
    },
    what_would_change_conclusion: [
      ...(missingChains.length > 0
        ? [`A direct official observation in the missing ${missingChains.join(" / ")} chain.`]
        : []),
      ...(failedOrIncomplete.size > 0
        ? ["A successful retry of the failed or incomplete official-source checks."]
        : []),
      "A local inspection or official route/property report for address-level conclusions.",
    ].slice(0, 2),
  };
}

function compactEvidenceBundle(
  analyses: ActiveAnalysis[],
  primary: ActiveAnalysis,
  timeDisplay: string
): ToolEvidenceBundle {
  const includedChains = analyses.map((analysis) => analysis.request.hazardId);
  const compactChains = analyses.map(compactEvidenceChain);
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
    overall_summary: compactChains
      .map((chain) => `${chain.name}: ${chain.status_summary}`)
      .join("; "),
    synthesis: synthesizeAnalyses(analyses),
    must_report_every_chain: true,
    required_chain_reporting: "report_each_included_chain",
    agent_response_contract: {
      style: "plain_english",
      avoid_internal_names: true,
      use_chain_name: true,
      use_status_summary: true,
      use_overall_summary: true,
      summary_first: true,
      per_chain_fields: "status_strongest_evidence_time_source_limitation",
    },
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
    chains: compactChains,
    claim_discussion_available:
      primary.outcome.hazardId === "wind_storm" && Boolean(primary.outcome.result.claimDiscussion),
    related_evidence_visible_in_shared_view: true,
    ...(chainsWithObservations === 0
      ? {
          no_data_is_not_no_danger: true as const,
          required_answer_boundary: "no_observations_do_not_prove_safety" as const,
          required_final_answer_sentence: "No observations were returned; this does not prove safety or no danger." as const,
        }
      : {}),
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

  const finalBundle: ToolEvidenceBundle = {
    ...primaryUrlOnly,
    analysis_id: truncate(primaryUrlOnly.analysis_id, 24),
    request: {
      ...primaryUrlOnly.request,
      place: truncate(primaryUrlOnly.request.place, 40),
    },
    chains: primaryUrlOnly.chains.map((chain) => ({
      hazard: chain.hazard,
      name: chain.name,
      evidence_scope: chain.evidence_scope,
      status_summary: chain.status_summary,
      confidence: chain.confidence,
      ...(chain.citation
        ? {
            citation: {
              ...chain.citation,
              product: truncate(chain.citation.product, 20),
              url: null,
            },
          }
        : {}),
    })),
    synthesis: {
      directly_observed: primaryUrlOnly.synthesis.directly_observed
        .slice(0, 1)
        .map((item) => truncate(item, 60)),
      supported_inference: primaryUrlOnly.synthesis.directly_observed.length >= 2
        ? "Multiple chains add regional context; they do not prove causation."
        : primaryUrlOnly.synthesis.directly_observed.length === 1
          ? "One chain has direct evidence; cross-chain support is incomplete."
          : "No direct observation supports a cross-chain inference.",
      still_unknown: primaryUrlOnly.synthesis.still_unknown
        .slice(0, 1)
        .map((item) => truncate(item, 50)),
      source_status: {
        official_sources_returned:
          primaryUrlOnly.synthesis.source_status.official_sources_returned,
        failed_or_incomplete_checks:
          primaryUrlOnly.synthesis.source_status.failed_or_incomplete_checks
            .slice(0, 1)
            .map((item) => truncate(item, 45)),
      },
      what_would_change_conclusion:
        primaryUrlOnly.synthesis.what_would_change_conclusion
          .slice(0, 1)
          .map((item) => truncate(item, 55)),
    },
    claim_discussion_available: primaryUrlOnly.claim_discussion_available || undefined,
  };
  if (JSON.stringify(finalBundle).length <= MAX_OUTPUT_CHARACTERS) return finalBundle;
  const {
    use_decision: omittedUseDecision,
    related_evidence_visible_in_shared_view: omittedVisibleReceipt,
    ...mostCompact
  } = finalBundle;
  void omittedUseDecision;
  void omittedVisibleReceipt;
  return {
    ...mostCompact,
    agent_response_contract: {
      style: "plain_english",
      summary_first: true,
    },
  };
}

function plannedHazards(input: ParsedInput): HazardId[] {
  if (input.analysisScope === "single_hazard_only") return [input.hazard];
  const related = DEFAULT_RELATED_HAZARDS[input.hazard]
    .filter((hazard) => hazard !== input.hazard);
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
    const investigationId = `analysis-bundle-${now.getTime()}`;
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
          investigationId,
          investigationKind: "analysis",
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

const COMPARISON_INPUT_KEYS = new Set([
  "baseline",
  "comparison",
  "hazard",
  "analysis_scope",
  "concern",
  "question",
]);

function comparisonScenarioInput(
  raw: Record<string, unknown>,
  scenario: "baseline" | "comparison",
  now: Date
): ParsedInput | ToolFailure {
  const scenarioValue = raw[scenario];
  if (!isRecord(scenarioValue)) {
    return failure("invalid_input", `${scenario} must contain place, time, and an optional radius_km.`);
  }
  return parseInput({
    ...scenarioValue,
    hazard: raw.hazard,
    analysis_scope: raw.analysis_scope,
    concern: raw.concern,
    question: raw.question,
  }, now);
}

function comparisonPlaceFailure(
  scenario: "baseline" | "comparison",
  input: ToolFailure,
  rawInput: Record<string, unknown>
) {
  if (input.status !== "needs_place_choice") {
    return {
      ...input,
      failed_scenario: scenario,
    };
  }
  return {
    ...input,
    message: `PAUSE FOR USER: the ${scenario} place is ambiguous. Ask the person to choose one option, wait for a new user message, then retry this comparison with every original argument unchanged and set only ${scenario}.place_choice_id to the selected choice_id.`,
    ambiguous_scenario: scenario,
    after_user_choice: {
      required_next_action: "retry_comparison_with_selected_place" as const,
      continue_task: true,
      preserve_all_other_arguments: true,
      set_selected_choice_at: `${scenario}.place_choice_id`,
      retry_with_original_arguments: rawInput,
    },
  };
}

function scenarioLabel(
  prefix: "Baseline" | "Comparison",
  selection: PlaceSelection,
  timeDisplay: string
): string {
  return truncate(`${prefix}: ${selection.label} · ${timeDisplay}`, 120);
}

function comparisonSummary(analyses: ActiveAnalysis[]) {
  const byScenario = new Map<string, ActiveAnalysis[]>();
  for (const analysis of analyses) {
    const id = analysis.request.evidenceBundle?.scenarioId ?? "unknown";
    byScenario.set(id, [...(byScenario.get(id) ?? []), analysis]);
  }
  const baseline = byScenario.get("baseline") ?? [];
  const comparison = byScenario.get("comparison") ?? [];
  const baselineByHazard = new Map(baseline.map((analysis) => [analysis.request.hazardId, analysis]));
  const comparisonByHazard = new Map(comparison.map((analysis) => [analysis.request.hazardId, analysis]));
  const agreements: string[] = [];
  const differences: string[] = [];
  const unknowns: string[] = [];
  for (const hazard of [...new Set([...baselineByHazard.keys(), ...comparisonByHazard.keys()])]) {
    const left = baselineByHazard.get(hazard);
    const right = comparisonByHazard.get(hazard);
    if (!left || !right) continue;
    const leftDetails = resultDetails(left);
    const rightDetails = resultDetails(right);
    const leftCount = leftDetails.evidence?.observations.length ?? 0;
    const rightCount = rightDetails.evidence?.observations.length ?? 0;
    if (leftCount > 0 && rightCount > 0) {
      agreements.push(`${HAZARD_NAMES[hazard]} has direct official observations in both scenarios.`);
    } else if (leftCount !== rightCount) {
      differences.push(
        `${HAZARD_NAMES[hazard]} returned direct observations in ${leftCount > 0 ? "the baseline" : "the comparison"} only.`
      );
    } else {
      unknowns.push(`${HAZARD_NAMES[hazard]} returned no direct observation in either scenario.`);
    }
    if (leftDetails.kind !== rightDetails.kind) {
      differences.push(
        `${HAZARD_NAMES[hazard]} evidence status differs: baseline ${leftDetails.kind.replaceAll("_", " ")}; comparison ${rightDetails.kind.replaceAll("_", " ")}.`
      );
    }
  }
  return {
    agreements: agreements.slice(0, 2),
    differences: differences.slice(0, 3),
    unknowns: [
      ...unknowns.slice(0, 1),
      "Differences in evidence availability do not by themselves prove a difference in hazard severity.",
    ],
  };
}

export async function executeCompareHazardTool(
  rawInput: Record<string, unknown>,
  options: WebMCP.ToolExecuteCallbackOptions | undefined,
  dependencies: AnalyzeHazardToolDependencies
): Promise<unknown> {
  const unexpected = Object.keys(rawInput).find((key) => !COMPARISON_INPUT_KEYS.has(key));
  if (unexpected) return failure("invalid_input", `Unexpected input field: ${unexpected}.`);
  const signal = options?.signal ?? new AbortController().signal;
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Tool execution cancelled", "AbortError");
  }
  const now = dependencies.now?.() ?? new Date();
  const baselineInput = comparisonScenarioInput(rawInput, "baseline", now);
  if ("status" in baselineInput) return baselineInput;
  const comparisonInput = comparisonScenarioInput(rawInput, "comparison", now);
  if ("status" in comparisonInput) return comparisonInput;

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const shareNamedPlaceResolution = canShareNamedPlaceResolution(
    baselineInput,
    comparisonInput
  );
  const baselineResolved = await resolvePlace(baselineInput, fetchImpl, signal);
  if ("status" in baselineResolved) {
    return comparisonPlaceFailure("baseline", baselineResolved, rawInput);
  }
  const comparisonResolved = shareNamedPlaceResolution
    ? baselineResolved
    : await resolvePlace(comparisonInput, fetchImpl, signal);
  if ("status" in comparisonResolved) {
    return comparisonPlaceFailure("comparison", comparisonResolved, rawInput);
  }

  const baselineTime = selectionTime(baselineInput, now);
  const comparisonTime = selectionTime(comparisonInput, now);
  let baselineSelection: PlaceSelection;
  let comparisonSelection: PlaceSelection;
  try {
    baselineSelection = buildSelection(
      baselineInput,
      baselineResolved,
      baselineTime,
      baselineInput.latitude !== undefined ? "agent" : "geocoder"
    );
    comparisonSelection = buildSelection(
      comparisonInput,
      comparisonResolved,
      comparisonTime,
      comparisonInput.latitude !== undefined ? "agent" : "geocoder"
    );
  } catch (error) {
    return failure(
      "invalid_input",
      error instanceof Error ? error.message : "One comparison scenario was invalid."
    );
  }

  const scenarioInputs = [
    {
      id: "baseline",
      order: 0,
      input: baselineInput,
      selection: baselineSelection,
      time: baselineTime,
      label: scenarioLabel("Baseline", baselineSelection, baselineTime.display),
    },
    {
      id: "comparison",
      order: 1,
      input: comparisonInput,
      selection: comparisonSelection,
      time: comparisonTime,
      label: scenarioLabel("Comparison", comparisonSelection, comparisonTime.display),
    },
  ] as const;
  const investigationId = `comparison-${now.getTime()}`;
  const requestDrafts = scenarioInputs.flatMap((scenario) =>
    plannedHazards(scenario.input).map((hazardId) => ({ scenario, hazardId }))
  );
  const includedHazards = [...new Set(requestDrafts.map((item) => item.hazardId))];
  const requests = requestDrafts.map(({ scenario, hazardId }, index): AnalysisRequest => ({
    hazardId,
    concern: scenario.input.concern,
    placeSelection: scenario.selection,
    ...(scenario.input.question ? { optionalQuestion: scenario.input.question } : {}),
    evidenceMode: "live",
    evidenceBundle: {
      primaryHazardId: scenario.input.hazard,
      includedHazardIds: includedHazards,
      role: index === 0
        ? "start_context"
        : index === requestDrafts.length - 1
          ? "primary"
          : "context",
      investigationId,
      investigationKind: "comparison",
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      scenarioOrder: scenario.order,
    },
  }));

  let analyses: ActiveAnalysis[] | null;
  if (dependencies.runAnalysisBundle) {
    analyses = await dependencies.runAnalysisBundle(requests, "agent", signal);
  } else {
    analyses = [];
    for (const request of requests) {
      const analysis = await dependencies.runAnalysis(request, "agent", signal);
      if (analysis === null) {
        analyses = null;
        break;
      }
      analyses.push(analysis);
    }
  }
  if (analyses === null) {
    return failure("superseded", "A newer request replaced the comparison before every evidence chain completed.");
  }

  const groupedScenarios = scenarioInputs.map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    place: truncate(scenario.selection.label, 80),
    radius_km: scenario.selection.analysisArea.radiusKm,
    time: scenario.time.display,
    chains: analyses!
      .filter((analysis) => analysis.request.evidenceBundle?.scenarioId === scenario.id)
      .map(compactEvidenceChain),
  }));
  const output = {
    status: "environmental_evidence_comparison",
    analysis_id: investigationId,
    ui_updated: true,
    evidence_scope: "separate_scenarios_and_hazard_chains",
    must_report_every_scenario_and_chain: true,
    agent_response_contract: {
      style: "plain_english",
      summary_first: true,
      report_agreements_differences_and_unknowns: true,
      never_treat_missing_data_as_no_hazard: true,
    },
    scenarios: groupedScenarios,
    comparison: comparisonSummary(analyses),
    synthesis: synthesizeAnalyses(analyses),
  };
  if (JSON.stringify(output).length <= MAX_OUTPUT_CHARACTERS) return output;
  const reduced = {
    ...output,
    scenarios: output.scenarios.map((scenario) => ({
      ...scenario,
      chains: scenario.chains.map((chain) => ({
        hazard: chain.hazard,
        name: chain.name,
        evidence_scope: chain.evidence_scope,
        status_summary: chain.status_summary,
        confidence: chain.confidence,
        ...(chain.citation
          ? { citation: { ...chain.citation, product: "official source", url: null } }
          : {}),
      })),
    })),
    synthesis: {
      ...output.synthesis,
      directly_observed: output.synthesis.directly_observed.slice(0, 2),
      what_would_change_conclusion: output.synthesis.what_would_change_conclusion.slice(0, 1),
    },
  };
  return reduced;
}

export function createAnalyzeHazardTool(
  dependencies: AnalyzeHazardToolDependencies
): WebMCP.ModelContextTool {
  return {
    name: ANALYZE_HAZARD_TOOL_NAME,
    title: "Analyze environmental hazard",
    description:
      "Analyze place+hazard. Call help first for demos. If unclear, ask and wait; season/place/goal alone implies none. First named-place call: pass as stated; set place_choice_id=null; never pre-qualify place. Use latest_completed unless dates given; never today. After the reply, copy selected choice_id to place_choice_id, preserve inputs, execute and finish. For unqualified storm/thunderstorm/severe weather: use wind_storm+related_context and copy question; single_hazard_only needs explicit wind/water. For related_context, plain English: overall summary; every chain's status, strongest evidence, time, source, limitation; no field/enum names. Infer concern; else general.",
    inputSchema: ANALYZE_HAZARD_INPUT_SCHEMA,
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: true,
    },
    execute: (input, options) => executeAnalyzeHazardTool(input, options, dependencies),
  };
}

export function createCompareHazardTool(
  dependencies: AnalyzeHazardToolDependencies
): WebMCP.ModelContextTool {
  return {
    name: COMPARE_HAZARD_TOOL_NAME,
    title: "Compare environmental evidence",
    description:
      "Compare two place/time/radius scenarios through the same validated evidence pipeline. Use when the person asks what changed, which place/time had stronger evidence, or to compare before/after. Preserve each stated radius. For generic storm use wind_storm + related_context so both Wind & Storm and Flood & Heavy Rain run in both scenarios. Report every scenario and every chain in plain English, then agreements, differences, unknowns, confidence, and what evidence would change the conclusion.",
    inputSchema: COMPARE_HAZARD_INPUT_SCHEMA,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: (input, options) => executeCompareHazardTool(input, options, dependencies),
  };
}

export { MAX_OUTPUT_CHARACTERS };
