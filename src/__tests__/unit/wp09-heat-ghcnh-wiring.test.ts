/**
 * ADR-0039: GHCNh historical ground evidence wired into live Extreme Heat.
 *
 * A metro selection box (no operational USCRN station) with a date older
 * than the GHCNh publication window must return a GHCNh station observation;
 * the 7-day-to-4-week window carries the explicit ground-publication-gap
 * limitation without contacting either network. Every transport is mocked;
 * no network request is made.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { validateEvidenceObject } from "@/contracts/evidence";
import { queryLiveHeatEvidence } from "@/lib/heat/live-adapter";
import { CUSTOM_AREA_PLACE_ID } from "@/lib/location/query-area";

const NOW = new Date("2026-08-19T12:00:00Z");
const HISTORICAL_DATE = "2026-07-01"; // 49 days old: beyond the 28-day window
const GAP_DATE = "2026-08-05"; // 14 days old: too old for NWS, too new for GHCNh
// Downtown Phoenix box: no operational USCRN station inside (ADR-0037).
const PHOENIX_AREA = { west: -112.34, south: 33.22, east: -111.81, north: 33.67 };

const CUSTOM_INPUT = { placeId: CUSTOM_AREA_PLACE_ID, mode: "live" as const };

const REAL_STATION_HEADER = readFileSync(
  resolve(process.cwd(), "src/data/fixtures/ghcnh/station-list-head.csv"),
  "utf8"
).split(/\r?\n/u)[0];
const REAL_IAH_PSV = readFileSync(
  resolve(process.cwd(), "src/data/fixtures/ghcnh/ghcnh-iah-head.psv"),
  "utf8"
);

// One in-box GHCNh station near the Phoenix box center.
const GHCNH_STATION_LIST = [
  REAL_STATION_HEADER,
  ["USW00023183", "33.4278", "-112.0038", "337.4", "AZ", "PHOENIX SKY HARBOR INTL AP",
    "", "", "72278", "KPHX", "US"].join(","),
].join("\n");

// A real-format PSV day for the historical date with hourly rows.
function ghcnhPsv(hours = 24): string {
  const [header, realRow] = REAL_IAH_PSV.split(/\r?\n/u);
  const rows = Array.from({ length: hours }, (_, hour) => {
    const cells = realRow.split("|");
    cells[0] = "USW00023183";
    cells[2] = `${HISTORICAL_DATE}T${String(hour).padStart(2, "0")}:00:00`;
    cells[11] = String(38 + hour / 10);
    cells[59] = "18";
    return cells.join("|");
  });
  return [header, ...rows].join("\n");
}

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

function mockFetch(
  png: Buffer,
  options: { psv?: () => Response; ghcnhStatus?: number } = {}
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
      if (url.pathname.endsWith("ghcnh-station-list.csv")) {
        return new Response(GHCNH_STATION_LIST, {
          status: 200,
          headers: { "content-type": "text/csv" },
        });
      }
      if (url.pathname.includes("/by-year/")) {
        if (options.ghcnhStatus) return new Response("error", { status: options.ghcnhStatus });
        return options.psv
          ? options.psv()
          : new Response(ghcnhPsv(), {
              status: 200,
              headers: { "content-type": "text/plain" },
            });
      }
    }
    throw new Error(`Unexpected URL: ${url.toString()}`);
  }) as unknown as typeof fetch;
}

function limitationIds(result: Awaited<ReturnType<typeof queryLiveHeatEvidence>>): string[] {
  return (result.evidence?.limitations ?? []).map((limitation) => limitation.limitationId);
}

describe("ADR-0039 GHCNh historical ground evidence", () => {
  it("returns a GHCNh station observation for a metro box and a historical date", async () => {
    const fetchImpl = mockFetch(await tile());
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, date: HISTORICAL_DATE, area: PHOENIX_AREA },
      { fetchImpl, now: () => NOW, }
    );

    expect(result.kind).toBe("success");
    expect(result.evidence?.evidenceState).toBe("observations_returned");
    expect(result.evidence?.observations).toHaveLength(2);
    expect(result.evidence?.observations[1]).toMatchObject({
      variableName: "Hourly air temperature",
      value: 40.3,
      unit: "degC",
      provenance: expect.objectContaining({ sourceId: "noaa_ncei_global_hourly" }),
      metadata: expect.objectContaining({
        stationId: "USW00023183",
        heatRole: "ground_air_temperature",
        distinctHourCount: 24,
        relativeHumidityPct: 18,
      }),
    });
    expect(limitationIds(result)).toContain("lim-adr0039-ghcnh-station");
    expect(limitationIds(result)).not.toContain("lim-uxfix02-heat-no-station-in-area");
    // NWS is never consulted for a date outside its retention window.
    const urls = vi.mocked(fetchImpl).mock.calls.map(([input]) => String(input));
    expect(urls.every((url) => !url.includes("api.weather.gov"))).toBe(true);
    validateEvidenceObject(result.evidence);
  });

  it("keeps the publication-gap limitation without contacting any network in the middle window", async () => {
    const fetchImpl = mockFetch(await tile());
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, date: GAP_DATE, area: PHOENIX_AREA },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("inconclusive_evidence");
    expect(result.evidence?.observations).toHaveLength(1);
    expect(limitationIds(result)).toContain("lim-adr0039-ground-publication-gap");
    const urls = vi.mocked(fetchImpl).mock.calls.map(([input]) => String(input));
    expect(urls.every((url) => !url.includes("api.weather.gov"))).toBe(true);
    expect(urls.every((url) => !url.includes("ncei.noaa.gov"))).toBe(true);
  });

  it("stays inconclusive with the unusable-station limitation when the station day is empty", async () => {
    const fetchImpl = mockFetch(await tile(), {
      psv: () =>
        new Response(REAL_IAH_PSV.split(/\r?\n/u)[0], {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    });
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, date: HISTORICAL_DATE, area: PHOENIX_AREA },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("inconclusive_evidence");
    expect(result.evidence?.observations).toHaveLength(1);
    expect(limitationIds(result)).toContain("lim-adr0039-ghcnh-no-usable-station");
  });

  it("fails closed without a satellite-only substitute when GHCNh transport fails", async () => {
    const fetchImpl = mockFetch(await tile(), { ghcnhStatus: 500 });
    const result = await queryLiveHeatEvidence(
      { ...CUSTOM_INPUT, date: HISTORICAL_DATE, area: PHOENIX_AREA },
      { fetchImpl, now: () => NOW }
    );

    expect(result).toMatchObject({
      kind: "source_failure",
      failureReason: "provider_failure",
      failureStage: "ghcnh_station_year",
    });
    expect(result.evidence?.observations).toEqual([]);
  });
});
