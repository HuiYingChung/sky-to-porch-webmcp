/**
 * ADR-0040 (Bug E): browser client for the GIBS availability probe. One
 * bounded internal request per (product, date, area); concurrent duplicates
 * coalesce and successful checks have a bounded TTL. Failures stay explicit,
 * and an all-transparent check means only that no visible pixels were found.
 */

import type { BoundingBox } from "@/contracts/common";
import type { GibsAvailabilityProduct } from "./gibs-availability";

export type GibsAvailabilityEnvelope =
  | { ok: true; visiblePixelsDetected: boolean }
  | { ok: false; error: "source_failure" };

export const GIBS_AVAILABILITY_CLIENT_CACHE_TTL_MS = 5 * 60_000;

const inFlight = new Map<string, Promise<GibsAvailabilityEnvelope>>();
const cache = new Map<string, {
  storedAt: number;
  envelope: GibsAvailabilityEnvelope;
}>();
const CACHE_MAX_ENTRIES = 24;

function requestKey(product: GibsAvailabilityProduct, date: string, area: BoundingBox): string {
  return `${product}|${date}|${area.west},${area.south},${area.east},${area.north}`;
}

export async function loadGibsAvailability(
  product: GibsAvailabilityProduct,
  date: string,
  area: BoundingBox,
  fetchImpl: typeof fetch = fetch,
  nowMs: () => number = Date.now
): Promise<GibsAvailabilityEnvelope> {
  const key = requestKey(product, date, area);
  const cached = cache.get(key);
  if (
    cached &&
    nowMs() - cached.storedAt <= GIBS_AVAILABILITY_CLIENT_CACHE_TTL_MS
  ) return cached.envelope;
  if (cached) cache.delete(key);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = (async (): Promise<GibsAvailabilityEnvelope> => {
    try {
      const params = new URLSearchParams({
        product,
        date,
        west: String(area.west),
        south: String(area.south),
        east: String(area.east),
        north: String(area.north),
      });
      const response = await fetchImpl(`/api/map/gibs-availability?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) return { ok: false, error: "source_failure" };
      const body = (await response.json()) as {
        ok?: boolean;
        result?: { visiblePixelsDetected?: boolean };
      };
      if (
        body.ok !== true ||
        typeof body.result?.visiblePixelsDetected !== "boolean"
      ) {
        return { ok: false, error: "source_failure" };
      }
      const envelope: GibsAvailabilityEnvelope = {
        ok: true,
        visiblePixelsDetected: body.result.visiblePixelsDetected,
      };
      if (cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next().value as string | undefined;
        if (oldest) cache.delete(oldest);
      }
      cache.set(key, { storedAt: nowMs(), envelope });
      return envelope;
    } catch {
      return { ok: false, error: "source_failure" };
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

export function clearGibsAvailabilityClientStateForTests(): void {
  cache.clear();
  inFlight.clear();
}
