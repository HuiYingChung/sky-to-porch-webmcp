import { createHash } from "crypto";
import { CONCERN_TYPES, type ConcernType } from "@/contracts/common";
import { validateQueryableSourceId } from "@/contracts/dataset-registry";
import {
  validateEvidenceObject,
  validateObservation,
  type EvidenceObject,
  type Limitation,
  type MissionAttribution,
  type Observation,
} from "@/contracts/evidence";
import { normalizeOptionalQuestion } from "@/lib/ai/optional-question";
import { CUSTOM_AREA_PLACE_ID, validateCanonicalAreaQuery } from "@/lib/location/query-area";
import {
  queryAtmosphericSatellite,
  type AtmosphericFailureReason,
} from "./atmospheric-live-adapter";
import {
  assertAtmosphericSourceReadiness,
  buildAtmosphericRequest,
} from "./atmospheric-source-contract";
import { queryAirNowDailyData } from "./airnow-daily-live-adapter";
import {
  queryHansVolcanoActivity,
  type HansFailureReason,
  type HansSchemaDiagnostic,
} from "./hans-live-adapter";
import {
  queryUsgsEarthquakeEvents,
  type UsgsEarthquakeFailureReason,
  type UsgsEarthquakeSchemaDiagnostic,
} from "./usgs-earthquake-live-adapter";
import { queryGvpEruptions } from "./gvp-eruption-live-adapter";
import { queryEpaAqs, type EpaAqsCredentials } from "./epa-aqs-live-adapter";
import type {
  CoverageGapHazardId,
  CoverageGapQueryInput,
  CoverageGapQueryResult,
  CoverageGapSourceOutcome,
} from "./types";

export type VolcanoSourceFailureDiagnostic =
  | {
      sourceId: "nasa_gibs_omps_so2";
      reason: AtmosphericFailureReason;
      stage: "image_query";
    }
  | {
      sourceId: "usgs_volcano_hans";
      reason: HansFailureReason;
      stage: "volcano_inventory" | "notice_search";
      schemaDiagnostic?: HansSchemaDiagnostic;
    }
  | {
      sourceId: "usgs_earthquake_geojson";
      reason: UsgsEarthquakeFailureReason;
      stage: "event_query";
      schemaDiagnostic?: UsgsEarthquakeSchemaDiagnostic;
    }
  | {
      sourceId: "smithsonian_gvp_eruptions";
      reason: string;
      stage: "eruption_query";
    };

/** Caller-owned, safe metadata sink. It never contains headers or payloads. */
export interface VolcanoEvidenceDiagnostics {
  sourceFailures: VolcanoSourceFailureDiagnostic[];
}

function parseDate(date: string, now: Date): "valid" | "unsupported" {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return "unsupported";
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) {
    return "unsupported";
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return parsed < today ? "valid" : "unsupported";
}

export function parseCoverageGapInput(value: unknown): CoverageGapQueryInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set(["placeId", "area", "date", "concern", "optionalQuestion"]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) return null;
  if (
    input.placeId !== CUSTOM_AREA_PLACE_ID ||
    typeof input.date !== "string" ||
    typeof input.concern !== "string" ||
    !(CONCERN_TYPES as readonly string[]).includes(input.concern)
  ) return null;
  let optionalQuestion: string | undefined;
  try {
    optionalQuestion = normalizeOptionalQuestion(input.optionalQuestion);
  } catch {
    return null;
  }
  try {
    const canonical = validateCanonicalAreaQuery(input.placeId, input.area);
    return {
      ...canonical,
      date: input.date,
      concern: input.concern as ConcernType,
      ...(optionalQuestion ? { optionalQuestion } : {}),
    };
  } catch {
    return null;
  }
}

function meaning(
  hazardId: CoverageGapHazardId,
  concern: ConcernType,
  optionalQuestion: string | undefined,
  kind: CoverageGapQueryResult["kind"]
): CoverageGapQueryResult["meaning"] {
  const subject = hazardId === "air_quality" ? "air-quality" : "earth-and-volcano";
  const state = kind === "success" || kind === "inconclusive_evidence"
    ? `The ${subject} sources returned bounded evidence with the limitations shown below.`
    : kind === "no_observation"
      ? `The ${subject} sources were queried but returned no usable observation for this area/date.`
      : kind === "source_failure"
        ? `One or more ${subject} sources failed; missing evidence is not safe conditions or no danger.`
        : "This request needs a completed date (up to yesterday UTC).";
  return {
    concern,
    summary:
      `${state} Your concern changes only the wording of this response, never which sources are used.`,
    optionalQuestionAcknowledged: optionalQuestion !== undefined,
  };
}

function areaKey(input: CoverageGapQueryInput): string {
  return createHash("sha256")
    .update(`${input.area.west},${input.area.south},${input.area.east},${input.area.north}`)
    .digest("hex")
    .slice(0, 12);
}

function asObservation(value: unknown): Observation {
  validateObservation(value);
  return value;
}

function evidenceStateFor(
  observations: Observation[],
  outcomes: CoverageGapSourceOutcome[]
): EvidenceObject["evidenceState"] {
  const failed = outcomes.includes("source_failure");
  if (observations.length > 0) {
    return outcomes.every((outcome) => outcome === "success" || outcome === "out_of_scope")
      ? "observations_returned"
      : "inconclusive_evidence";
  }
  if (failed) return "source_failure";
  if (outcomes.includes("no_observation")) return "no_observation";
  return "unsupported_coverage";
}

function resultKind(state: EvidenceObject["evidenceState"]): CoverageGapQueryResult["kind"] {
  if (state === "observations_returned") return "success";
  if (state === "inconclusive_evidence") return "inconclusive_evidence";
  if (state === "no_observation") return "no_observation";
  if (state === "unsupported_coverage") return "unsupported_coverage";
  return "source_failure";
}

function mission(
  hazardId: CoverageGapHazardId,
  observation: Observation | undefined,
  failed: boolean
): MissionAttribution {
  const air = hazardId === "air_quality";
  return {
    missionName: air ? "Terra and Aqua" : "NOAA-20",
    agency: air ? "NASA" : "NASA / NOAA",
    purpose: air
      ? "MODIS MAIAC regional aerosol-optical-depth visualization"
      : "OMPS lower-troposphere sulfur-dioxide visualization",
    selectionReason: "Daily credential-free satellite visualization for the validated canonical area and date",
    contributedObservationIds: observation ? [observation.observationId] : [],
    retrievalStatus: observation ? "success" : failed ? "failed" : "failed",
    keyLimitation: air
      ? "AOD is not AQI, PM2.5, indoor air quality, or personal exposure."
      : "SO2 imagery does not establish eruption cause, timing, exposure, or danger.",
    datasetId: air
      ? "MODIS_Combined_MAIAC_L2G_AerosolOpticalDepth"
      : "OMPS_NOAA20_SO2_Lower_Troposphere",
  };
}

function assembleEvidence(
  input: CoverageGapQueryInput,
  hazardId: CoverageGapHazardId,
  observations: Observation[],
  outcomes: CoverageGapSourceOutcome[],
  limitations: Limitation[],
  assembledAt: string
): EvidenceObject {
  const state = evidenceStateFor(observations, outcomes);
  const satelliteSource = hazardId === "air_quality"
    ? "nasa_gibs_modis_aod"
    : "nasa_gibs_omps_so2";
  const satelliteObservation = observations.find(
    (observation) => observation.provenance.sourceId === satelliteSource
  );
  const supplementalMissionDefinitions: Partial<Record<Observation["provenance"]["sourceId"], {
    missionName: string;
    agency: string;
    purpose: string;
    keyLimitation: string;
    datasetId: string;
  }>> = {
    airnow_daily_data: {
      missionName: "AirNow daily monitoring data",
      agency: "U.S. EPA and partner agencies",
      purpose: "Provide preliminary outdoor monitoring-site AQI summaries.",
      keyLimitation: "Outdoor preliminary AQI is not indoor air quality, personal exposure, or a regulatory AQS finding.",
      datasetId: "AirNow daily_data_v2",
    },
    epa_aqs: {
      missionName: "EPA Air Quality System",
      agency: "U.S. Environmental Protection Agency",
      purpose: "Provide validated historical outdoor monitoring-station pollutant samples.",
      keyLimitation: "Validated AQS data can lag by months and is not indoor air quality, personal exposure, or a current alert.",
      datasetId: "EPA AQS sampleData/byBox",
    },
    usgs_volcano_hans: {
      missionName: "USGS Volcano Hazards Notification System",
      agency: "USGS Volcano Hazards Program",
      purpose: "Provide official reports of observed volcanic activity.",
      keyLimitation: "HANS reports observations and notices; it does not predict eruption timing.",
      datasetId: "USGS HANS",
    },
    usgs_earthquake_geojson: {
      missionName: "USGS Earthquake Catalog",
      agency: "USGS Earthquake Hazards Program",
      purpose: "Provide observed catalog earthquake events inside the selected geometry.",
      keyLimitation: "Catalog events may be revised and do not predict earthquakes or establish volcanic causality.",
      datasetId: "USGS FDSN Event GeoJSON",
    },
    smithsonian_gvp_eruptions: {
      missionName: "Smithsonian Global Volcanism Program",
      agency: "Smithsonian Institution",
      purpose: "Provide official historical eruption records whose catalog interval overlaps the requested date.",
      keyLimitation: "Historical eruption records are not real-time alerts or predictions, and date precision may be incomplete.",
      datasetId: "GVP Volcanoes of the World Holocene Eruptions",
    },
  };
  const supplementalMissions = [...new Set(observations.map((observation) => observation.provenance.sourceId))]
    .filter((sourceId) => sourceId !== satelliteSource)
    .flatMap((sourceId): MissionAttribution[] => {
      const definition = supplementalMissionDefinitions[sourceId];
      if (!definition) return [];
      return [{
        ...definition,
        selectionReason: "The official source returned validated observations for the exact selected geometry and requested date.",
        contributedObservationIds: observations
          .filter((observation) => observation.provenance.sourceId === sourceId)
          .map((observation) => observation.observationId),
        retrievalStatus: "success",
      }];
    });
  const observedTimes = observations
    .map((observation) => Date.parse(observation.provenance.observedAt))
    .filter(Number.isFinite);
  const latestMs = observedTimes.length > 0 ? Math.max(...observedTimes) : NaN;
  const evidence: EvidenceObject = {
    evidenceId: `evd-${hazardId}-${areaKey(input)}-${input.date}-${assembledAt.replace(/[^0-9]/gu, "")}`,
    hazardId,
    intentId: `intent-${hazardId}-live-${input.date}`,
    evidenceState: state,
    dataMode: observations.length > 0 ? "live" : "failed",
    observations,
    derivedMetrics: [],
    missionAttributions: [
      mission(hazardId, satelliteObservation, outcomes[0] === "source_failure"),
      ...supplementalMissions,
    ],
    freshness: Number.isFinite(latestMs)
      ? {
          status: "historical",
          classificationBasis: "historical_context",
          mostRecentObservationAt: new Date(latestMs).toISOString(),
          evaluatedAt: assembledAt,
          ageSeconds: Math.max(0, Math.floor((Date.parse(assembledAt) - latestMs) / 1_000)),
          note: "Live retrieval returned historical evidence for the explicitly requested completed UTC date.",
        }
      : {
          status: "unknown",
          classificationBasis: "no_observation_time",
          evaluatedAt: assembledAt,
          note: "No usable observation time was returned; missing evidence is not safety.",
        },
    confidence: {
      level: state === "observations_returned" ? "low" : "insufficient",
      rationale: observations.length > 0
        ? "Regional satellite, outdoor monitoring-site, or official activity evidence is available, but it does not establish indoor, property, personal-exposure, evacuation, or prediction conclusions."
        : "No usable observation was returned; no safety or no-danger conclusion is supported.",
    },
    limitations,
    explanations: [],
    assembledAt,
  };
  validateEvidenceObject(evidence);
  return evidence;
}

const AIR_LIMITATIONS: Limitation[] = [
  {
    limitationId: "lim-air-aod-not-aqi",
    source: "nasa_gibs_modis_aod",
    description: "MAIAC aerosol optical depth is regional satellite context, not AQI, PM2.5 concentration, indoor air quality, or personal exposure.",
    required: true,
  },
  {
    limitationId: "lim-air-airnow-daily-outdoor-only",
    source: "airnow_daily_data",
    description: "AirNow daily AQI values are preliminary outdoor monitoring-site summaries, not indoor air quality, individual exposure, medical advice, regulatory AQS findings, or property-level certainty.",
    required: true,
  },
  {
    limitationId: "lim-air-airnow-daily-local-date",
    source: "airnow_daily_data",
    description: "AirNow daily rows use a midnight-to-midnight Local Standard Time date and do not provide a UTC observation instant.",
    required: true,
  },
  {
    limitationId: "lim-air-airnow-daily-missing-not-safe",
    source: "airnow_daily_data",
    description: "Missing nearby rows or a failed daily-file request is not evidence of clean air or no health risk.",
    required: true,
  },
  {
    limitationId: "lim-air-aqs-validated-lag",
    source: "epa_aqs",
    description: "EPA AQS validated monitoring data can lag by six months or more. A credential gate, missing in-area row, or historical station value is not a current clean-air or personal-exposure finding.",
    required: true,
  },
];

const EARTH_VOLCANO_LIMITATIONS: Limitation[] = [
  {
    limitationId: "lim-volcano-omps-context-only",
    source: "nasa_gibs_omps_so2",
    description: "OMPS sulfur-dioxide imagery is atmospheric context and does not prove a named volcano erupted, identify plume cause, or establish exposure.",
    required: true,
  },
  {
    limitationId: "lim-volcano-hans-no-prediction",
    source: "usgs_volcano_hans",
    description: "USGS HANS reports observed official activity; no notice or source failure is not no volcanic hazard, and eruption timing is never predicted.",
    required: true,
  },
  {
    limitationId: "lim-earthquake-observed-events-only",
    source: "usgs_earthquake_geojson",
    description: "USGS catalog events are observed reports that may be automatic or revised; they do not predict earthquakes or eruptions, prove a causal link to satellite or volcano observations, or make an empty/failed query evidence of seismic safety.",
    required: true,
  },
  {
    limitationId: "lim-gvp-historical-not-prediction",
    source: "smithsonian_gvp_eruptions",
    description: "Smithsonian GVP eruption records are historical catalog evidence with potentially incomplete date precision; they are not real-time alerts, exposure findings, or predictions.",
    required: true,
  },
];

function unsupportedDateResult(
  input: CoverageGapQueryInput,
  hazardId: CoverageGapHazardId
): CoverageGapQueryResult {
  const sourceOutcomes: Record<string, CoverageGapSourceOutcome> = hazardId === "air_quality"
    ? { nasa_gibs_modis_aod: "not_attempted", airnow_daily_data: "not_attempted", epa_aqs: "not_attempted" }
    : {
        nasa_gibs_omps_so2: "not_attempted",
        usgs_volcano_hans: "not_attempted",
        usgs_earthquake_geojson: "not_attempted",
        smithsonian_gvp_eruptions: "not_attempted",
        earthquake_prediction: "out_of_scope",
      };
  return {
    kind: "unsupported_date",
    hazardId,
    date: input.date,
    area: input.area,
    retrievalAttempted: false,
    sourceOutcomes,
    meaning: meaning(hazardId, input.concern, input.optionalQuestion, "unsupported_date"),
    limitations: ["Only real completed UTC dates are accepted."],
    rejectionReason: "This date is outside the available range, so no source check was made.",
  };
}

export async function queryAirQualityEvidence(
  input: CoverageGapQueryInput,
  dependencies: { fetchImpl?: typeof fetch; now?: () => Date; aqsCredentials?: EpaAqsCredentials } = {}
): Promise<CoverageGapQueryResult> {
  const now = dependencies.now?.() ?? new Date();
  if (parseDate(input.date, now) === "unsupported") {
    return unsupportedDateResult(input, "air_quality");
  }
  assertAtmosphericSourceReadiness();
  buildAtmosphericRequest("nasa_gibs_modis_aod", input.date, input.area);
  validateQueryableSourceId("airnow_daily_data");
  const [satellite, ground, aqs] = await Promise.all([
    queryAtmosphericSatellite(
      "nasa_gibs_modis_aod",
      input.date,
      input.area,
      { fetchImpl: dependencies.fetchImpl, now: () => now }
    ),
    queryAirNowDailyData(input.date, input.area, {
      fetchImpl: dependencies.fetchImpl,
      now: () => now,
      externalCallsAuthorized: true,
    }),
    queryEpaAqs(input.area, input.date, {
      fetchImpl: dependencies.fetchImpl,
      now: () => now,
      credentials: dependencies.aqsCredentials,
    }),
  ]);
  const satelliteOutcome: CoverageGapSourceOutcome = satellite.kind === "observation"
    ? "success"
    : satellite.kind === "no_observation" ? "no_observation" : "source_failure";
  const groundOutcome: CoverageGapSourceOutcome = ground.kind === "observations"
    ? "success"
    : ground.kind === "no_observation" ? "no_observation" : "source_failure";
  const aqsOutcome: CoverageGapSourceOutcome = aqs.kind === "observations"
    ? "success"
    : aqs.kind === "no_observation"
      ? "no_observation"
      : aqs.kind === "credential_gate_closed"
        ? "credential_gate_closed"
        : "source_failure";
  const observations: Observation[] = [
    ...(satellite.kind === "observation" ? [asObservation(satellite.observation)] : []),
    ...(ground.kind === "observations" ? ground.observations.map(asObservation) : []),
    ...(aqs.kind === "observations" ? aqs.observations.map(asObservation) : []),
  ];
  const sourceOutcomes = {
    nasa_gibs_modis_aod: satelliteOutcome,
    airnow_daily_data: groundOutcome,
    epa_aqs: aqsOutcome,
  };
  const relevantOutcomes = [
    satelliteOutcome,
    groundOutcome,
    ...(aqsOutcome === "credential_gate_closed" ? [] : [aqsOutcome]),
  ];
  const evidence = assembleEvidence(
    input,
    "air_quality",
    observations,
    relevantOutcomes,
    AIR_LIMITATIONS,
    now.toISOString()
  );
  const kind = evidenceStateFor(observations, relevantOutcomes);
  return {
    kind: resultKind(kind),
    hazardId: "air_quality",
    date: input.date,
    area: input.area,
    retrievalAttempted: true,
    sourceOutcomes,
    meaning: meaning("air_quality", input.concern, input.optionalQuestion, resultKind(kind)),
    limitations: AIR_LIMITATIONS.map((item) => item.description),
    rejectionReason: satellite.kind === "source_failure"
      ? `MAIAC source failure: ${satellite.reason}. Available outdoor AQI remains separate from satellite evidence.`
      : ground.kind === "source_failure"
        ? `AirNow daily source failure: ${ground.reason}. Satellite AOD is not AQI, and missing ground evidence is not clean air.`
        : aqs.kind === "source_failure"
          ? `EPA AQS source failure: ${aqs.reason}. Preliminary AirNow and satellite AOD remain separate from the missing validated historical check.`
        : ground.kind === "no_observation"
          ? "No AirNow daily monitoring-site AQI row was returned in the area. Satellite AOD is not AQI, and no nearby row is not clean air."
          : "Satellite AOD and outdoor monitoring-site AQI are shown as separate evidence and never converted into one another.",
    evidence,
  };
}

export async function queryVolcanoEvidence(
  input: CoverageGapQueryInput,
  dependencies: {
    fetchImpl?: typeof fetch;
    now?: () => Date;
    diagnostics?: VolcanoEvidenceDiagnostics;
  } = {}
): Promise<CoverageGapQueryResult> {
  const now = dependencies.now?.() ?? new Date();
  if (parseDate(input.date, now) === "unsupported") {
    return unsupportedDateResult(input, "earth_volcanoes");
  }
  assertAtmosphericSourceReadiness();
  buildAtmosphericRequest("nasa_gibs_omps_so2", input.date, input.area);
  const [satellite, hans, earthquakes, gvp] = await Promise.all([
    queryAtmosphericSatellite("nasa_gibs_omps_so2", input.date, input.area, {
      fetchImpl: dependencies.fetchImpl,
      now: () => now,
    }),
    queryHansVolcanoActivity(input.date, input.area, {
      fetchImpl: dependencies.fetchImpl,
      now: () => now,
    }),
    queryUsgsEarthquakeEvents(input.date, input.area, {
      fetchImpl: dependencies.fetchImpl,
      now: () => now,
    }),
    queryGvpEruptions(input.area, input.date, {
      fetchImpl: dependencies.fetchImpl,
      now: () => now,
    }),
  ]);
  if (satellite.kind === "source_failure") {
    dependencies.diagnostics?.sourceFailures.push({
      sourceId: "nasa_gibs_omps_so2",
      reason: satellite.reason,
      stage: "image_query",
    });
  }
  if (hans.kind === "source_failure") {
    dependencies.diagnostics?.sourceFailures.push({
      sourceId: "usgs_volcano_hans",
      reason: hans.reason,
      stage: hans.stage,
      ...(hans.schemaDiagnostic ? { schemaDiagnostic: hans.schemaDiagnostic } : {}),
    });
  }
  if (earthquakes.kind === "source_failure") {
    dependencies.diagnostics?.sourceFailures.push({
      sourceId: "usgs_earthquake_geojson",
      reason: earthquakes.reason,
      stage: earthquakes.stage,
      ...(earthquakes.schemaDiagnostic
        ? { schemaDiagnostic: earthquakes.schemaDiagnostic }
        : {}),
    });
  }
  if (gvp.kind === "source_failure") {
    dependencies.diagnostics?.sourceFailures.push({
      sourceId: "smithsonian_gvp_eruptions",
      reason: gvp.reason,
      stage: "eruption_query",
    });
  }
  const satelliteOutcome: CoverageGapSourceOutcome = satellite.kind === "observation"
    ? "success"
    : satellite.kind === "no_observation" ? "no_observation" : "source_failure";
  const hansOutcome: CoverageGapSourceOutcome = hans.kind === "observations"
    ? "success"
    : hans.kind === "no_observation" ? "no_observation" : "source_failure";
  const earthquakeOutcome: CoverageGapSourceOutcome = earthquakes.kind === "observations"
    ? "success"
    : earthquakes.kind === "no_observation" ? "no_observation" : "source_failure";
  const gvpOutcome: CoverageGapSourceOutcome = gvp.kind === "observations"
    ? "success"
    : gvp.kind === "no_observation" ? "no_observation" : "source_failure";
  const observations: Observation[] = [
    ...(satellite.kind === "observation" ? [asObservation(satellite.observation)] : []),
    ...(hans.kind === "observations" ? hans.observations.map(asObservation) : []),
    ...(earthquakes.kind === "observations" ? earthquakes.observations.map(asObservation) : []),
    ...(gvp.kind === "observations" ? gvp.observations.map(asObservation) : []),
  ];
  const sourceOutcomes = {
    nasa_gibs_omps_so2: satelliteOutcome,
    usgs_volcano_hans: hansOutcome,
    usgs_earthquake_geojson: earthquakeOutcome,
    smithsonian_gvp_eruptions: gvpOutcome,
    earthquake_prediction: "out_of_scope" as const,
  };
  const relevantOutcomes = [satelliteOutcome, hansOutcome, earthquakeOutcome, gvpOutcome];
  const evidence = assembleEvidence(
    input,
    "earth_volcanoes",
    observations,
    relevantOutcomes,
    EARTH_VOLCANO_LIMITATIONS,
    now.toISOString()
  );
  const state = evidenceStateFor(observations, relevantOutcomes);
  const kind = resultKind(state);
  return {
    kind,
    hazardId: "earth_volcanoes",
    date: input.date,
    area: input.area,
    retrievalAttempted: true,
    sourceOutcomes,
    meaning: meaning("earth_volcanoes", input.concern, input.optionalQuestion, kind),
    limitations: EARTH_VOLCANO_LIMITATIONS.map((item) => item.description),
    rejectionReason: state === "source_failure"
      ? "The Earth & Volcanoes evidence chain failed closed; missing evidence is not safety, and no danger or prediction conclusion is supported."
      : satelliteOutcome !== "success"
        ? "No validated OMPS observation materially connected satellite evidence to the separate official earthquake or volcano records; no meaningful satellite connection is claimed."
        : "Satellite SO2, HANS notices, GVP eruption records, and observed earthquake events are separate source roles; compare their timing, geography, and confidence before drawing an evidence-supported inference. Future timing and emergency danger are outside these historical records.",
    evidence,
  };
}

/** Compatibility helpers retain deterministic unsupported-date behavior only. */
export function buildAirQualityCoverageGapResult(
  input: CoverageGapQueryInput,
  now: Date = new Date()
): CoverageGapQueryResult {
  if (parseDate(input.date, now) === "unsupported") return unsupportedDateResult(input, "air_quality");
  throw new Error("Air Quality live results are asynchronous; use queryAirQualityEvidence");
}

export function buildVolcanoCoverageGapResult(
  input: CoverageGapQueryInput,
  now: Date = new Date()
): CoverageGapQueryResult {
  if (parseDate(input.date, now) === "unsupported") return unsupportedDateResult(input, "earth_volcanoes");
  throw new Error("Volcano live results are asynchronous; use queryVolcanoEvidence");
}
