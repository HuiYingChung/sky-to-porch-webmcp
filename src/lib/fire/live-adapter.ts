/**
 * Server-only NOAA HMS live retrieval for WP-05.
 *
 * New dates use the official Fire Text product (stream parsed and hashed) plus
 * Smoke KML (bounded bytes, XML parsed). The immutable 2025-01-08 regression
 * continues to use the original Fire KML endpoint and payload hash.
 */

import { createHash } from "node:crypto";
import { validateEvidenceObject } from "@/contracts/evidence";
import type {
  EvidenceObject,
  Freshness,
  Limitation,
  MissionAttribution,
  Observation,
} from "@/contracts/evidence";
import type { BoundingBox } from "@/contracts/common";
import { CUSTOM_AREA_PLACE_ID, areasIntersect, validateQueryArea } from "@/lib/location/query-area";
import { queryFirmsEvidence } from "./firms-adapter";
import { getRegistryEntry } from "@/data/dataset-registry";
import { parseHmsKml } from "./hms-kml";
import type {
  FireCoverageDay,
  FireFailureReason,
  FireLiveQueryInput,
  FireQueryResult,
  FireTemporalCoverage,
} from "./types";
import {
  HMS_COMMON_START_DATE,
  HMS_MAX_RANGE_DAYS,
  LA_FIRE_BOX,
  LAKE_MICHIGAN_FIRE_BOX,
  PINNED_FIXTURE_DATE,
} from "./types";

const ALLOWLISTED_HOST = "satepsanone.nesdis.noaa.gov";
const FIRE_TEXT_TEMPLATE =
  "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Fire_Points/Text/{YYYY}/{MM}/hms_fire{YYYYMMDD}.txt";
const FIRE_TEXT_MAX_BYTES = 24 * 1024 * 1024;
const LEGACY_FIRE_KML_MAX_BYTES = 8 * 1024 * 1024;
const SMOKE_KML_MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const LATEST_LOOKBACK_DAYS = 7;
const MAX_TEXT_LINE_CHARS = 4096;
const COMPLETION_SETTLE_MS = 60 * 60 * 1000;

/**
 * Approximate NOAA HMS analysis coverage (North America incl. Alaska/Hawaii).
 * Used only to choose between HMS and the global FIRMS product for custom
 * areas; every retrieval still validates its own coverage fail-closed.
 */
export const HMS_APPROXIMATE_COVERAGE_BOX: BoundingBox = {
  west: -180,
  south: 0,
  east: -40,
  north: 80,
};

export type FireAreaPrimarySource = "noaa_hms" | "nasa_firms";

/**
 * Deterministic geographic source choice for a validated area. The selection
 * is independent of UI method, concern, optional question, or demo identity.
 */
export function selectFireAreaPrimarySource(value: unknown): FireAreaPrimarySource {
  const area = validateQueryArea(value);
  return areasIntersect(area, HMS_APPROXIMATE_COVERAGE_BOX)
    ? "noaa_hms"
    : "nasa_firms";
}

const PLACE_BOX: Record<string, BoundingBox> = {
  "demo-los-angeles": LA_FIRE_BOX,
  "demo-lake-michigan": LAKE_MICHIGAN_FIRE_BOX,
};

export interface HmsLiveDependencies {
  fetch: typeof globalThis.fetch;
  nowIso: () => string;
}

const DEFAULT_DEPS: HmsLiveDependencies = {
  fetch: globalThis.fetch,
  nowIso: () => new Date().toISOString(),
};

type SourceKind = "fire" | "smoke";
type InternalFailureReason = FireFailureReason | "missing" | "incomplete";

class HmsRetrievalError extends Error {
  constructor(
    readonly reason: InternalFailureReason,
    readonly source: SourceKind,
  ) {
    super(`HMS ${source} retrieval failed: ${reason}`);
  }
}

class HmsDayFailure extends Error {
  constructor(
    readonly reason: FireFailureReason,
    readonly coverage: FireCoverageDay,
  ) {
    super(`HMS daily retrieval failed: ${reason}`);
  }
}

interface StreamedResponse<T> {
  value: T;
  payloadHash: string;
  rawByteCount: number;
  retrievedAt: string;
  sourceLastModifiedAt?: string;
}

interface ParsedFireText {
  totalRecords: number;
  inBoxRecords: number;
  sourceRecordCount: number;
  excludedDifferentObservationDayRecords: number;
}

interface ParsedDailyProduct {
  sourceUrl: string;
  payloadHash: string;
  rawByteCount: number;
  retrievedAt: string;
  totalCount: number;
  inBoxCount: number;
  product: string;
  unit: "records" | "coordinate_pairs";
  placemarkCount?: number;
  sourceLastModifiedAt?: string;
  sourceRecordCount?: number;
  excludedDifferentObservationDayRecords?: number;
}

interface RetrievedDay {
  date: string;
  coverage: FireCoverageDay;
  fire: ParsedDailyProduct;
  smoke: ParsedDailyProduct;
}

interface UnsupportedDay {
  date: string;
  coverage: FireCoverageDay;
}

type DayAttempt = RetrievedDay | UnsupportedDay;

function isRetrievedDay(day: DayAttempt): day is RetrievedDay {
  return day.coverage.status === "complete";
}

function parseIsoDate(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === date ? ms : null;
}

function formatIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addUtcDays(date: string, amount: number): string {
  const ms = parseIsoDate(date);
  if (ms === null) throw new Error("invalid internal ISO date");
  return formatIsoDate(ms + amount * 86_400_000);
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const startMs = parseIsoDate(startDate);
  const endMs = parseIsoDate(endDate);
  if (startMs === null || endMs === null || startMs > endMs) return [];
  const dates: string[] = [];
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    dates.push(formatIsoDate(ms));
  }
  return dates;
}

function yesterdayUtc(nowIso: string): string | null {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return null;
  const now = new Date(nowMs);
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return formatIsoDate(todayMs - 86_400_000);
}

function dateTokens(date: string): { YYYY: string; MM: string; YYYYMMDD: string } {
  if (parseIsoDate(date) === null) throw new Error("invalid source date");
  return {
    YYYY: date.slice(0, 4),
    MM: date.slice(5, 7),
    YYYYMMDD: date.replaceAll("-", ""),
  };
}

function materializeAllowlistedUrl(template: string, date: string): string {
  const tokens = dateTokens(date);
  const raw = template
    .replaceAll("{YYYY}", tokens.YYYY)
    .replaceAll("{MM}", tokens.MM)
    .replaceAll("{YYYYMMDD}", tokens.YYYYMMDD);
  if (raw.includes("{") || raw.includes("}")) {
    throw new Error("unresolved source template token");
  }
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.hostname !== ALLOWLISTED_HOST ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("source URL outside exact allowlist");
  }
  return url.href;
}

function registryTemplate(
  sourceId: "noaa_hms_fire_points" | "noaa_hms_smoke_polygons",
): string {
  const entry = getRegistryEntry(sourceId);
  if (!entry || entry.requiresCredential || !entry.supportedDataModes.includes("live")) {
    throw new Error("HMS source is not approved for credential-free live use");
  }
  return entry.endpointTemplate;
}

function fireUrlForDate(date: string): { url: string; legacyKml: boolean } {
  if (date === PINNED_FIXTURE_DATE) {
    return {
      url: materializeAllowlistedUrl(registryTemplate("noaa_hms_fire_points"), date),
      legacyKml: true,
    };
  }
  return { url: materializeAllowlistedUrl(FIRE_TEXT_TEMPLATE, date), legacyKml: false };
}

function smokeUrlForDate(date: string): string {
  return materializeAllowlistedUrl(registryTemplate("noaa_hms_smoke_polygons"), date);
}

function expectedYearDay(date: string): string {
  const dateMs = parseIsoDate(date);
  if (dateMs === null) throw new Error("invalid source date");
  const year = Number(date.slice(0, 4));
  const day = Math.floor((dateMs - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  return `${year}${String(day).padStart(3, "0")}`;
}

function isValidYearDay(value: string): boolean {
  if (!/^\d{7}$/u.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const day = Number(value.slice(4));
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day >= 1 && day <= (leapYear ? 366 : 365);
}

function inBox(lon: number, lat: number, box: BoundingBox): boolean {
  return lon >= box.west && lon <= box.east && lat >= box.south && lat <= box.north;
}

function createFireTextConsumer(date: string, box: BoundingBox) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const expectedHeader = [
    "Lon",
    "Lat",
    "YearDay",
    "Time",
    "Satellite",
    "Method",
    "Ecosystem",
    "FRP",
  ];
  const yearDay = expectedYearDay(date);
  let pending = "";
  let headerSeen = false;
  let totalRecords = 0;
  let inBoxRecords = 0;
  let sourceRecordCount = 0;
  let excludedDifferentObservationDayRecords = 0;

  function parseLine(line: string): void {
    const fields = line.split(",").map((field) => field.trim());
    if (!headerSeen) {
      if (fields.length !== expectedHeader.length ||
          fields.some((field, index) => field !== expectedHeader[index])) {
        throw new HmsRetrievalError("schema_validation", "fire");
      }
      headerSeen = true;
      return;
    }
    if (line.trim() === "" || fields.length !== 8) {
      throw new HmsRetrievalError("schema_validation", "fire");
    }
    const [lonText, latText, yearDayText, timeText, satellite, method, ecosystem, frp] = fields;
    const lon = Number(lonText);
    const lat = Number(latText);
    const ecosystemNumber = Number(ecosystem);
    const frpNumber = Number(frp);
    if (
      !Number.isFinite(lon) || lon < -180 || lon > 180 ||
      !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !isValidYearDay(yearDayText) ||
      !/^\d{4}$/.test(timeText) || Number(timeText.slice(0, 2)) > 23 || Number(timeText.slice(2)) > 59 ||
      satellite.length === 0 || method.length === 0 ||
      !Number.isInteger(ecosystemNumber) || !Number.isFinite(frpNumber)
    ) {
      throw new HmsRetrievalError("schema_validation", "fire");
    }
    sourceRecordCount += 1;
    if (yearDayText !== yearDay) {
      excludedDifferentObservationDayRecords += 1;
      return;
    }
    totalRecords += 1;
    if (inBox(lon, lat, box)) inBoxRecords += 1;
  }

  function processCompleteLines(): void {
    let lineStart = 0;
    let newlineIndex = pending.indexOf("\n", lineStart);
    while (newlineIndex >= 0) {
      const line = pending.slice(lineStart, newlineIndex).replace(/\r$/, "");
      parseLine(line);
      lineStart = newlineIndex + 1;
      newlineIndex = pending.indexOf("\n", lineStart);
    }
    if (lineStart > 0) pending = pending.slice(lineStart);
    if (pending.length > MAX_TEXT_LINE_CHARS) {
      throw new HmsRetrievalError("schema_validation", "fire");
    }
  }

  return {
    write(chunk: Uint8Array) {
      try {
        pending += decoder.decode(chunk, { stream: true });
        processCompleteLines();
      } catch (error) {
        if (error instanceof HmsRetrievalError) throw error;
        throw new HmsRetrievalError("malformed", "fire");
      }
    },
    finish(): ParsedFireText {
      try {
        pending += decoder.decode();
        if (pending.length > 0) parseLine(pending.replace(/\r$/, ""));
      } catch (error) {
        if (error instanceof HmsRetrievalError) throw error;
        throw new HmsRetrievalError("malformed", "fire");
      }
      if (!headerSeen) throw new HmsRetrievalError("schema_validation", "fire");
      if (sourceRecordCount > 0 && totalRecords === 0) {
        throw new HmsRetrievalError("schema_validation", "fire");
      }
      return {
        totalRecords,
        inBoxRecords,
        sourceRecordCount,
        excludedDifferentObservationDayRecords,
      };
    },
  };
}

async function streamBoundedResponse<T>(options: {
  url: string;
  source: SourceKind;
  maxBytes: number;
  expectedMediaType: string;
  completedObservationDate?: string;
  deps: HmsLiveDependencies;
  write: (chunk: Uint8Array) => void;
  finish: () => T;
}): Promise<StreamedResponse<T>> {
  const { url, source, maxBytes, expectedMediaType, completedObservationDate, deps, write, finish } = options;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== ALLOWLISTED_HOST || parsed.host !== ALLOWLISTED_HOST) {
    throw new HmsRetrievalError("validation_failure", source);
  }

  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new HmsRetrievalError("timeout", source));
    }, TIMEOUT_MS);
  });

  try {
    let response: Response;
    try {
      response = await Promise.race([
        deps.fetch(url, {
          method: "GET",
          cache: "no-store",
          redirect: "manual",
          signal: controller.signal,
          headers: { "Accept-Encoding": "identity" },
        }),
        timeout,
      ]);
    } catch (error) {
      if (error instanceof HmsRetrievalError) throw error;
      throw new HmsRetrievalError("network", source);
    }

    if (response.status >= 300 && response.status < 400) {
      throw new HmsRetrievalError("redirect", source);
    }
    if (response.status === 404 || response.status === 410) {
      throw new HmsRetrievalError("missing", source);
    }
    if (response.status === 429) {
      throw new HmsRetrievalError("rate_limited", source);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new HmsRetrievalError("provider_failure", source);
    }

    const mediaType = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
    if (mediaType !== expectedMediaType) {
      throw new HmsRetrievalError("schema_validation", source);
    }
    const contentLength = response.headers.get("Content-Length");
    if (contentLength !== null) {
      if (!/^\d+$/.test(contentLength)) {
        throw new HmsRetrievalError("schema_validation", source);
      }
      const length = Number(contentLength);
      if (!Number.isSafeInteger(length) || length > maxBytes) {
        throw new HmsRetrievalError("oversize", source);
      }
    }
    if (!response.body) throw new HmsRetrievalError("malformed", source);

    const retrievedAt = deps.nowIso();
    if (!Number.isFinite(Date.parse(retrievedAt))) {
      throw new HmsRetrievalError("validation_failure", source);
    }
    let sourceLastModifiedAt: string | undefined;
    if (completedObservationDate !== undefined) {
      const lastModified = response.headers.get("Last-Modified");
      const lastModifiedMs = lastModified === null ? NaN : Date.parse(lastModified);
      const observedDayEndMs = Date.parse(`${completedObservationDate}T23:59:59.999Z`);
      const retrievedAtMs = Date.parse(retrievedAt);
      if (
        !Number.isFinite(lastModifiedMs) ||
        lastModifiedMs <= observedDayEndMs ||
        lastModifiedMs > retrievedAtMs - COMPLETION_SETTLE_MS
      ) {
        throw new HmsRetrievalError("incomplete", source);
      }
      sourceLastModifiedAt = new Date(lastModifiedMs).toISOString();
    }
    reader = response.body.getReader();
    const hash = createHash("sha256");
    let rawByteCount = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (!ArrayBuffer.isView(value) || value.BYTES_PER_ELEMENT !== 1) {
        throw new HmsRetrievalError("malformed", source);
      }
      const bytes = Uint8Array.from(value);
      rawByteCount += bytes.byteLength;
      if (rawByteCount > maxBytes) throw new HmsRetrievalError("oversize", source);
      hash.update(bytes);
      write(bytes);
    }
    return {
      value: finish(),
      payloadHash: hash.digest("hex").toUpperCase(),
      rawByteCount,
      retrievedAt,
      ...(sourceLastModifiedAt ? { sourceLastModifiedAt } : {}),
    };
  } catch (error) {
    controller.abort();
    if (reader) await reader.cancel().catch(() => undefined);
    if (error instanceof HmsRetrievalError) throw error;
    throw new HmsRetrievalError("malformed", source);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function fetchKmlProduct(options: {
  url: string;
  source: SourceKind;
  maxBytes: number;
  kind: "fire_points" | "smoke_polygons";
  completedObservationDate?: string;
  box: BoundingBox;
  deps: HmsLiveDependencies;
}): Promise<ParsedDailyProduct> {
  const chunks: Uint8Array[] = [];
  const response = await streamBoundedResponse({
    url: options.url,
    source: options.source,
    maxBytes: options.maxBytes,
    expectedMediaType: "application/vnd.google-earth.kml+xml",
    completedObservationDate: options.completedObservationDate,
    deps: options.deps,
    write: (chunk) => chunks.push(Uint8Array.from(chunk)),
    finish: () => undefined,
  });
  const bytes = new Uint8Array(response.rawByteCount);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed;
  try {
    parsed = parseHmsKml(bytes, options.kind, options.box);
  } catch {
    throw new HmsRetrievalError("malformed", options.source);
  }
  return {
    sourceUrl: options.url,
    payloadHash: response.payloadHash,
    rawByteCount: response.rawByteCount,
    retrievedAt: response.retrievedAt,
    totalCount: parsed.totalCoordinatePairs,
    inBoxCount: parsed.inBoxCoordinatePairs,
    placemarkCount: parsed.placemarkCount,
    ...(response.sourceLastModifiedAt
      ? { sourceLastModifiedAt: response.sourceLastModifiedAt }
      : {}),
    product: options.kind === "fire_points"
      ? "NOAA HMS Fire Detection Points KML"
      : "NOAA HMS Smoke Polygons KML",
    unit: "coordinate_pairs",
  };
}

async function fetchFireText(
  url: string,
  date: string,
  box: BoundingBox,
  deps: HmsLiveDependencies,
): Promise<ParsedDailyProduct> {
  const consumer = createFireTextConsumer(date, box);
  const response = await streamBoundedResponse({
    url,
    source: "fire",
    maxBytes: FIRE_TEXT_MAX_BYTES,
    expectedMediaType: "text/plain",
    completedObservationDate: date,
    deps,
    write: consumer.write,
    finish: consumer.finish,
  });
  return {
    sourceUrl: url,
    payloadHash: response.payloadHash,
    rawByteCount: response.rawByteCount,
    retrievedAt: response.retrievedAt,
    totalCount: response.value.totalRecords,
    inBoxCount: response.value.inBoxRecords,
    sourceRecordCount: response.value.sourceRecordCount,
    excludedDifferentObservationDayRecords:
      response.value.excludedDifferentObservationDayRecords,
    product: "NOAA HMS Fire Detection Points Text",
    unit: "records",
    ...(response.sourceLastModifiedAt
      ? { sourceLastModifiedAt: response.sourceLastModifiedAt }
      : {}),
  };
}

async function fetchDay(
  date: string,
  box: BoundingBox,
  deps: HmsLiveDependencies,
): Promise<DayAttempt> {
  const legacyRegression = date === PINNED_FIXTURE_DATE;
  let smokeStatus: FireCoverageDay["smokeStatus"] = "not_checked";
  let fireStatus: FireCoverageDay["fireStatus"] = "not_checked";
  let smoke: ParsedDailyProduct;
  try {
    smoke = await fetchKmlProduct({
      url: smokeUrlForDate(date),
      source: "smoke",
      maxBytes: SMOKE_KML_MAX_BYTES,
      kind: "smoke_polygons",
      ...(!legacyRegression ? { completedObservationDate: date } : {}),
      box,
      deps,
    });
    smokeStatus = "complete";
  } catch (error) {
    if (error instanceof HmsRetrievalError && (error.reason === "missing" || error.reason === "incomplete")) {
      return {
        date,
        coverage: {
          date,
          status: "unsupported",
          fireStatus,
          smokeStatus: error.reason === "missing" ? "missing" : "incomplete",
        },
      };
    }
    const reason = error instanceof HmsRetrievalError &&
        error.reason !== "missing" && error.reason !== "incomplete"
      ? error.reason
      : "provider_failure";
    throw new HmsDayFailure(reason, {
      date,
      status: "failed",
      fireStatus,
      smokeStatus: "failed",
    });
  }

  let fire: ParsedDailyProduct;
  try {
    const fireUrl = fireUrlForDate(date);
    fire = fireUrl.legacyKml
      ? await fetchKmlProduct({
          url: fireUrl.url,
          source: "fire",
          maxBytes: LEGACY_FIRE_KML_MAX_BYTES,
          kind: "fire_points",
          box,
          deps,
        })
      : await fetchFireText(fireUrl.url, date, box, deps);
    fireStatus = "complete";
  } catch (error) {
    if (error instanceof HmsRetrievalError && (error.reason === "missing" || error.reason === "incomplete")) {
      return {
        date,
        coverage: {
          date,
          status: "unsupported",
          fireStatus: error.reason === "missing" ? "missing" : "incomplete",
          smokeStatus,
        },
      };
    }
    const reason = error instanceof HmsRetrievalError &&
        error.reason !== "missing" && error.reason !== "incomplete"
      ? error.reason
      : "provider_failure";
    throw new HmsDayFailure(reason, {
      date,
      status: "failed",
      fireStatus: "failed",
      smokeStatus,
    });
  }

  return {
    date,
    coverage: { date, status: "complete", fireStatus, smokeStatus },
    fire,
    smoke,
  };
}

function bboxText(box: BoundingBox): string {
  return `W${box.west} S${box.south} E${box.east} N${box.north}`;
}

function observationFor(
  source: SourceKind,
  day: RetrievedDay,
  placeId: string,
  box: BoundingBox,
): Observation {
  const product = source === "fire" ? day.fire : day.smoke;
  const sourceId = source === "fire" ? "noaa_hms_fire_points" : "noaa_hms_smoke_polygons";
  const variableName = source === "fire"
    ? "fire_detection_records_in_box"
    : "smoke_coordinate_pairs_in_box";
  const metadata: Record<string, string | number | boolean> = {
    observationDate: day.date,
    boundingBox: bboxText(box),
    totalCount: product.totalCount,
    inBoxCount: product.inBoxCount,
    rawByteCount: product.rawByteCount,
    countUnit: product.unit,
    dataWarning: source === "fire"
      ? "Records are not counts of distinct fires, homes, or people."
      : "Coordinate pairs are not counts of distinct smoke extents, homes, or people.",
  };
  if (product.sourceLastModifiedAt !== undefined) {
    metadata.sourceLastModifiedAt = product.sourceLastModifiedAt;
  }
  if (product.placemarkCount !== undefined) metadata.placemarkCount = product.placemarkCount;
  if (product.sourceRecordCount !== undefined) {
    metadata.sourceRecordCount = product.sourceRecordCount;
  }
  if (product.excludedDifferentObservationDayRecords !== undefined) {
    metadata.excludedDifferentObservationDayRecords =
      product.excludedDifferentObservationDayRecords;
  }
  return {
    observationId: `obs-hms-${source}-${placeId}-${day.date}`,
    provenance: {
      sourceId,
      sourceUrl: product.sourceUrl,
      retrievedAt: product.retrievedAt,
      observedAt: `${day.date}T00:00:00Z`,
      product: product.product,
      payloadHash: product.payloadHash,
      requestParameters: {
        date: day.date,
        place: placeId,
        bounds: bboxText(box),
      },
    },
    variableName,
    value: product.inBoxCount,
    unit: product.unit,
    dataMode: "live",
    periodStart: `${day.date}T00:00:00Z`,
    periodEnd: `${day.date}T23:59:59Z`,
    metadata,
  };
}

function limitationsFor(
  evidenceState: EvidenceObject["evidenceState"],
  coverageStatus: FireTemporalCoverage["status"],
): Limitation[] {
  const fireEntry = getRegistryEntry("noaa_hms_fire_points")!;
  const smokeEntry = getRegistryEntry("noaa_hms_smoke_polygons")!;
  return [
    ...fireEntry.requiredLimitations.map((description, index) => ({
      limitationId: `hms-fire-live-lim-${index}`,
      source: "noaa_hms_fire_points",
      description,
      required: true,
    })),
    ...smokeEntry.requiredLimitations.map((description, index) => ({
      limitationId: `hms-smoke-live-lim-${index}`,
      source: "noaa_hms_smoke_polygons",
      description,
      required: true,
    })),
    {
      limitationId: "hms-live-historical",
      source: "live-adapter",
      description:
        "This is a live retrieval of completed historical NOAA HMS daily files, not current or real-time data.",
      required: true,
    },
    ...(coverageStatus === "partial" ? [{
      limitationId: "hms-live-partial-coverage",
      source: "live-adapter",
      description:
        "Partial coverage: at least one requested UTC date lacked a complete Fire and Smoke source pair. " +
        "Unsupported days contributed no observations and were not treated as zero danger.",
      required: true,
    }] : []),
    ...(evidenceState === "no_observation" || evidenceState === "inconclusive_evidence" ? [{
      limitationId: "hms-live-no-observation-not-safety",
      source: "live-adapter",
      description:
        "Zero in-box counts or incomplete date coverage do not mean no fire or no danger. " +
        "Cloud, smoke, canopy, terrain, processing delay, and missing files can limit observations.",
      required: true,
    }] : []),
  ];
}

function buildEvidence(
  placeId: string,
  box: BoundingBox,
  completeDays: RetrievedDay[],
  coverage: FireTemporalCoverage,
  assembledAt: string,
): EvidenceObject {
  const observations = completeDays.flatMap((day) => [
    observationFor("fire", day, placeId, box),
    observationFor("smoke", day, placeId, box),
  ]);
  const positive = observations.some((observation) => (observation.value ?? 0) > 0);
  const evidenceState: EvidenceObject["evidenceState"] = coverage.status === "partial"
    ? "inconclusive_evidence"
    : positive
      ? "observations_returned"
      : "no_observation";
  const firstDate = completeDays[0].date;
  const latestDate = completeDays[completeDays.length - 1].date;
  const latestObservedAt = `${latestDate}T00:00:00Z`;
  const ageSeconds = Math.floor((Date.parse(assembledAt) - Date.parse(latestObservedAt)) / 1000);
  const freshness: Freshness = {
    status: "historical",
    classificationBasis: "historical_context",
    mostRecentObservationAt: latestObservedAt,
    evaluatedAt: assembledAt,
    ageSeconds,
    note:
      `LIVE RETRIEVAL · HISTORICAL OBSERVATION. Complete NOAA daily evidence spans ${firstDate} through ${latestDate}. ` +
      `Coverage status: ${coverage.status}.`,
  };
  const fireIds = observations
    .filter((observation) => observation.provenance.sourceId === "noaa_hms_fire_points")
    .map((observation) => observation.observationId);
  const smokeIds = observations
    .filter((observation) => observation.provenance.sourceId === "noaa_hms_smoke_polygons")
    .map((observation) => observation.observationId);
  const retrievalStatus: MissionAttribution["retrievalStatus"] = coverage.status === "partial"
    ? "partial"
    : "success";
  const fireEntry = getRegistryEntry("noaa_hms_fire_points")!;
  const smokeEntry = getRegistryEntry("noaa_hms_smoke_polygons")!;
  const missionAttributions: MissionAttribution[] = [
    {
      missionName: fireEntry.displayName,
      agency: fireEntry.agency,
      purpose: fireEntry.role,
      selectionReason: "Registered source for historical satellite fire-point observations on each complete requested day.",
      contributedObservationIds: fireIds,
      retrievalStatus,
      keyLimitation: fireEntry.requiredLimitations[0],
      datasetId: "noaa_hms_fire_points",
    },
    {
      missionName: smokeEntry.displayName,
      agency: smokeEntry.agency,
      purpose: smokeEntry.role,
      selectionReason: "Registered source for historical smoke-polygon observations on each complete requested day.",
      contributedObservationIds: smokeIds,
      retrievalStatus,
      keyLimitation: smokeEntry.requiredLimitations[0],
      datasetId: "noaa_hms_smoke_polygons",
    },
  ];
  const evidence: EvidenceObject = {
    evidenceId: `ev-hms-live-${placeId}-${firstDate}-${latestDate}`,
    hazardId: "fire_smoke",
    intentId: `intent-${placeId}-${firstDate}-${latestDate}`,
    evidenceState,
    dataMode: "live",
    observations,
    derivedMetrics: [],
    missionAttributions,
    freshness,
    confidence: evidenceState === "observations_returned"
      ? {
          level: "low",
          rationale:
            "Complete daily NOAA HMS Fire and Smoke source pairs were validated. Satellite and historical-data limitations still apply.",
        }
      : {
          level: "insufficient",
          rationale: coverage.status === "partial"
            ? "At least one requested UTC day lacks a complete Fire and Smoke source pair."
            : "Validated sources returned zero in-box counts; zero observations do not imply safety.",
        },
    limitations: limitationsFor(evidenceState, coverage.status),
    explanations: [],
    assembledAt,
  };
  validateEvidenceObject(evidence);
  return evidence;
}

function buildSourceFailureEvidence(
  evaluatedAt: string,
  reason: FireFailureReason,
): EvidenceObject {
  const evidence: EvidenceObject = {
    evidenceId: `ev-hms-live-source-failure-${reason}`,
    hazardId: "fire_smoke",
    intentId: "intent-live-source-failure",
    evidenceState: "source_failure",
    dataMode: "failed",
    observations: [],
    derivedMetrics: [],
    missionAttributions: [{
      missionName: "NOAA HMS (Live Retrieval — Failed)",
      agency: "NOAA / NESDIS / OSPO",
      purpose: "Historical Fire and Smoke daily-source retrieval.",
      selectionReason: "Registered source retrieval failed closed.",
      contributedObservationIds: [],
      retrievalStatus: "failed",
      keyLimitation: "Source failure is not proof of no fire or no danger.",
      datasetId: "noaa_hms_fire_points",
    }],
    freshness: {
      status: "unknown",
      classificationBasis: "no_observation_time",
      evaluatedAt,
      note: `Source failure (${reason}); no observation freshness is available.`,
    },
    confidence: {
      level: "insufficient",
      rationale: "The query failed closed; no stale, cached, partial, or fixture result was substituted.",
    },
    limitations: [
      {
        limitationId: "hms-live-failure",
        source: "live-adapter",
        description:
          `Live retrieval failed (${reason}). No stale, cached, partial, or fixture result was substituted.`,
        required: true,
      },
      {
        limitationId: "hms-live-failure-not-safety",
        source: "live-adapter",
        description: "Source failure is not proof of no fire or no danger; use official current alerts and local authorities.",
        required: true,
      },
    ],
    explanations: [],
    assembledAt: evaluatedAt,
  };
  validateEvidenceObject(evidence);
  return evidence;
}

function unsupportedDate(reason: string, temporalCoverage?: FireTemporalCoverage): FireQueryResult {
  return { kind: "unsupported_date", rejectionReason: reason, ...(temporalCoverage ? { temporalCoverage } : {}) };
}

function failedResult(
  reason: FireFailureReason,
  coverage: FireTemporalCoverage,
  deps: HmsLiveDependencies,
): FireQueryResult {
  const evaluatedAt = deps.nowIso();
  const safeEvaluatedAt = Number.isFinite(Date.parse(evaluatedAt)) ? evaluatedAt : new Date(0).toISOString();
  return {
    kind: "source_failure",
    failureReason: reason,
    temporalCoverage: coverage,
    evidence: buildSourceFailureEvidence(safeEvaluatedAt, reason),
  };
}

export async function queryLiveFireEvidence(
  input: FireLiveQueryInput,
  deps: HmsLiveDependencies = DEFAULT_DEPS,
): Promise<FireQueryResult> {
  if (input.mode !== "live") throw new Error("live adapter requires mode=live");
  // UXFIX-02: a validated user-selected map area is accepted alongside the
  // registered demo places. The area is re-validated here (defense in depth);
  // every source allowlist, byte cap, and fail-closed rule is unchanged.
  let box: BoundingBox | undefined;
  if (input.placeId === CUSTOM_AREA_PLACE_ID) {
    if (!("time" in input)) {
      return {
        kind: "unsupported_place",
        rejectionReason:
          "The legacy 2025-01-08 regression accepts registered demo places only. " +
          "Custom map areas use the bounded time selection.",
      };
    }
    try {
      box = validateQueryArea(input.area);
    } catch {
      return {
        kind: "unsupported_place",
        rejectionReason:
          "The selected map area is not a valid query area (west/south/east/north " +
          "within WGS-84, bounded span). Re-select the location.",
      };
    }
  } else {
    box = PLACE_BOX[input.placeId];
  }
  if (!box) {
    return {
      kind: "unsupported_place",
      // PR4b batch 3 (owner rule): no internal place ids in user-facing text.
      rejectionReason:
        "This place isn't supported in live mode. Pick a place from search, the map, or a demo card.",
    };
  }

  // UXFIX-02 (ADR-0022): NOAA HMS covers North America. A map-selected area
  // outside that coverage routes to the global NASA FIRMS product (key-gated,
  // fail-closed) instead of returning a bare no-observation.
  if (
    input.placeId === CUSTOM_AREA_PLACE_ID &&
    "time" in input &&
    selectFireAreaPrimarySource(box) === "nasa_firms"
  ) {
    const nowIsoForFirms = deps.nowIso();
    const latestForFirms = yesterdayUtc(nowIsoForFirms);
    if (latestForFirms === null) {
      return {
        kind: "unsupported_date",
        rejectionReason: "The current time could not be resolved to a completed UTC date.",
      };
    }
    let firmsStart: string;
    let firmsEnd: string;
    if (input.time.kind === "range") {
      if (
        parseIsoDate(input.time.startDate) === null ||
        parseIsoDate(input.time.endDate) === null ||
        input.time.startDate > input.time.endDate ||
        input.time.endDate > latestForFirms
      ) {
        return {
          kind: "unsupported_date",
          rejectionReason:
            "Global FIRMS retrieval accepts an inclusive range of completed UTC dates (up to yesterday).",
        };
      }
      firmsStart = input.time.startDate;
      firmsEnd = input.time.endDate;
    } else {
      firmsEnd = latestForFirms;
      firmsStart = addUtcDays(latestForFirms, -(input.time.days - 1));
    }
    return queryFirmsEvidence(box, firmsStart, firmsEnd, {
      fetch: deps.fetch,
      nowIso: deps.nowIso,
    });
  }

  const nowIso = deps.nowIso();
  const latestAllowedDate = yesterdayUtc(nowIso);
  if (latestAllowedDate === null) {
    return failedResult("validation_failure", {
      requestType: "latest",
      status: "failed",
      days: [],
    }, deps);
  }

  let requestType: FireTemporalCoverage["requestType"];
  let requestedDates: string[];
  const cache = new Map<string, RetrievedDay>();
  const latestResolutionDays: FireCoverageDay[] = [];

  if ("date" in input) {
    requestType = "legacy_regression";
    if (input.date !== PINNED_FIXTURE_DATE) {
      return unsupportedDate(
        `Legacy live regression accepts only ${PINNED_FIXTURE_DATE}. New product queries must use a bounded time selection.`,
      );
    }
    requestedDates = [input.date];
  } else if (input.time.kind === "range") {
    requestType = "custom";
    const dates = enumerateDates(input.time.startDate, input.time.endDate);
    if (
      dates.length === 0 ||
      dates.length > HMS_MAX_RANGE_DAYS ||
      input.time.startDate < HMS_COMMON_START_DATE ||
      input.time.endDate > latestAllowedDate
    ) {
      return unsupportedDate(
        `Live custom range must contain 1–${HMS_MAX_RANGE_DAYS} inclusive UTC dates between ` +
        `${HMS_COMMON_START_DATE} and ${latestAllowedDate}. Today UTC is not a completed daily file.`,
      );
    }
    requestedDates = dates;
  } else {
    requestType = input.time.days === 1 ? "latest" : "latest_7d";
    let resolvedLatest: RetrievedDay | undefined;
    for (let offset = 0; offset < LATEST_LOOKBACK_DAYS; offset += 1) {
      const candidateDate = addUtcDays(latestAllowedDate, -offset);
      if (candidateDate < HMS_COMMON_START_DATE) break;
      try {
        const attempt = await fetchDay(candidateDate, box, deps);
        latestResolutionDays.push(attempt.coverage);
        if (isRetrievedDay(attempt)) {
          resolvedLatest = attempt;
          cache.set(candidateDate, attempt);
          break;
        }
      } catch (error) {
        const failure = error instanceof HmsDayFailure ? error : new HmsDayFailure(
          "provider_failure",
          { date: candidateDate, status: "failed", fireStatus: "not_checked", smokeStatus: "failed" },
        );
        return failedResult(failure.reason, {
          requestType,
          status: "failed",
          days: [...latestResolutionDays, failure.coverage],
        }, deps);
      }
    }
    if (!resolvedLatest) {
      return unsupportedDate(
        "Latest could not be resolved to a complete NOAA Fire and Smoke daily pair within the bounded seven-day lookback.",
        { requestType, status: "unsupported", days: latestResolutionDays },
      );
    }
    const start = addUtcDays(resolvedLatest.date, -(input.time.days - 1));
    if (start < HMS_COMMON_START_DATE) {
      return unsupportedDate(
        `The resolved latest range begins before the common NOAA Fire and Smoke boundary ${HMS_COMMON_START_DATE}.`,
        { requestType, status: "unsupported", days: latestResolutionDays },
      );
    }
    requestedDates = enumerateDates(start, resolvedLatest.date);
  }

  const attempts: DayAttempt[] = [];
  for (const date of requestedDates) {
    const cached = cache.get(date);
    if (cached) {
      attempts.push(cached);
      continue;
    }
    try {
      attempts.push(await fetchDay(date, box, deps));
    } catch (error) {
      const failure = error instanceof HmsDayFailure ? error : new HmsDayFailure(
        "provider_failure",
        { date, status: "failed", fireStatus: "not_checked", smokeStatus: "failed" },
      );
      return failedResult(failure.reason, {
        requestType,
        status: "failed",
        requestedStartDate: requestedDates[0],
        requestedEndDate: requestedDates[requestedDates.length - 1],
        days: [...attempts.map((attempt) => attempt.coverage), failure.coverage],
      }, deps);
    }
  }

  const completeDays = attempts.filter(isRetrievedDay);
  const coverageStatus: FireTemporalCoverage["status"] = completeDays.length === requestedDates.length
    ? "complete"
    : completeDays.length > 0
      ? "partial"
      : "unsupported";
  const coverage: FireTemporalCoverage = {
    requestType,
    status: coverageStatus,
    requestedStartDate: requestedDates[0],
    requestedEndDate: requestedDates[requestedDates.length - 1],
    ...(completeDays.length > 0 ? {
      resolvedStartDate: completeDays[0].date,
      resolvedEndDate: completeDays[completeDays.length - 1].date,
    } : {}),
    days: [
      ...latestResolutionDays.filter(
        (candidate) => !attempts.some((attempt) => attempt.date === candidate.date),
      ),
      ...attempts.map((attempt) => attempt.coverage),
    ],
  };

  if (completeDays.length === 0) {
    return unsupportedDate(
      "No requested UTC date had a complete NOAA Fire and Smoke daily source pair. Missing data was not treated as zero danger.",
      coverage,
    );
  }

  const assembledAt = deps.nowIso();
  if (!Number.isFinite(Date.parse(assembledAt))) {
    return failedResult("validation_failure", { ...coverage, status: "failed" }, deps);
  }
  try {
    const evidence = buildEvidence(input.placeId, box, completeDays, coverage, assembledAt);
    return {
      kind: coverage.status === "partial"
        ? "partial_coverage"
        : evidence.evidenceState === "observations_returned"
          ? "success"
          : "no_observation",
      evidence,
      temporalCoverage: coverage,
    };
  } catch {
    return failedResult("validation_failure", { ...coverage, status: "failed" }, deps);
  }
}
