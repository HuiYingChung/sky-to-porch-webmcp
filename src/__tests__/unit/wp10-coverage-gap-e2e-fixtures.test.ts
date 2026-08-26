import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { coverageGapE2eFetch } from "@/lib/coverage-gap/e2e-fixture-fetch";
import { coverageGapFetchForRequest } from "@/lib/coverage-gap/e2e-fixture-mode";
import { buildAirNowDailyFileUrl } from "@/lib/coverage-gap/airnow-daily-live-adapter";
import { buildUsgsEarthquakeQueryUrl } from "@/lib/coverage-gap/usgs-earthquake-live-adapter";

const HOUSTON_AREA = { west: -96, south: 29, east: -95, north: 30 };

describe("WP-10 coverage-gap E2E network containment", () => {
  it("activates only for the exact loopback Playwright environment", async () => {
    await expect(coverageGapFetchForRequest(
      new Request("http://localhost:3000/api/air/query"),
      { PLAYWRIGHT_TEST_SERVER: "1", SKY_TO_PORCH_E2E_FIXTURES: "coverage-gap-v1" }
    )).resolves.toBe(coverageGapE2eFetch);
    await expect(coverageGapFetchForRequest(
      new Request("https://product.example/api/air/query"),
      { PLAYWRIGHT_TEST_SERVER: "1", SKY_TO_PORCH_E2E_FIXTURES: "coverage-gap-v1" }
    )).rejects.toThrow("outside the bounded local test server");
    await expect(coverageGapFetchForRequest(
      new Request("http://localhost:3000/api/air/query"),
      { PLAYWRIGHT_TEST_SERVER: "1", SKY_TO_PORCH_E2E_FIXTURES: "wrong" }
    )).rejects.toThrow("outside the bounded local test server");
  });

  it("returns valid deterministic GIBS images and never passes unknown URLs through", async () => {
    const aod = await coverageGapE2eFetch(
      "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?LAYERS=MODIS_Combined_MAIAC_L2G_AerosolOpticalDepth"
    );
    const omps = await coverageGapE2eFetch(
      "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?LAYERS=OMPS_NOAA20_SO2_Lower_Troposphere"
    );
    await expect(sharp(await aod.arrayBuffer()).metadata()).resolves.toMatchObject({
      format: "png", width: 512, height: 512,
    });
    await expect(sharp(await omps.arrayBuffer()).metadata()).resolves.toMatchObject({
      format: "png", width: 512, height: 512,
    });
    await expect(coverageGapE2eFetch("https://example.com/unexpected")).rejects.toThrow(
      "Blocked unexpected coverage-gap E2E request"
    );
  });

  it("returns an empty HANS inventory so no notice search is needed", async () => {
    const response = await coverageGapE2eFetch(
      "https://volcanoes.usgs.gov/hans-public/api/volcano/getUSVolcanoes",
      { method: "GET" }
    );
    await expect(response.json()).resolves.toEqual([]);
  });

  it("returns one bounded observed-earthquake event inside the requested area and day", async () => {
    const response = await coverageGapE2eFetch(
      buildUsgsEarthquakeQueryUrl("2026-08-13", HOUSTON_AREA),
      { method: "GET" }
    );
    expect(response.headers.get("content-type")).toContain("application/json");
    const payload = await response.json();
    expect(payload).toMatchObject({
      type: "FeatureCollection",
      metadata: { count: 1, status: 200 },
      features: [{
        type: "Feature",
        properties: { mag: 2.1, type: "earthquake", status: "reviewed" },
        geometry: { type: "Point", coordinates: [-95.5, 29.5, 7.5] },
      }],
    });
  });

  it("returns a bounded AirNow daily fixture for the requested historical date", async () => {
    const response = await coverageGapE2eFetch(buildAirNowDailyFileUrl("2026-08-13"), {
      method: "GET",
    });
    expect(response.headers.get("content-type")).toBe("binary/octet-stream");
    const text = await response.text();
    expect(text).toContain("08/13/26|480000001|Deterministic Houston monitor|");
    expect(text.split("|")).toHaveLength(13);
  });
});
