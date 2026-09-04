/**
 * src/lib/location/geocode.ts
 *
 * UXFIX-02 (W8): Server-side place-name search via the public Photon API
 * (photon.komoot.io, © komoot — geocoding data © OpenStreetMap contributors).
 *
 * Policy (ADR-0022):
 *   - Public Nominatim remains prohibited; Photon's terms permit reasonable
 *     use without a key. This module enforces good-citizen behavior: one
 *     upstream request per second process-wide, bounded response size, no
 *     retry, fail-closed on any upstream problem.
 *   - Geocoding is a convenience only. Search failure never blocks the demo
 *     places or map-click selection paths.
 *   - For production-scale use, self-host Photon or move to a keyed provider.
 */

import {
  ValidationError,
  validateBoundingBox,
  type BoundingBox,
} from "@/contracts/common";

export const PHOTON_HOST = "photon.komoot.io";
export const GEOCODE_MAX_RESULTS = 5;
export const GEOCODE_MIN_INTERVAL_MS = 1000;
/** Maximum requests waiting behind the one active Photon request. */
export const GEOCODE_MAX_QUEUED_REQUESTS = 4;
/** A queued request fails boundedly instead of waiting on a stalled predecessor. */
export const GEOCODE_MAX_QUEUE_WAIT_MS = 10_000;
export const GEOCODE_ATTRIBUTION =
  "Search results © OpenStreetMap contributors, via Photon (komoot)";
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F-\u009F]/u;

export interface GeocodeAdminContext {
  locality?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  country?: string;
  countryCode?: string;
}

export interface GeocodeResult {
  /** Stable upstream identity when Photon supplies an OSM feature id. */
  id?: string;
  /** Display label assembled from Photon properties (never invented). */
  label: string;
  lon: number;
  lat: number;
  /** Source-supplied place extent normalized to WGS84 west/south/east/north. */
  boundingBox: BoundingBox | null;
  /** Only administrative fields actually supplied by Photon are returned. */
  adminContext: GeocodeAdminContext;
}

export type GeocodeScheduleResult<T> =
  | { kind: "completed"; value: T }
  | { kind: "rate_limited" }
  | { kind: "aborted" };

interface QueuedGeocodeRequest {
  run: (signal: AbortSignal) => Promise<unknown>;
  controller: AbortController;
  callerSignal?: AbortSignal;
  resolve: (result: GeocodeScheduleResult<unknown>) => void;
  reject: (error: unknown) => void;
  queueTimer?: ReturnType<typeof setTimeout>;
  onCallerAbort?: () => void;
  onInternalAbort?: () => void;
  settled: boolean;
}

/**
 * Process-local Photon scheduler. The route is the only production caller:
 * one upstream request runs at a time, request starts remain one second apart,
 * and overload is bounded by both queue length and queue-wait time.
 */
function waitForStartWindow(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  if (delayMs <= 0) return Promise.resolve(true);
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(ready);
    };
    const timer = setTimeout(() => finish(true), delayMs);
    const onAbort = () => finish(false);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

class GeocodeScheduler {
  private readonly queue: QueuedGeocodeRequest[] = [];
  private active: QueuedGeocodeRequest | null = null;
  private running = false;
  private disposed = false;
  private lastUpstreamRequestMs: number | null = null;

  schedule<T>(
    run: (signal: AbortSignal) => Promise<T>,
    callerSignal?: AbortSignal
  ): Promise<GeocodeScheduleResult<T>> {
    if (callerSignal?.aborted || this.disposed) {
      return Promise.resolve({ kind: "aborted" });
    }
    if (this.queue.length >= GEOCODE_MAX_QUEUED_REQUESTS) {
      return Promise.resolve({ kind: "rate_limited" });
    }

    return new Promise<GeocodeScheduleResult<T>>((resolve, reject) => {
      const controller = new AbortController();
      const request: QueuedGeocodeRequest = {
        run,
        controller,
        callerSignal,
        resolve: resolve as (result: GeocodeScheduleResult<unknown>) => void,
        reject,
        settled: false,
      };
      request.onCallerAbort = () => controller.abort();
      request.onInternalAbort = () => {
        if (this.removeQueuedRequest(request) || this.active === request) {
          this.settle(request, { kind: "aborted" });
        }
      };
      callerSignal?.addEventListener("abort", request.onCallerAbort, { once: true });
      controller.signal.addEventListener("abort", request.onInternalAbort, { once: true });
      request.queueTimer = setTimeout(() => {
        if (!this.removeQueuedRequest(request)) return;
        this.settle(request, { kind: "rate_limited" });
        // Wake a head-of-queue request that is waiting for its start window.
        controller.abort();
      }, GEOCODE_MAX_QUEUE_WAIT_MS);
      this.queue.push(request);
      void this.drain();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const request of [...this.queue]) {
      this.removeQueuedRequest(request);
      request.controller.abort();
      this.settle(request, { kind: "aborted" });
    }
    if (this.active) {
      this.active.controller.abort();
      this.settle(this.active, { kind: "aborted" });
    }
  }

  private removeQueuedRequest(request: QueuedGeocodeRequest): boolean {
    const index = this.queue.indexOf(request);
    if (index === -1) return false;
    this.queue.splice(index, 1);
    return true;
  }

  private clearQueueTimer(request: QueuedGeocodeRequest): void {
    if (request.queueTimer === undefined) return;
    clearTimeout(request.queueTimer);
    request.queueTimer = undefined;
  }

  private cleanUp(request: QueuedGeocodeRequest): void {
    this.clearQueueTimer(request);
    if (request.callerSignal && request.onCallerAbort) {
      request.callerSignal.removeEventListener("abort", request.onCallerAbort);
    }
    if (request.onInternalAbort) {
      request.controller.signal.removeEventListener("abort", request.onInternalAbort);
    }
  }

  private settle(
    request: QueuedGeocodeRequest,
    result: GeocodeScheduleResult<unknown>
  ): void {
    if (request.settled) return;
    request.settled = true;
    this.cleanUp(request);
    request.resolve(result);
  }

  private fail(request: QueuedGeocodeRequest, error: unknown): void {
    if (request.settled) return;
    request.settled = true;
    this.cleanUp(request);
    request.reject(error);
  }

  private async drain(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      while (!this.disposed && this.queue.length > 0) {
        const request = this.queue[0];
        if (!request || request.settled || request.controller.signal.aborted) {
          if (request) this.removeQueuedRequest(request);
          continue;
        }

        const delayMs = this.lastUpstreamRequestMs === null
          ? 0
          : Math.max(
            0,
            this.lastUpstreamRequestMs + GEOCODE_MIN_INTERVAL_MS - performance.now()
          );
        if (delayMs > 0) {
          const ready = await waitForStartWindow(delayMs, request.controller.signal);
          if (!ready) continue;
          // Recompute after every wake so wall-clock changes cannot start a
          // request early; the independent queue timer remains the hard bound.
          continue;
        }

        // No await occurs between this final abort check and dispatch.
        if (request.controller.signal.aborted) continue;
        this.queue.shift();
        this.clearQueueTimer(request);
        this.active = request;
        this.lastUpstreamRequestMs = performance.now();
        try {
          const value = await request.run(request.controller.signal);
          if (request.controller.signal.aborted) {
            this.settle(request, { kind: "aborted" });
          } else {
            this.settle(request, { kind: "completed", value });
          }
        } catch (error) {
          if (request.controller.signal.aborted) {
            this.settle(request, { kind: "aborted" });
          } else {
            this.fail(request, error);
          }
        } finally {
          if (this.active === request) this.active = null;
        }
      }
    } finally {
      this.running = false;
      if (!this.disposed && this.queue.length > 0) void this.drain();
    }
  }
}

let geocodeScheduler = new GeocodeScheduler();

export function scheduleGeocodeRequest<T>(
  run: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal
): Promise<GeocodeScheduleResult<T>> {
  return geocodeScheduler.schedule(run, signal);
}

/** Test hook: dispose all work and replace the process-local scheduler. */
export function resetGeocodeSchedulerForTests(): void {
  geocodeScheduler.dispose();
  geocodeScheduler = new GeocodeScheduler();
}

/** Backwards-compatible alias for the previous limiter test hook. */
export const resetGeocodeRateLimiter = resetGeocodeSchedulerForTests;

export function buildPhotonUrl(query: string): URL {
  const url = new URL(`https://${PHOTON_HOST}/api/`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(GEOCODE_MAX_RESULTS));
  url.searchParams.set("lang", "en");
  if (url.hostname !== PHOTON_HOST) throw new ValidationError("geocoder host mismatch");
  return url;
}

/** Reads and parses a JSON response without buffering more than the byte cap. */
export async function readBoundedJsonBody(
  response: Response,
  maximumBytes: number
): Promise<unknown> {
  const contentType = (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json" && contentType !== "application/geo+json") {
    throw new ValidationError("geocoder response content type is not JSON");
  }
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null) {
    const declaredLength = Number(lengthHeader);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > maximumBytes
    ) {
      throw new ValidationError("geocoder response exceeds the byte cap");
    }
  }
  if (!response.body) throw new ValidationError("geocoder response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new ValidationError("geocoder response exceeds the byte cap");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ValidationError("geocoder response is not valid UTF-8 JSON");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 &&
    trimmed.length <= 200 &&
    !CONTROL_CHAR_RE.test(trimmed)
    ? trimmed
    : undefined;
}

/**
 * Photon documents `extent` as upper-left then lower-right rather than a
 * GeoJSON bbox. Normalizing each axis by min/max makes the public contract
 * unambiguous; the canonical bounding-box validator rejects malformed or
 * degenerate extents.
 */
function photonExtent(
  value: unknown,
  representativeLon: number,
  representativeLat: number
): BoundingBox | null {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every((item) => typeof item === "number" && Number.isFinite(item))
  ) return null;
  const [firstLon, firstLat, secondLon, secondLat] = value as number[];
  // The public BoundingBox contract does not represent antimeridian wrapping.
  // Photon documents the first longitude as west and the second as east, so a
  // reversed pair must be dropped instead of min/max-expanded across Earth.
  if (firstLon > secondLon) return null;
  const boundingBox: BoundingBox = {
    west: Math.min(firstLon, secondLon),
    south: Math.min(firstLat, secondLat),
    east: Math.max(firstLon, secondLon),
    north: Math.max(firstLat, secondLat),
  };
  try {
    validateBoundingBox(boundingBox);
    // `extent` and the representative Point are both untrusted provider data.
    // Never let a mismatched extent frame a different region from the point
    // used by the analysis pipeline.
    if (
      representativeLon < boundingBox.west ||
      representativeLon > boundingBox.east ||
      representativeLat < boundingBox.south ||
      representativeLat > boundingBox.north
    ) return null;
    return boundingBox;
  } catch {
    return null;
  }
}

function photonAdminContext(properties: Record<string, unknown>): GeocodeAdminContext {
  const values: GeocodeAdminContext = {
    locality: optionalTrimmedString(properties.locality),
    city: optionalTrimmedString(properties.city),
    district: optionalTrimmedString(properties.district),
    county: optionalTrimmedString(properties.county),
    state: optionalTrimmedString(properties.state),
    country: optionalTrimmedString(properties.country),
    countryCode: /^[A-Za-z]{2}$/u.test(
      optionalTrimmedString(properties.countrycode) ?? ""
    )
      ? (properties.countrycode as string).trim().toUpperCase()
      : undefined,
  };
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [keyof GeocodeAdminContext, string] =>
      entry[1] !== undefined
    )
  );
}

/**
 * Parses a Photon GeoJSON response into bounded, validated results.
 * Throws ValidationError on structural problems; skips malformed features.
 */
export function parsePhotonResponse(body: unknown): GeocodeResult[] {
  if (!isRecord(body) || body.type !== "FeatureCollection" || !Array.isArray(body.features)) {
    throw new ValidationError("geocoder response is not a FeatureCollection");
  }
  const results: GeocodeResult[] = [];
  for (const feature of body.features) {
    if (results.length >= GEOCODE_MAX_RESULTS) break;
    if (!isRecord(feature) || feature.type !== "Feature") continue;
    const geometry = feature.geometry;
    const properties = feature.properties;
    if (
      !isRecord(geometry) ||
      geometry.type !== "Point" ||
      !Array.isArray(geometry.coordinates) ||
      typeof geometry.coordinates[0] !== "number" ||
      typeof geometry.coordinates[1] !== "number" ||
      !isRecord(properties)
    ) {
      continue;
    }
    const lon = geometry.coordinates[0];
    const lat = geometry.coordinates[1];
    if (
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      lon < -180 ||
      lon > 180 ||
      lat < -90 ||
      lat > 90
    ) continue;
    const name = optionalTrimmedString(properties.name) ?? "";
    if (name.length === 0) continue;
    const featureType = (optionalTrimmedString(properties.type) ?? "")
      .replaceAll("_", " ");
    const primaryLabel = featureType.length > 0 ? `${name} (${featureType})` : name;
    const context = [properties.city, properties.district, properties.county]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .map((part) => part.trim())
      .filter((part) => part.toLocaleLowerCase("en-US") !== name.toLocaleLowerCase("en-US"));
    const parts = [primaryLabel, ...context, properties.state, properties.country]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .map((part) => part.trim());
    const deduped = [...new Set(parts)];
    if (deduped.length === 0) continue;
    const label = deduped.join(", ");
    if (label.length > 200 || CONTROL_CHAR_RE.test(label)) continue;
    const osmType = (optionalTrimmedString(properties.osm_type) ?? "")
      .toLocaleLowerCase("en-US");
    const osmId = properties.osm_id;
    const id = /^[nwr]$/u.test(osmType) &&
      typeof osmId === "number" &&
      Number.isSafeInteger(osmId) &&
      osmId >= 0
      ? `osm-${osmType}-${osmId}`
      : undefined;
    results.push({
      ...(id ? { id } : {}),
      label,
      lon,
      lat,
      boundingBox: photonExtent(properties.extent, lon, lat),
      adminContext: photonAdminContext(properties),
    });
  }
  return results;
}
