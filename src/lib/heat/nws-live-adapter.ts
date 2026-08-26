/**
 * ADR-0038: NWS station observations (api.weather.gov) as recent-date ground
 * evidence for Extreme Heat.
 *
 * The operational USCRN network is rural-sited, so major metro selection
 * boxes contain no USCRN station (ADR-0037). The NWS observation network
 * (airport METAR and partner stations) covers every U.S. metro; its API
 * retains roughly the last seven days of observations — verified 2026-08-19:
 * full data at 1 day back, fragments at 7 days, nothing at 14+.
 *
 * Bounded request budget per query, no retry, no outside-area fallback:
 *   1. /points/{lat},{lon} for the area center → gridpoint stations URL
 *   2. the gridpoint stations list → in-box candidates, nearest first
 *   3. up to NWS_MAX_STATION_ATTEMPTS station-day observation requests
 *      (a station with zero valid rows advances to the next candidate —
 *       the ADR-0036 dead-station lesson applied to this network)
 *
 * Every numeric value is NWS-provided verbatim (temperature, NWS-computed
 * heat index, relative humidity); nothing is derived locally. Quality-control
 * codes are preserved, never reinterpreted.
 */

import { createHash } from "crypto";
import type { BoundingBox } from "@/contracts/common";
import type { Observation, Provenance } from "@/contracts/evidence";
import { areaCenter } from "@/lib/location/query-area";
import {
  NWS_OBSERVATIONS_PRODUCT,
  NWS_SOURCE_ID,
  validateHeatSourceObservation,
} from "./source-contracts";
import type { HeatFailureReason } from "./types";

type FetchLike = typeof fetch;

export const NWS_HOST = "api.weather.gov";
/**
 * api.weather.gov requires a product User-Agent (same policy the registry
 * records for noaa_nws_alerts). No credential, no personal data.
 */
export const NWS_USER_AGENT = "sky-to-porch (owner-operated evidence retrieval)";
export const NWS_RETENTION_DAYS = 7;
export const NWS_MAX_STATION_ATTEMPTS = 2;
/** points + gridpoint stations + at most two station-day observation requests. */
export const NWS_MAX_REQUESTS = 2 + NWS_MAX_STATION_ATTEMPTS;
export const NWS_TIMEOUT_MS = 10_000;
export const NWS_OBSERVATIONS_TIMEOUT_MS = 30_000;
export const NWS_POINTS_MAX_BYTES = 1_000_000;
export const NWS_STATIONS_MAX_BYTES = 4_000_000;
/** A full station day (~300 sub-hourly rows) measured ~1.2 MB on 2026-08-19. */
export const NWS_OBSERVATIONS_MAX_BYTES = 8_000_000;
export const NWS_OBSERVATIONS_LIMIT = 500;
/**
 * Hours of the requested UTC day that must carry a valid temperature before
 * the day counts as ground-confirmed (observations_returned); fewer hours
 * still return the observations but the evidence stays inconclusive.
 */
export const NWS_MIN_DISTINCT_HOURS = 18;

const ACCEPTED_CONTENT_TYPES = ["application/geo+json", "application/json", "application/ld+json"];

export interface NwsStationDayObservations {
  kind: "observations";
  stationId: string;
  stationName: string;
  observations: Observation[];
  distinctHourCount: number;
  /** True when the day is hour-complete enough to ground-confirm. */
  dayComplete: boolean;
}

export type NwsGroundResult =
  | NwsStationDayObservations
  | { kind: "no_station" }
  | { kind: "no_observation"; attemptedStationIds: string[] }
  | { kind: "source_failure"; reason: HeatFailureReason; stage: "nws_transport" | "nws_payload" };

class NwsLiveError extends Error {
  constructor(readonly reason: HeatFailureReason) {
    super(reason);
    this.name = "NwsLiveError";
  }
}

/** True when the requested UTC date is inside the verified retention window. */
export function isWithinNwsRetentionWindow(date: string, now: Date): boolean {
  const dateMs = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(dateMs)) return false;
  const ageDays = (now.getTime() - dateMs) / 86_400_000;
  return ageDays >= 0 && ageDays <= NWS_RETENTION_DAYS;
}

/** api.weather.gov 301-redirects un-normalized coordinates; pre-normalize. */
function normalizeCoordinate(value: number): string {
  return String(Number(value.toFixed(4)));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchBoundedJson(
  fetchImpl: FetchLike,
  url: URL,
  maximumBytes: number,
  timeoutMs: number
): Promise<{ json: unknown; bytes: Uint8Array }> {
  if (url.protocol !== "https:" || url.hostname !== NWS_HOST) {
    throw new NwsLiveError("validation_failure");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/geo+json",
          "User-Agent": NWS_USER_AGENT,
        },
      });
    } catch {
      throw new NwsLiveError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) throw new NwsLiveError("redirect");
    if (response.status === 429) throw new NwsLiveError("rate_limited");
    if (response.status === 404) throw new NwsLiveError("provider_failure");
    if (!response.ok) throw new NwsLiveError("provider_failure");
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!ACCEPTED_CONTENT_TYPES.includes(contentType)) {
      throw new NwsLiveError("schema_validation");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      throw new NwsLiveError("oversize");
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maximumBytes) throw new NwsLiveError("oversize");
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
    } catch {
      throw new NwsLiveError("malformed");
    }
    return { json, bytes: buffer };
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface NwsStationCandidate {
  stationId: string;
  stationName: string;
  latitude: number;
  longitude: number;
}

function parseGridpointStations(json: unknown): NwsStationCandidate[] {
  if (!isRecord(json) || !Array.isArray(json.features)) {
    throw new NwsLiveError("schema_validation");
  }
  const stations: NwsStationCandidate[] = [];
  for (const feature of json.features) {
    if (!isRecord(feature) || !isRecord(feature.properties) || !isRecord(feature.geometry)) {
      continue;
    }
    const stationId = feature.properties.stationIdentifier;
    const stationName = feature.properties.name;
    const coordinates = feature.geometry.coordinates;
    if (
      typeof stationId !== "string" || !/^[A-Z0-9]{3,8}$/u.test(stationId) ||
      typeof stationName !== "string" || stationName.trim().length === 0 ||
      !Array.isArray(coordinates) || coordinates.length < 2 ||
      typeof coordinates[0] !== "number" || typeof coordinates[1] !== "number" ||
      coordinates[1] < -90 || coordinates[1] > 90 ||
      coordinates[0] < -180 || coordinates[0] > 180
    ) {
      continue;
    }
    stations.push({
      stationId,
      stationName: stationName.trim(),
      latitude: coordinates[1],
      longitude: coordinates[0],
    });
  }
  return stations;
}

interface NwsQuantity {
  value: number | null;
  qualityControl: string;
}

function parseQuantity(value: unknown, unitSuffix: string): NwsQuantity | null {
  if (!isRecord(value)) return null;
  const unitCode = value.unitCode;
  const raw = value.value;
  if (raw !== null && (typeof raw !== "number" || !Number.isFinite(raw))) return null;
  if (raw !== null && typeof unitCode === "string" && !unitCode.endsWith(unitSuffix)) return null;
  return {
    value: raw as number | null,
    qualityControl: typeof value.qualityControl === "string" ? value.qualityControl : "",
  };
}

interface NwsDayRow {
  observedAt: string;
  temperatureC: number;
  temperatureQc: string;
  heatIndexC: number | null;
  relativeHumidityPct: number | null;
}

function parseStationDay(json: unknown, date: string): NwsDayRow[] {
  if (!isRecord(json) || !Array.isArray(json.features)) {
    throw new NwsLiveError("schema_validation");
  }
  const rows: NwsDayRow[] = [];
  for (const feature of json.features) {
    if (!isRecord(feature) || !isRecord(feature.properties)) continue;
    const properties = feature.properties;
    const timestamp = properties.timestamp;
    if (typeof timestamp !== "string") continue;
    const timestampMs = Date.parse(timestamp);
    if (!Number.isFinite(timestampMs)) continue;
    const observedAt = new Date(timestampMs).toISOString();
    if (!observedAt.startsWith(date)) continue;
    const temperature = parseQuantity(properties.temperature, "degC");
    if (!temperature || temperature.value === null) continue;
    if (temperature.value < -100 || temperature.value > 100) continue;
    const heatIndex = parseQuantity(properties.heatIndex, "degC");
    const humidity = parseQuantity(properties.relativeHumidity, "percent");
    rows.push({
      observedAt,
      temperatureC: temperature.value,
      temperatureQc: temperature.qualityControl,
      heatIndexC:
        heatIndex && heatIndex.value !== null &&
        heatIndex.value >= -100 && heatIndex.value <= 100
          ? heatIndex.value
          : null,
      relativeHumidityPct:
        humidity && humidity.value !== null &&
        humidity.value >= 0 && humidity.value <= 100
          ? humidity.value
          : null,
    });
  }
  return rows.sort((left, right) => left.observedAt.localeCompare(right.observedAt));
}

function buildNwsObservations(
  rows: NwsDayRow[],
  station: NwsStationCandidate,
  url: URL,
  bytes: Uint8Array,
  retrievedAt: string,
  date: string
): { observations: Observation[]; distinctHourCount: number } {
  const distinctHours = new Set(rows.map((row) => row.observedAt.slice(11, 13)));
  const distinctHourCount = distinctHours.size;
  // Peak selection mirrors the USCRN path: the NWS-provided heat index ranks
  // the day when present; otherwise the temperature does. Nothing is derived.
  const withHeatIndex = rows.filter((row) => row.heatIndexC !== null);
  const peak = (withHeatIndex.length > 0
    ? [...withHeatIndex].sort(
        (left, right) =>
          (right.heatIndexC as number) - (left.heatIndexC as number) ||
          left.observedAt.localeCompare(right.observedAt)
      )
    : [...rows].sort(
        (left, right) =>
          right.temperatureC - left.temperatureC ||
          left.observedAt.localeCompare(right.observedAt)
      ))[0];
  const compactTimestamp = peak.observedAt.replace(/[^0-9]/gu, "");
  const idTag = station.stationId.toLowerCase();
  const shared: Provenance = {
    sourceId: NWS_SOURCE_ID,
    sourceUrl: url.toString(),
    sourceRecordId: `${station.stationId}#${peak.observedAt}`,
    retrievedAt,
    observedAt: peak.observedAt,
    product: NWS_OBSERVATIONS_PRODUCT,
    payloadHash: sha256(bytes),
    requestParameters: { stationId: station.stationId, utcDate: date },
  };
  const metadataBase = {
    stationId: station.stationId,
    stationName: station.stationName,
    stationLatitude: station.latitude,
    stationLongitude: station.longitude,
    relativeHumidityPct: peak.relativeHumidityPct ?? ("unknown" as const),
    qualityControl: peak.temperatureQc || "blank",
    distinctHourCount,
  };
  const qualifiers = ["outdoor_station", "quality_flags_preserved_not_reinterpreted"];
  const observations: Observation[] = [
    {
      observationId: `obs-nws-air-${idTag}-${compactTimestamp}`,
      provenance: shared,
      variableName: "Hourly air temperature",
      value: peak.temperatureC,
      unit: "degC",
      dataMode: "live",
      qualifiers,
      metadata: { ...metadataBase, heatRole: "ground_air_temperature" },
    },
  ];
  if (peak.heatIndexC !== null) {
    observations.push({
      observationId: `obs-nws-heat-index-${idTag}-${compactTimestamp}`,
      provenance: shared,
      variableName: "Hourly heat index",
      value: peak.heatIndexC,
      unit: "degC",
      dataMode: "live",
      qualifiers,
      metadata: { ...metadataBase, heatRole: "derived_heat_index" },
    });
  }
  for (const observation of observations) validateHeatSourceObservation(observation);
  return { observations, distinctHourCount };
}

/**
 * Retrieve the requested UTC day from the in-area NWS station nearest to the
 * area center. Returns no_station when the gridpoint list has no station
 * inside the box — never a station outside the user's selection.
 */
export async function queryNwsGroundEvidence(
  area: BoundingBox,
  date: string,
  now: Date,
  fetchImpl: FetchLike = fetch
): Promise<NwsGroundResult> {
  const center = areaCenter(area);
  let candidates: NwsStationCandidate[];
  try {
    const pointsUrl = new URL(
      `https://${NWS_HOST}/points/${normalizeCoordinate(center.lat)},${normalizeCoordinate(center.lon)}`
    );
    const points = await fetchBoundedJson(fetchImpl, pointsUrl, NWS_POINTS_MAX_BYTES, NWS_TIMEOUT_MS);
    const properties = isRecord(points.json) ? points.json.properties : null;
    const stationsHref = isRecord(properties) ? properties.observationStations : null;
    if (typeof stationsHref !== "string") throw new NwsLiveError("schema_validation");
    const stationsUrl = new URL(stationsHref);
    const stations = await fetchBoundedJson(
      fetchImpl,
      stationsUrl,
      NWS_STATIONS_MAX_BYTES,
      NWS_TIMEOUT_MS
    );
    candidates = parseGridpointStations(stations.json)
      .filter(
        (station) =>
          station.longitude >= area.west &&
          station.longitude <= area.east &&
          station.latitude >= area.south &&
          station.latitude <= area.north
      )
      .map((station) => ({
        station,
        distance:
          (station.longitude - center.lon) ** 2 + (station.latitude - center.lat) ** 2,
      }))
      .sort(
        (left, right) =>
          left.distance - right.distance ||
          left.station.stationId.localeCompare(right.station.stationId)
      )
      .map(({ station }) => station);
  } catch (error) {
    return {
      kind: "source_failure",
      reason: error instanceof NwsLiveError ? error.reason : "schema_validation",
      stage: "nws_transport",
    };
  }
  if (candidates.length === 0) return { kind: "no_station" };

  const attempts = candidates.slice(0, NWS_MAX_STATION_ATTEMPTS);
  const attemptedStationIds: string[] = [];
  for (const station of attempts) {
    attemptedStationIds.push(station.stationId);
    let payload: { json: unknown; bytes: Uint8Array };
    let observationsUrl: URL;
    try {
      observationsUrl = new URL(
        `https://${NWS_HOST}/stations/${station.stationId}/observations` +
          `?start=${date}T00:00:00Z&end=${date}T23:59:59Z&limit=${NWS_OBSERVATIONS_LIMIT}`
      );
      payload = await fetchBoundedJson(
        fetchImpl,
        observationsUrl,
        NWS_OBSERVATIONS_MAX_BYTES,
        NWS_OBSERVATIONS_TIMEOUT_MS
      );
    } catch (error) {
      return {
        kind: "source_failure",
        reason: error instanceof NwsLiveError ? error.reason : "schema_validation",
        stage: "nws_transport",
      };
    }
    try {
      const rows = parseStationDay(payload.json, date);
      if (rows.length === 0) continue;
      const built = buildNwsObservations(
        rows,
        station,
        observationsUrl,
        payload.bytes,
        now.toISOString(),
        date
      );
      return {
        kind: "observations",
        stationId: station.stationId,
        stationName: station.stationName,
        observations: built.observations,
        distinctHourCount: built.distinctHourCount,
        dayComplete: built.distinctHourCount >= NWS_MIN_DISTINCT_HOURS,
      };
    } catch (error) {
      return {
        kind: "source_failure",
        reason: error instanceof NwsLiveError ? error.reason : "schema_validation",
        stage: "nws_payload",
      };
    }
  }
  return { kind: "no_observation", attemptedStationIds };
}
