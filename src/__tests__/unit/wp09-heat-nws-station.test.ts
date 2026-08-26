/**
 * ADR-0038: NWS station observations as recent-date metro ground evidence.
 *
 * A metro selection box (verified: no operational USCRN station inside) with
 * a recent date must return NWS station observations; older dates carry the
 * explicit retention limitation; USCRN-covered boxes never contact
 * api.weather.gov. Every transport is mocked; no network request is made.
 */

import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { validateEvidenceObject } from "@/contracts/evidence";
import { queryLiveHeatEvidence } from "@/lib/heat/live-adapter";
import { CUSTOM_AREA_PLACE_ID } from "@/lib/location/query-area";

const NOW = new Date("2026-08-19T12:00:00Z");
const RECENT_DATE = "2026-08-18";
// ADR-0039: 11 days old — too old for the NWS window, too recent for GHCNh.
const GAP_DATE = "2026-08-08";
// Downtown Phoenix 25 km box: no operational USCRN station inside (ADR-0037
// verified the nearest is 158 km away), two NWS stations inside.
const PHOENIX_AREA = { west: -112.34, south: 33.22, east: -111.81, north: 33.67 };
// Contains the operational USCRN Tucson station: NWS must never be contacted.
const TUCSON_AREA = { west: -111.27, south: 32.14, east: -111.07, north: 32.34 };

const CUSTOM_INPUT = { placeId: CUSTOM_AREA_PLACE_ID, mode: "live" as const };

const STATIONS_URL = "https://api.weather.gov/gridpoints/PSR/159,58/stations";

async function tile(alpha = 255): Promise<Buffer> {
  return sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 180, g: 90, b: 30, alpha: alpha / 255 },
    },
  }).png().toBuffer();
}

function uscrnCsv(rows = 24): string {
  const header = [
    "WBANNO", "DATE_TIME", "LONGITUDE", "LATITUDE",
    "RELATIVE_HUMIDITY", "DRY_BULB_TEMPERATURE_C", "HEAT_INDEX_C",
  ].join(",");
  const lines = Array.from({ length: rows }, (_, hour) => {
    const dateTime = `${RECENT_DATE.replaceAll("-", "")}${String(hour).padStart(2, "0")}`;
    return ["53131", dateTime, "-111.17", "32.24", 20, 30 + hour / 10, 28 + hour / 10].join(",");
  });
  return [header, ...lines].join("\n");
}

function pointsBody(): string {
  return JSON.stringify({ properties: { observationStations: STATIONS_URL } });
}

function stationsBody(): string {
  return JSON.stringify({
    features: [
      {
        properties: { stationIdentifier: "KPHX", name: "Phoenix Sky Harbor International Airport" },
        geometry: { coordinates: [-112.003465, 33.427799] },
      },
      {
        properties: { stationIdentifier: "KSDL", name: "Scottsdale Airport" },
        geometry: { coordinates: [-111.92316, 33.61235] },
      },
      {
        properties: { stationIdentifier: "KOUT", name: "Far Outside The Box" },
        geometry: { coordinates: [-113.5, 34.9] },
      },
    ],
  });
}

function observationsBody(options: {
  date?: string;
  hours?: number;
  heatIndex?: boolean;
  empty?: boolean;
} = {}): string {
  if (options.empty) return JSON.stringify({ features: [] });
  const date = options.date ?? RECENT_DATE;
  const hours = options.hours ?? 24;
  const features = Array.from({ length: hours }, (_, hour) => ({
    properties: {
      timestamp: `${date}T${String(hour).padStart(2, "0")}:55:00+00:00`,
      temperature: { unitCode: "wmoUnit:degC", value: 40 + hour / 10, qualityControl: "V" },
      relativeHumidity: { unitCode: "wmoUnit:percent", value: 20, qualityControl: "V" },
      heatIndex: options.heatIndex === false
        ? { unitCode: "wmoUnit:degC", value: null, qualityControl: "Z" }
        : { unitCode: "wmoUnit:degC", value: 41 + hour / 10, qualityControl: "V" },
    },
  }));
  return JSON.stringify({ features });
}

function geoJson(body: string, status = 200): Response {
  return new Response(status >= 400 ? "error" : body, {
    status,
    headers: { "content-type": "application/geo+json" },
  });
}

function mockFetch(
  png: Buffer,
  options: {
    observations?: (stationId: string) => Response;
    nwsStatus?: number;
  } = {}
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === "gibs.earthdata.nasa.gov") {
      return new Response(new Uint8Array(png), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    if (url.hostname === "www.ncei.noaa.gov") {
      return new Response(uscrnCsv(), {
        status: 200,
        headers: { "content-type": "text/csv" },
      });
    }
    if (url.hostname === "api.weather.gov") {
      if (options.nwsStatus) return geoJson("", options.nwsStatus);
      if (url.pathname.startsWith("/points/")) return geoJson(pointsBody());
      if (url.pathname.endsWith("/stations")) return geoJson(stationsBody());
      const match = url.pathname.match(/^\/stations\/([A-Z0-9]+)\/observations$/u);
      if (match) {
        return options.observations
          ? options.observations(match[1])
          : geoJson(observationsBody());
      }
    }
    throw new Error(`Unexpected URL: ${url.toString()}`);
  }) as unknown as typeof fetch;
}

function nwsUrls(fetchImpl: typeof fetch): string[] {
  return vi.mocked(fetchImpl).mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.includes("api.weather.gov"));
}

describe("ADR-0038 NWS recent-date metro ground evidence", () => {
  it("returns NWS station observations for a metro box with no USCRN station", async () => {
    const fetchImpl = mockFetch(await tile());
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, date: RECENT_DATE, area: PHOENIX_AREA },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("success");
    expect(result.evidence?.evidenceState).toBe("observations_returned");
    expect(result.evidence?.observations).toHaveLength(3);
    expect(result.evidence?.observations[1]).toMatchObject({
      variableName: "Hourly air temperature",
      unit: "degC",
      provenance: expect.objectContaining({ sourceId: "nws_station_observations" }),
      metadata: expect.objectContaining({
        stationId: "KPHX",
        stationName: "Phoenix Sky Harbor International Airport",
        distinctHourCount: 24,
      }),
    });
    expect(result.evidence?.observations[2]).toMatchObject({
      variableName: "Hourly heat index",
      value: 43.3,
    });
    const limitationIds = (result.evidence?.limitations ?? []).map((l) => l.limitationId);
    expect(limitationIds).toContain("lim-adr0038-nws-station");
    expect(limitationIds).not.toContain("lim-uxfix02-heat-no-station-in-area");
    // points → gridpoint stations → one station-day request.
    expect(nwsUrls(fetchImpl)).toHaveLength(3);
    validateEvidenceObject(result.evidence);
  });

  it("keeps the publication-gap limitation instead of contacting NWS for a gap-window date", async () => {
    const fetchImpl = mockFetch(await tile());
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, date: GAP_DATE, area: PHOENIX_AREA },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("inconclusive_evidence");
    expect(result.evidence?.observations).toHaveLength(1);
    const limitationIds = (result.evidence?.limitations ?? []).map((l) => l.limitationId);
    expect(limitationIds).toContain("lim-uxfix02-heat-no-station-in-area");
    expect(limitationIds).toContain("lim-adr0039-ground-publication-gap");
    expect(nwsUrls(fetchImpl)).toHaveLength(0);
  });

  it("never contacts NWS when an operational USCRN station is inside the box", async () => {
    const fetchImpl = mockFetch(await tile());
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, date: RECENT_DATE, area: TUCSON_AREA },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("success");
    expect(result.evidence?.observations[1].provenance.sourceId).toBe(
      "noaa_uscrn_heat_exposure"
    );
    expect(nwsUrls(fetchImpl)).toHaveLength(0);
  });

  it("fails closed without a satellite-only substitute when NWS transport fails", async () => {
    const fetchImpl = mockFetch(await tile(), { nwsStatus: 500 });
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, date: RECENT_DATE, area: PHOENIX_AREA },
      { fetchImpl, now: () => NOW }
    );

    expect(result).toMatchObject({
      kind: "source_failure",
      failureReason: "provider_failure",
      failureStage: "nws_transport",
    });
    expect(result.evidence?.observations).toEqual([]);
  });

  it("advances past an empty station day to the next in-box station", async () => {
    const fetchImpl = mockFetch(await tile(), {
      observations: (stationId) =>
        stationId === "KPHX"
          ? geoJson(observationsBody({ empty: true }))
          : geoJson(observationsBody()),
    });
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, date: RECENT_DATE, area: PHOENIX_AREA },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("success");
    expect(result.evidence?.observations[1].metadata?.stationId).toBe("KSDL");
    expect(nwsUrls(fetchImpl)).toHaveLength(4);
  });

  it("stays inconclusive with the no-usable-station limitation when every in-box station day is empty", async () => {
    const fetchImpl = mockFetch(await tile(), {
      observations: () => geoJson(observationsBody({ empty: true })),
    });
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, date: RECENT_DATE, area: PHOENIX_AREA },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("inconclusive_evidence");
    expect(result.evidence?.observations).toHaveLength(1);
    const limitationIds = (result.evidence?.limitations ?? []).map((l) => l.limitationId);
    expect(limitationIds).toContain("lim-adr0038-nws-no-usable-station");
    // Bounded: two attempts, the out-of-box station is never contacted.
    expect(nwsUrls(fetchImpl)).toHaveLength(4);
    expect(nwsUrls(fetchImpl).join(" ")).not.toContain("KOUT");
  });

  it("emits only the air-temperature observation when NWS computed no heat index", async () => {
    const fetchImpl = mockFetch(await tile(), {
      observations: () => geoJson(observationsBody({ heatIndex: false })),
    });
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, date: RECENT_DATE, area: PHOENIX_AREA },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("success");
    expect(result.evidence?.observations).toHaveLength(2);
    expect(result.evidence?.observations[1]).toMatchObject({
      variableName: "Hourly air temperature",
      value: 42.3,
    });
    validateEvidenceObject(result.evidence);
  });
});
