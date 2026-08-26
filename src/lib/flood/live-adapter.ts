import { createHash } from "crypto";
import sharp from "sharp";
import {
  validateEvidenceObject,
  type EvidenceObject,
  type Freshness,
  type Limitation,
  type MissionAttribution,
  type Observation,
} from "@/contracts/evidence";
import {
  FLOOD_EARLIEST_DATE,
  FLOOD_MAX_RANGE_DAYS,
  USGS_GAGE_HEIGHT_PARAMETER,
  type FloodFailureReason,
  type FloodLiveQueryInput,
  type FloodQueryResult,
  type FloodSourceOutcomes,
} from "./types";
import { queryFloodExtent, type FloodExtentResult } from "./extent-live-adapter";
import {
  queryCanadaHydrometricDailyMean,
  type CanadaHydrometricResult,
} from "./canada-hydrometric-live-adapter";
import type { BoundingBox } from "@/contracts/common";
import {
  CUSTOM_AREA_PLACE_ID,
  areaCenter,
  validateQueryArea,
} from "@/lib/location/query-area";

const GIBS_LAYER = "IMERG_Precipitation_Rate";
const GIBS_HOST = "gibs.earthdata.nasa.gov";
const USGS_HOST = "api.waterdata.usgs.gov";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_GIBS_BYTES = 2_000_000;
const MAX_USGS_BYTES = 4_000_000;

type FetchLike = typeof fetch;

export interface FloodLiveAdapterDependencies {
  fetchImpl?: FetchLike;
  now?: () => Date;
}

class FloodLiveAdapterError extends Error {
  constructor(readonly reason: FloodFailureReason) {
    super(reason);
    this.name = "FloodLiveAdapterError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStrictDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value
    ? ms
    : null;
}

/**
 * ADR-0043: rejections carry their own result kind so a date problem is
 * reported as an unsupported date, never as an unsupported place. The
 * previous classification keyed on a "demo-houston" placeId that the route
 * stopped accepting in UXFIX-02, so every live date rejection surfaced as
 * "Location not supported".
 */
interface FloodInputRejection {
  kind: "unsupported_place" | "unsupported_date";
  reason: string;
}

function validateInput(input: FloodLiveQueryInput, now: Date): FloodInputRejection | null {
  if (input.placeId !== CUSTOM_AREA_PLACE_ID) {
    return {
      kind: "unsupported_place",
      reason: "Live Flood evidence requires the canonical map-selected area.",
    };
  }
  try {
    validateQueryArea(input.area);
  } catch {
    return {
      kind: "unsupported_place",
      reason: "The selected map area is not a valid Flood query area. Re-select the location.",
    };
  }
  const startMs = parseStrictDate(input.startDate);
  const endMs = parseStrictDate(input.endDate);
  if (startMs === null || endMs === null || endMs < startMs) {
    return {
      kind: "unsupported_date",
      reason: "Flood live dates must be a real inclusive YYYY-MM-DD range.",
    };
  }
  // ADR-0043: dates before the IMERG record are an explicit date rejection,
  // not seven transparent tiles presented as a coverage gap.
  if (input.startDate < FLOOD_EARLIEST_DATE) {
    return {
      kind: "unsupported_date",
      reason: `Flood live retrieval begins with the IMERG precipitation record on ${FLOOD_EARLIEST_DATE}.`,
    };
  }
  const days = (endMs - startMs) / 86_400_000 + 1;
  if (!Number.isInteger(days) || days < 1 || days > FLOOD_MAX_RANGE_DAYS) {
    return {
      kind: "unsupported_date",
      reason: `Flood live retrieval accepts an inclusive range of 1-${FLOOD_MAX_RANGE_DAYS} UTC days.`,
    };
  }
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (endMs >= todayMs) {
    return {
      kind: "unsupported_date",
      reason: "Flood live retrieval accepts only completed UTC dates before today.",
    };
  }
  return null;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const statedLength = response.headers.get("content-length");
  if (statedLength !== null) {
    const length = Number(statedLength);
    if (!Number.isFinite(length) || length < 0 || length > maximumBytes) {
      throw new FloodLiveAdapterError("oversize");
    }
  }
  if (!response.body) throw new FloodLiveAdapterError("malformed");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new FloodLiveAdapterError("oversize");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchBounded(
  fetchImpl: FetchLike,
  url: URL,
  maximumBytes: number,
  acceptedContentTypes: readonly string[]
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: acceptedContentTypes.join(", ") },
      });
    } catch {
      throw new FloodLiveAdapterError(controller.signal.aborted ? "timeout" : "network");
    }

    if (response.status >= 300 && response.status < 400) {
      throw new FloodLiveAdapterError("redirect");
    }
    if (response.status === 429) throw new FloodLiveAdapterError("rate_limited");
    if (!response.ok) throw new FloodLiveAdapterError("provider_failure");

    const contentType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!acceptedContentTypes.includes(contentType)) {
      throw new FloodLiveAdapterError("schema_validation");
    }
    return { bytes: await readBoundedBody(response, maximumBytes), contentType };
  } finally {
    clearTimeout(timeout);
  }
}

function buildGibsUrl(date: string, box: BoundingBox): URL {
  const url = new URL("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi");
  const parameters: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    LAYERS: GIBS_LAYER,
    SRS: "EPSG:4326",
    STYLES: "",
    WIDTH: "512",
    HEIGHT: "512",
    TIME: date,
    BBOX: `${box.west},${box.south},${box.east},${box.north}`,
  };
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  if (url.hostname !== GIBS_HOST) throw new FloodLiveAdapterError("validation_failure");
  return url;
}

function buildUsgsContinuousUrl(siteId: string, startDate: string, endDate: string): URL {
  const url = new URL(
    "https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items"
  );
  url.searchParams.set("f", "json");
  url.searchParams.set("limit", "10000");
  url.searchParams.set("monitoring_location_id", `USGS-${siteId}`);
  url.searchParams.set("parameter_code", USGS_GAGE_HEIGHT_PARAMETER);
  url.searchParams.set(
    "datetime",
    `${startDate}T00:00:00Z/${endDate}T23:59:59Z`
  );
  if (url.hostname !== USGS_HOST) throw new FloodLiveAdapterError("validation_failure");
  return url;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new FloodLiveAdapterError("malformed");
  }
}

async function buildGibsObservation(
  fetchImpl: FetchLike,
  date: string,
  retrievedAt: string,
  box: BoundingBox,
  areaTag: string
): Promise<{ observation: Observation; transparent: boolean }> {
  const url = buildGibsUrl(date, box);
  const { bytes, contentType } = await fetchBounded(
    fetchImpl,
    url,
    MAX_GIBS_BYTES,
    ["image/png"]
  );
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  let alphaMaximum: number;
  try {
    metadata = await sharp(bytes, { failOn: "error" }).metadata();
    const statistics = await sharp(bytes, { failOn: "error" }).ensureAlpha().stats();
    alphaMaximum = statistics.channels[3]?.max ?? 255;
  } catch {
    throw new FloodLiveAdapterError("malformed");
  }
  if (metadata.format !== "png" || metadata.width !== 512 || metadata.height !== 512) {
    throw new FloodLiveAdapterError("schema_validation");
  }

  const transparent = alphaMaximum === 0;
  return {
    transparent,
    observation: {
      observationId: `obs-gibs-imerg-${areaTag}-${date}`,
      provenance: {
        sourceId: "nasa_gibs_imerg",
        sourceUrl: url.toString(),
        retrievedAt,
        observedAt: transparent ? "unknown" : `${date}T00:00:00Z`,
        product:
          "NASA GIBS best-service layer IMERG_Precipitation_Rate; GetMap does not expose a numeric run or concept version",
        payloadHash: sha256(bytes),
        requestParameters: Object.fromEntries(url.searchParams.entries()),
      },
      variableName: "GIBS IMERG precipitation visualization PNG",
      textValue: transparent
        ? "Transparent PNG returned; this is unsupported coverage, not zero precipitation."
        : "Validated non-transparent PNG visualization received; no numeric precipitation was inferred from pixels.",
      unit: transparent
        ? "PNG tile (transparent/no-data)"
        : "PNG tile (visual evidence only; numeric rainfall not inferred from colors)",
      dataMode: "live",
      qualifiers: transparent ? ["unsupported_coverage"] : [],
      metadata: {
        contentType,
        bytes: bytes.byteLength,
        width: metadata.width,
        height: metadata.height,
        requestedTime: date,
        boundingBox: `${box.west},${box.south},${box.east},${box.north}`,
        layerAlias: GIBS_LAYER,
        versionDisclosure: "GIBS best-service GetMap response does not expose concept/run version",
      },
    },
  };
}

type ParsedContinuousValue = {
  id: string;
  time: string;
  value: number;
  qualifiers: string[];
  timeSeriesId: string;
};

function parseStringList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  if (!values.every((item) => typeof item === "string" && item.trim().length > 0)) {
    throw new FloodLiveAdapterError("schema_validation");
  }
  return [...new Set(values as string[])].sort();
}

function parseContinuous(
  bytes: Uint8Array,
  siteId: string,
  startDate: string,
  endDate: string
): ParsedContinuousValue[] {
  const parsed = parseJson(bytes);
  if (!isRecord(parsed) || parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new FloodLiveAdapterError("schema_validation");
  }
  if (
    parsed.numberReturned !== undefined &&
    (!Number.isInteger(parsed.numberReturned) || parsed.numberReturned !== parsed.features.length)
  ) {
    throw new FloodLiveAdapterError("schema_validation");
  }
  if (Array.isArray(parsed.links)) {
    const hasNext = parsed.links.some((link) => isRecord(link) && link.rel === "next");
    if (hasNext) throw new FloodLiveAdapterError("oversize");
  }

  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T23:59:59Z`);
  const allValues = parsed.features.map((feature): ParsedContinuousValue => {
    if (!isRecord(feature) || feature.type !== "Feature" || typeof feature.id !== "string") {
      throw new FloodLiveAdapterError("schema_validation");
    }
    const properties = feature.properties;
    if (
      !isRecord(properties) ||
      properties.monitoring_location_id !== `USGS-${siteId}` ||
      properties.parameter_code !== USGS_GAGE_HEIGHT_PARAMETER ||
      properties.unit_of_measure !== "ft" ||
      typeof properties.time !== "string" ||
      typeof properties.time_series_id !== "string" ||
      (typeof properties.value !== "string" && typeof properties.value !== "number")
    ) {
      throw new FloodLiveAdapterError("schema_validation");
    }
    const timeMs = Date.parse(properties.time);
    const value = Number(properties.value);
    if (!Number.isFinite(timeMs) || !Number.isFinite(value)) {
      throw new FloodLiveAdapterError("schema_validation");
    }
    return {
      id: feature.id,
      time: new Date(timeMs).toISOString(),
      value,
      qualifiers: [
        ...parseStringList(properties.approval_status ?? properties.approvals_status),
        ...parseStringList(properties.qualifier),
      ].filter((item, index, all) => all.indexOf(item) === index).sort(),
      timeSeriesId: properties.time_series_id,
    };
  });
  // ADR-0043: the request already asks for exactly this window; a returned
  // boundary or rounded timestamp just outside it is the provider's edge
  // behavior, not a schema violation. Such rows are excluded from evidence
  // rather than collapsing the whole flood query into a source failure.
  const values = allValues.filter((entry) => {
    const timeMs = Date.parse(entry.time);
    return timeMs >= startMs && timeMs <= endMs;
  });
  return values.sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
}

interface GageSite {
  siteId: string;
  name: string;
  /** Hash of the payload that established this site (location or discovery). */
  locationPayloadHash: string;
  /** How the site was chosen (ADR-0043: bbox discovery is the only path). */
  selectionBasis: "bbox_discovery_nearest";
}

/**
 * UXFIX-02: Discover USGS monitoring locations inside a validated query area.
 * One bounded request; candidates are sorted by distance to the area center.
 * Returns at most `maximumCandidates` sites. Failure fails closed upstream.
 */
function buildUsgsDiscoveryUrl(box: BoundingBox): URL {
  const url = new URL(
    "https://api.waterdata.usgs.gov/ogcapi/v0/collections/monitoring-locations/items"
  );
  url.searchParams.set("f", "json");
  url.searchParams.set("limit", "50");
  url.searchParams.set("bbox", `${box.west},${box.south},${box.east},${box.north}`);
  if (url.hostname !== USGS_HOST) throw new FloodLiveAdapterError("validation_failure");
  return url;
}

async function discoverGageSites(
  fetchImpl: FetchLike,
  box: BoundingBox,
  maximumCandidates: number
): Promise<GageSite[]> {
  const url = buildUsgsDiscoveryUrl(box);
  const { bytes } = await fetchBounded(
    fetchImpl,
    url,
    MAX_USGS_BYTES,
    ["application/geo+json", "application/json"]
  );
  const parsed = parseJson(bytes);
  if (!isRecord(parsed) || parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new FloodLiveAdapterError("schema_validation");
  }
  const payloadHash = sha256(bytes);
  const center = areaCenter(box);
  const candidates: Array<GageSite & { distance: number }> = [];
  for (const feature of parsed.features) {
    if (!isRecord(feature) || feature.type !== "Feature") continue;
    const properties = feature.properties;
    const geometry = feature.geometry;
    if (
      !isRecord(properties) ||
      properties.agency_code !== "USGS" ||
      typeof properties.monitoring_location_number !== "string" ||
      !/^\d{8,15}$/u.test(properties.monitoring_location_number) ||
      typeof properties.monitoring_location_name !== "string" ||
      properties.monitoring_location_name.trim().length === 0 ||
      !isRecord(geometry) ||
      geometry.type !== "Point" ||
      !Array.isArray(geometry.coordinates) ||
      typeof geometry.coordinates[0] !== "number" ||
      typeof geometry.coordinates[1] !== "number"
    ) {
      continue;
    }
    const longitude = geometry.coordinates[0];
    const latitude = geometry.coordinates[1];
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < box.west ||
      longitude > box.east ||
      latitude < box.south ||
      latitude > box.north
    ) {
      continue;
    }
    const dLon = longitude - center.lon;
    const dLat = latitude - center.lat;
    candidates.push({
      siteId: properties.monitoring_location_number,
      name: properties.monitoring_location_name,
      locationPayloadHash: payloadHash,
      selectionBasis: "bbox_discovery_nearest",
      distance: dLon * dLon + dLat * dLat,
    });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.siteId.localeCompare(b.siteId));
  return candidates.slice(0, maximumCandidates).map(({ siteId, name, locationPayloadHash, selectionBasis }) => ({
    siteId,
    name,
    locationPayloadHash,
    selectionBasis,
  }));
}

async function buildUsgsObservation(
  fetchImpl: FetchLike,
  site: GageSite,
  startDate: string,
  endDate: string,
  retrievedAt: string
): Promise<Observation | null> {
  const continuousUrl = buildUsgsContinuousUrl(site.siteId, startDate, endDate);
  const continuousResponse = await fetchBounded(
    fetchImpl,
    continuousUrl,
    MAX_USGS_BYTES,
    ["application/geo+json", "application/json"]
  );
  const values = parseContinuous(continuousResponse.bytes, site.siteId, startDate, endDate);
  const location = { name: site.name, payloadHash: site.locationPayloadHash };
  if (values.length === 0) return null;

  const latest = values[values.length - 1];
  const numericValues = values.map((item) => item.value);
  return {
    observationId: `obs-usgs-gage-${site.siteId}-${latest.id}`,
    provenance: {
      sourceId: "usgs_instantaneous_values",
      sourceUrl: continuousUrl.toString(),
      sourceRecordId: latest.id,
      retrievedAt,
      observedAt: latest.time,
      product: "USGS Water Data OGC API v0 continuous values",
      payloadHash: sha256(continuousResponse.bytes),
      requestParameters: Object.fromEntries(continuousUrl.searchParams.entries()),
    },
    variableName: "Gage height",
    value: latest.value,
    unit: "ft",
    dataMode: "live",
    qualifiers: latest.qualifiers,
    periodStart: values[0].time,
    periodEnd: latest.time,
    metadata: {
      siteId: site.siteId,
      monitoringLocationId: `USGS-${site.siteId}`,
      siteSelectionBasis: site.selectionBasis,
      siteName: location.name,
      parameterCd: USGS_GAGE_HEIGHT_PARAMETER,
      parameterName: "Gage height",
      totalValues: values.length,
      observedRangeMin: Math.min(...numericValues),
      observedRangeMax: Math.max(...numericValues),
      timeSeriesId: latest.timeSeriesId,
      locationPayloadHash: location.payloadHash,
      serviceDisclosure: "USGS continuous values may be provisional and subject to revision",
    },
  };
}

function freshnessFor(observations: Observation[], evaluatedAt: string): Freshness {
  const times = observations
    .map((observation) => observation.provenance.observedAt)
    .filter((value): value is string => value !== "unknown")
    .map((value) => Date.parse(value));
  if (times.length === 0) {
    return {
      status: "unknown",
      classificationBasis: "no_observation_time",
      evaluatedAt,
      note: "No usable observation timestamp is available.",
    };
  }
  const latest = Math.max(...times);
  const evaluatedMs = Date.parse(evaluatedAt);
  return {
    status: "historical",
    classificationBasis: "historical_context",
    mostRecentObservationAt: new Date(latest).toISOString(),
    evaluatedAt,
    ageSeconds: Math.floor((evaluatedMs - latest) / 1000),
    note: "The live retrieval returned historical observations for the explicitly requested completed UTC dates.",
  };
}

const GIBS_LIMITATION: Limitation = {
  limitationId: "lim-wp08-live-gibs-visual-only",
  source: "nasa_gibs_imerg",
  description:
    "GIBS imagery is visualization evidence only. Numeric rainfall, surface-water extent, route status, and property impact are not inferred from pixels.",
  required: true,
};

const NO_GAGE_LIMITATION: Limitation = {
  limitationId: "lim-uxfix02-live-no-gage-in-area",
  source: "ground_gage_sources",
  description:
    "No applicable USGS or ECCC gage inside the selected area returned an observation for the requested dates. " +
    "Absent ground data is not evidence of no flooding.",
  required: true,
};

const USGS_LIMITATION: Limitation = {
  limitationId: "lim-wp08-live-usgs-station-only",
  source: "usgs_instantaneous_values",
  description:
    "A provisional station-level gage reading is not a universal Flood threshold and does not establish property-level flooding or route status.",
  required: true,
};

const CANADA_GEOMET_LIMITATION: Limitation = {
  limitationId: "lim-webmcp-canada-geomet-station-only",
  source: "canada_geomet",
  description:
    "The ECCC daily mean is one station-level water-level observation in metres. It is not a universal flood threshold and does not establish property flooding, route status, or safety.",
  required: true,
};

const CANADA_GEOMET_NO_OBSERVATION_LIMITATION: Limitation = {
  limitationId: "lim-webmcp-canada-geomet-no-observation",
  source: "canada_geomet",
  description:
    "No valid ECCC hydrometric daily-mean water level was returned inside the selected area for the requested end date. Missing ground data is not evidence of no flooding.",
  required: true,
};

const CANADA_GEOMET_FAILURE_LIMITATION: Limitation = {
  limitationId: "lim-webmcp-canada-geomet-failure",
  source: "canada_geomet",
  description:
    "The ECCC hydrometric request failed. Other returned sources do not replace Canadian ground evidence, and the failure is not evidence of no flooding or no danger.",
  required: true,
};

/** Inclusive first day of the backward-looking 3-day composite ending on endDate. */
function floodExtentWindowStart(endDate: string): string {
  return new Date(Date.parse(`${endDate}T00:00:00Z`) - 2 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * ADR-0043: the evidence states the composite's actual window, matching the
 * ADR-0040 map-card disclosure. A detection may come from any day in the
 * window — including days before a shorter selected range — and days of a
 * longer selected range before the window have no flood-extent coverage.
 */
function floodExtentLimitation(endDate: string): Limitation {
  return {
    limitationId: "lim-wp10-live-flood-extent-visual-only",
    source: "nasa_lance_flood_extent",
    description:
      `The VIIRS flood product is a 3-day composite covering ${floodExtentWindowStart(endDate)} ` +
      `through ${endDate} UTC; a detection may come from any day in that window, and selected ` +
      "days before it have no flood-extent coverage. It is retained as a regional visualization: " +
      "pixel classes, flood depth, property impact, road status, and evacuation instructions " +
      "are not inferred.",
    required: true,
  };
}

function floodExtentNoObservationLimitation(endDate: string): Limitation {
  return {
    limitationId: "lim-wp10-live-flood-extent-no-observation",
    source: "nasa_lance_flood_extent",
    description:
      `The flood-extent request returned a valid transparent no-observation image for the ` +
      `3-day composite covering ${floodExtentWindowStart(endDate)} through ${endDate} UTC. ` +
      "That is not evidence of no flood or no danger.",
    required: true,
  };
}

const FLOOD_EXTENT_FAILURE_LIMITATION: Limitation = {
  limitationId: "lim-wp10-live-flood-extent-failure",
  source: "nasa_lance_flood_extent",
  description:
    "The flood-extent source failed. Other returned context does not replace it, and the failure is not evidence of no flood or no danger.",
  required: true,
};

function floodExtentAttribution(result: FloodExtentResult): MissionAttribution {
  return {
    missionName: "VIIRS NOAA-20 / NOAA-21",
    agency: "NASA / NOAA",
    purpose: "Regional 3-day flood-extent visualization",
    selectionReason: "Satellite flood-extent evidence paired with precipitation context and available ground gages",
    contributedObservationIds:
      result.kind === "source_failure" ? [] : [result.observation.observationId],
    retrievalStatus: result.kind === "source_failure" ? "failed" : "success",
    keyLimitation:
      result.kind === "no_observation"
        ? "A transparent response is no observation, not no flood or no danger."
        : "The visualization is not interpreted as flood depth, property impact, road status, or an evacuation instruction.",
    datasetId: "VIIRS_Combined_Flood_3-Day",
  };
}

function gpmAttribution(observations: Observation[], anyTransparent: boolean): MissionAttribution {
  return {
    missionName: "GPM (Global Precipitation Measurement)",
    agency: "NASA / JAXA",
    purpose: "Global precipitation measurement visualized through GIBS IMERG",
    selectionReason: "Credential-free regional precipitation visualization for the Flood evidence path",
    contributedObservationIds: observations.map((observation) => observation.observationId),
    retrievalStatus: anyTransparent ? "partial" : "success",
    keyLimitation:
      "The PNG is visualization evidence only; no numeric rainfall, surface-water, property, or route conclusion is derived from colors.",
    datasetId: GIBS_LAYER,
  };
}

function canadaHydrometricAttribution(
  result: Extract<CanadaHydrometricResult, { kind: "observation" | "source_failure" }>
): MissionAttribution {
  return {
    missionName: "ECCC Water Survey of Canada",
    agency: "Environment and Climate Change Canada",
    purpose: "In-area hydrometric daily-mean water-level context",
    selectionReason:
      "Official anonymous Canadian ground-station evidence queried by the validated selected bounding box and end date",
    contributedObservationIds:
      result.kind === "observation" ? [result.observation.observationId] : [],
    retrievalStatus: result.kind === "observation" ? "success" : "failed",
    keyLimitation:
      "One station daily mean is not a universal flood threshold and does not establish property flooding or route safety.",
    datasetId: "hydrometric-daily-mean",
  };
}

function buildFailureEvidence(evaluatedAt: string, reason: FloodFailureReason): EvidenceObject {
  const evidence: EvidenceObject = {
    evidenceId: `evd-flood-live-failure-${reason}-${evaluatedAt}`,
    hazardId: "flood_storm",
    intentId: "intent-flood-live-query",
    evidenceState: "source_failure",
    dataMode: "failed",
    observations: [],
    derivedMetrics: [],
    missionAttributions: [],
    freshness: {
      status: "unknown",
      classificationBasis: "no_observation_time",
      evaluatedAt,
      note: "No observation time exists because a required live source failed.",
    },
    confidence: {
      level: "insufficient",
      rationale: `A required live source failed (${reason}). Failure is not evidence of no danger.`,
    },
    limitations: [
      {
        limitationId: "lim-wp08-live-failure-not-safe",
        source: "nasa_gibs_imerg",
        description:
          "Live source failure is not zero precipitation, no flooding, no property impact, or a safe route. No fixture was substituted.",
        required: true,
      },
      {
        limitationId: "lim-wp08-live-failure-usgs-not-safe",
        source: "usgs_instantaneous_values",
        description:
          "A failed USGS retrieval is not a low gage value, no flooding, no property impact, or a safe route. No fixture was substituted.",
        required: true,
      },
    ],
    explanations: [],
    assembledAt: evaluatedAt,
  };
  validateEvidenceObject(evidence);
  return evidence;
}

export async function queryLiveFloodEvidence(
  input: FloodLiveQueryInput,
  dependencies: FloodLiveAdapterDependencies = {}
): Promise<FloodQueryResult> {
  const sourceOutcomes: FloodSourceOutcomes = {
    imerg: "not_attempted",
    floodExtent: "not_attempted",
    usgs: "not_attempted",
    canadaGeomet: "not_attempted",
  };
  const now = dependencies.now?.() ?? new Date();
  const rejection = validateInput(input, now);
  if (rejection) {
    return {
      kind: rejection.kind,
      sourceOutcomes,
      rejectionReason: rejection.reason,
    };
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const assembledAt = now.toISOString();
  const box: BoundingBox = validateQueryArea(input.area);
  const areaTag = "custom-area";
  try {
    const floodExtent = await queryFloodExtent(input.endDate, box, {
      fetchImpl,
      now: () => now,
    });
    sourceOutcomes.floodExtent = floodExtent.kind === "observation"
      ? "success"
      : floodExtent.kind === "no_observation"
        ? "no_observation"
        : "failed";

    // UXFIX-02: one bounded GIBS observation per requested UTC day (max
    // FLOOD_MAX_RANGE_DAYS), fetched sequentially to stay a good citizen.
    const dates: string[] = [];
    for (
      let ms = Date.parse(`${input.startDate}T00:00:00Z`);
      ms <= Date.parse(`${input.endDate}T00:00:00Z`);
      ms += 86_400_000
    ) {
      dates.push(new Date(ms).toISOString().slice(0, 10));
    }
    const gibsDays: Array<{ observation: Observation; transparent: boolean }> = [];
    for (const date of dates) {
      gibsDays.push(await buildGibsObservation(fetchImpl, date, assembledAt, box, areaTag));
    }
    sourceOutcomes.imerg = gibsDays.every((day) => day.transparent)
      ? "no_observation"
      : "success";

    // Ground gage: nearest discovered site with data inside the validated
    // area (bounded candidates). ADR-0043 removed the unreachable pinned
    // Houston demo-site branch — the route only ever accepts custom-area.
    let usgs: Observation | null = null;
    sourceOutcomes.usgs = "no_observation";
    const candidates = await discoverGageSites(fetchImpl, box, 3);
    for (const candidate of candidates) {
      usgs = await buildUsgsObservation(
        fetchImpl,
        candidate,
        input.startDate,
        input.endDate,
        assembledAt
      );
      if (usgs) break;
    }
    if (usgs) sourceOutcomes.usgs = "success";

    // Canada ground coverage is a supporting role. The coarse geographic
    // gate only avoids clearly irrelevant requests; the adapter accepts an
    // observation only when the station coordinate is inside this exact box.
    const canadaHydrometric = await queryCanadaHydrometricDailyMean(
      box,
      input.endDate,
      { fetchImpl, now: () => now }
    );
    sourceOutcomes.canadaGeomet = canadaHydrometric.kind === "observation"
      ? "success"
      : canadaHydrometric.kind === "no_observation"
        ? "no_observation"
        : canadaHydrometric.kind === "source_failure"
          ? "failed"
          : "not_attempted";

    const gibsObservations = gibsDays.map((day) => day.observation);
    const floodExtentObservation = floodExtent.kind !== "source_failure"
      ? floodExtent.observation as Observation
      : null;
    const canadaObservation = canadaHydrometric.kind === "observation"
      ? canadaHydrometric.observation
      : null;
    const groundObservations = [
      ...(usgs ? [usgs] : []),
      ...(canadaObservation ? [canadaObservation] : []),
    ];
    const observations = [
      ...gibsObservations,
      ...(floodExtentObservation ? [floodExtentObservation] : []),
      ...groundObservations,
    ];
    const satelliteUnsupported =
      gibsDays.every((day) => day.transparent) && floodExtent.kind === "no_observation";
    const unsupported = satelliteUnsupported && groundObservations.length === 0;
    const inconclusive = !unsupported && (
      groundObservations.length === 0 ||
      floodExtent.kind === "source_failure" ||
      satelliteUnsupported
    );
    const evidence: EvidenceObject = {
      evidenceId: `evd-flood-${areaTag}-live-${input.startDate}-${input.endDate}`,
      hazardId: "flood_storm",
      intentId: "intent-flood-live-query",
      evidenceState: unsupported
        ? "unsupported_coverage"
        : inconclusive
          ? "inconclusive_evidence"
          : "observations_returned",
      dataMode: "live",
      observations,
      derivedMetrics: [],
      missionAttributions: [
        gpmAttribution(gibsObservations, gibsDays.some((day) => day.transparent)),
        floodExtentAttribution(floodExtent),
        ...(canadaHydrometric.kind === "observation" || canadaHydrometric.kind === "source_failure"
          ? [canadaHydrometricAttribution(canadaHydrometric)]
          : []),
      ],
      freshness: freshnessFor(observations, assembledAt),
      confidence: {
        level: unsupported || inconclusive ? "insufficient" : "low",
        rationale: unsupported
          ? "Every requested day returned a transparent GIBS response and cannot support a precipitation observation."
          : inconclusive
            ? floodExtent.kind === "source_failure"
              ? "The returned precipitation or gage context cannot replace the failed flood-extent source."
              : satelliteUnsupported
                ? "A ground gage observation is available, but both satellite roles returned no usable regional observation."
                : "The regional visualization was retrieved but no applicable USGS or ECCC gage in the selected area returned an observation for these dates."
            : "Regional visualization and in-area station evidence are available but do not establish property or route conditions.",
      },
      limitations: [
        GIBS_LIMITATION,
        floodExtentLimitation(input.endDate),
        ...(floodExtent.kind === "no_observation"
          ? [floodExtentNoObservationLimitation(input.endDate)]
          : floodExtent.kind === "source_failure"
            ? [FLOOD_EXTENT_FAILURE_LIMITATION]
            : []),
        ...(usgs ? [USGS_LIMITATION] : []),
        ...(canadaHydrometric.kind === "observation"
          ? [CANADA_GEOMET_LIMITATION]
          : canadaHydrometric.kind === "no_observation"
            ? [CANADA_GEOMET_NO_OBSERVATION_LIMITATION]
            : canadaHydrometric.kind === "source_failure"
              ? [CANADA_GEOMET_FAILURE_LIMITATION]
              : []),
        ...(groundObservations.length === 0 ? [NO_GAGE_LIMITATION] : []),
      ],
      explanations: [],
      assembledAt,
    };
    validateEvidenceObject(evidence);
    return {
      kind: unsupported
        ? "unsupported_coverage"
        : inconclusive
          ? "inconclusive_evidence"
          : "success",
      sourceOutcomes,
      evidence,
    };
  } catch (error) {
    const reason = error instanceof FloodLiveAdapterError
      ? error.reason
      : "validation_failure";
    if (sourceOutcomes.imerg === "not_attempted") sourceOutcomes.imerg = "failed";
    else if (sourceOutcomes.usgs === "not_attempted" || sourceOutcomes.usgs === "no_observation") {
      sourceOutcomes.usgs = "failed";
    }
    return {
      kind: "source_failure",
      sourceOutcomes,
      failureReason: reason,
      evidence: buildFailureEvidence(assembledAt, reason),
    };
  }
}
