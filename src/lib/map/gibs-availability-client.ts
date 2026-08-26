/**
 * ADR-0040 (Bug E): browser client for the GIBS availability probe. One
 * bounded internal request per (product, date, area); concurrent duplicates
 * coalesce. Failure resolves to "unknown" — the layer card then relies on
 * the tile-level status alone and never fabricates a no-imagery claim.
 */

import type { BoundingBox } from "@/contracts/common";
import type { GibsAvailabilityProduct } from "./gibs-availability";

export type GibsAvailabilityEnvelope =
  | { ok: true; available: boolean }
  | { ok: false };

const inFlight = new Map<string, Promise<GibsAvailabilityEnvelope>>();
const cache = new Map<string, GibsAvailabilityEnvelope>();
const CACHE_MAX_ENTRIES = 24;

function requestKey(product: GibsAvailabilityProduct, date: string, area: BoundingBox): string {
  return `${product}|${date}|${area.west},${area.south},${area.east},${area.north}`;
}

export async function loadGibsAvailability(
  product: GibsAvailabilityProduct,
  date: string,
  area: BoundingBox
): Promise<GibsAvailabilityEnvelope> {
  const key = requestKey(product, date, area);
  const cached = cache.get(key);
  if (cached) return cached;
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
      const response = await fetch(`/api/map/gibs-availability?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) return { ok: false };
      const body = (await response.json()) as {
        ok?: boolean;
        result?: { available?: boolean };
      };
      if (body.ok !== true || typeof body.result?.available !== "boolean") {
        return { ok: false };
      }
      const envelope: GibsAvailabilityEnvelope = { ok: true, available: body.result.available };
      if (cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next().value as string | undefined;
        if (oldest) cache.delete(oldest);
      }
      cache.set(key, envelope);
      return envelope;
    } catch {
      return { ok: false };
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}
