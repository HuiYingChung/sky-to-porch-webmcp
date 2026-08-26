import { createHash } from "crypto";
import type { BoundingBox } from "@/contracts/common";
import { validateQueryArea } from "@/lib/location/query-area";

type FetchLike = typeof fetch;

export const AIRNOW_HOST = "www.airnowapi.org";
export const AIRNOW_DATA_PATH = "/aq/data/";
export const AIRNOW_TIMEOUT_MS = 10_000;
export const AIRNOW_MAX_BYTES = 2_000_000;
export const AIRNOW_CACHE_TTL_MS = 5 * 60 * 1_000;
export const AIRNOW_MAX_CONCURRENCY = 2;
export const AIRNOW_MAX_OBSERVATIONS = 20;
export const AIRNOW_MAX_CLIENT_QUERIES_PER_MINUTE = 6;

export type AirNowFailureReason =
  | "credential_not_configured"
  | "rate_limited"
  | "timeout"
  | "network"
  | "redirect"
  | "oversize"
  | "media_type"
  | "malformed"
  | "schema_validation"
  | "provider_failure";

export interface AirNowObservation {
  observationId: string;
  provenance: {
    sourceId: "airnow";
    sourceUrl: string;
    sourceRecordId: string;
    retrievedAt: string;
    observedAt: string;
    product: string;
    payloadHash: string;
    requestParameters: Record<string, string>;
  };
  variableName: string;
  value: number;
  unit: "AQI";
  dataMode: "live";
  qualifiers: string[];
  metadata: Record<string, string | number>;
}

export type AirNowResult =
  | { kind: "observations"; observations: AirNowObservation[]; cacheStatus: "hit" | "miss" }
  | { kind: "no_observation"; cacheStatus: "hit" | "miss" }
  | { kind: "source_failure"; reason: AirNowFailureReason };

export interface AirNowDependencies {
  fetchImpl?: FetchLike;
  now?: () => Date;
  apiKey?: string;
  cache?: false;
}

class AirNowError extends Error {
  constructor(readonly reason: AirNowFailureReason) {
    super(reason);
    this.name = "AirNowError";
  }
}

const cache = new Map<string, { expiresAt: number; result: AirNowResult }>();
const clientWindows = new Map<string, number[]>();
let active = 0;
const waiters: Array<() => void> = [];

async function withConcurrency<T>(work: () => Promise<T>): Promise<T> {
  if (active >= AIRNOW_MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
    waiters.shift()?.();
  }
}

export function airNowClientRateLimiterAllows(clientToken: string, nowMs: number): boolean {
  const token = createHash("sha256").update(clientToken).digest("hex");
  const windowStart = nowMs - 60_000;
  const recent = (clientWindows.get(token) ?? []).filter((timestamp) => timestamp > windowStart);
  if (recent.length >= AIRNOW_MAX_CLIENT_QUERIES_PER_MINUTE) {
    clientWindows.set(token, recent);
    return false;
  }
  recent.push(nowMs);
  clientWindows.set(token, recent);
  return true;
}

function buildUrl(date: string, area: BoundingBox, apiKey: string): URL {
  const url = new URL(`https://${AIRNOW_HOST}${AIRNOW_DATA_PATH}`);
  url.searchParams.set("startDate", `${date}T00`);
  url.searchParams.set("endDate", `${date}T23`);
  url.searchParams.set("parameters", "OZONE,PM25");
  url.searchParams.set("BBOX", `${area.west},${area.south},${area.east},${area.north}`);
  url.searchParams.set("dataType", "A");
  url.searchParams.set("format", "application/json");
  url.searchParams.set("verbose", "1");
  url.searchParams.set("monitorType", "0");
  url.searchParams.set("includerawconcentrations", "0");
  url.searchParams.set("API_KEY", apiKey);
  return url;
}

function redactedUrl(url: URL): string {
  const copy = new URL(url);
  copy.searchParams.set("API_KEY", "REDACTED");
  return copy.toString();
}

async function readBody(response: Response): Promise<Uint8Array> {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null) {
    const length = Number(lengthHeader);
    if (!Number.isInteger(length) || length < 0 || length > AIRNOW_MAX_BYTES) {
      throw new AirNowError("oversize");
    }
  }
  if (!response.body) throw new AirNowError("malformed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > AIRNOW_MAX_BYTES) {
      await reader.cancel();
      throw new AirNowError("oversize");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObservations(
  value: unknown,
  area: BoundingBox,
  date: string,
  sourceUrl: string,
  bytes: Uint8Array,
  retrievedAt: string
): AirNowObservation[] {
  if (!Array.isArray(value)) throw new AirNowError("schema_validation");
  if (value.length > 10_000) throw new AirNowError("oversize");
  const payloadHash = createHash("sha256").update(bytes).digest("hex");
  const parsed: AirNowObservation[] = [];
  for (const item of value) {
    if (!isRecord(item)) throw new AirNowError("schema_validation");
    const latitude = Number(item.Latitude);
    const longitude = Number(item.Longitude);
    const aqi = Number(item.AQI);
    if (
      typeof item.UTC !== "string" || typeof item.Parameter !== "string" ||
      typeof item.SiteName !== "string" || typeof item.AgencyName !== "string" ||
      typeof item.FullAQSCode !== "string" || typeof item.Category !== "number" ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(aqi)
    ) throw new AirNowError("schema_validation");
    if (
      longitude < area.west || longitude > area.east ||
      latitude < area.south || latitude > area.north ||
      aqi < 0 || aqi > 500
    ) throw new AirNowError("schema_validation");
    const observedAtMs = Date.parse(item.UTC.endsWith("Z") ? item.UTC : `${item.UTC}Z`);
    if (!Number.isFinite(observedAtMs) || new Date(observedAtMs).toISOString().slice(0, 10) !== date) {
      throw new AirNowError("schema_validation");
    }
    const parameter = item.Parameter.trim().toUpperCase();
    if (!["OZONE", "PM2.5", "PM25"].includes(parameter)) continue;
    const observedAt = new Date(observedAtMs).toISOString();
    parsed.push({
      observationId: `obs-airnow-${item.FullAQSCode}-${parameter.replace(/[^A-Z0-9]/gu, "")}-${observedAt.replace(/[^0-9]/gu, "")}`,
      provenance: {
        sourceId: "airnow",
        sourceUrl,
        sourceRecordId: `${item.FullAQSCode}#${parameter}#${observedAt}`,
        retrievedAt,
        observedAt,
        product: "AirNow historical monitoring-site AQI",
        payloadHash,
        requestParameters: {
          utcDate: date,
          parameters: "OZONE,PM25",
          boundingBox: `${area.west},${area.south},${area.east},${area.north}`,
          dataType: "A",
        },
      },
      variableName: `${parameter} outdoor AQI`,
      value: aqi,
      unit: "AQI",
      dataMode: "live",
      qualifiers: ["outdoor_monitoring_site", "not_indoor_air", "not_personal_exposure"],
      metadata: {
        siteName: item.SiteName,
        agencyName: item.AgencyName,
        fullAqsCode: item.FullAQSCode,
        latitude,
        longitude,
        categoryNumber: item.Category,
      },
    });
  }
  parsed.sort((left, right) =>
    right.provenance.observedAt.localeCompare(left.provenance.observedAt) ||
    left.observationId.localeCompare(right.observationId)
  );
  return parsed.slice(0, AIRNOW_MAX_OBSERVATIONS);
}

export async function queryAirNow(
  date: string,
  value: unknown,
  dependencies: AirNowDependencies = {}
): Promise<AirNowResult> {
  const area = validateQueryArea(value);
  const dateMs = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
    !Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== date) {
    return { kind: "source_failure", reason: "schema_validation" };
  }
  const apiKey = dependencies.apiKey ?? process.env.AIRNOW_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    return { kind: "source_failure", reason: "credential_not_configured" };
  }
  const now = dependencies.now?.() ?? new Date();
  const cacheKey = `${date}|${area.west},${area.south},${area.east},${area.north}`;
  const cached = dependencies.cache === false ? undefined : cache.get(cacheKey);
  if (cached && cached.expiresAt > now.getTime()) {
    const cloned = structuredClone(cached.result);
    if (cloned.kind === "source_failure") return cloned;
    return { ...cloned, cacheStatus: "hit" };
  }
  return withConcurrency(async () => {
    const url = buildUrl(date, area, apiKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AIRNOW_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await (dependencies.fetchImpl ?? fetch)(url, {
          method: "GET",
          redirect: "manual",
          cache: "no-store",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
      } catch {
        throw new AirNowError(controller.signal.aborted ? "timeout" : "network");
      }
      if (response.status >= 300 && response.status < 400) throw new AirNowError("redirect");
      if (response.status === 429) throw new AirNowError("rate_limited");
      if (!response.ok) throw new AirNowError("provider_failure");
      const contentType = (response.headers.get("content-type") ?? "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (contentType !== "application/json") throw new AirNowError("media_type");
      const bytes = await readBody(response);
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        throw new AirNowError("malformed");
      }
      const observations = parseObservations(
        value,
        area,
        date,
        redactedUrl(url),
        bytes,
        now.toISOString()
      );
      const result: AirNowResult = observations.length === 0
        ? { kind: "no_observation", cacheStatus: "miss" }
        : { kind: "observations", observations, cacheStatus: "miss" };
      if (dependencies.cache !== false) {
        cache.set(cacheKey, { expiresAt: now.getTime() + AIRNOW_CACHE_TTL_MS, result });
      }
      return result;
    } catch (error) {
      return {
        kind: "source_failure",
        reason: error instanceof AirNowError ? error.reason : "schema_validation",
      };
    } finally {
      clearTimeout(timeout);
    }
  });
}
