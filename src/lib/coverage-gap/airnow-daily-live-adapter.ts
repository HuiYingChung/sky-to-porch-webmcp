import { createHash } from "crypto";
import type { BoundingBox } from "@/contracts/common";
import { validateQueryArea } from "@/lib/location/query-area";
import {
  parseAirNowDailyData,
  type AirNowDailyRecord,
} from "./airnow-daily-data-parser";

type FetchLike = typeof fetch;

export const AIRNOW_DAILY_HOST = "files.airnowtech.org";
export const AIRNOW_DAILY_FILENAME = "daily_data_v2.dat";
export const AIRNOW_DAILY_TIMEOUT_MS = 10_000;
export const AIRNOW_DAILY_MAX_BYTES = 8 * 1024 * 1024;
export const AIRNOW_DAILY_CACHE_TTL_MS = 5 * 60 * 1_000;
export const AIRNOW_DAILY_MAX_CONCURRENCY = 2;
export const AIRNOW_DAILY_MAX_OBSERVATIONS = 20;

const ACCEPTED_MEDIA_TYPES = new Set([
  "text/plain",
  "application/octet-stream",
  "binary/octet-stream",
]);
const MEDIA_TYPE_PATTERN = /^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/u;
const INVALID_OR_MISSING_MEDIA_TYPE = "invalid_or_missing";

export type AirNowDailyLiveFailureReason =
  | "live_gate_closed"
  | "rate_limited"
  | "timeout"
  | "network"
  | "redirect"
  | "oversize"
  | "media_type"
  | "malformed"
  | "schema_validation"
  | "provider_failure";

/**
 * Pre-promotion observation candidate. The registry keeps this source
 * deferred until a separately approved live-source gate validates the exact
 * official file path and media contract.
 */
export interface AirNowDailyLiveObservation {
  observationId: string;
  provenance: {
    sourceId: "airnow_daily_data";
    sourceUrl: string;
    sourceRecordId: string;
    retrievedAt: string;
    observedAt: "unknown";
    product: "AirNow daily monitoring-site AQI summary";
    payloadHash: string;
    requestParameters: Record<string, string>;
  };
  variableName: string;
  value: number;
  unit: "AQI";
  dataMode: "live";
  qualifiers: string[];
  metadata: Record<string, string | number | boolean>;
}

export type AirNowDailyLiveResult =
  | {
      kind: "observations";
      observations: AirNowDailyLiveObservation[];
      cacheStatus: "hit" | "miss";
      areaRecordCount: number;
      truncated: boolean;
    }
  | { kind: "no_observation"; cacheStatus: "hit" | "miss" }
  | {
      kind: "source_failure";
      reason: Exclude<AirNowDailyLiveFailureReason, "media_type">;
    }
  | {
      kind: "source_failure";
      reason: "media_type";
      receivedMediaType: string;
    };

export interface AirNowDailyLiveDependencies {
  fetchImpl?: FetchLike;
  now?: () => Date;
  cache?: false;
  /** Must be true only inside an approved live gate or promoted product path. */
  externalCallsAuthorized?: boolean;
}

class AirNowDailyLiveError extends Error {
  constructor(
    readonly reason: AirNowDailyLiveFailureReason,
    readonly receivedMediaType?: string,
  ) {
    super(reason);
    this.name = "AirNowDailyLiveError";
  }
}

function normalizeMediaType(value: string | null): string {
  const mediaType = (value ?? "").split(";", 1)[0].trim().toLowerCase();
  return MEDIA_TYPE_PATTERN.test(mediaType) ? mediaType : INVALID_OR_MISSING_MEDIA_TYPE;
}

function sourceFailure(error: unknown): AirNowDailyLiveResult {
  if (error instanceof AirNowDailyLiveError) {
    const { reason } = error;
    if (reason === "media_type") {
      return {
        kind: "source_failure",
        reason,
        receivedMediaType: error.receivedMediaType ?? INVALID_OR_MISSING_MEDIA_TYPE,
      };
    }
    return { kind: "source_failure", reason };
  }
  return { kind: "source_failure", reason: "schema_validation" };
}

const resultCache = new Map<string, {
  expiresAt: number;
  result: AirNowDailyLiveResult;
}>();
let activeRequests = 0;
const requestWaiters: Array<() => void> = [];

function isValidIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date;
}

export function buildAirNowDailyFileUrl(date: string): URL {
  if (!isValidIsoDate(date)) throw new Error("invalid AirNow daily-file date");
  const compactDate = date.replaceAll("-", "");
  return new URL(
    `https://${AIRNOW_DAILY_HOST}/airnow/${date.slice(0, 4)}/${compactDate}/${AIRNOW_DAILY_FILENAME}`
  );
}

async function withConcurrency<T>(work: () => Promise<T>): Promise<T> {
  if (activeRequests >= AIRNOW_DAILY_MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => requestWaiters.push(resolve));
  }
  activeRequests += 1;
  try {
    return await work();
  } finally {
    activeRequests -= 1;
    requestWaiters.shift()?.();
  }
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const statedLength = response.headers.get("content-length");
  if (statedLength !== null) {
    const length = Number(statedLength);
    if (!Number.isInteger(length) || length < 0 || length > AIRNOW_DAILY_MAX_BYTES) {
      throw new AirNowDailyLiveError("oversize");
    }
  }
  if (!response.body) throw new AirNowDailyLiveError("malformed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > AIRNOW_DAILY_MAX_BYTES) {
      await reader.cancel();
      throw new AirNowDailyLiveError("oversize");
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

function mapRecord(
  record: AirNowDailyRecord,
  sourceUrl: string,
  payloadHash: string,
  retrievedAt: string,
  area: BoundingBox,
  areaRecordCount: number,
  returnedRecordCount: number,
): AirNowDailyLiveObservation {
  return {
    observationId: `obs-airnow-daily-${record.aqsid}-${record.parameter.replace(/[^A-Z0-9]/gu, "")}-${record.isoDate.replaceAll("-", "")}`,
    provenance: {
      sourceId: "airnow_daily_data",
      sourceUrl,
      sourceRecordId: `${record.fullAqsid}#${record.parameter}#${record.isoDate}`,
      retrievedAt,
      // The file identifies a Local Standard Time calendar date, but does not
      // carry the site's UTC offset. Do not invent an instant.
      observedAt: "unknown",
      product: "AirNow daily monitoring-site AQI summary",
      payloadHash,
      requestParameters: {
        validDate: record.isoDate,
        boundingBox: `${area.west},${area.south},${area.east},${area.north}`,
        parameters: "OZONE-8HR,PM2.5-24HR,PM10-24HR",
        countryPrefix: "840",
      },
    },
    variableName: `${record.parameter} outdoor daily AQI`,
    value: record.aqi,
    unit: "AQI",
    dataMode: "live",
    qualifiers: [...record.qualifiers],
    metadata: {
      validDate: record.isoDate,
      timeBasis: "midnight-to-midnight Local Standard Time; UTC instant unavailable",
      siteName: record.siteName,
      dataSource: record.dataSource,
      fullAqsid: record.fullAqsid,
      latitude: record.lat,
      longitude: record.lon,
      aqiCategory: record.aqiCategory,
      concentrationValue: record.value,
      concentrationUnit: record.reportingUnits,
      averagingPeriodHours: record.averagingPeriod,
      areaRecordCount,
      returnedRecordCount,
      resultTruncated: areaRecordCount > returnedRecordCount,
    },
  };
}

/**
 * Bounded daily-file transport. It is deliberately closed by default until
 * an exact live gate or a promoted product caller opts in explicitly.
 */
export async function queryAirNowDailyData(
  date: string,
  value: unknown,
  dependencies: AirNowDailyLiveDependencies = {},
): Promise<AirNowDailyLiveResult> {
  let area: BoundingBox;
  try {
    area = validateQueryArea(value);
    if (!isValidIsoDate(date)) throw new AirNowDailyLiveError("schema_validation");
  } catch (error) {
    return sourceFailure(error);
  }
  if (dependencies.externalCallsAuthorized !== true) {
    return { kind: "source_failure", reason: "live_gate_closed" };
  }

  const url = buildAirNowDailyFileUrl(date);
  const now = dependencies.now?.() ?? new Date();
  const cacheKey = `${url}|${area.west},${area.south},${area.east},${area.north}`;
  const cacheEnabled = dependencies.cache !== false && dependencies.fetchImpl === undefined;
  const cached = cacheEnabled ? resultCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > now.getTime()) {
    const cloned = structuredClone(cached.result);
    return cloned.kind === "source_failure" ? cloned : { ...cloned, cacheStatus: "hit" };
  }

  return withConcurrency(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AIRNOW_DAILY_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await (dependencies.fetchImpl ?? fetch)(url, {
          method: "GET",
          redirect: "manual",
          cache: "no-store",
          signal: controller.signal,
          headers: { Accept: "text/plain, application/octet-stream;q=0.9" },
        });
      } catch {
        throw new AirNowDailyLiveError(controller.signal.aborted ? "timeout" : "network");
      }
      if (response.status >= 300 && response.status < 400) {
        throw new AirNowDailyLiveError("redirect");
      }
      if (response.status === 429) throw new AirNowDailyLiveError("rate_limited");
      if (!response.ok) throw new AirNowDailyLiveError("provider_failure");
      const contentType = normalizeMediaType(response.headers.get("content-type"));
      if (!ACCEPTED_MEDIA_TYPES.has(contentType)) {
        throw new AirNowDailyLiveError("media_type", contentType);
      }
      const bytes = await readBoundedBody(response);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new AirNowDailyLiveError("malformed");
      }
      const parsed = parseAirNowDailyData(text, date, area);
      if (parsed.kind === "source_failure") {
        throw new AirNowDailyLiveError(parsed.reason);
      }
      const result: AirNowDailyLiveResult = parsed.kind === "no_observation"
        ? { kind: "no_observation", cacheStatus: "miss" }
        : (() => {
            const areaRecordCount = parsed.records.length;
            const selected = parsed.records.slice(0, AIRNOW_DAILY_MAX_OBSERVATIONS);
            const payloadHash = createHash("sha256").update(bytes).digest("hex");
            return {
              kind: "observations" as const,
              observations: selected.map((record) => mapRecord(
                record,
                url.toString(),
                payloadHash,
                now.toISOString(),
                area,
                areaRecordCount,
                selected.length,
              )),
              cacheStatus: "miss" as const,
              areaRecordCount,
              truncated: areaRecordCount > selected.length,
            };
          })();
      if (cacheEnabled) {
        resultCache.set(cacheKey, {
          expiresAt: now.getTime() + AIRNOW_DAILY_CACHE_TTL_MS,
          result,
        });
      }
      return result;
    } catch (error) {
      return sourceFailure(error);
    } finally {
      clearTimeout(timeout);
    }
  });
}
