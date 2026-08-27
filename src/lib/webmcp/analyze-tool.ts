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
const MAX_OUTPUT_CHARACTERS = 1_500;
const AGENT_HAZARD_IDS = [...HAZARD_IDS, "storm_impacts"] as const;
type AgentHazardId = (typeof AGENT_HAZARD_IDS)[number];
const STRICT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F-\u009F]/;

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
]);

export interface AnalyzeHazardToolDependencies {
  runAnalysis: (
    request: AnalysisRequest,
    origin?: "agent",
    signal?: AbortSignal
  ) => Promise<ActiveAnalysis | null>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface ParsedInput {
  place: string;
  hazard: AgentHazardId;
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
}

interface CompactObservation {
  name: string;
  value: number | string;
  unit?: string;
  source: string;
  observed_at: string;
}

interface ToolSuccess {
  status: string;
  analysis_id: string;
  ui_updated: true;
  evidence_scope:
    | "wind_only_no_rain_flood_or_water_gages"
    | "water_only_no_wind_damage_causation"
    | "selected_hazard_only";
  request: {
    place: string;
    hazard: AgentHazardId;
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
  limitations: string[];
  verify_urls: string[];
  no_data_is_not_no_danger: true;
}

interface CompactStormChain {
  hazard: "wind_storm" | "flood_storm";
  evidence_scope:
    | "wind_only_no_rain_flood_or_water_gages"
    | "water_only_no_wind_damage_causation";
  status: string;
  observation: CompactObservation | null;
  limitation: string | null;
  verify_url: string | null;
}

interface ToolStormBundle {
  status: "storm_evidence_bundle";
  analysis_id: string;
  ui_updated: true;
  evidence_scope: "separate_wind_and_water_chains";
  request: {
    place: string;
    hazard: "storm_impacts";
    concern: ConcernType;
    radius_km: number;
    time: string;
  };
  chains: { wind: CompactStormChain; water: CompactStormChain };
  claim_discussion_available: boolean;
  water_evidence_visible_in_shared_view: true;
  no_data_is_not_no_danger: true;
}

export type AnalyzeHazardToolOutput = ToolFailure | ToolSuccess | ToolStormBundle;

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
      enum: AGENT_HAZARD_IDS,
      description: "Use storm_impacts for broad storm damage or claim questions; it gathers separate wind and water chains. Use one hazard only for a narrow ask.",
    },
    concern: {
      type: "string",
      enum: CONCERN_TYPES,
      default: "home",
      description: "User context; defaults to home.",
    },
    latitude: {
      type: "number",
      minimum: -90,
      maximum: 90,
      description: "Latitude for an already chosen place candidate; requires longitude.",
    },
    longitude: {
      type: "number",
      minimum: -180,
      maximum: 180,
      description: "Longitude for an already chosen place candidate; requires latitude.",
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
      description: "Optional user question to acknowledge without inventing evidence.",
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

function placeChoices(candidates: GeocodeCandidate[]): AgentPlaceChoice[] {
  return candidates.map((candidate, index) => ({
    choice_id: `place-${index + 1}`,
    label: candidate.label,
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
    !(AGENT_HAZARD_IDS as readonly string[]).includes(raw.hazard)
  ) {
    return failure("invalid_input", `hazard must be one of: ${AGENT_HAZARD_IDS.join(", ")}.`);
  }
  const concern = raw.concern ?? "home";
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
    raw.hazard !== "fire_smoke" &&
    raw.hazard !== "flood_storm" &&
    raw.start_date !== raw.end_date
  ) {
    return failure("invalid_input", `${raw.hazard} accepts exactly one completed UTC date.`);
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
    hazard: raw.hazard as AgentHazardId,
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
  if (input.hazard === "fire_smoke") {
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
    return failure(
      "needs_place_choice",
      `I found ${candidates.length} possible places for “${input.place}”. Ask the person to choose one by label. Keep every other input unchanged, then retry with that choice's coordinates.`,
      placeChoices(candidates)
    );
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
  const verifyUrls = evidence
    ? [...new Set(
        evidence.observations
          .map((observation) => observation.provenance.sourceUrl)
          .filter(
            (url): url is string =>
              typeof url === "string" && url.length <= 300
          )
      )]
    : [];

  const base: ToolSuccess = {
    status: details.kind,
    analysis_id: analysis.analysisId,
    ui_updated: true,
    evidence_scope: analysis.request.hazardId === "wind_storm"
      ? "wind_only_no_rain_flood_or_water_gages"
      : analysis.request.hazardId === "flood_storm"
        ? "water_only_no_wind_damage_causation"
        : "selected_hazard_only",
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
    limitations: limitations.slice(0, 3).map((item) => truncate(item, 180)),
    verify_urls: verifyUrls.slice(0, 2),
    no_data_is_not_no_danger: true,
  };

  if (JSON.stringify(base).length <= MAX_OUTPUT_CHARACTERS) return base;
  const reduced: ToolSuccess = {
    ...base,
    evidence: base.evidence
      ? { ...base.evidence, observations: base.evidence.observations.slice(0, 1) }
      : null,
    limitations: base.limitations.slice(0, 1).map((item) => truncate(item, 120)),
    verify_urls: base.verify_urls.slice(0, 1),
  };
  return reduced;
}

function compactStormChain(
  analysis: ActiveAnalysis,
  hazard: "wind_storm" | "flood_storm"
): CompactStormChain {
  const details = resultDetails(analysis);
  const evidence = details.evidence;
  const observation = evidence?.observations[0];
  const limitation = details.rejectionReason ?? details.limitations[0] ?? null;
  const verifyUrl = evidence?.observations
    .map((item) => item.provenance.sourceUrl)
    .find((url): url is string => typeof url === "string" && url.length <= 300) ?? null;
  return {
    hazard,
    evidence_scope: hazard === "wind_storm"
      ? "wind_only_no_rain_flood_or_water_gages"
      : "water_only_no_wind_damage_causation",
    status: details.kind,
    observation: observation ? compactObservation(observation) : null,
    limitation: limitation ? truncate(limitation, 130) : null,
    verify_url: verifyUrl,
  };
}

function compactStormBundle(
  wind: ActiveAnalysis,
  water: ActiveAnalysis,
  timeDisplay: string
): ToolStormBundle {
  const bundle: ToolStormBundle = {
    status: "storm_evidence_bundle",
    analysis_id: `storm-bundle:${wind.analysisId}:${water.analysisId}`,
    ui_updated: true,
    evidence_scope: "separate_wind_and_water_chains",
    request: {
      place: truncate(wind.request.placeSelection.label, 100),
      hazard: "storm_impacts",
      concern: wind.request.concern,
      radius_km: wind.request.placeSelection.analysisArea.radiusKm,
      time: timeDisplay,
    },
    chains: {
      wind: compactStormChain(wind, "wind_storm"),
      water: compactStormChain(water, "flood_storm"),
    },
    claim_discussion_available:
      wind.outcome.hazardId === "wind_storm" && Boolean(wind.outcome.result.claimDiscussion),
    water_evidence_visible_in_shared_view: true,
    no_data_is_not_no_danger: true,
  };
  if (JSON.stringify(bundle).length <= MAX_OUTPUT_CHARACTERS) return bundle;
  return {
    ...bundle,
    chains: {
      wind: { ...bundle.chains.wind, observation: null, verify_url: null },
      water: { ...bundle.chains.water, observation: null, verify_url: null },
    },
  };
}

export async function executeAnalyzeHazardTool(
  rawInput: Record<string, unknown>,
  options: WebMCP.ToolExecuteCallbackOptions,
  dependencies: AnalyzeHazardToolDependencies
): Promise<AnalyzeHazardToolOutput> {
  if (options.signal.aborted) {
    throw options.signal.reason ?? new DOMException("Tool execution cancelled", "AbortError");
  }
  const now = dependencies.now?.() ?? new Date();
  const input = parseInput(rawInput, now);
  if ("status" in input) return input;

  const resolved = await resolvePlace(
    input,
    dependencies.fetchImpl ?? fetch,
    options.signal
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

  if (input.hazard === "storm_impacts") {
    const commonRequest = {
      concern: input.concern,
      placeSelection,
      ...(input.question ? { optionalQuestion: input.question } : {}),
      evidenceMode: "live" as const,
    };
    const water = await dependencies.runAnalysis(
      { ...commonRequest, hazardId: "flood_storm", stormBundleRole: "water" },
      "agent",
      options.signal
    );
    if (water === null) {
      return failure(
        "superseded",
        "A newer request replaced the storm investigation before both evidence chains completed."
      );
    }
    const wind = await dependencies.runAnalysis(
      { ...commonRequest, hazardId: "wind_storm", stormBundleRole: "wind" },
      "agent",
      options.signal
    );
    if (wind === null) {
      return failure(
        "superseded",
        "A newer request replaced the storm investigation before both evidence chains completed."
      );
    }
    return compactStormBundle(wind, water, time.display);
  }

  const analysis = await dependencies.runAnalysis(
    {
      hazardId: input.hazard as HazardId,
      concern: input.concern,
      placeSelection,
      ...(input.question ? { optionalQuestion: input.question } : {}),
      evidenceMode: "live",
    },
    "agent",
    options.signal
  );
  if (analysis === null) {
    if (options.signal.aborted) {
      throw options.signal.reason ?? new DOMException("Tool execution cancelled", "AbortError");
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
      "Resolve a place, retrieve bounded evidence, and synchronize Sky to Porch. For broad storm damage or claim questions, use storm_impacts: it automatically gathers separate wind and water chains. Use wind_storm or flood_storm only for a clearly narrow question. Ambiguous places require user choice. Missing data never means no danger.",
    inputSchema: ANALYZE_HAZARD_INPUT_SCHEMA,
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: true,
    },
    execute: (input, options) => executeAnalyzeHazardTool(input, options, dependencies),
  };
}

export { MAX_OUTPUT_CHARACTERS };
