import { createHash } from "crypto";
import {
  validateEvidenceObject,
  type EvidenceObject,
  type Limitation,
  type MissionAttribution,
  type Observation,
} from "@/contracts/evidence";
import {
  buildGibsNdviDescribeDomainsUrl,
  buildGibsNdviWmsUrl,
  buildUsdmAdministrativePercentRequest,
  GIBS_DROUGHT_COMPOSITE_DAYS,
  GIBS_DROUGHT_LAYER_ID,
  GIBS_DROUGHT_NATIVE_SCALE_METERS,
  GIBS_DROUGHT_PRODUCT,
  gibsNdviBoundingBox,
  gibsNdviRequestParameters,
  USDM_ARIZONA_STATE_FIPS,
  USDM_DROUGHT_PRODUCT,
  USDM_JSON_ACCEPT,
} from "./source-contracts";
import { getUsAdministrativeArea, type UsAdministrativeArea } from "@/data/us-administrative-areas";
import { resolveUsAdministrativeArea } from "./administrative-area-live";
import { CUSTOM_AREA_PLACE_ID, areasIntersect, validateQueryArea } from "@/lib/location/query-area";
import type {
  DroughtFailureReason,
  DroughtFailureStage,
  DroughtLiveQueryInput,
  DroughtQueryResult,
  DroughtSourceOutcome,
  DroughtSourceOutcomes,
} from "./types";
import { selectGibsDomainDate, inspectGibsPng, normalizeUsdmPercentArea } from "./live-schema";
import { queryCanadaDroughtMonitor } from "./canada-drought-live-adapter";
import { getRegistryEntry } from "@/data/dataset-registry";

// ---------------------------------------------------------------------------
// Constants (exact per prompt)
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_DOMAIN_BYTES = 65_536;
const MAX_PNG_BYTES = 2_000_000;
const MAX_USDM_BYTES = 65_536;
const DOMAIN_LOOKBACK_DAYS = 64;
const CANADA_DROUGHT_APPROXIMATE_COVERAGE = {
  west: -141,
  south: 41.6,
  east: -52,
  north: 83,
};

// Allowed hosts (exact per prompt)
const GIBS_DOMAIN_HOST = "gitc.earthdata.nasa.gov";
const GIBS_IMAGE_HOST = "gibs.earthdata.nasa.gov";
const USDM_HOST = "usdmdataservices.unl.edu";

// Path family prefixes (per locked builders)
const GIBS_DOMAIN_PATH_PREFIX = "/wmts/epsg4326/std/1.0.0/";
const GIBS_IMAGE_PATH_PREFIX = "/wms/epsg4326/std/wms.cgi";
const USDM_PATH_PREFIX = "/api/StateStatistics/";

// ---------------------------------------------------------------------------
// Exact mission statics
// ---------------------------------------------------------------------------

const GIBS_MISSION = {
  missionName: "Terra MODIS NDVI visualization",
  agency: "NASA",
  purpose: "Regional 16-day vegetation visualization.",
  selectionReason: "Primary vegetation-evidence role for regional drought context.",
  keyLimitation: "Visualization only; it does not provide numeric NDVI or property conditions.",
  datasetId: "MODIS_Terra_L3_NDVI_16Day_v6.1_STD",
};

const USDM_MISSION = {
  missionName: "U.S. Drought Monitor regional statistics",
  agency: "NDMC / USDA / NOAA",
  purpose: "Weekly regional drought-category confirmation.",
  selectionReason: "Supporting official regional-confirmation role alongside the vegetation evidence.",
  keyLimitation: "Statewide percentages do not establish property or household water conditions.",
  datasetId: "USDM_StateStatistics_PercentArea",
};

// ---------------------------------------------------------------------------
// Required limitations
// ---------------------------------------------------------------------------

const LIM_GIBS_VISUAL_ONLY: Limitation = {
  limitationId: "lim-wp10-gibs-visual-only",
  source: "nasa_gibs_modis_ndvi_16day",
  description:
    "GIBS NDVI imagery is visualization only; numeric NDVI, vegetation trend, drought cause, crop condition, and property condition are not inferred from PNG colors.",
  required: true,
};

const LIM_USDM_REGIONAL: Limitation = {
  limitationId: "lim-wp10-usdm-regional",
  source: "us_drought_monitor_rest",
  description:
    "USDM percentages are weekly statewide context; D0 is not drought and no category establishes property or household water conditions.",
  required: true,
};

const LIM_SCALE_MISMATCH: Limitation = {
  limitationId: "lim-wp10-scale-mismatch",
  source: "nasa_gibs_modis_ndvi_16day",
  description:
    "The regional satellite visualization and statewide USDM statistics use different scales and cannot be treated as property-level agreement.",
  required: true,
};

const LIM_NO_OBSERVATION: Limitation = {
  limitationId: "lim-wp10-no-observation-not-safe",
  source: "us_drought_monitor_rest",
  description:
    "No returned observation is missing evidence; it is not no drought, no impact, or no danger.",
  required: true,
};

const LIM_GIBS_NO_OBSERVATION: Limitation = {
  limitationId: "lim-wp10-gibs-no-observation-not-safe",
  source: "nasa_gibs_modis_ndvi_16day",
  description:
    "No usable satellite vegetation image was returned for the selected area and date; missing imagery is not no drought, no impact, or no danger.",
  required: true,
};

const LIM_PARTIAL: Limitation = {
  limitationId: "lim-wp10-partial-not-complete",
  source: "nasa_gibs_modis_ndvi_16day",
  description:
    "One required source role is missing or failed; partial evidence is not a complete drought or land-condition conclusion.",
  required: true,
};

const LIM_FAILURE: Limitation = {
  limitationId: "lim-wp10-failure-no-fallback",
  source: "us_drought_monitor_rest",
  description:
    "No fixture, stale value, cached value, or alternate source was substituted for failed live retrieval.",
  required: true,
};

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

class DroughtLiveAdapterError extends Error {
  constructor(
    readonly reason: DroughtFailureReason,
    readonly stage?: DroughtFailureStage
  ) {
    super(reason);
    this.name = "DroughtLiveAdapterError";
  }
}

function withStage(error: unknown, stage: DroughtFailureStage): DroughtLiveAdapterError {
  return error instanceof DroughtLiveAdapterError
    ? new DroughtLiveAdapterError(error.reason, error.stage ?? stage)
    : new DroughtLiveAdapterError("validation_failure", stage);
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface DroughtLiveAdapterDependencies {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FetchLike = typeof fetch;

function isAllowedRedirectPath(pathname: string, allowedPath: string): boolean {
  return allowedPath.endsWith("/")
    ? pathname.startsWith(allowedPath)
    : pathname === allowedPath;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseStrictDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

function addUtcDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Derive the latest Tuesday not later than requestedDate */
function latestTuesdayNotAfter(dateStr: string): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  const d = new Date(ms);
  // UTC day: 0=Sun,1=Mon,2=Tue,...
  const dayOfWeek = d.getUTCDay();
  // Tuesday = 2
  const daysToSubtract = (dayOfWeek - 2 + 7) % 7;
  const tuesdayMs = ms - daysToSubtract * 24 * 60 * 60 * 1000;
  return new Date(tuesdayMs).toISOString().slice(0, 10);
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const statedLength = response.headers.get("content-length");
  if (statedLength !== null) {
    const len = Number(statedLength);
    if (!Number.isFinite(len) || len < 0 || len > maxBytes) {
      throw new DroughtLiveAdapterError("oversize");
    }
  }
  if (!response.body) throw new DroughtLiveAdapterError("malformed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new DroughtLiveAdapterError("oversize");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

/** Follow at most one same-host/same-path-family HTTPS redirect */
async function fetchWithOneRedirect(
  fetchImpl: FetchLike,
  url: URL,
  signal: AbortSignal,
  expectedHost: string,
  expectedPathPrefix: string,
  stage: DroughtFailureStage,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  const headers: Record<string, string> = { ...(extraHeaders ?? {}) };

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal,
      headers,
    });
  } catch {
    throw new DroughtLiveAdapterError(signal.aborted ? "timeout" : "network", stage);
  }

  if (response.status >= 300 && response.status < 400) {
    // Attempt one redirect
    const location = response.headers.get("Location");
    if (!location) throw new DroughtLiveAdapterError("redirect", stage);
    let redirectUrl: URL;
    try {
      redirectUrl = new URL(location, url);
    } catch {
      throw new DroughtLiveAdapterError("redirect", stage);
    }
    // Must be HTTPS, same host, same path family
    if (
      redirectUrl.protocol !== "https:" ||
      redirectUrl.hostname !== expectedHost ||
      redirectUrl.port !== "" ||
      redirectUrl.username !== "" ||
      redirectUrl.password !== "" ||
      !isAllowedRedirectPath(redirectUrl.pathname, expectedPathPrefix)
    ) {
      throw new DroughtLiveAdapterError("redirect", stage);
    }
    // Do not forward credentials
    try {
      response = await fetchImpl(redirectUrl, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal,
        headers: { ...(extraHeaders ?? {}) },
      });
    } catch {
      throw new DroughtLiveAdapterError(signal.aborted ? "timeout" : "network", stage);
    }
    // Second redirect is rejected
    if (response.status >= 300 && response.status < 400) {
      throw new DroughtLiveAdapterError("redirect", stage);
    }
  }

  if (response.status === 429) throw new DroughtLiveAdapterError("rate_limited", stage);
  if (!response.ok) throw new DroughtLiveAdapterError("provider_failure", stage);
  return response;
}

async function fetchBytes(
  fetchImpl: FetchLike,
  url: URL,
  maxBytes: number,
  acceptedContentTypes: string[],
  expectedHost: string,
  expectedPathPrefix: string,
  stage: DroughtFailureStage,
  extraHeaders?: Record<string, string>
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchWithOneRedirect(
      fetchImpl, url, controller.signal, expectedHost, expectedPathPrefix, stage, extraHeaders
    );
    const rawType = response.headers.get("content-type") ?? "";
    const normalized = rawType.split(";", 1)[0].trim().toLowerCase();
    if (!acceptedContentTypes.includes(normalized)) {
      throw new DroughtLiveAdapterError("media_type", stage);
    }
    let bytes: Uint8Array;
    try {
      bytes = await readBoundedBody(response, maxBytes);
    } catch (error) {
      if (error instanceof DroughtLiveAdapterError) throw error;
      throw new DroughtLiveAdapterError(controller.signal.aborted ? "timeout" : "network", stage);
    }
    return { bytes, contentType: normalized };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Mission attributions
// ---------------------------------------------------------------------------

function gibsMission(
  status: MissionAttribution["retrievalStatus"],
  observationId?: string
): MissionAttribution {
  return {
    ...GIBS_MISSION,
    contributedObservationIds: observationId ? [observationId] : [],
    retrievalStatus: status,
  };
}

function usdmMission(
  status: MissionAttribution["retrievalStatus"],
  observationId?: string
): MissionAttribution {
  return {
    ...USDM_MISSION,
    contributedObservationIds: observationId ? [observationId] : [],
    retrievalStatus: status,
  };
}

// ---------------------------------------------------------------------------
// EvidenceObject assembly
// ---------------------------------------------------------------------------

type GibsOutcomeData =
  | { outcome: "success"; observation: Observation; date: string }
  | { outcome: "no_observation"; date: string }  // transparent PNG
  | { outcome: "not_attempted" }                 // no domain date
  | { outcome: "failed"; reason: DroughtFailureReason; stage: DroughtFailureStage };

type UsdmOutcomeData =
  | { outcome: "success"; observation: Observation; date: string }
  | { outcome: "no_observation"; observation: Observation; date: string }  // zero rows
  | { outcome: "not_attempted" }
  | { outcome: "failed"; reason: DroughtFailureReason; stage: DroughtFailureStage };

function assembleEvidence(
  requestedDate: string,
  gibsData: GibsOutcomeData,
  usdmData: UsdmOutcomeData,
  assembledAt: string,
  selectionKey: string
): EvidenceObject {
  const observations: Observation[] = [];

  // Collect observations
  if (gibsData.outcome === "success") observations.push(gibsData.observation);
  if (usdmData.outcome === "success") observations.push(usdmData.observation);
  if (usdmData.outcome === "no_observation") observations.push(usdmData.observation);

  // Determine result kind
  const gibsIsSuccess = gibsData.outcome === "success";
  const usdmIsSuccess = usdmData.outcome === "success";
  const gibsHasObservation = gibsData.outcome === "success" || gibsData.outcome === "no_observation";
  const usdmHasObservation = usdmData.outcome === "success" || usdmData.outcome === "no_observation";
  const hasAnySuccess = gibsIsSuccess || usdmIsSuccess;
  const allSuccess = gibsIsSuccess && usdmIsSuccess;
  const hasObservation = gibsHasObservation || usdmHasObservation;
  const bothNoObservation =
    gibsData.outcome === "no_observation" && usdmData.outcome === "no_observation";
  const anyFailed =
    gibsData.outcome === "failed" || usdmData.outcome === "failed";
  // not_attempted counts as a non-success non-failure for result classification
  const gibsNotAttempted = gibsData.outcome === "not_attempted";
  const usdmNotAttempted = usdmData.outcome === "not_attempted";

  let resultKind: DroughtQueryResult["kind"];
  if (allSuccess) {
    resultKind = "success";
  } else if (hasAnySuccess) {
    resultKind = "inconclusive_evidence";
  } else if (gibsNotAttempted && usdmIsSuccess) {
    // GIBS not attempted but USDM succeeded: inconclusive
    resultKind = "inconclusive_evidence";
  } else if (gibsNotAttempted && usdmData.outcome === "no_observation") {
    // no_observation for both (GIBS not attempted, USDM no row)
    resultKind = "no_observation";
  } else if (bothNoObservation) {
    resultKind = "no_observation";
  } else if (gibsData.outcome === "no_observation" && usdmNotAttempted) {
    resultKind = "no_observation";
  } else if (gibsNotAttempted && usdmNotAttempted) {
    resultKind = "unsupported_coverage";
  } else if (anyFailed && !hasAnySuccess) {
    resultKind = "source_failure";
  } else {
    // mixed case with not_attempted and failure
    resultKind = "source_failure";
  }

  // Evidence state from result kind
  const evidenceStateMap: Record<string, string> = {
    success: "observations_returned",
    inconclusive_evidence: "inconclusive_evidence",
    no_observation: "no_observation",
    unsupported_coverage: "unsupported_coverage",
    source_failure: "source_failure",
    unsupported_place: "source_failure",
    unsupported_date: "source_failure",
  };
  const evidenceState = evidenceStateMap[resultKind] as
    | "observations_returned"
    | "no_observation"
    | "source_failure"
    | "inconclusive_evidence"
    | "unsupported_coverage";

  // DataMode
  const dataMode = hasObservation ? "live" : "failed";

  // Mission attributions
  // Note: "success"/"partial" require contributedObservationIds.length > 0;
  //       "failed"/"not_attempted" require it to be empty.
  // Transparent PNG (no_observation for GIBS): retrieval happened but no usable image → "failed"
  const gibsMissionAttrib: MissionAttribution =
    gibsData.outcome === "success"
      ? gibsMission("success", gibsData.observation.observationId)
      : gibsData.outcome === "no_observation"
        ? gibsMission("failed")   // transparent PNG = no usable image data
        : gibsData.outcome === "not_attempted"
          ? gibsMission("not_attempted")
          : gibsMission("failed");

  const usdmMissionAttrib: MissionAttribution =
    usdmData.outcome === "success"
      ? usdmMission("success", usdmData.observation.observationId)
      : usdmData.outcome === "no_observation"
        ? usdmMission("success", usdmData.observation.observationId)
        : usdmData.outcome === "not_attempted"
          ? usdmMission("not_attempted")
          : usdmMission("failed");

  // Freshness
  const observationTimes = observations
    .map((obs) => (obs.provenance.observedAt !== "unknown" ? Date.parse(obs.provenance.observedAt) : NaN))
    .filter(Number.isFinite);
  const latestObsMs = observationTimes.length > 0 ? Math.max(...observationTimes) : NaN;
  const hasObsTime = Number.isFinite(latestObsMs);

  const freshness: EvidenceObject["freshness"] = hasObsTime
    ? {
        status: "historical",
        classificationBasis: "historical_context",
        mostRecentObservationAt: new Date(latestObsMs).toISOString(),
        evaluatedAt: assembledAt,
        ageSeconds: Math.floor((Date.parse(assembledAt) - latestObsMs) / 1000),
        note: "Source dates are historical context selected for the requested calendar date; they are not current property conditions.",
      }
    : {
        status: "unknown",
        classificationBasis: "no_observation_time",
        evaluatedAt: assembledAt,
        note: "No usable observation time is available; missing evidence is not no drought or no danger.",
      };

  // Confidence
  let confidenceLevel: "moderate" | "low" | "insufficient";
  let confidenceRationale: string;
  if (allSuccess) {
    confidenceLevel = "moderate";
    confidenceRationale =
      "Both bounded regional source roles returned validated historical evidence; neither supports a property, household-water, or safety conclusion.";
  } else if (resultKind === "inconclusive_evidence") {
    confidenceLevel = "low";
    confidenceRationale =
      "Only part of the bounded satellite-plus-regional evidence chain is available; no complete property, household-water, or safety conclusion is supported.";
  } else {
    confidenceLevel = "insufficient";
    confidenceRationale =
      "The bounded regional evidence chain contains no usable observation; no drought, property, household-water, or safety conclusion is supported.";
  }

  // Limitations
  const baseLimitations: Limitation[] = [
    LIM_GIBS_VISUAL_ONLY,
    LIM_USDM_REGIONAL,
    LIM_SCALE_MISMATCH,
  ];

  const stateLimitations: Limitation[] = [];
  if (resultKind === "no_observation") {
    stateLimitations.push(LIM_NO_OBSERVATION);
    if (gibsData.outcome === "no_observation") {
      stateLimitations.push(LIM_GIBS_NO_OBSERVATION);
    }
  } else if (resultKind === "inconclusive_evidence") {
    stateLimitations.push(LIM_PARTIAL);
  } else if (resultKind === "source_failure") {
    stateLimitations.push(LIM_FAILURE);
  }

  const limitations: Limitation[] = [...baseLimitations, ...stateLimitations];

  const evidence: EvidenceObject = {
    evidenceId: `evd-wp10-drought-live-${selectionKey}-${requestedDate}`,
    hazardId: "drought_land",
    intentId: `intent-wp10-drought-live-${selectionKey}-${requestedDate}`,
    evidenceState,
    dataMode,
    observations,
    derivedMetrics: [],
    missionAttributions: [gibsMissionAttrib, usdmMissionAttrib],
    freshness,
    confidence: {
      level: confidenceLevel,
      rationale: confidenceRationale,
    },
    limitations,
    explanations: [],
    assembledAt,
  };

  validateEvidenceObject(evidence);

  return evidence;
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

export async function queryLiveDroughtEvidence(
  input: DroughtLiveQueryInput,
  dependencies?: DroughtLiveAdapterDependencies
): Promise<DroughtQueryResult> {
  const fetchImpl = dependencies?.fetchImpl ?? fetch;
  const now = dependencies?.now?.() ?? new Date();
  const isCustomArea = input.placeId === CUSTOM_AREA_PLACE_ID;
  let queryArea: ReturnType<typeof validateQueryArea> | undefined;

  // 1. Accept the labelled Tucson path or a validated canonical custom area.
  if (isCustomArea) {
    try {
      queryArea = validateQueryArea(input.area);
    } catch {
      return {
        kind: "unsupported_place",
        sourceOutcomes: { gibs: "not_attempted", usdm: "not_attempted" },
        rejectionReason: "The selected area is not a valid Drought query area. Re-select the location.",
      };
    }
  } else if (input.placeId !== "demo-tucson") {
    return {
      kind: "unsupported_place",
      sourceOutcomes: { gibs: "not_attempted", usdm: "not_attempted" },
      rejectionReason: "Live Drought evidence is available for the Tucson demonstration or a selected area.",
    };
  }
  const selectionKey = isCustomArea
    ? `custom-${createHash("sha256").update(gibsNdviBoundingBox(queryArea)).digest("hex").slice(0, 12)}`
    : "demo-tucson";

  // 2. Reject invalid, today, or future UTC date
  const dateMs = parseStrictDate(input.date);
  if (dateMs === null) {
    return {
      kind: "unsupported_date",
      sourceOutcomes: { gibs: "not_attempted", usdm: "not_attempted" },
      rejectionReason: "date must be a real YYYY-MM-DD UTC calendar date.",
    };
  }
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (dateMs >= todayMs) {
    return {
      kind: "unsupported_date",
      sourceOutcomes: { gibs: "not_attempted", usdm: "not_attempted" },
      rejectionReason: "Live Drought retrieval accepts only completed UTC dates before today.",
    };
  }

  const assembledAt = now.toISOString();
  const requestedDate = input.date;
  let administrativeAreaOutcome: DroughtSourceOutcome | undefined = isCustomArea
    ? "not_attempted"
    : undefined;

  // 3. Derive domain window: requestedDate - 64 days through requestedDate
  const windowStart = addUtcDays(requestedDate, -DOMAIN_LOOKBACK_DAYS);
  const domainUrl = new URL(buildGibsNdviDescribeDomainsUrl(windowStart, requestedDate));

  // 4. Derive USDM Tuesday
  const requestedTuesday = latestTuesdayNotAfter(requestedDate);
  const arizonaArea = getUsAdministrativeArea(USDM_ARIZONA_STATE_FIPS);
  if (!arizonaArea) {
    return {
      kind: "source_failure",
      sourceOutcomes: {
        gibs: "not_attempted",
        usdm: "not_attempted",
        ...(isCustomArea ? { administrativeArea: "not_attempted" as const } : {}),
      },
      failureReason: "validation_failure",
      failureStage: "evidence_assembly",
    };
  }

  // 5. Execute GIBS domain + USDM as two independent async branches
  // GIBS domain chain: domain -> PNG
  const gibsChainPromise: Promise<GibsOutcomeData> = (async (): Promise<GibsOutcomeData> => {
    // Domain request
    let domainBytes: Uint8Array;
    let domainXml: string;
    try {
      const { bytes } = await fetchBytes(
        fetchImpl,
        domainUrl,
        MAX_DOMAIN_BYTES,
        ["application/xml", "text/xml", "application/ows+xml"],
        GIBS_DOMAIN_HOST,
        GIBS_DOMAIN_PATH_PREFIX,
        "gibs_domain_transport"
      );
      domainBytes = bytes;
    } catch (error) {
      const err = error instanceof DroughtLiveAdapterError
        ? error
        : withStage(error, "gibs_domain_transport");
      return { outcome: "failed", reason: err.reason, stage: err.stage ?? "gibs_domain_transport" };
    }
    try {
      domainXml = new TextDecoder("utf-8", { fatal: true }).decode(domainBytes);
    } catch {
      return { outcome: "failed", reason: "malformed", stage: "gibs_domain_payload" };
    }

    // Select date
    let selectedDate: string | null;
    try {
      const selection = selectGibsDomainDate(domainXml, requestedDate);
      selectedDate = selection.selectedDate;
    } catch {
      return { outcome: "failed", reason: "schema_validation", stage: "gibs_domain_payload" };
    }

    if (selectedDate === null) {
      // No date in domain — not_attempted for PNG
      return { outcome: "not_attempted" };
    }

    // PNG request
    const pngUrl = new URL(buildGibsNdviWmsUrl(selectedDate, queryArea));
    let pngBytes: Uint8Array;
    let pngContentType: string;
    try {
      const { bytes, contentType } = await fetchBytes(
        fetchImpl,
        pngUrl,
        MAX_PNG_BYTES,
        ["image/png"],
        GIBS_IMAGE_HOST,
        GIBS_IMAGE_PATH_PREFIX,
        "gibs_image_transport"
      );
      pngBytes = bytes;
      pngContentType = contentType;
    } catch (error) {
      const err = error instanceof DroughtLiveAdapterError
        ? error
        : withStage(error, "gibs_image_transport");
      return { outcome: "failed", reason: err.reason, stage: err.stage ?? "gibs_image_transport" };
    }

    // Inspect PNG
    const pngHash = sha256(pngBytes);
    let inspection: Awaited<ReturnType<typeof inspectGibsPng>>;
    try {
      inspection = await inspectGibsPng(pngBytes, pngContentType);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      const reason: DroughtFailureReason = msg.includes("schema_validation")
        ? "schema_validation"
        : "malformed";
      return { outcome: "failed", reason, stage: "gibs_image_payload" };
    }

    if (inspection === null) {
      // Transparent PNG: no_observation
      return { outcome: "no_observation", date: selectedDate };
    }

    // Build GIBS observation
    const yyyymmdd = selectedDate.replaceAll("-", "");
    const params = gibsNdviRequestParameters(selectedDate, queryArea);
    const observation: Observation = {
      observationId: `obs-wp10-gibs-live-${selectionKey}-${yyyymmdd}`,
      provenance: {
        sourceId: "nasa_gibs_modis_ndvi_16day",
        sourceUrl: buildGibsNdviWmsUrl(selectedDate, queryArea),
        retrievedAt: assembledAt,
        observedAt: `${selectedDate}T00:00:00Z`,
        product: GIBS_DROUGHT_PRODUCT,
        payloadHash: pngHash,
        requestParameters: params,
      },
      variableName: "16-day NDVI visualization",
      textValue: "regional_visualization_available",
      dataMode: "live",
      qualifiers: [
        "visualization_only",
        "numeric_ndvi_not_inferred",
        "regional_not_property",
      ],
      metadata: {
        droughtRole: "satellite_vegetation_visualization",
        layerId: GIBS_DROUGHT_LAYER_ID,
        contentType: inspection.contentType,
        imageWidth: inspection.imageWidth,
        imageHeight: inspection.imageHeight,
        nativeScaleMeters: GIBS_DROUGHT_NATIVE_SCALE_METERS,
        compositePeriodDays: GIBS_DROUGHT_COMPOSITE_DAYS,
        boundingBox: gibsNdviBoundingBox(queryArea),
        byteLength: inspection.byteLength,
        opaqueSampleCount: inspection.opaqueSampleCount,
        distinctColorCount: inspection.distinctColorCount,
      },
    };
    return { outcome: "success", observation, date: selectedDate };
  })();

  // USDM branch (independent)
  const usdmChainPromise: Promise<UsdmOutcomeData> = (async (): Promise<UsdmOutcomeData> => {
    let administrativeArea: UsAdministrativeArea = arizonaArea;
    if (isCustomArea) {
      const resolution = await resolveUsAdministrativeArea(queryArea, { fetchImpl });
      if (resolution.kind === "source_failure") {
        administrativeAreaOutcome = "failed";
        return {
          outcome: "failed",
          reason: resolution.reason,
          stage: "administrative_area_resolution",
        };
      }
      if (resolution.kind === "no_observation") {
        administrativeAreaOutcome = "no_observation";
        return { outcome: "not_attempted" };
      }
      administrativeAreaOutcome = "success";
      administrativeArea = resolution.area;
    }
    const usdmRequest = buildUsdmAdministrativePercentRequest(
      requestedTuesday,
      administrativeArea
    );
    const usdmUrl = new URL(usdmRequest.url);
    let usdmBytes: Uint8Array;
    try {
      const { bytes } = await fetchBytes(
        fetchImpl,
        usdmUrl,
        MAX_USDM_BYTES,
        ["application/json", "text/json"],
        USDM_HOST,
        USDM_PATH_PREFIX,
        "usdm_transport",
        { Accept: USDM_JSON_ACCEPT }
      );
      usdmBytes = bytes;
    } catch (error) {
      const err = error instanceof DroughtLiveAdapterError
        ? error
        : withStage(error, "usdm_transport");
      return { outcome: "failed", reason: err.reason, stage: err.stage ?? "usdm_transport" };
    }

    const usdmHash = sha256(usdmBytes);
    let parsed: unknown;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(usdmBytes);
      parsed = JSON.parse(text);
    } catch {
      return { outcome: "failed", reason: "malformed", stage: "usdm_payload" };
    }

    let row: ReturnType<typeof normalizeUsdmPercentArea>;
    try {
      row = normalizeUsdmPercentArea(
        parsed,
        requestedTuesday,
        administrativeArea.postalCode
      );
    } catch (error) {
      // schema validation failure
      void error;
      return { outcome: "failed", reason: "schema_validation", stage: "usdm_payload" };
    }

    if (row === null) {
      // Zero rows — build no-row marker
      const usdmYyymmdd = requestedTuesday.replaceAll("-", "");
      const noRowObs: Observation = {
        observationId: `obs-wp10-usdm-live-${usdmYyymmdd}-no-row`,
        provenance: {
          sourceId: "us_drought_monitor_rest",
          sourceUrl: usdmRequest.url,
          sourceRecordId: `USDM#StateStatistics#${administrativeArea.fips}#${requestedTuesday}`,
          retrievedAt: assembledAt,
          observedAt: `${requestedTuesday}T00:00:00Z`,
          product: USDM_DROUGHT_PRODUCT,
          payloadHash: usdmHash,
          requestParameters: usdmRequest.requestParameters,
        },
        variableName: "Regional drought area statistics",
        textValue: "no_regional_row_returned",
        dataMode: "live",
        qualifiers: [
          "regional_state_scale",
          "weekly_product",
          "d0_is_not_drought",
          "property_inference_not_supported",
        ],
        metadata: {
          droughtRole: "regional_drought_statistics",
          areaType: "StateStatistics",
          stateFips: administrativeArea.fips,
          areaName: administrativeArea.name,
          statisticsFormat: "traditional_cumulative_percent_of_area",
          mapValidDay: "Tuesday",
          releaseDay: "Thursday",
          cadenceDays: 7,
          resultRowCount: 0,
        },
      };
      return { outcome: "no_observation", observation: noRowObs, date: requestedTuesday };
    }

    // Build USDM success observation
    const usdmYyymmdd = requestedTuesday.replaceAll("-", "");
    const usdmObs: Observation = {
      observationId: `obs-wp10-usdm-live-${usdmYyymmdd}`,
      provenance: {
        sourceId: "us_drought_monitor_rest",
        sourceUrl: usdmRequest.url,
        sourceRecordId: `USDM#StateStatistics#${administrativeArea.fips}#${requestedTuesday}`,
        retrievedAt: assembledAt,
        observedAt: `${requestedTuesday}T00:00:00Z`,
        product: USDM_DROUGHT_PRODUCT,
        payloadHash: usdmHash,
        requestParameters: usdmRequest.requestParameters,
      },
      variableName: "Regional drought area statistics",
      textValue: "regional_statistics_available",
      dataMode: "live",
      qualifiers: [
        "regional_state_scale",
        "weekly_product",
        "d0_is_not_drought",
        "property_inference_not_supported",
      ],
      metadata: {
        droughtRole: "regional_drought_statistics",
        areaType: "StateStatistics",
        stateFips: administrativeArea.fips,
        areaName: administrativeArea.name,
        statisticsFormat: "traditional_cumulative_percent_of_area",
        unit: "percent",
        mapValidDay: "Tuesday",
        releaseDay: "Thursday",
        cadenceDays: 7,
        nonePct: row.nonePct,
        d0Pct: row.d0Pct,
        d1Pct: row.d1Pct,
        d2Pct: row.d2Pct,
        d3Pct: row.d3Pct,
        d4Pct: row.d4Pct,
      },
    };
    return { outcome: "success", observation: usdmObs, date: requestedTuesday };
  })();

  const canadaDroughtPromise = isCustomArea && areasIntersect(queryArea!, CANADA_DROUGHT_APPROXIMATE_COVERAGE)
    ? queryCanadaDroughtMonitor(queryArea, requestedDate, {
        fetchImpl,
        now: () => now,
      })
    : Promise.resolve({ kind: "not_applicable" as const, reason: "before_record" as const });

  // Run the independent satellite, U.S. regional, and Canadian regional branches together.
  const [gibsData, usdmData, canadaDrought] = await Promise.all([
    gibsChainPromise,
    usdmChainPromise,
    canadaDroughtPromise,
  ]);

  // Assemble evidence
  let evidence: EvidenceObject;
  try {
    evidence = assembleEvidence(
      requestedDate,
      gibsData,
      usdmData,
      assembledAt,
      selectionKey
    );
    const canadaObservation = canadaDrought.kind === "observation"
      ? canadaDrought.observation
      : undefined;
    const canadaEntry = getRegistryEntry("canada_drought_monitor")!;
    if (canadaObservation) evidence.missionAttributions.push({
      missionName: canadaEntry.displayName,
      agency: canadaEntry.agency,
      purpose: canadaEntry.role,
      selectionReason: "The latest official monthly product not after the requested date returned a center-point source raster class inside the exact selected geometry.",
      contributedObservationIds: [canadaObservation.observationId],
      retrievalStatus: "success",
      keyLimitation: canadaEntry.requiredLimitations[0],
      datasetId: "Canadian Drought Monitor ImageServer",
    });
    if (canadaDrought.kind !== "not_applicable") evidence.limitations.push(...canadaEntry.requiredLimitations.map((description, index) => ({
      limitationId: `canada-drought-live-lim-${index}`,
      source: "canada_drought_monitor",
      description,
      required: true,
    })));
    if (canadaObservation) {
      evidence.observations.push(canadaObservation);
      if (["no_observation", "source_failure", "unsupported_coverage"].includes(evidence.evidenceState)) {
        evidence.evidenceState = "inconclusive_evidence";
      }
      evidence.dataMode = "live";
      evidence.confidence = {
        level: evidence.evidenceState === "observations_returned" ? evidence.confidence.level : "low",
        rationale: "Official regional drought evidence is available, but source scale and classification timing do not establish property, crop, household-water, or safety conditions.",
      };
      const observedMs = Date.parse(canadaObservation.provenance.observedAt);
      const previousMs = evidence.freshness.mostRecentObservationAt
        ? Date.parse(evidence.freshness.mostRecentObservationAt)
        : NaN;
      const latestMs = Number.isFinite(previousMs) ? Math.max(previousMs, observedMs) : observedMs;
      evidence.freshness = {
        status: "historical",
        classificationBasis: "historical_context",
        mostRecentObservationAt: new Date(latestMs).toISOString(),
        evaluatedAt: assembledAt,
        ageSeconds: Math.floor((Date.parse(assembledAt) - latestMs) / 1000),
        note: "Historical regional products were selected for the requested date; they are not current property conditions.",
      };
    }
    if (canadaDrought.kind === "source_failure") {
      evidence.limitations.push({
        limitationId: "canada-drought-live-source-failure",
        source: "canada_drought_monitor",
        description: "The Canadian Drought Monitor check failed. Other returned evidence does not replace it, and the failure is not proof of no drought.",
        required: true,
      });
    }
    validateEvidenceObject(evidence);
  } catch {
    // evidence_assembly failure
    const sourceOutcomes: DroughtSourceOutcomes = {
      gibs: gibsData.outcome === "success" ? "success" :
            gibsData.outcome === "no_observation" ? "no_observation" :
            gibsData.outcome === "not_attempted" ? "not_attempted" : "failed",
      usdm: usdmData.outcome === "success" ? "success" :
            usdmData.outcome === "no_observation" ? "no_observation" :
            usdmData.outcome === "not_attempted" ? "not_attempted" : "failed",
      ...(administrativeAreaOutcome
        ? { administrativeArea: administrativeAreaOutcome }
        : {}),
      ...(canadaDrought.kind === "not_applicable" ? {} : {
        canadaDrought: canadaDrought.kind === "observation"
          ? "success" as const
          : canadaDrought.kind === "source_failure"
            ? "failed" as const
            : "no_observation" as const,
      }),
    };
    return {
      kind: "source_failure",
      sourceOutcomes,
      failureReason: "validation_failure",
      failureStage: "evidence_assembly",
    };
  }

  // Build final source outcomes
  const sourceOutcomes: DroughtSourceOutcomes = {
    gibs: gibsData.outcome === "success" ? "success" :
          gibsData.outcome === "no_observation" ? "no_observation" :
          gibsData.outcome === "not_attempted" ? "not_attempted" : "failed",
    usdm: usdmData.outcome === "success" ? "success" :
          usdmData.outcome === "no_observation" ? "no_observation" :
          usdmData.outcome === "not_attempted" ? "not_attempted" : "failed",
    ...(administrativeAreaOutcome
      ? { administrativeArea: administrativeAreaOutcome }
      : {}),
    ...(canadaDrought.kind === "not_applicable" ? {} : {
      canadaDrought: canadaDrought.kind === "observation"
        ? "success" as const
        : canadaDrought.kind === "source_failure"
          ? "failed" as const
          : "no_observation" as const,
    }),
  };

  // Determine result kind from evidence state
  const resultKindMap: Record<string, DroughtQueryResult["kind"]> = {
    observations_returned: "success",
    inconclusive_evidence: "inconclusive_evidence",
    no_observation: "no_observation",
    source_failure: "source_failure",
    unsupported_coverage: "unsupported_coverage",
  };
  const kind = (resultKindMap[evidence.evidenceState] ?? "source_failure") as DroughtQueryResult["kind"];

  // Find first failure
  let failureReason: DroughtFailureReason | undefined;
  let failureStage: DroughtFailureStage | undefined;
  if (gibsData.outcome === "failed") {
    failureReason = gibsData.reason;
    failureStage = gibsData.stage;
  } else if (usdmData.outcome === "failed") {
    failureReason = usdmData.reason;
    failureStage = usdmData.stage;
  }

  return {
    kind,
    sourceOutcomes,
    evidence,
    ...(failureReason ? { failureReason } : {}),
    ...(failureStage ? { failureStage } : {}),
  };
}
