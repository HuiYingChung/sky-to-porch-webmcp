import type { BoundingBox } from "@/contracts/common";
import {
  parseWildfireLayerEnvelope,
  type WildfireLayerEnvelope,
} from "@/contracts/wildfire-layer";

const CACHE_TTL_MS = 2 * 60_000;

interface CacheEntry {
  storedAt: number;
  envelope: WildfireLayerEnvelope;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<WildfireLayerEnvelope>>();

function cacheKey(date: string, area: BoundingBox): string {
  return [date, area.west, area.south, area.east, area.north].join(",");
}

function requestUrl(date: string, area: BoundingBox): string {
  const params = new URLSearchParams({
    date,
    west: String(area.west),
    south: String(area.south),
    east: String(area.east),
    north: String(area.north),
  });
  return `/api/map/wildfire?${params.toString()}`;
}

export async function loadWildfireLayer(
  date: string,
  area: BoundingBox,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  nowMs: () => number = Date.now
): Promise<WildfireLayerEnvelope> {
  const key = cacheKey(date, area);
  const cached = cache.get(key);
  if (cached && nowMs() - cached.storedAt <= CACHE_TTL_MS) return cached.envelope;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const response = await fetchImpl(requestUrl(date, area), {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { ok: false, error: "source_failure" } as const;
      }
      const envelope = parseWildfireLayerEnvelope(payload);
      if (!envelope) return { ok: false, error: "schema_validation" } as const;
      if (envelope.ok && (
        envelope.result.requestArea.west !== area.west ||
        envelope.result.requestArea.south !== area.south ||
        envelope.result.requestArea.east !== area.east ||
        envelope.result.requestArea.north !== area.north
      )) return { ok: false, error: "schema_validation" } as const;
      if (envelope.ok) cache.set(key, { storedAt: nowMs(), envelope });
      return envelope;
    } catch {
      return { ok: false, error: "source_failure" } as const;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, request);
  return request;
}

export function clearWildfireLayerClientCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
