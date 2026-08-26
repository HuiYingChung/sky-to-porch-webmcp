/**
 * P0-A: custom-area live Extreme Heat queries include the allowlisted NOAA
 * USCRN station when its fixed coordinate lies inside the validated bounding
 * box. ADR-0037 widens the allowlist to every USCRN station publishing a
 * Heat01 file and selects the station nearest to the area center. Every
 * transport is mocked; no network request is made.
 */

import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { validateEvidenceObject } from "@/contracts/evidence";
import { queryLiveHeatEvidence } from "@/lib/heat/live-adapter";
import { USCRN_TUCSON_COORDINATE } from "@/lib/heat/source-contracts";
import { CUSTOM_AREA_PLACE_ID } from "@/lib/location/query-area";

const NOW = new Date("2026-08-12T05:00:00Z");
const DATE = "2024-07-11";
// Contains the Tucson USCRN station coordinate (lon -111.17, lat 32.24).
const AREA_WITH_STATION = { west: -111.27, south: 32.14, east: -111.07, north: 32.34 };
// Same derived tile neighborhood, but the station is west of the box.
const AREA_WITHOUT_STATION = { west: -111.0, south: 32.14, east: -110.8, north: 32.34 };

const CUSTOM_INPUT = {
  placeId: CUSTOM_AREA_PLACE_ID,
  date: DATE,
  mode: "live" as const,
};

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

function csv(rows = 24): string {
  const header = [
    "WBANNO",
    "DATE_TIME",
    "LONGITUDE",
    "LATITUDE",
    "RELATIVE_HUMIDITY",
    "DRY_BULB_TEMPERATURE_C",
    "HEAT_INDEX_C",
  ].join(",");
  const lines = Array.from({ length: rows }, (_, hour) => {
    const dateTime = `20240711${String(hour).padStart(2, "0")}`;
    const air = hour === 0 ? 41.7 : 30 + hour / 10;
    const index = hour === 0 ? 38.9 : 25 + hour / 10;
    return ["53131", dateTime, "-111.17", "32.24", 11 + hour, air, index].join(",");
  });
  return [header, ...lines].join("\n");
}

function mockFetch(png: Buffer, options: { noaaStatus?: number } = {}): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === "gibs.earthdata.nasa.gov") {
      return new Response(new Uint8Array(png), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    if (url.hostname === "www.ncei.noaa.gov") {
      // ADR-0039: a historical no-USCRN date consults the GHCNh archive;
      // this inventory's only U.S. station is far outside every test box.
      if (url.pathname.endsWith("ghcnh-station-list.csv")) {
        return new Response(
          [
            "GHCN_ID,LATITUDE,LONGITUDE,ELEVATION,STATE,NAME,GSN,(US)HCN_(US)CRN,WMO_ID,ICAO,ISO_CODE",
            "USW00099999,45.0,-70.0,10.0,ME,FAR AWAY STATION,,,,,US",
          ].join("\n"),
          { status: 200, headers: { "content-type": "text/csv" } }
        );
      }
      return new Response(options.noaaStatus ? "unavailable" : csv(), {
        status: options.noaaStatus ?? 200,
        headers: { "content-type": "text/csv" },
      });
    }
    throw new Error(`Unexpected URL: ${url.toString()}`);
  }) as unknown as typeof fetch;
}

describe("P0-A heat live custom-area with an allowlisted station in the box", () => {
  it("includes the station observations and the USCRN limitation for a box over Tucson", async () => {
    const fetchImpl = mockFetch(await tile());
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, area: AREA_WITH_STATION },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("success");
    expect(result.evidence?.evidenceState).toBe("observations_returned");
    expect(result.evidence?.observations).toHaveLength(3);
    expect(result.evidence?.observations.map((observation) => observation.observationId)).toEqual([
      "obs-gibs-modis-lst-custom-area-20240711",
      "obs-uscrn-air-tucson-2024071100",
      "obs-uscrn-heat-index-tucson-2024071100",
    ]);
    expect(result.evidence?.observations[1]).toMatchObject({
      variableName: "Hourly air temperature",
      value: 41.7,
      unit: "degC",
      provenance: { sourceRecordId: "CRNHE0101-AZ_Tucson_11_W.csv#2024071100" },
    });
    expect(result.evidence?.observations[2]).toMatchObject({
      variableName: "Hourly heat index",
      value: 38.9,
      unit: "degC",
    });
    const limitationIds = (result.evidence?.limitations ?? []).map((l) => l.limitationId);
    expect(limitationIds).toContain("lim-wp09-live-uscrn-station");
    expect(limitationIds).not.toContain("lim-uxfix02-heat-no-station-in-area");
    expect(vi.mocked(fetchImpl).mock.calls.map(([input]) => String(input))).toContain(
      "https://www.ncei.noaa.gov/pub/data/uscrn/products/heat01/CRNHE0101-AZ_Tucson_11_W.csv"
    );
    validateEvidenceObject(result.evidence);
  });

  it("accepts the station coordinate on the inclusive box edge", async () => {
    const result = await queryLiveHeatEvidence(
      {
        ...CUSTOM_INPUT,
        area: {
          west: USCRN_TUCSON_COORDINATE.lon,
          south: USCRN_TUCSON_COORDINATE.lat,
          east: USCRN_TUCSON_COORDINATE.lon + 0.2,
          north: USCRN_TUCSON_COORDINATE.lat + 0.2,
        },
      },
      { fetchImpl: mockFetch(await tile()), now: () => NOW }
    );
    expect(result.kind).toBe("success");
    expect(result.evidence?.observations).toHaveLength(3);
  });

  it("stays satellite-only with the no-station limitation when the box misses the station", async () => {
    const fetchImpl = mockFetch(await tile());
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, area: AREA_WITHOUT_STATION },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("inconclusive_evidence");
    expect(result.evidence?.observations).toHaveLength(1);
    expect(result.evidence?.observations[0].provenance.sourceId).toBe("nasa_gibs_modis_lst_day");
    const limitationIds = (result.evidence?.limitations ?? []).map((l) => l.limitationId);
    expect(limitationIds).toContain("lim-uxfix02-heat-no-station-in-area");
    expect(limitationIds).not.toContain("lim-wp09-live-uscrn-station");
    // No USCRN Heat01 file and no GHCNh station-year file is ever requested;
    // only the GHCNh inventory is consulted (its station is outside the box).
    const urls = vi.mocked(fetchImpl).mock.calls.map(([input]) => String(input));
    expect(urls.every((url) => !url.includes("/heat01/"))).toBe(true);
    expect(urls.every((url) => !url.includes("/by-year/"))).toBe(true);
  });

  it("fails closed without a GIBS-only substitute when the station fetch fails", async () => {
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, area: AREA_WITH_STATION },
      { fetchImpl: mockFetch(await tile(), { noaaStatus: 500 }), now: () => NOW }
    );

    expect(result).toMatchObject({
      kind: "source_failure",
      failureReason: "provider_failure",
      failureStage: "noaa_transport",
    });
    expect(result.evidence?.observations).toEqual([]);
    expect(result.evidence?.dataMode).toBe("failed");
    const limitationIds = (result.evidence?.limitations ?? []).map((l) => l.limitationId);
    expect(limitationIds).toContain("lim-wp09-live-uscrn-station");
    validateEvidenceObject(result.evidence);
  });

  it("keeps a transparent tile as unsupported coverage even with station data present", async () => {
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, area: AREA_WITH_STATION },
      { fetchImpl: mockFetch(await tile(0)), now: () => NOW }
    );
    expect(result.kind).toBe("unsupported_coverage");
    expect(result.evidence?.evidenceState).toBe("unsupported_coverage");
  });
});

describe("ADR-0037 nationwide USCRN Heat01 allowlist", () => {
  // Box around the operational CO Boulder 14 W station (40.03, -105.54) —
  // far from any demo place, one allowlisted station inside.
  const BOULDER_AREA = { west: -105.74, south: 39.83, east: -105.34, north: 40.23 };
  // Contains the operational Asheville pair: NC Asheville 13 S (35.41,
  // -82.55) and NC Asheville 8 SSW (35.49, -82.61). The center (35.49,
  // -82.6) is nearer to 8 SSW while 13 S sorts first in the generated list,
  // so nearest-selection is observable.
  const TWO_STATION_AREA = { west: -82.75, south: 35.37, east: -82.45, north: 35.61 };

  it("returns station observations for a Boulder box far from any demo place", async () => {
    const fetchImpl = mockFetch(await tile());
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, area: BOULDER_AREA },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("success");
    expect(result.evidence?.observations).toHaveLength(3);
    expect(result.evidence?.observations[1]).toMatchObject({
      variableName: "Hourly air temperature",
      metadata: expect.objectContaining({
        stationId: "CO_Boulder_14_W",
        stationName: "CO Boulder 14 W",
      }),
      provenance: expect.objectContaining({
        sourceUrl:
          "https://www.ncei.noaa.gov/pub/data/uscrn/products/heat01/CRNHE0101-CO_Boulder_14_W.csv",
      }),
    });
    expect(result.evidence?.observations[1].observationId).toBe(
      "obs-uscrn-air-co-boulder-14-w-2024071100"
    );
    validateEvidenceObject(result.evidence);
  });

  it("selects the allowlisted station nearest to the area center, not list order", async () => {
    const fetchImpl = mockFetch(await tile());
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, area: TWO_STATION_AREA },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("success");
    expect(result.evidence?.observations[1].metadata?.stationId).toBe("NC_Asheville_8_SSW");
    const noaaUrls = vi
      .mocked(fetchImpl)
      .mock.calls.map(([input]) => String(input))
      .filter((url) => url.includes("ncei.noaa.gov"));
    expect(noaaUrls).toEqual([
      "https://www.ncei.noaa.gov/pub/data/uscrn/products/heat01/CRNHE0101-NC_Asheville_8_SSW.csv",
    ]);
  });
});
