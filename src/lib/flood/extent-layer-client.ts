import type { BoundingBox } from "@/contracts/common";
import {
  parseFloodExtentLayerEnvelope,
  type FloodExtentLayerEnvelope,
} from "@/contracts/flood-extent-layer";

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 24;

interface CacheEntry {
  storedAt: number;
  envelope: FloodExtentLayerEnvelope;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<FloodExtentLayerEnvelope>>();

function requestKey(date: string, area: BoundingBox): string {
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
  return `/api/map/flood-extent?${params.toString()}`;
}

function areasMatch(left: BoundingBox, right: BoundingBox): boolean {
  return (
    left.west === right.west &&
    left.south === right.south &&
    left.east === right.east &&
    left.north === right.north
  );
}

function storeSuccess(key: string, entry: CacheEntry): void {
  while (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
  cache.set(key, entry);
}

export async function loadFloodExtentLayer(
  date: string,
  area: BoundingBox,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  nowMs: () => number = Date.now
): Promise<FloodExtentLayerEnvelope> {
  const key = requestKey(date, area);
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
      const envelope = parseFloodExtentLayerEnvelope(payload);
      if (!envelope) return { ok: false, error: "schema_validation" } as const;
      if (envelope.ok && (
        !areasMatch(envelope.result.requestArea, area) ||
        (envelope.result.observedDate !== null && envelope.result.observedDate !== date)
      )) return { ok: false, error: "schema_validation" } as const;
      if (envelope.ok) storeSuccess(key, { storedAt: nowMs(), envelope });
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

export function clearFloodExtentLayerClientCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
