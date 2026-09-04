import { createHash } from "crypto";
import sharp from "sharp";
import {
  validateEvidenceObject,
  type EvidenceObject,
  type Limitation,
  type MissionAttribution,
  type Observation,
  type Provenance,
} from "@/contracts/evidence";
import {
  GIBS_HEAT_LAYER_ID,
  GIBS_HEAT_TILE_MATRIX_SET,
  USCRN_HEAT_PRODUCT,
  USCRN_TUCSON_COORDINATE,
  USCRN_TUCSON_STATION_ID,
  USCRN_TUCSON_STATION_NAME,
  validateHeatSourceObservation,
} from "./source-contracts";
import {
  HEAT_GIBS_UNPUBLISHED_LIMITATION_ID,
  type HeatFailureStage,
  type HeatFailureReason,
  type HeatLiveQueryInput,
  type HeatQueryResult,
} from "./types";
import type { BoundingBox } from "@/contracts/common";
import { USCRN_HEAT01_STATIONS } from "@/data/uscrn-heat01-stations";
import {
  CUSTOM_AREA_PLACE_ID,
  areaCenter,
  validateQueryArea,
} from "@/lib/location/query-area";
import {
  NWS_RETENTION_DAYS,
  isWithinNwsRetentionWindow,
  queryNwsGroundEvidence,
  type NwsStationDayObservations,
} from "./nws-live-adapter";
import { NWS_SOURCE_ID } from "./source-contracts";
import {
  queryGhcnhGroundEvidence,
  type GhcnhGroundObservation,
} from "./ground-live-adapter";
import { NCEI_GHCNH_SOURCE_ID } from "./ground-source-contract";

const GIBS_HOST = "gibs.earthdata.nasa.gov";
const NOAA_HOST = "www.ncei.noaa.gov";
const GIBS_TILE = {
  matrixSet: GIBS_HEAT_TILE_MATRIX_SET,
  matrix: 7,
  row: 51,
  col: 24,
} as const;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_GIBS_BYTES = 2_000_000;
/**
 * ADR-0037: a Heat01 CSV spans the station's full commissioned history (the
 * verified Tucson file is 16.2 MB and grows ~0.7 MB/year), so the previous
 * 20 MB cap left no headroom for older stations. Still a hard fail-closed
 * bound.
 */
const MAX_NOAA_BYTES = 32_000_000;
const EARLIEST_GIBS_DATE = "2000-02-24";
const USCRN_HEAT01_BASE_URL = "https://www.ncei.noaa.gov/pub/data/uscrn/products/heat01/";
/**
 * ADR-0039: GHCNh station-by-year files publish roughly four weeks behind
 * real time (files regenerated 2026-08-19 ended at 2026-07-21/22 across
 * stations). Dates younger than this window are predictably unpublished, so
 * they are never queried; the gap is stated as an explicit limitation.
 */
export const GHCNH_PUBLICATION_WINDOW_DAYS = 28;
/** Distinct valid UTC hours required before a GHCNh day ground-confirms. */
export const GHCNH_MIN_DISTINCT_HOURS = 18;
/**
 * ADR-0041: distinct published UTC hours required before a USCRN Heat01 day
 * ground-confirms, aligned with the ADR-0038 NWS and ADR-0039 GHCNh rule.
 * The previous rows.length === 24 rule turned any single missing hour
 * (instrument maintenance, a file not yet backfilled) into a whole-day
 * downgrade; a shortfall now stays visible as an explicit limitation instead.
 */
export const USCRN_MIN_DISTINCT_HOURS = 18;
/**
 * ADR-0041: a transparent GIBS tile for a date this close to today usually
 * means the daily MODIS LST product has not been published yet, not that the
 * place or date is outside coverage. Older transparent dates keep the
 * out-of-coverage semantics.
 */
export const GIBS_RECENT_PUBLICATION_WINDOW_DAYS = 3;

function isBeyondGhcnhPublicationWindow(date: string, now: Date): boolean {
  const dateMs = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(dateMs)) return false;
  return (now.getTime() - dateMs) / 86_400_000 >= GHCNH_PUBLICATION_WINDOW_DAYS;
}

/**
 * P0-A/ADR-0037: allowlisted NOAA USCRN Heat01 stations usable by live
 * queries. A custom-area query includes a station only when its fixed
 * coordinate lies inside the validated bounding box; nothing else is ever
 * fetched.
 */
interface UscrnStationSource {
  readonly stationId: string;
  readonly stationName: string;
  readonly coordinate: { readonly lat: number; readonly lon: number };
  readonly csvUrl: string;
  readonly csvFileName: string;
  /** Stable observation-ID tag; "tucson" keeps existing IDs byte-identical. */
  readonly idTag: string;
}

function uscrnIdTag(stationId: string): string {
  if (stationId === USCRN_TUCSON_STATION_ID) return "tucson";
  return stationId.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-");
}

/** ADR-0037: every USCRN station that publishes a Heat01 file (generated list). */
const ALLOWLISTED_USCRN_STATIONS: readonly UscrnStationSource[] =
  USCRN_HEAT01_STATIONS.map((station) => ({
    stationId: station.stationId,
    stationName: station.stationName,
    coordinate: { lat: station.lat, lon: station.lon },
    csvUrl: `${USCRN_HEAT01_BASE_URL}CRNHE0101-${station.stationId}.csv`,
    csvFileName: `CRNHE0101-${station.stationId}.csv`,
    idTag: uscrnIdTag(station.stationId),
  }));

const TUCSON_STATION: UscrnStationSource = (() => {
  const station = ALLOWLISTED_USCRN_STATIONS.find(
    (entry) => entry.stationId === USCRN_TUCSON_STATION_ID
  );
  if (
    !station ||
    station.stationName !== USCRN_TUCSON_STATION_NAME ||
    station.coordinate.lat !== USCRN_TUCSON_COORDINATE.lat ||
    station.coordinate.lon !== USCRN_TUCSON_COORDINATE.lon
  ) {
    throw new Error("USCRN allowlist drift: the ADR-0034 Tucson entry is missing or changed");
  }
  return station;
})();

/**
 * Allowlisted station nearest to the area center among those whose coordinate
 * lies inside the box (inclusive); deterministic tie-break by stationId.
 */
function stationInsideArea(box: BoundingBox): UscrnStationSource | null {
  const center = areaCenter(box);
  const inside = ALLOWLISTED_USCRN_STATIONS.filter((station) =>
    station.coordinate.lon >= box.west &&
    station.coordinate.lon <= box.east &&
    station.coordinate.lat >= box.south &&
    station.coordinate.lat <= box.north
  );
  if (inside.length === 0) return null;
  return inside
    .map((station) => ({
      station,
      distance:
        (station.coordinate.lon - center.lon) ** 2 + (station.coordinate.lat - center.lat) ** 2,
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.station.stationId.localeCompare(right.station.stationId)
    )[0].station;
}

type FetchLike = typeof fetch;

export interface HeatLiveAdapterDependencies {
  fetchImpl?: FetchLike;
  now?: () => Date;
}

class HeatLiveAdapterError extends Error {
  constructor(
    readonly reason: HeatFailureReason,
    readonly stage?: HeatFailureStage
  ) {
    super(reason);
    this.name = "HeatLiveAdapterError";
  }
}

function withFailureStage(error: unknown, stage: HeatFailureStage): HeatLiveAdapterError {
  return error instanceof HeatLiveAdapterError
    ? new HeatLiveAdapterError(error.reason, error.stage ?? stage)
    : new HeatLiveAdapterError("validation_failure", stage);
}

function parseStrictDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

function validateInput(input: HeatLiveQueryInput, now: Date): string | null {
  // UXFIX-02: a validated map-selected area is accepted alongside Tucson.
  if (input.placeId === CUSTOM_AREA_PLACE_ID) {
    try {
      validateQueryArea(input.area);
    } catch {
      return "The selected map area is not a valid Extreme Heat query area. Re-select the location.";
    }
  } else if (input.placeId !== "demo-tucson") {
    return "Live Extreme Heat evidence is available for the Tucson demonstration or a map-selected area.";
  }
  const dateMs = parseStrictDate(input.date);
  if (dateMs === null) return "Heat live date must be a real YYYY-MM-DD UTC date.";
  if (input.date < EARLIEST_GIBS_DATE) {
    return `Heat live retrieval begins at the approved MODIS Terra path on ${EARLIEST_GIBS_DATE}.`;
  }
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (dateMs >= todayMs) return "Heat live retrieval accepts only completed UTC dates before today.";
  return null;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const statedLength = response.headers.get("content-length");
  if (statedLength !== null) {
    const length = Number(statedLength);
    if (!Number.isFinite(length) || length < 0 || length > maximumBytes) {
      throw new HeatLiveAdapterError("oversize");
    }
  }
  if (!response.body) throw new HeatLiveAdapterError("malformed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new HeatLiveAdapterError("oversize");
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
      throw new HeatLiveAdapterError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) {
      throw new HeatLiveAdapterError("redirect");
    }
    if (response.status === 429) throw new HeatLiveAdapterError("rate_limited");
    if (!response.ok) throw new HeatLiveAdapterError("provider_failure");
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!acceptedContentTypes.includes(contentType)) {
      throw new HeatLiveAdapterError("schema_validation");
    }
    return { bytes: await readBoundedBody(response, maximumBytes), contentType };
  } finally {
    clearTimeout(timeout);
  }
}

type TileAddress = { matrixSet: string; matrix: number; row: number; col: number };

/**
 * UXFIX-02: Web-Mercator tile address (GoogleMapsCompatible level 7) for the
 * center of a validated query area. Same tile scheme as the pinned Tucson
 * demonstration tile; the address is derived deterministically from geometry.
 */
function tileForArea(box: BoundingBox): TileAddress {
  const center = areaCenter(box);
  const tiles = 2 ** GIBS_TILE.matrix;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, center.lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const col = Math.min(
    tiles - 1,
    Math.max(0, Math.floor(((center.lon + 180) / 360) * tiles))
  );
  const row = Math.min(
    tiles - 1,
    Math.max(0, Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * tiles
    ))
  );
  return { matrixSet: GIBS_TILE.matrixSet, matrix: GIBS_TILE.matrix, row, col };
}

function buildGibsUrl(date: string, tile: TileAddress): URL {
  const url = new URL(
    `https://${GIBS_HOST}/wmts/epsg3857/best/${GIBS_HEAT_LAYER_ID}/default/` +
      `${date}/${tile.matrixSet}/${tile.matrix}/${tile.row}/${tile.col}.png`
  );
  if (url.hostname !== GIBS_HOST) throw new HeatLiveAdapterError("validation_failure");
  return url;
}

function buildNoaaUrl(station: UscrnStationSource): URL {
  const url = new URL(station.csvUrl);
  if (url.hostname !== NOAA_HOST) throw new HeatLiveAdapterError("validation_failure");
  return url;
}

async function buildGibsObservation(
  bytes: Uint8Array,
  contentType: string,
  url: URL,
  date: string,
  retrievedAt: string,
  tile: TileAddress,
  areaTag: string
): Promise<{ observation: Observation | null; opaqueSampleCount: number }> {
  let width: number | undefined;
  let height: number | undefined;
  let format: string | undefined;
  let sample: Buffer;
  try {
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    width = metadata.width;
    height = metadata.height;
    format = metadata.format;
    sample = await sharp(bytes, { failOn: "error" })
      .resize(16, 16, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer();
  } catch {
    throw new HeatLiveAdapterError("malformed");
  }
  if (format !== "png" || width !== 256 || height !== 256 || sample.length !== 1024) {
    throw new HeatLiveAdapterError("schema_validation");
  }
  let opaqueSampleCount = 0;
  const colors = new Set<string>();
  for (let index = 0; index < sample.length; index += 4) {
    if (sample[index + 3] === 0) continue;
    opaqueSampleCount += 1;
    colors.add(`${sample[index]},${sample[index + 1]},${sample[index + 2]}`);
  }
  if (opaqueSampleCount === 0) return { observation: null, opaqueSampleCount };

  const observation: Observation = {
    observationId: `obs-gibs-modis-lst-${areaTag}-${date.replaceAll("-", "")}`,
    provenance: {
      sourceId: "nasa_gibs_modis_lst_day",
      sourceUrl: url.toString(),
      retrievedAt,
      observedAt: `${date}T00:00:00Z`,
      product: GIBS_HEAT_LAYER_ID,
      payloadHash: sha256(bytes),
      requestParameters: {
        date,
        tileMatrixSet: tile.matrixSet,
        tileMatrix: String(tile.matrix),
        tileRow: String(tile.row),
        tileCol: String(tile.col),
      },
    },
    variableName: "Land-surface temperature visualization",
    textValue: "visualization_available",
    dataMode: "live",
    qualifiers: ["visualization_only", "numeric_temperature_not_inferred"],
    metadata: {
      heatRole: "satellite_land_surface_temperature_visualization",
      layerId: GIBS_HEAT_LAYER_ID,
      contentType,
      imageWidth: width,
      imageHeight: height,
      tileMatrixSet: tile.matrixSet,
      tileMatrix: tile.matrix,
      tileRow: tile.row,
      tileCol: tile.col,
      byteLength: bytes.byteLength,
      opaqueSampleCount,
      distinctColorCount: colors.size,
    },
  };
  validateHeatSourceObservation(observation);
  return { observation, opaqueSampleCount };
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (quoted) throw new HeatLiveAdapterError("malformed");
  values.push(current);
  return values;
}

type HeatRow = {
  rowId: string;
  observedAt: string;
  airTemperatureC: number;
  heatIndexC: number;
  relativeHumidityPct: number;
};

function parseNoaaRows(bytes: Uint8Array, date: string): HeatRow[] {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HeatLiveAdapterError("malformed");
  }
  const lines = text.split(/\r?\n/u).filter((line) => line.length > 0);
  if (lines.length < 1) throw new HeatLiveAdapterError("malformed");
  const headers = parseCsvLine(lines[0].replace(/^\uFEFF/u, ""));
  const required = [
    "DATE_TIME",
    "DRY_BULB_TEMPERATURE_C",
    "HEAT_INDEX_C",
    "RELATIVE_HUMIDITY",
  ] as const;
  const indices = Object.fromEntries(required.map((name) => [name, headers.indexOf(name)])) as
    Record<(typeof required)[number], number>;
  if (required.some((name) => indices[name] < 0) || new Set(headers).size !== headers.length) {
    throw new HeatLiveAdapterError("schema_validation");
  }

  const compactDate = date.replaceAll("-", "");
  const rows: HeatRow[] = [];
  const seenHours = new Set<string>();
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    if (cells.length !== headers.length) throw new HeatLiveAdapterError("schema_validation");
    const dateTime = cells[indices.DATE_TIME];
    if (!/^\d{10}$/u.test(dateTime)) throw new HeatLiveAdapterError("schema_validation");
    if (!dateTime.startsWith(compactDate)) continue;
    const hour = dateTime.slice(8, 10);
    if (!/^(?:[01]\d|2[0-3])$/u.test(hour) || seenHours.has(hour)) {
      throw new HeatLiveAdapterError("schema_validation");
    }
    seenHours.add(hour);
    const airTemperatureC = Number(cells[indices.DRY_BULB_TEMPERATURE_C]);
    const heatIndexC = Number(cells[indices.HEAT_INDEX_C]);
    const relativeHumidityPct = Number(cells[indices.RELATIVE_HUMIDITY]);
    if (
      !Number.isFinite(airTemperatureC) || airTemperatureC < -100 || airTemperatureC > 100 ||
      !Number.isFinite(heatIndexC) || heatIndexC < -100 || heatIndexC > 100 ||
      !Number.isFinite(relativeHumidityPct) || relativeHumidityPct < 0 || relativeHumidityPct > 100
    ) throw new HeatLiveAdapterError("schema_validation");
    rows.push({
      rowId: dateTime,
      observedAt: `${date}T${hour}:00:00Z`,
      airTemperatureC,
      heatIndexC,
      relativeHumidityPct,
    });
  }
  return rows.sort((left, right) => left.observedAt.localeCompare(right.observedAt));
}

function buildNoaaObservations(
  rows: HeatRow[],
  bytes: Uint8Array,
  url: URL,
  date: string,
  retrievedAt: string,
  station: UscrnStationSource
): Observation[] {
  if (rows.length === 0) return [];
  const peak = [...rows].sort(
    (left, right) => right.heatIndexC - left.heatIndexC || left.observedAt.localeCompare(right.observedAt)
  )[0];
  const endMs = Date.parse(peak.observedAt);
  const shared: Provenance = {
    sourceId: "noaa_uscrn_heat_exposure",
    sourceUrl: url.toString(),
    sourceRecordId: `${station.csvFileName}#${peak.rowId}`,
    retrievedAt,
    observedAt: peak.observedAt,
    product: USCRN_HEAT_PRODUCT,
    payloadHash: sha256(bytes),
    requestParameters: { station: station.stationId, utcDate: date },
  };
  const metadataBase = {
    stationId: station.stationId,
    stationName: station.stationName,
    stationLatitude: station.coordinate.lat,
    stationLongitude: station.coordinate.lon,
    relativeHumidityPct: peak.relativeHumidityPct,
    fileFormat: "CRNHE0101",
  };
  const air: Observation = {
    observationId: `obs-uscrn-air-${station.idTag}-${peak.rowId}`,
    provenance: shared,
    variableName: "Hourly air temperature",
    value: peak.airTemperatureC,
    unit: "degC",
    dataMode: "live",
    qualifiers: ["outdoor_station"],
    periodStart: new Date(endMs - 3_600_000).toISOString(),
    periodEnd: peak.observedAt,
    metadata: {
      heatRole: "ground_air_temperature",
      ...metadataBase,
      fieldName: "DRY_BULB_TEMPERATURE_C",
    },
  };
  const index: Observation = {
    observationId: `obs-uscrn-heat-index-${station.idTag}-${peak.rowId}`,
    provenance: shared,
    variableName: "Hourly heat index",
    value: peak.heatIndexC,
    unit: "degC",
    dataMode: "live",
    qualifiers: ["NOAA_derived"],
    periodStart: new Date(endMs - 3_600_000).toISOString(),
    periodEnd: peak.observedAt,
    metadata: {
      heatRole: "derived_heat_index",
      ...metadataBase,
      fieldName: "HEAT_INDEX_C",
    },
  };
  validateHeatSourceObservation(air);
  validateHeatSourceObservation(index);
  return [air, index];
}

const GIBS_LIMITATION: Limitation = {
  limitationId: "lim-wp09-live-gibs-visual-only",
  source: "nasa_gibs_modis_lst_day",
  description:
    "NASA GIBS imagery is visualization evidence only; no numeric temperature is inferred from image colors, and land-surface temperature is not air or indoor temperature.",
  required: true,
};

const NO_STATION_LIMITATION: Limitation = {
  limitationId: "lim-uxfix02-heat-no-station-in-area",
  source: "noaa_uscrn_heat_exposure",
  description:
    "No NOAA USCRN outdoor station exists inside the selected area. " +
    "Satellite visualization alone does not establish outdoor air temperature, heat index, " +
    "indoor conditions, or individual risk.",
  required: true,
};

/**
 * ADR-0041: the day ground-confirmed with at least USCRN_MIN_DISTINCT_HOURS
 * distinct hours, but some hourly rows are unpublished. The shortfall is
 * stated instead of silently accepting the partial day as a complete one.
 */
function uscrnPartialDayLimitation(distinctHourCount: number): Limitation {
  return {
    limitationId: "lim-adr0041-uscrn-partial-day",
    source: "noaa_uscrn_heat_exposure",
    description:
      `The USCRN station published ${distinctHourCount} of 24 hourly readings for this UTC date. ` +
      "Unpublished hours are missing evidence, not observed-safe hours, and the daily peak " +
      "may fall inside a missing hour.",
    required: true,
  };
}

/**
 * ADR-0041: transparent GIBS tile on a very recent date — the imagery is
 * likely still unpublished, so the honest next step is the previous day.
 */
const GIBS_POSSIBLY_UNPUBLISHED_LIMITATION: Limitation = {
  limitationId: HEAT_GIBS_UNPUBLISHED_LIMITATION_ID,
  source: "nasa_gibs_modis_lst_day",
  description:
    "The satellite returned no imagery for this recent date, which usually means NASA GIBS " +
    "has not published the daily product yet rather than a true coverage gap. Checking the " +
    "previous completed UTC day is a reasonable next step. A missing image is not evidence " +
    "of no heat hazard.",
  required: true,
};

const NOAA_LIMITATION: Limitation = {
  limitationId: "lim-wp09-live-uscrn-station",
  source: "noaa_uscrn_heat_exposure",
  description:
    "USCRN describes one named outdoor station and hour. It does not establish indoor temperature, household certainty, or individual medical risk.",
  required: true,
};

/** ADR-0038: NWS station observations carried as ground evidence. */
const NWS_LIMITATION: Limitation = {
  limitationId: "lim-adr0038-nws-station",
  source: NWS_SOURCE_ID,
  description:
    "NWS observations describe one named outdoor station. They do not establish indoor " +
    "temperature, household certainty, or individual medical risk, and the NWS-provided heat " +
    "index is only reported when the service computed one.",
  required: true,
};

/** ADR-0038: NWS was consulted but returned no usable in-area station day. */
const NWS_UNAVAILABLE_LIMITATION: Limitation = {
  limitationId: "lim-adr0038-nws-no-usable-station",
  source: NWS_SOURCE_ID,
  description:
    "No NWS observation station inside the selected area returned usable readings for this " +
    "date. Missing evidence is not evidence of safe conditions.",
  required: true,
};

/** ADR-0039: GHCNh historical station observations carried as ground evidence. */
const GHCNH_LIMITATION: Limitation = {
  limitationId: "lim-adr0039-ghcnh-station",
  source: NCEI_GHCNH_SOURCE_ID,
  description:
    "GHCNh values describe one named outdoor station. They do not establish indoor " +
    "temperature, household certainty, or individual medical risk, and NOAA publishes no heat " +
    "index in this product — none is derived.",
  required: true,
};

/** ADR-0039: GHCNh was consulted but returned no usable in-area station day. */
const GHCNH_UNAVAILABLE_LIMITATION: Limitation = {
  limitationId: "lim-adr0039-ghcnh-no-usable-station",
  source: NCEI_GHCNH_SOURCE_ID,
  description:
    "No in-area GHCNh station returned usable readings for this date. " +
    "Missing evidence is not evidence of safe conditions.",
  required: true,
};

/**
 * ADR-0039: the date falls between the NWS observation window and the GHCNh
 * publication window, so neither network can ground-confirm it.
 */
const GROUND_PUBLICATION_GAP_LIMITATION: Limitation = {
  limitationId: "lim-adr0039-ground-publication-gap",
  source: NCEI_GHCNH_SOURCE_ID,
  description:
    `NWS observations retain roughly the last ${NWS_RETENTION_DAYS} days and GHCNh files ` +
    `publish roughly ${GHCNH_PUBLICATION_WINDOW_DAYS} days behind real time, so this date ` +
    "falls in a window neither network can ground-confirm yet. Missing evidence is not " +
    "evidence of safe conditions.",
  required: true,
};

function missionAttribution(
  status: MissionAttribution["retrievalStatus"],
  observationId?: string,
  isCustomArea = false
): MissionAttribution {
  return {
    missionName: "Terra",
    agency: "NASA",
    purpose: "MODIS daily daytime land-surface-temperature visualization through NASA GIBS",
    selectionReason: isCustomArea
      ? "Used the daily satellite image covering the selected area center."
      : "Used the daily satellite image covering the selected example area.",
    contributedObservationIds: observationId ? [observationId] : [],
    retrievalStatus: status,
    keyLimitation: "The image is visualization only; no numeric temperature is inferred from colors.",
    datasetId: GIBS_HEAT_LAYER_ID,
  };
}

/**
 * ADR-0039: shape the GHCNh ground result into the heat evidence contract.
 * Only the air-temperature observation is emitted (GHCNh has no heat index);
 * relative humidity rides in metadata exactly like the other station sources.
 */
function ghcnhHeatObservation(
  ghcnhObservations: GhcnhGroundObservation[]
): { observation: Observation; distinctHourCount: number } {
  const temperature = ghcnhObservations.find(
    (observation) => observation.variableName === "Hourly outdoor air temperature"
  );
  const humidity = ghcnhObservations.find(
    (observation) => observation.variableName === "Hourly relative humidity"
  );
  if (!temperature || !humidity) {
    throw new HeatLiveAdapterError("schema_validation", "ghcnh_station_year");
  }
  const metadata = temperature.metadata;
  const distinctHourCount = Number(metadata.distinctHourCount);
  const stationId = String(metadata.stationId);
  const compactTimestamp = temperature.provenance.observedAt.replace(/[^0-9]/gu, "");
  const idTag = stationId.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-");
  const observation: Observation = {
    observationId: `obs-ghcnh-air-${idTag}-${compactTimestamp}`,
    provenance: temperature.provenance,
    variableName: "Hourly air temperature",
    value: temperature.value,
    unit: "degC",
    dataMode: "live",
    qualifiers: ["outdoor_station", "quality_flags_preserved_not_reinterpreted"],
    metadata: {
      heatRole: "ground_air_temperature",
      stationId,
      stationName: String(metadata.stationName),
      stationLatitude: Number(metadata.stationLatitude),
      stationLongitude: Number(metadata.stationLongitude),
      relativeHumidityPct: humidity.value,
      qualityControl: String(metadata.temperatureQc) || "blank",
      rowCountForDate: Number(metadata.rowCountForDate),
      distinctHourCount,
      selectionBasis: String(metadata.selectionBasis),
    },
  };
  validateHeatSourceObservation(observation);
  return { observation, distinctHourCount };
}

function sourceFailureEvidence(
  evaluatedAt: string,
  isCustomArea: boolean,
  hasStation: boolean
): EvidenceObject {
  const evidence: EvidenceObject = {
    evidenceId: `evd-heat-source-failure-${evaluatedAt.replace(/[^0-9]/gu, "")}`,
    hazardId: "extreme_heat",
    intentId: "intent-heat-live-source-failure",
    evidenceState: "source_failure",
    dataMode: "failed",
    observations: [],
    derivedMetrics: [],
    missionAttributions: [missionAttribution("failed", undefined, isCustomArea)],
    freshness: {
      status: "unknown",
      classificationBasis: "no_observation_time",
      evaluatedAt,
      note: "No observation time exists because the source could not be checked.",
    },
    confidence: {
      level: "insufficient",
      rationale: "A required source failed. Missing evidence is not evidence of safe conditions.",
    },
    limitations: hasStation
      ? [GIBS_LIMITATION, NOAA_LIMITATION]
      : [GIBS_LIMITATION, NO_STATION_LIMITATION],
    explanations: [],
    assembledAt: evaluatedAt,
  };
  validateEvidenceObject(evidence);
  return evidence;
}

export async function queryLiveHeatEvidence(
  input: HeatLiveQueryInput,
  dependencies: HeatLiveAdapterDependencies = {}
): Promise<HeatQueryResult> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now?.() ?? new Date();
  const rejectionReason = validateInput(input, now);
  if (rejectionReason) {
    return {
      kind: input.placeId === "demo-tucson" ? "unsupported_date" : "unsupported_place",
      rejectionReason,
    };
  }
  const evaluatedAt = now.toISOString();
  // A real, validated area selects ground sources by geographic coverage,
  // never by a client label or demo identity (WP-14). ADR-0037: the station
  // is the allowlisted USCRN station nearest to the area center among those
  // whose coordinate lies inside the validated bounding box (inclusive).
  const isCustomArea = input.placeId === CUSTOM_AREA_PLACE_ID;
  const queryArea = isCustomArea ? validateQueryArea(input.area) : undefined;
  const areaTag = isCustomArea ? "custom-area" : "tucson";
  const station = queryArea ? stationInsideArea(queryArea) : TUCSON_STATION;
  const tile = queryArea
    ? tileForArea(queryArea)
    : { matrixSet: GIBS_TILE.matrixSet, matrix: GIBS_TILE.matrix, row: GIBS_TILE.row, col: GIBS_TILE.col };
  // ADR-0038: metros without an in-box USCRN station fall through to the NWS
  // observation network for dates inside its verified ~7-day window.
  const nwsEligible =
    station === null && queryArea !== undefined && isWithinNwsRetentionWindow(input.date, now);
  // ADR-0039: older dates fall through to the GHCNh station-by-year archive
  // once the date is beyond its publication window.
  const ghcnhEligible =
    station === null &&
    queryArea !== undefined &&
    !nwsEligible &&
    isBeyondGhcnhPublicationWindow(input.date, now);
  try {
    const gibsUrl = buildGibsUrl(input.date, tile);
    const gibsResponsePromise = fetchBounded(fetchImpl, gibsUrl, MAX_GIBS_BYTES, ["image/png"])
      .catch((error: unknown) => { throw withFailureStage(error, "gibs_transport"); });
    const nwsPromise = nwsEligible && queryArea
      ? queryNwsGroundEvidence(queryArea, input.date, now, fetchImpl)
      : null;
    const ghcnhPromise = ghcnhEligible && queryArea
      ? queryGhcnhGroundEvidence(input.date, queryArea, { fetchImpl, now: () => now })
      : null;
    let noaaResponse: { bytes: Uint8Array; contentType: string } | null = null;
    let noaaUrl: URL | null = null;
    if (station) {
      noaaUrl = buildNoaaUrl(station);
      [, noaaResponse] = await Promise.all([
        gibsResponsePromise,
        fetchBounded(fetchImpl, noaaUrl, MAX_NOAA_BYTES, ["text/csv"])
          .catch((error: unknown) => { throw withFailureStage(error, "noaa_transport"); }),
      ]);
    }
    const gibsResponse = await gibsResponsePromise;
    let gibs: Awaited<ReturnType<typeof buildGibsObservation>>;
    try {
      gibs = await buildGibsObservation(
        gibsResponse.bytes,
        gibsResponse.contentType,
        gibsUrl,
        input.date,
        evaluatedAt,
        tile,
        areaTag
      );
    } catch (error) {
      throw withFailureStage(error, "gibs_payload");
    }
    let rows: HeatRow[] = [];
    let noaaObservations: Observation[] = [];
    if (station && noaaResponse && noaaUrl) {
      try {
        rows = parseNoaaRows(noaaResponse.bytes, input.date);
        noaaObservations = buildNoaaObservations(
          rows,
          noaaResponse.bytes,
          noaaUrl,
          input.date,
          evaluatedAt,
          station
        );
      } catch (error) {
        throw withFailureStage(error, "noaa_payload");
      }
    }
    let nwsData: NwsStationDayObservations | null = null;
    let nwsUnavailable: "no_station" | "no_observation" | null = null;
    if (nwsPromise) {
      const nwsResult = await nwsPromise;
      if (nwsResult.kind === "source_failure") {
        throw new HeatLiveAdapterError(nwsResult.reason, nwsResult.stage);
      }
      if (nwsResult.kind === "observations") nwsData = nwsResult;
      else nwsUnavailable = nwsResult.kind;
    }
    let ghcnhData: { observation: Observation; distinctHourCount: number } | null = null;
    let ghcnhUnavailable = false;
    if (ghcnhPromise) {
      const ghcnhResult = await ghcnhPromise;
      if (ghcnhResult.kind === "observations") {
        ghcnhData = ghcnhHeatObservation(ghcnhResult.observations);
      } else if (
        ghcnhResult.kind === "source_failure" &&
        ghcnhResult.reason !== "not_found"
      ) {
        // media_type is a GHCNh-only reason; the closest heat reason applies.
        const reason: HeatFailureReason =
          ghcnhResult.reason === "media_type" ? "schema_validation" : ghcnhResult.reason;
        throw new HeatLiveAdapterError(
          reason,
          ghcnhResult.stage === "station_discovery" ? "ghcnh_discovery" : "ghcnh_station_year"
        );
      } else {
        // not_found (no year file among bounded attempts), no_station, and
        // no_observation all resolve to an honest unusable-station limitation.
        ghcnhUnavailable = true;
      }
    }
    const observations = [
      ...(gibs.observation ? [gibs.observation] : []),
      ...noaaObservations,
      ...(nwsData ? nwsData.observations : []),
      ...(ghcnhData ? [ghcnhData.observation] : []),
    ];
    // ADR-0041: all three ground networks share the same 18-distinct-hour
    // day-completeness rule (NWS applies it inside dayComplete).
    const groundConfirmed =
      (station !== null && rows.length >= USCRN_MIN_DISTINCT_HOURS) ||
      (nwsData !== null && nwsData.dayComplete) ||
      (ghcnhData !== null && ghcnhData.distinctHourCount >= GHCNH_MIN_DISTINCT_HOURS);
    const evidenceState = gibs.opaqueSampleCount === 0
      ? "unsupported_coverage" as const
      : groundConfirmed
        ? "observations_returned" as const
        : "inconclusive_evidence" as const;
    // ADR-0041: a transparent tile for a date within the recent publication
    // window is most likely still-unpublished imagery, not a coverage gap.
    const imageryPossiblyUnpublished =
      gibs.opaqueSampleCount === 0 &&
      (now.getTime() - Date.parse(`${input.date}T00:00:00Z`)) / 86_400_000 <
        GIBS_RECENT_PUBLICATION_WINDOW_DAYS;
    const latestObservationMs = Math.max(
      ...observations
        .map((observation) => Date.parse(observation.provenance.observedAt))
        .filter(Number.isFinite)
    );
    const hasObservationTime = Number.isFinite(latestObservationMs);
    const evidence: EvidenceObject = {
      evidenceId: `evd-heat-${areaTag}-${input.date.replaceAll("-", "")}-${evaluatedAt.replace(/[^0-9]/gu, "")}`,
      hazardId: "extreme_heat",
      intentId: `intent-heat-live-${areaTag}-${input.date}`,
      evidenceState,
      dataMode: "live",
      observations,
      derivedMetrics: [],
      missionAttributions: [missionAttribution(
        gibs.observation ? "success" : "failed",
        gibs.observation?.observationId,
        isCustomArea
      )],
      freshness: hasObservationTime
        ? {
            status: "historical",
            classificationBasis: "historical_context",
            mostRecentObservationAt: new Date(latestObservationMs).toISOString(),
            evaluatedAt,
            ageSeconds: Math.floor((Date.parse(evaluatedAt) - latestObservationMs) / 1000),
            note: "Live retrieval returned historical observations for the explicitly requested completed UTC date.",
          }
        : {
            status: "unknown",
            classificationBasis: "no_observation_time",
            evaluatedAt,
            note: "No usable observation timestamp was returned.",
          },
      confidence: {
        level: evidenceState === "observations_returned" ? "low" : "insufficient",
        rationale: evidenceState === "observations_returned"
          ? "A regional visualization and one outdoor station hour are present; no indoor, household, or individual conclusion is supported."
          : station === null && nwsData === null && ghcnhData === null
            ? "Only a regional satellite visualization is available for this area; no in-area outdoor station data could be retrieved. Missing evidence is not evidence of safe conditions."
            : "One or more required source roles are unavailable or incomplete. Missing evidence is not evidence of safe conditions.",
      },
      limitations: [
        ...(station
          ? [GIBS_LIMITATION, NOAA_LIMITATION]
          : nwsData
            ? [GIBS_LIMITATION, NWS_LIMITATION]
            : ghcnhData
              ? [GIBS_LIMITATION, GHCNH_LIMITATION]
              : [
                  GIBS_LIMITATION,
                  NO_STATION_LIMITATION,
                  nwsUnavailable !== null
                    ? NWS_UNAVAILABLE_LIMITATION
                    : ghcnhUnavailable
                      ? GHCNH_UNAVAILABLE_LIMITATION
                      : GROUND_PUBLICATION_GAP_LIMITATION,
                ]),
        // ADR-0041: a USCRN day that is usable but incomplete says so.
        ...(station !== null && rows.length > 0 && rows.length < 24
          ? [uscrnPartialDayLimitation(rows.length)]
          : []),
        ...(imageryPossiblyUnpublished ? [GIBS_POSSIBLY_UNPUBLISHED_LIMITATION] : []),
      ],
      explanations: [],
      assembledAt: evaluatedAt,
    };
    try {
      validateEvidenceObject(evidence);
    } catch (error) {
      throw withFailureStage(error, "evidence_assembly");
    }
    return {
      kind: evidenceState === "observations_returned"
        ? "success"
        : evidenceState === "unsupported_coverage"
          ? "unsupported_coverage"
          : "inconclusive_evidence",
      evidence,
    };
  } catch (error) {
    const failureReason = error instanceof HeatLiveAdapterError
      ? error.reason
      : "validation_failure";
    const failureStage = error instanceof HeatLiveAdapterError
      ? error.stage
      : "evidence_assembly";
    return {
      kind: "source_failure",
      failureReason,
      failureStage,
      evidence: sourceFailureEvidence(evaluatedAt, isCustomArea, station !== null),
    };
  }
}
