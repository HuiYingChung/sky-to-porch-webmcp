/**
 * src/__tests__/unit/uxfix02-custom-area.test.ts
 *
 * UXFIX-02 (ADR-0022) — map-selected query areas.
 *
 * Covers: query-area validation, fire adapter custom-area gating, flood
 * custom-area retrieval with per-day GIBS observations and bounded USGS gage
 * discovery, and heat custom-area satellite-only retrieval with the derived
 * Web-Mercator tile address. All upstream responses are mocked; no network.
 */

import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import {
  CUSTOM_AREA_PLACE_ID,
  QUERY_AREA_MAX_SPAN_DEG,
  validateQueryArea,
  areaContainsCoordinate,
  areasIntersect,
} from "@/lib/location/query-area";
import { queryLiveFireEvidence } from "@/lib/fire/live-adapter";
import { queryLiveFloodEvidence } from "@/lib/flood/live-adapter";
import { queryLiveHeatEvidence } from "@/lib/heat/live-adapter";

const NOW = new Date("2024-07-10T12:00:00Z");

// ---------------------------------------------------------------------------
// validateQueryArea
// ---------------------------------------------------------------------------

describe("validateQueryArea", () => {
  const valid = { west: -96, south: 29, east: -95, north: 30 };

  it("accepts a well-formed area and returns a plain box", () => {
    expect(validateQueryArea(valid)).toEqual(valid);
  });

  it.each([
    ["missing key", { west: -96, south: 29, east: -95 }],
    ["extra key", { ...valid, note: "x" }],
    ["non-numeric", { ...valid, west: "-96" }],
    ["reversed lon", { ...valid, west: -94 }],
    ["reversed lat", { ...valid, south: 31 }],
    ["outside wgs84", { ...valid, north: 91 }],
    ["span too wide", { ...valid, east: valid.west + QUERY_AREA_MAX_SPAN_DEG + 1 }],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(() => validateQueryArea(value)).toThrow();
  });

  it("areasIntersect detects overlap and separation", () => {
    expect(areasIntersect(valid, { west: -95.5, south: 29.5, east: -94, north: 31 })).toBe(true);
    expect(areasIntersect(valid, { west: 10, south: 10, east: 11, north: 11 })).toBe(false);
  });

  it("areaContainsCoordinate uses the real source coordinate and inclusive edges", () => {
    expect(areaContainsCoordinate(valid, { lon: -95.5, lat: 29.5 })).toBe(true);
    expect(areaContainsCoordinate(valid, { lon: -96, lat: 29 })).toBe(true);
    expect(areaContainsCoordinate(valid, { lon: -111.17, lat: 32.24 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fire adapter gating
// ---------------------------------------------------------------------------

describe("fire live adapter custom-area gating", () => {
  it("rejects custom-area with an invalid area without fetching", async () => {
    const fetchMock = vi.fn();
    const result = await queryLiveFireEvidence(
      {
        placeId: CUSTOM_AREA_PLACE_ID,
        mode: "live",
        time: { kind: "latest", days: 1 },
        area: { west: 5, south: 5, east: 4, north: 6 },
      },
      { fetch: fetchMock as unknown as typeof fetch, nowIso: () => NOW.toISOString() }
    );
    expect(result.kind).toBe("unsupported_place");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects custom-area on the legacy regression path", async () => {
    const fetchMock = vi.fn();
    const result = await queryLiveFireEvidence(
      { placeId: CUSTOM_AREA_PLACE_ID, mode: "live", date: "2025-01-08" },
      { fetch: fetchMock as unknown as typeof fetch, nowIso: () => NOW.toISOString() }
    );
    expect(result.kind).toBe("unsupported_place");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still rejects unknown placeIds with the demo-place guidance", async () => {
    const fetchMock = vi.fn();
    const result = await queryLiveFireEvidence(
      { placeId: "demo-houston", mode: "live", time: { kind: "latest", days: 1 } },
      { fetch: fetchMock as unknown as typeof fetch, nowIso: () => NOW.toISOString() }
    );
    expect(result.kind).toBe("unsupported_place");
    expect(result.rejectionReason).toContain("a demo card");
  });
});

// ---------------------------------------------------------------------------
// Flood adapter — custom area with discovery
// ---------------------------------------------------------------------------

async function pngBuffer(size: number, alpha: number): Promise<Buffer> {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 20, g: 60, b: 200, alpha },
    },
  }).png().toBuffer();
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function discoveryBody() {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "USGS-11111111",
        geometry: { type: "Point", coordinates: [-95.6, 29.6] },
        properties: {
          agency_code: "USGS",
          monitoring_location_number: "11111111",
          monitoring_location_name: "Far Bayou at Testville",
        },
      },
      {
        type: "Feature",
        id: "USGS-22222222",
        geometry: { type: "Point", coordinates: [-95.51, 29.51] },
        properties: {
          agency_code: "USGS",
          monitoring_location_number: "22222222",
          monitoring_location_name: "Near Creek at Demo City",
        },
      },
    ],
  };
}

function continuousBody(siteId: string, values: number[]) {
  return {
    type: "FeatureCollection",
    numberReturned: values.length,
    features: values.map((value, index) => ({
      type: "Feature",
      id: `rec-${siteId}-${index}`,
      properties: {
        monitoring_location_id: `USGS-${siteId}`,
        parameter_code: "00065",
        unit_of_measure: "ft",
        time: `2024-07-08T0${index}:00:00Z`,
        time_series_id: `ts-${siteId}`,
        value,
      },
    })),
  };
}

const CUSTOM_FLOOD_INPUT = {
  placeId: CUSTOM_AREA_PLACE_ID,
  startDate: "2024-07-07",
  endDate: "2024-07-08",
  mode: "live" as const,
  area: { west: -96, south: 29, east: -95, north: 30 },
};

describe("flood live adapter custom-area", () => {
  it("returns per-day GIBS observations plus the nearest discovered gage with data", async () => {
    const opaque = await pngBuffer(512, 1);
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("wms.cgi")) {
        return new Response(new Uint8Array(opaque), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      if (url.includes("monitoring-locations/items?")) return jsonResponse(discoveryBody());
      if (url.includes("collections/continuous/items")) {
        // Nearest site (22222222) has no data; the next one (11111111) does.
        if (url.includes("USGS-22222222")) return jsonResponse(continuousBody("22222222", []));
        return jsonResponse(continuousBody("11111111", [3.4, 3.6]));
      }
      throw new Error(`unexpected URL in test: ${url}`);
    });

    const result = await queryLiveFloodEvidence(CUSTOM_FLOOD_INPUT, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => NOW,
    });

    expect(result.kind).toBe("success");
    const observations = result.evidence?.observations ?? [];
    // Two IMERG days + one VIIRS flood-extent visualization + one gage observation.
    expect(observations).toHaveLength(4);
    expect(observations[0].observationId).toBe("obs-gibs-imerg-custom-area-2024-07-07");
    expect(observations[1].observationId).toBe("obs-gibs-imerg-custom-area-2024-07-08");
    expect(observations[2].provenance.sourceId).toBe("nasa_lance_flood_extent");
    const gage = observations[3];
    expect(gage.metadata?.siteId).toBe("11111111");
    expect(gage.metadata?.siteSelectionBasis).toBe("bbox_discovery_nearest");
    // The GIBS request carried the custom bbox, not the Houston box.
    const gibsCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("IMERG_Precipitation_Rate")
    );
    expect(String(gibsCall?.[0])).toContain("BBOX=-96%2C29%2C-95%2C30");
    expect(result.evidence?.evidenceId).toBe("evd-flood-custom-area-live-2024-07-07-2024-07-08");
  });

  it("is inconclusive with the no-gage limitation when the area has no gage data", async () => {
    const opaque = await pngBuffer(512, 1);
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("wms.cgi")) {
        return new Response(new Uint8Array(opaque), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      if (url.includes("monitoring-locations/items?")) {
        return jsonResponse({ type: "FeatureCollection", features: [] });
      }
      throw new Error(`unexpected URL in test: ${url}`);
    });

    const result = await queryLiveFloodEvidence(CUSTOM_FLOOD_INPUT, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => NOW,
    });

    expect(result.kind).toBe("inconclusive_evidence");
    const limitationIds = (result.evidence?.limitations ?? []).map((l) => l.limitationId);
    expect(limitationIds).toContain("lim-uxfix02-live-no-gage-in-area");
  });

  it("does not treat a discovery result outside the requested bbox as an in-area gage", async () => {
    const opaque = await pngBuffer(512, 1);
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("wms.cgi")) {
        return new Response(new Uint8Array(opaque), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      if (url.includes("monitoring-locations/items?")) {
        return jsonResponse({
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            geometry: { type: "Point", coordinates: [-120, 40] },
            properties: {
              agency_code: "USGS",
              monitoring_location_number: "33333333",
              monitoring_location_name: "Out-of-area gage",
            },
          }],
        });
      }
      throw new Error(`unexpected URL in test: ${url}`);
    });

    const result = await queryLiveFloodEvidence(CUSTOM_FLOOD_INPUT, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => NOW,
    });
    expect(result.kind).toBe("inconclusive_evidence");
    expect(fetchMock.mock.calls.some((call) =>
      String(call[0]).includes("collections/continuous/items")
    )).toBe(false);
  });

  it("keeps unsupported_coverage when every requested day is transparent", async () => {
    const transparent = await pngBuffer(512, 0);
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("wms.cgi")) {
        return new Response(new Uint8Array(transparent), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      if (url.includes("monitoring-locations/items?")) {
        return jsonResponse({ type: "FeatureCollection", features: [] });
      }
      throw new Error(`unexpected URL in test: ${url}`);
    });

    const result = await queryLiveFloodEvidence(CUSTOM_FLOOD_INPUT, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => NOW,
    });
    expect(result.kind).toBe("unsupported_coverage");
  });

  it("rejects custom-area with an invalid area before any fetch", async () => {
    const fetchMock = vi.fn();
    const result = await queryLiveFloodEvidence(
      { ...CUSTOM_FLOOD_INPUT, area: { west: 0, south: 0, east: 40, north: 1 } },
      { fetchImpl: fetchMock as unknown as typeof fetch, now: () => NOW }
    );
    expect(result.kind).toBe("unsupported_place");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Heat adapter — custom area, satellite-only
// ---------------------------------------------------------------------------

describe("heat live adapter custom-area", () => {
  // Area centered on the Tucson demonstration coordinate: the derived tile
  // must equal the pinned demonstration tile (7/51/24).
  const TUCSON_LIKE_AREA = { west: -111.27, south: 32.14, east: -111.07, north: 32.34 };
  const PHOENIX_AREA = { west: -112.2, south: 33.3, east: -111.9, north: 33.6 };

  function heatCsv(): string {
    const header = "DATE_TIME,DRY_BULB_TEMPERATURE_C,HEAT_INDEX_C,RELATIVE_HUMIDITY";
    const rows = Array.from({ length: 24 }, (_, hour) =>
      `20240708${String(hour).padStart(2, "0")},${35 + hour / 10},${34 + hour / 10},20`
    );
    return [header, ...rows].join("\n");
  }

  it("uses the actual Tucson station when its coordinate is inside the selected area", async () => {
    const opaque = await pngBuffer(256, 1);
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/wmts/epsg3857/best/")) {
        return new Response(new Uint8Array(opaque), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      if (url.includes("ncei.noaa.gov")) {
        return new Response(heatCsv(), {
          status: 200,
          headers: { "content-type": "text/csv" },
        });
      }
      throw new Error(`unexpected URL in test: ${url}`);
    });

    const result = await queryLiveHeatEvidence(
      {
        placeId: CUSTOM_AREA_PLACE_ID,
        date: "2024-07-08",
        mode: "live",
        area: TUCSON_LIKE_AREA,
      },
      { fetchImpl: fetchMock as unknown as typeof fetch, now: () => NOW }
    );

    // The near-Tucson custom area derives the pinned demonstration tile.
    expect(urls.some((url) => url.endsWith("/7/51/24.png"))).toBe(true);
    expect(urls.some((url) => url.includes("ncei.noaa.gov"))).toBe(true);

    expect(result.kind).toBe("success");
    const observations = result.evidence?.observations ?? [];
    expect(observations).toHaveLength(3);
    expect(observations[0].observationId).toBe("obs-gibs-modis-lst-custom-area-20240708");
    const limitationIds = (result.evidence?.limitations ?? []).map((l) => l.limitationId);
    expect(limitationIds).toContain("lim-wp09-live-uscrn-station");
    expect(limitationIds).not.toContain("lim-uxfix02-heat-no-station-in-area");
    expect(result.evidence?.missionAttributions[0]?.selectionReason).toContain(
      "selected area center"
    );
  });

  it("never borrows Tucson readings for a real area that does not contain the station", async () => {
    const opaque = await pngBuffer(256, 1);
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/wmts/epsg3857/best/")) {
        return new Response(new Uint8Array(opaque), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      // ADR-0038: a recent date consults NWS; this gridpoint has no station.
      if (url.includes("api.weather.gov/points/")) {
        return new Response(
          JSON.stringify({
            properties: { observationStations: "https://api.weather.gov/gridpoints/PSR/1,1/stations" },
          }),
          { status: 200, headers: { "content-type": "application/geo+json" } }
        );
      }
      if (url.includes("api.weather.gov/gridpoints/")) {
        return new Response(JSON.stringify({ features: [] }), {
          status: 200,
          headers: { "content-type": "application/geo+json" },
        });
      }
      throw new Error(`unexpected URL in test: ${url}`);
    });

    const result = await queryLiveHeatEvidence({
      placeId: CUSTOM_AREA_PLACE_ID,
      date: "2024-07-08",
      mode: "live",
      area: PHOENIX_AREA,
    }, { fetchImpl: fetchMock as unknown as typeof fetch, now: () => NOW });

    expect(urls.every((url) => !url.includes("ncei.noaa.gov"))).toBe(true);
    expect(result.kind).toBe("inconclusive_evidence");
    expect(result.evidence?.observations).toHaveLength(1);
    const limitationIds = (result.evidence?.limitations ?? []).map((l) => l.limitationId);
    expect(limitationIds).toContain("lim-uxfix02-heat-no-station-in-area");
  });

  it("returns unsupported_coverage for a transparent custom-area tile", async () => {
    const transparent = await pngBuffer(256, 0);
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = String(input);
      return url.includes("ncei.noaa.gov")
        ? new Response(heatCsv(), { status: 200, headers: { "content-type": "text/csv" } })
        : new Response(new Uint8Array(transparent), {
            status: 200,
            headers: { "content-type": "image/png" },
          });
    });
    const result = await queryLiveHeatEvidence(
      {
        placeId: CUSTOM_AREA_PLACE_ID,
        date: "2024-07-08",
        mode: "live",
        area: TUCSON_LIKE_AREA,
      },
      { fetchImpl: fetchMock as unknown as typeof fetch, now: () => NOW }
    );
    expect(result.kind).toBe("unsupported_coverage");
  });

  it("rejects custom-area with an invalid area before any fetch", async () => {
    const fetchMock = vi.fn();
    const result = await queryLiveHeatEvidence(
      {
        placeId: CUSTOM_AREA_PLACE_ID,
        date: "2024-07-08",
        mode: "live",
        area: { west: 1, south: 1, east: 0, north: 2 },
      },
      { fetchImpl: fetchMock as unknown as typeof fetch, now: () => NOW }
    );
    expect(result.kind).toBe("unsupported_place");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps coordinate-selected station limitations truthful on source failure", async () => {
    const result = await queryLiveHeatEvidence(
      {
        placeId: CUSTOM_AREA_PLACE_ID,
        date: "2024-07-08",
        mode: "live",
        area: TUCSON_LIKE_AREA,
      },
      {
        fetchImpl: vi.fn(async () => new Response("not a png", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })) as unknown as typeof fetch,
        now: () => NOW,
      }
    );
    expect(result.kind).toBe("source_failure");
    const limitationIds = (result.evidence?.limitations ?? []).map((l) => l.limitationId);
    expect(limitationIds).toContain("lim-wp09-live-uscrn-station");
    expect(limitationIds).not.toContain("lim-uxfix02-heat-no-station-in-area");
    expect(result.evidence?.missionAttributions[0]?.selectionReason).toContain(
      "selected area center"
    );
  });
});

// ---------------------------------------------------------------------------
// UXFIX-02: plain-summary guardrails
// ---------------------------------------------------------------------------

import {
  validatePlainSummaryText,
  deterministicPlainSummary,
} from "@/lib/ai/evidence-explainer";
import type { EvidenceEvaluationResult } from "@/lib/evidence/evaluator";

describe("plain-summary guardrails", () => {
  const context = JSON.stringify({ value: 3.4, date: "2024-07-08" });

  it("accepts a bounded, claim-free summary whose numbers exist in context", () => {
    const text =
      "Rain was seen over this area on 2024-07-08, and a nearby river gage read 3.4 feet. These are regional, historical records.";
    expect(validatePlainSummaryText(text, context)).toBe(text);
  });

  it.each([
    ["too short", "Too short."],
    ["forbidden safety claim", "It is completely safe to go outside today because the data says so, without any doubt at all."],
    ["evacuation advice", "You should evacuate immediately because the rain data for 2024-07-08 looks very heavy in this region."],
    ["property claim", "Your home is likely flooded based on the satellite imagery captured over the region on 2024-07-08 today."],
    ["invented number", "The river gage read 99.9 feet on 2024-07-08, which is a historical observation from official sources."],
    ["numeric substring", "The river gage read 20 feet on 2024-07-08, which is a historical observation from official sources."],
    ["url", "See https://example.com for more details about the observations recorded across the region on 2024-07-08."],
  ])("rejects %s", (_label, text) => {
    expect(() => validatePlainSummaryText(text, context)).toThrow();
  });

  it("deterministic summary is plain, state-aware, and inside the contract bound", () => {
    const evidence = {
      evidenceState: "source_failure",
      observations: [],
    } as unknown as EvidenceEvaluationResult["evidence"];
    const summary = deterministicPlainSummary(
      { evidence, conflicts: [], inferenceAllowed: false },
      "home"
    );
    expect(summary).toContain("could not be reached");
    expect(summary.length).toBeLessThanOrEqual(700);
  });
});

// ---------------------------------------------------------------------------
// UXFIX-02: FIRMS global fire adapter (key-gated)
// ---------------------------------------------------------------------------

import {
  FIRMS_MAX_RANGE_DAYS,
  queryFirmsEvidence,
  parseFirmsCsv,
} from "@/lib/fire/firms-adapter";

describe("FIRMS global fire adapter", () => {
  const TAIPEI_AREA = { west: 121.3, south: 24.8, east: 121.8, north: 25.3 };
  const CSV =
    "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n" +
    "25.05,121.55,330.1,0.5,0.5,2024-07-08,0512,N,VIIRS,n,2,290.1,4.2,D\n" +
    "25.06,121.56,331.0,0.5,0.5,2024-07-09,0512,N,VIIRS,n,2,291.0,5.0,D\n";

  it("reports source failure without a MAP_KEY and never mislabels the place", async () => {
    const fetchMock = vi.fn();
    const result = await queryFirmsEvidence(TAIPEI_AREA, "2024-07-08", "2024-07-09", {
      fetch: fetchMock as unknown as typeof fetch,
      nowIso: () => NOW.toISOString(),
      mapKey: "",
    });
    expect(result.kind).toBe("source_failure");
    expect(result.rejectionReason).toContain("server credential not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns validated evidence with the key redacted from provenance", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(CSV, { status: 200, headers: { "content-type": "text/csv" } })
    );
    const result = await queryFirmsEvidence(TAIPEI_AREA, "2024-07-08", "2024-07-09", {
      fetch: fetchMock as unknown as typeof fetch,
      nowIso: () => NOW.toISOString(),
      mapKey: "secret-map-key-123",
    });
    expect(result.kind).toBe("success");
    const observation = result.evidence?.observations[0];
    expect(observation?.value).toBe(2);
    // The real key reaches the upstream URL…
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("secret-map-key-123");
    // …but is redacted everywhere in the stored evidence.
    expect(JSON.stringify(result.evidence)).not.toContain("secret-map-key-123");
    expect(observation?.provenance.sourceUrl).toContain("/MAP_KEY/");
  });

  it("zero detections is an explicit no_observation, not safety", async () => {
    const header = CSV.split("\n")[0];
    const fetchMock = vi.fn(async () =>
      new Response(`${header}\n`, { status: 200, headers: { "content-type": "text/csv" } })
    );
    const result = await queryFirmsEvidence(TAIPEI_AREA, "2024-07-08", "2024-07-08", {
      fetch: fetchMock as unknown as typeof fetch,
      nowIso: () => NOW.toISOString(),
      mapKey: "k",
    });
    expect(result.kind).toBe("no_observation");
    expect(result.evidence?.observations[0]?.qualifiers).toContain("no_detection_is_not_no_fire");
  });

  it("fails closed on a malformed CSV", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("not,a,firms,header\n1,2,3,4\n", { status: 200, headers: { "content-type": "text/csv" } })
    );
    const result = await queryFirmsEvidence(TAIPEI_AREA, "2024-07-08", "2024-07-08", {
      fetch: fetchMock as unknown as typeof fetch,
      nowIso: () => NOW.toISOString(),
      mapKey: "k",
    });
    expect(result.kind).toBe("source_failure");
    expect(result.temporalCoverage?.days[0]?.fireStatus).toBe("failed");
  });

  it("parseFirmsCsv validates dates and coordinates inside the requested area", () => {
    const parsed = parseFirmsCsv(CSV, "2024-07-08", "2024-07-09", TAIPEI_AREA);
    expect(parsed.total).toBe(2);
    expect(parsed.perDate.get("2024-07-08")).toBe(1);
  });

  it("rejects FIRMS rows outside the requested date window or area", () => {
    expect(() => parseFirmsCsv(CSV, "2024-07-08", "2024-07-08", TAIPEI_AREA)).toThrow();
    const outsideArea = CSV.replace("25.05,121.55", "40.00,121.55");
    expect(() =>
      parseFirmsCsv(outsideArea, "2024-07-08", "2024-07-09", TAIPEI_AREA)
    ).toThrow();
  });

  it("enforces the official five-day Area API limit before fetching", async () => {
    const fetchMock = vi.fn();
    const result = await queryFirmsEvidence(TAIPEI_AREA, "2024-07-01", "2024-07-06", {
      fetch: fetchMock as unknown as typeof fetch,
      nowIso: () => NOW.toISOString(),
      mapKey: "k",
    });
    expect(FIRMS_MAX_RANGE_DAYS).toBe(5);
    expect(result.kind).toBe("unsupported_date");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on a wrong content type or declared oversize body", async () => {
    for (const response of [
      new Response(CSV, { status: 200, headers: { "content-type": "text/html" } }),
      new Response(CSV, {
        status: 200,
        headers: { "content-type": "text/csv", "content-length": String(8 * 1024 * 1024 + 1) },
      }),
    ]) {
      const result = await queryFirmsEvidence(TAIPEI_AREA, "2024-07-08", "2024-07-09", {
        fetch: vi.fn(async () => response) as unknown as typeof fetch,
        nowIso: () => NOW.toISOString(),
        mapKey: "k",
      });
      expect(result.kind).toBe("source_failure");
    }
  });
});

// ---------------------------------------------------------------------------
// UXFIX-02: geocoder parsing
// ---------------------------------------------------------------------------

import { parsePhotonResponse, readBoundedJsonBody } from "@/lib/location/geocode";

describe("Photon geocode parsing", () => {
  it("parses valid features and skips malformed ones", () => {
    const results = parsePhotonResponse({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [121.56, 25.03] },
          properties: { name: "Taipei", country: "Taiwan" },
        },
        { type: "Feature", geometry: { type: "Point", coordinates: ["x", 1] }, properties: {} },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [200, 95] },
          properties: { name: "OutOfRange" },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [Number.NaN, 25] },
          properties: { name: "NonFinite" },
        },
      ],
    });
    expect(results).toEqual([{ label: "Taipei, Taiwan", lon: 121.56, lat: 25.03 }]);
  });

  it("keeps stable OSM identities and distinguishes a city from a same-name county", () => {
    const results = parsePhotonResponse({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            osm_type: "R",
            osm_id: 2688911,
            type: "city",
            name: "Houston",
            county: "Harris",
            state: "Texas",
            country: "United States",
          },
          geometry: { type: "Point", coordinates: [-95.3676974, 29.7589382] },
        },
        {
          type: "Feature",
          properties: {
            osm_type: "R",
            osm_id: 1840945,
            type: "county",
            name: "Houston",
            state: "Texas",
            country: "United States",
          },
          geometry: { type: "Point", coordinates: [-95.390805, 31.3378465] },
        },
      ],
    });

    expect(results).toEqual([
      {
        id: "osm-r-2688911",
        label: "Houston (city), Harris, Texas, United States",
        lon: -95.3676974,
        lat: 29.7589382,
      },
      {
        id: "osm-r-1840945",
        label: "Houston (county), Texas, United States",
        lon: -95.390805,
        lat: 31.3378465,
      },
    ]);
  });

  it("throws on a non-FeatureCollection body", () => {
    expect(() => parsePhotonResponse({ nope: true })).toThrow();
  });

  it("reads valid JSON within the byte cap", async () => {
    const body = JSON.stringify({ type: "FeatureCollection", features: [] });
    await expect(readBoundedJsonBody(
      new Response(body, { headers: { "content-type": "application/json; charset=utf-8" } }),
      1024
    )).resolves.toEqual({ type: "FeatureCollection", features: [] });
  });

  it("rejects JSON that exceeds the streamed byte cap or has the wrong content type", async () => {
    await expect(readBoundedJsonBody(
      new Response(JSON.stringify({ value: "too large" }), {
        headers: { "content-type": "application/json" },
      }),
      5
    )).rejects.toThrow();
    await expect(readBoundedJsonBody(
      new Response("{}", { headers: { "content-type": "text/html" } }),
      1024
    )).rejects.toThrow();
  });
});
