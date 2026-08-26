import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { US_COVERAGE_AREA_CASES } from "@/data/us-coverage-matrix";
import { queryAtmosphericSatellite } from "@/lib/coverage-gap/atmospheric-live-adapter";
import { queryFloodExtent } from "@/lib/flood/extent-live-adapter";
import {
  buildCensusAdministrativeAreaUrl,
  resolveUsAdministrativeArea,
} from "@/lib/drought/administrative-area-live";
import { getUsAdministrativeArea } from "@/data/us-administrative-areas";
import {
  ghcnhGuardSummary,
  queryGhcnhGroundEvidence,
} from "@/lib/heat/ground-live-adapter";
import {
  airNowClientRateLimiterAllows,
  queryAirNow,
} from "@/lib/coverage-gap/airnow-live-adapter";
import { queryHansVolcanoActivity } from "@/lib/coverage-gap/hans-live-adapter";

const NOW = new Date("2026-08-14T12:00:00Z");
const DATE = "2024-07-08";
const AREA = US_COVERAGE_AREA_CASES[7].area;

async function png(alpha: number): Promise<Buffer> {
  return sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: alpha / 255 },
    },
  }).png().toBuffer();
}

function pngResponse(bytes: Uint8Array, status = 200): Response {
  return new Response(Buffer.from(bytes), {
    status,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(bytes.byteLength),
    },
  });
}

describe("mock-first prepared-to-live transports", () => {
  it.each([
    ["nasa_gibs_modis_aod", "aod_is_not_aqi"],
    ["nasa_gibs_omps_so2", "prediction_not_supported"],
  ] as const)("validates %s PNG and preserves its claim boundary", async (sourceId, qualifier) => {
    const bytes = await png(255);
    const fetchImpl = vi.fn(async () => pngResponse(bytes));
    const result = await queryAtmosphericSatellite(sourceId, DATE, AREA, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
    });
    expect(result.kind).toBe("observation");
    if (result.kind !== "observation") throw new Error("expected observation");
    expect(result.observation.provenance.sourceId).toBe(sourceId);
    expect(result.observation.provenance.requestParameters?.BBOX).toBe(
      `${AREA.west},${AREA.south},${AREA.east},${AREA.north}`
    );
    expect(result.observation.qualifiers).toContain(qualifier);
    expect(result.observation.dataMode).toBe("live");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns no_observation for a transparent atmospheric PNG", async () => {
    const bytes = await png(0);
    const result = await queryAtmosphericSatellite("nasa_gibs_modis_aod", DATE, AREA, {
      fetchImpl: vi.fn(async () => pngResponse(bytes)) as unknown as typeof fetch,
      now: () => NOW,
    });
    expect(result.kind).toBe("no_observation");
  });

  it("returns flood extent visualization without inventing depth or pixel classes", async () => {
    const bytes = await png(255);
    const result = await queryFloodExtent(DATE, AREA, {
      fetchImpl: vi.fn(async () => pngResponse(bytes)) as unknown as typeof fetch,
      now: () => NOW,
    });
    expect(result.kind).toBe("observation");
    if (result.kind !== "observation") throw new Error("expected observation");
    expect(result.observation.provenance.sourceId).toBe("nasa_lance_flood_extent");
    expect(result.observation.qualifiers).toEqual(expect.arrayContaining([
      "pixel_classification_not_inferred",
      "flood_depth_not_supported",
      "regional_not_property",
    ]));
  });

  it("fails closed on redirect, content-type drift, and oversize", async () => {
    const redirect = await queryFloodExtent(DATE, AREA, {
      fetchImpl: vi.fn(async () => new Response(null, {
        status: 302,
        headers: { Location: "https://example.test/not-allowed" },
      })) as unknown as typeof fetch,
    });
    expect(redirect).toEqual({ kind: "source_failure", reason: "redirect" });

    const media = await queryAtmosphericSatellite("nasa_gibs_modis_aod", DATE, AREA, {
      fetchImpl: vi.fn(async () => new Response("not png", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      })) as unknown as typeof fetch,
    });
    expect(media).toEqual({ kind: "source_failure", reason: "media_type" });

    const oversize = await queryFloodExtent(DATE, AREA, {
      fetchImpl: vi.fn(async () => new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "Content-Type": "image/png", "Content-Length": "2000001" },
      })) as unknown as typeof fetch,
    });
    expect(oversize).toEqual({ kind: "source_failure", reason: "oversize" });
  });

  it.each(US_COVERAGE_AREA_CASES)(
    "resolves USDM administration from canonical geometry for $region / $label",
    async (coverageCase) => {
      const registered = getUsAdministrativeArea(coverageCase.expectedUsdmArea.fips);
      if (!registered) throw new Error("coverage matrix FIPS is not registered");
      const { west, south, east, north } = coverageCase.area;
      const fixture = {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: {
            STATE: registered.fips,
            NAME: registered.name,
            STUSAB: registered.postalCode,
          },
          geometry: {
            type: "Polygon",
            coordinates: [[
              [west - 0.1, south - 0.1],
              [east + 0.1, south - 0.1],
              [east + 0.1, north + 0.1],
              [west - 0.1, north + 0.1],
              [west - 0.1, south - 0.1],
            ]],
          },
        }],
      };
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/geo+json" },
      }));
      const result = await resolveUsAdministrativeArea(coverageCase.area, {
        fetchImpl: fetchImpl as typeof fetch,
      });
      expect(result).toMatchObject({
        kind: "resolved",
        area: coverageCase.expectedUsdmArea,
        selectionBasis: "center_inside",
      });
      const url = buildCensusAdministrativeAreaUrl(coverageCase.area);
      expect(url.hostname).toBe("tigerweb.geo.census.gov");
      expect(url.searchParams.get("returnGeometry")).toBe("true");
      expect(url.searchParams.get("outFields")).toBe("STATE,NAME,STUSAB");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  );

  it("does not default coastal or empty TIGERweb results to a state", async () => {
    const result = await resolveUsAdministrativeArea(AREA, {
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        type: "FeatureCollection",
        features: [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/geo+json" },
      })) as unknown as typeof fetch,
    });
    expect(result.kind).toBe("no_observation");
  });

  it("queries one nearest in-area GHCNh station and preserves temperature/humidity separation", async () => {
    // Real station-list header (ADR-0035): GHCN_ID naming, extra columns, and
    // ISO_CODE country scoping. Real PSV column names and untagged-UTC DATEs.
    const stationCsv = [
      "GHCN_ID,LATITUDE,LONGITUDE,ELEVATION,STATE,NAME,GSN,(US)HCN_(US)CRN,WMO_ID,ICAO,ISO_CODE",
      "USW00026451,61.1744,-149.9964,40.2,AK,ANCHORAGE INTL AP,,,70273,PANC,US",
      "USW00000000,62.0000,-151.0000,20.0,AK,OUTSIDE AREA,,,,,US",
    ].join("\n");
    const psv = [
      "STATION|Station_name|DATE|temperature|temperature_Measurement_Code|temperature_Quality_Code|" +
        "relative_humidity|relative_humidity_Measurement_Code|relative_humidity_Quality_Code",
      "USW00026451|ANCHORAGE INTL AP|2024-07-08T12:00:00|21.4|||55||",
      "USW00026451|ANCHORAGE INTL AP|2024-07-08T15:00:00|24.8||K|48|D|",
    ].join("\n");
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const body = url.pathname.endsWith("ghcnh-station-list.csv") ? stationCsv : psv;
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    });
    const result = await queryGhcnhGroundEvidence(DATE, AREA, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      stationCache: false,
    });
    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    expect(result.station.id).toBe("USW00026451");
    expect(result.observations.map((item) => item.variableName)).toEqual([
      "Hourly outdoor air temperature",
      "Hourly relative humidity",
    ]);
    expect(result.observations[0].value).toBe(24.8);
    expect(result.observations[0].metadata.temperatureQc).toBe("K");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(ghcnhGuardSummary()).toMatchObject({
      maximumRequestsPerQuery: 5,
      maximumStationYearAttempts: 4,
      maximumConcurrency: 1,
      outsideAreaFallback: false,
    });
  });

  it("returns no_observation without fetching an outside-area GHCNh station", async () => {
    const stationCsv = [
      "GHCN_ID,LATITUDE,LONGITUDE,ELEVATION,STATE,NAME,GSN,(US)HCN_(US)CRN,WMO_ID,ICAO,ISO_CODE",
      "USW00000000,62.0000,-151.0000,20.0,AK,OUTSIDE AREA,,,,,US",
    ].join("\n");
    const fetchImpl = vi.fn(async () => new Response(stationCsv, {
      status: 200,
      headers: { "Content-Type": "text/csv" },
    }));
    const result = await queryGhcnhGroundEvidence(DATE, AREA, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      stationCache: false,
    });
    expect(result).toEqual({ kind: "no_observation", stage: "station_discovery" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps AirNow key server-side, redacts provenance, and returns bounded outdoor AQI", async () => {
    const payload = [{
      Latitude: 61.2,
      Longitude: -149.9,
      UTC: "2024-07-08T21:00:00",
      Parameter: "PM2.5",
      AQI: 42,
      Category: 1,
      SiteName: "Mock Anchorage monitor",
      AgencyName: "Mock official agency",
      FullAQSCode: "020200004",
    }];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      expect(url.searchParams.get("API_KEY")).toBe("unit-test-secret");
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const result = await queryAirNow(DATE, AREA, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      apiKey: "unit-test-secret",
      cache: false,
    });
    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    expect(result.observations[0].provenance.sourceUrl).toContain("API_KEY=REDACTED");
    expect(result.observations[0].provenance.sourceUrl).not.toContain("unit-test-secret");
    expect(result.observations[0]).toMatchObject({
      value: 42,
      unit: "AQI",
      qualifiers: ["outdoor_monitoring_site", "not_indoor_air", "not_personal_exposure"],
    });
  });

  it("fails AirNow closed before fetch when the server credential is absent", async () => {
    const fetchImpl = vi.fn();
    const result = await queryAirNow(DATE, AREA, {
      fetchImpl: fetchImpl as typeof fetch,
      apiKey: "",
      cache: false,
    });
    expect(result).toEqual({ kind: "source_failure", reason: "credential_not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("enforces the AirNow per-client request cap without storing the raw token", () => {
    const base = 1_700_000_000_000;
    expect(Array.from({ length: 6 }, (_, index) =>
      airNowClientRateLimiterAllows("mock-client", base + index)
    )).toEqual([true, true, true, true, true, true]);
    expect(airNowClientRateLimiterAllows("mock-client", base + 7)).toBe(false);
    expect(airNowClientRateLimiterAllows("different-client", base + 7)).toBe(true);
  });

  it("selects geographically applicable HANS notices and does not predict", async () => {
    const inventory = [{
      volcano_cd: "ak111",
      volcano_name: "Great Sitkin",
      latitude: 61.08,
      longitude: -149.8,
      obs_abbr: "avo",
    }];
    const notices = [{
      sentUtc: "2024-07-08 21:47:40",
      sentUnixtime: 1_720_475_260,
      noticeTypeCd: "DU",
      volcCds: "ak111",
      noticeHtml: "<p>Official deterministic notice body</p>",
      obsAbbr: "avo",
      noticeIdentifier: "DOI-USGS-AVO-MOCK-2024-07-08",
      permLink: "https://volcanoes.usgs.gov/hans-public/notice/DOI-USGS-AVO-MOCK-2024-07-08",
    }];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("getUSVolcanoes")) {
        return new Response(JSON.stringify(inventory), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ pageIndex: 0, searchText: "" });
      return new Response(JSON.stringify({ noticeTotal: notices.length, noticeData: notices }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    expect(result.observations[0].qualifiers).toEqual(expect.arrayContaining([
      "observed_official_activity",
      "eruption_timing_not_predicted",
      "no_risk_score",
    ]));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not call HANS notice search when no monitored volcano is in the area", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{
      volcano_cd: "hi1",
      volcano_name: "Outside area",
      latitude: 19.4,
      longitude: -155.3,
      obs_abbr: "hvo",
    }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result).toEqual({ kind: "no_observation", stage: "geographic_applicability" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
