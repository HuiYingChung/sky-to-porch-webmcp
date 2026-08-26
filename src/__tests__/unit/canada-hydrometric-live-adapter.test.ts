import { describe, expect, it, vi } from "vitest";
import { validateObservation } from "@/contracts/evidence";
import {
  CANADA_GEOMET_HOST,
  CANADA_HYDROMETRIC_COLLECTION,
  CANADA_HYDROMETRIC_MAX_FEATURES,
  buildCanadaHydrometricUrl,
  queryCanadaHydrometricDailyMean,
} from "@/lib/flood/canada-hydrometric-live-adapter";

const VANCOUVER_AREA = { west: -123.4, south: 49, east: -122.8, north: 49.5 };
const DATE = "2024-07-08";
const NOW = new Date("2026-08-26T16:00:00.000Z");

function feature(options: {
  stationNumber: string;
  stationName: string;
  coordinates: [number, number];
  level: number | null;
  discharge?: number | null;
  levelQualifier?: string | null;
}): Record<string, unknown> {
  const id = `${options.stationNumber}.${DATE}`;
  return {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: options.coordinates },
    properties: {
      IDENTIFIER: id,
      STATION_NAME: options.stationName,
      STATION_NUMBER: options.stationNumber,
      PROV_TERR_STATE_LOC: "BC",
      DATE,
      LEVEL: options.level,
      DISCHARGE: options.discharge ?? null,
      DISCHARGE_SYMBOL_EN: null,
      DISCHARGE_SYMBOL_FR: null,
      LEVEL_SYMBOL_EN: options.levelQualifier ?? null,
      LEVEL_SYMBOL_FR: null,
    },
  };
}

function collection(
  features: Record<string, unknown>[],
  options: { numberMatched?: number; links?: unknown[] } = {}
): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    numberMatched: options.numberMatched ?? features.length,
    numberReturned: features.length,
    links: options.links ?? [],
    features,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/geo+json" },
  });
}

describe("Canada GeoMet hydrometric daily-mean adapter", () => {
  it("builds one allowlisted, bounded bbox/date request", () => {
    const url = buildCanadaHydrometricUrl(VANCOUVER_AREA, DATE);
    expect(url.hostname).toBe(CANADA_GEOMET_HOST);
    expect(url.pathname).toBe(`/collections/${CANADA_HYDROMETRIC_COLLECTION}/items`);
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      bbox: "-123.4,49,-122.8,49.5",
      datetime: DATE,
      limit: String(CANADA_HYDROMETRIC_MAX_FEATURES),
      f: "json",
    });
  });

  it("selects the nearest valid in-area station and preserves source quality metadata", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(collection([
      feature({
        stationNumber: "08GA031",
        stationName: "CAPILANO RIVER AT CANYON",
        coordinates: [-123.11095, 49.35795],
        level: 0.539,
        discharge: 0.784,
      }),
      feature({
        stationNumber: "08MH032",
        stationName: "NORTH ARM FRASER RIVER AT VANCOUVER",
        coordinates: [-123.08864, 49.20536],
        level: 2.968,
        levelQualifier: "Estimated",
      }),
    ]))) as unknown as typeof fetch;

    const result = await queryCanadaHydrometricDailyMean(VANCOUVER_AREA, DATE, {
      fetchImpl,
      now: () => NOW,
    });

    expect(result.kind).toBe("observation");
    if (result.kind !== "observation") throw new Error("expected observation");
    expect(result.observation).toMatchObject({
      observationId: "obs-eccc-hydrometric-08MH032-2024-07-08",
      variableName: "Daily mean water level",
      value: 2.968,
      unit: "m",
      qualifiers: ["Estimated"],
      provenance: {
        sourceId: "canada_geomet",
        sourceRecordId: "08MH032.2024-07-08",
        retrievedAt: NOW.toISOString(),
        observedAt: "2024-07-08T00:00:00.000Z",
      },
      metadata: {
        stationNumber: "08MH032",
        stationSelectionBasis: "bbox_nearest_valid_level",
        collection: "hydrometric-daily-mean",
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(() => validateObservation(result.observation)).not.toThrow();
  });

  it("keeps a valid response with no numeric level as no observation", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(collection([
      feature({
        stationNumber: "08MH032",
        stationName: "NORTH ARM FRASER RIVER AT VANCOUVER",
        coordinates: [-123.08864, 49.20536],
        level: null,
        discharge: 250,
      }),
    ]))) as unknown as typeof fetch;

    await expect(queryCanadaHydrometricDailyMean(VANCOUVER_AREA, DATE, { fetchImpl }))
      .resolves.toEqual({ kind: "no_observation" });
  });

  it("does not request GeoMet for an area outside the coarse Canada request gate", async () => {
    const fetchImpl = vi.fn();
    await expect(queryCanadaHydrometricDailyMean(
      { west: -95.6, south: 29.5, east: -95.2, north: 30 },
      DATE,
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )).resolves.toEqual({ kind: "not_applicable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an invalid area before any source request", async () => {
    const fetchImpl = vi.fn();
    await expect(queryCanadaHydrometricDailyMean(
      { west: -123, south: 49, east: -124, north: 50 },
      DATE,
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )).resolves.toEqual({ kind: "source_failure", failureReason: "validation_failure" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed on an out-of-area station or an unbounded paginated response", async () => {
    const outOfAreaFetch = vi.fn(async () => jsonResponse(collection([
      feature({
        stationNumber: "08MH032",
        stationName: "NORTH ARM FRASER RIVER AT VANCOUVER",
        coordinates: [-124, 49.2],
        level: 2.968,
      }),
    ]))) as unknown as typeof fetch;
    const paginatedFetch = vi.fn(async () => jsonResponse(collection([], {
      numberMatched: CANADA_HYDROMETRIC_MAX_FEATURES + 1,
      links: [{ rel: "next", href: "https://api.weather.gc.ca/next" }],
    }))) as unknown as typeof fetch;

    await expect(queryCanadaHydrometricDailyMean(VANCOUVER_AREA, DATE, {
      fetchImpl: outOfAreaFetch,
    })).resolves.toMatchObject({ kind: "source_failure", failureReason: "schema_validation" });
    await expect(queryCanadaHydrometricDailyMean(VANCOUVER_AREA, DATE, {
      fetchImpl: paginatedFetch,
    })).resolves.toMatchObject({ kind: "source_failure", failureReason: "oversize" });
  });

  it("distinguishes a provider failure from no observation", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "unavailable" }, 503)) as unknown as typeof fetch;
    await expect(queryCanadaHydrometricDailyMean(VANCOUVER_AREA, DATE, { fetchImpl }))
      .resolves.toEqual({ kind: "source_failure", failureReason: "provider_failure" });
  });
});
