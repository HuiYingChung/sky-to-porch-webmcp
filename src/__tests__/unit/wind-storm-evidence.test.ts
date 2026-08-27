import { describe, expect, it, vi } from "vitest";
import { validateEvidenceObject } from "@/contracts/evidence";
import {
  parseGhcnhWindRows,
  queryGhcnhWindEvidence,
} from "@/lib/heat/ground-live-adapter";
import { queryLiveStormEvidence } from "@/lib/storm/live-adapter";
import { finalizeStormQueryResult } from "@/lib/storm/service";

const AREA = { west: -96, south: 29, east: -95, north: 30 };
const STATION_ID = "USW00012960";
const STATION_LIST = [
  "GHCN_ID,LATITUDE,LONGITUDE,ELEVATION,STATE,NAME,ISO_CODE",
  `${STATION_ID},29.9844,-95.3608,27.4,TX,HOUSTON INTERCONTINENTAL AP,US`,
].join("\n");
const WIND_PSV = [
  "STATION|DATE|wind_direction|wind_direction_Quality_Code|wind_speed|wind_speed_Quality_Code|wind_gust|wind_gust_Quality_Code",
  `${STATION_ID}|2024-07-08T00:00:00|170|1|10.0|1||`,
  `${STATION_ID}|2024-07-08T01:00:00|180|1|20.0|1|30.0|1`,
  `${STATION_ID}|2024-07-08T02:00:00|190|1|18.0|1|35.0|1`,
  `${STATION_ID}|2024-07-09T00:00:00|200|1|40.0|1|50.0|1`,
].join("\n");

function response(text: string, contentType: string): Response {
  return new Response(text, { status: 200, headers: { "content-type": contentType } });
}

function ghcnhFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    return url.includes("ghcnh-station-list.csv")
      ? response(STATION_LIST, "text/csv")
      : response(WIND_PSV, "text/plain");
  }) as unknown as typeof fetch;
}

describe("Wind & Storm evidence chain", () => {
  it("parses wind fields separately from precipitation and selects independent peaks", () => {
    const parsed = parseGhcnhWindRows(WIND_PSV, STATION_ID, "2024-07-08");
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.requestedDateRowCount).toBe(3);
    expect(parsed.rows[0]).toMatchObject({ windSpeedMs: 10, windGustMs: null });
    expect(Math.max(...parsed.rows.flatMap((row) => row.windSpeedMs === null ? [] : [row.windSpeedMs])))
      .toBe(20);
    expect(Math.max(...parsed.rows.flatMap((row) => row.windGustMs === null ? [] : [row.windGustMs])))
      .toBe(35);
  });

  it("uses only an in-area GHCNh station and returns peak speed and gust", async () => {
    const result = await queryGhcnhWindEvidence("2024-07-08", AREA, {
      fetchImpl: ghcnhFetch(),
      stationCache: false,
      now: () => new Date("2026-08-26T12:00:00.000Z"),
    });
    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") return;
    expect(result.station.id).toBe(STATION_ID);
    expect(result.observations.map((item) => item.variableName)).toEqual([
      "Peak observed wind gust",
      "Peak observed wind speed",
    ]);
    expect(result.observations.map((item) => item.value)).toEqual([35, 20]);
    expect(result.observations.every((item) => item.provenance.sourceId === "noaa_ncei_global_hourly"))
      .toBe(true);
  });

  it("assembles Beryl regional context and station wind without importing flood evidence", async () => {
    const adapter = await queryLiveStormEvidence(
      { placeId: "custom-area", date: "2024-07-08", mode: "live", area: AREA },
      {
        fetchImpl: ghcnhFetch(),
        now: () => new Date("2026-08-26T12:00:00.000Z"),
      }
    );
    expect(adapter.kind).toBe("success");
    expect(adapter.sourceOutcomes).toEqual({
      ghcnhWind: "success",
      officialEventContext: "success",
    });
    expect(adapter.evidence?.hazardId).toBe("wind_storm");
    expect(adapter.evidence?.dataMode).toBe("historical");
    expect(adapter.evidence?.observations.map((item) => item.provenance.sourceId)).toEqual([
      "noaa_ncei_global_hourly",
      "noaa_ncei_global_hourly",
      "nws_tropical_cyclone_report",
    ]);
    expect(adapter.evidence?.observations.some((item) =>
      /rain|precipitation|flood|gage/iu.test(item.variableName)
    )).toBe(false);
    expect(adapter.evidence?.derivedMetrics.map((item) => item.value)).toEqual([78.3, 44.7]);
    expect(() => validateEvidenceObject(adapter.evidence)).not.toThrow();

    const final = await finalizeStormQueryResult(
      adapter,
      "home",
      "Could Hurricane Beryl have damaged my roof?"
    );
    expect(final.claimDiscussion?.supportedStatements.join(" ")).toMatch(/official NWS/i);
    expect(final.claimDiscussion?.notEstablished.join(" ")).toMatch(/policy covers|insurer/i);
    expect(final.claimDiscussion?.documentationChecklist.length).toBeGreaterThanOrEqual(5);
    expect(final.explanation?.notSupported.join(" ")).toMatch(/insurance-claim outcome/i);
  });

  it("does not attach the Beryl report outside its governed area", async () => {
    const outsideStationList = [
      "GHCN_ID,LATITUDE,LONGITUDE,ELEVATION,STATE,NAME,ISO_CODE",
      "USW00099999,40.75,-73.98,10.0,NY,NEW YORK TEST,US",
    ].join("\n");
    const fetchImpl = vi.fn(async () => response(outsideStationList, "text/csv")) as unknown as typeof fetch;
    const result = await queryLiveStormEvidence(
      {
        placeId: "custom-area",
        date: "2024-07-08",
        mode: "live",
        area: { west: -74.1, south: 40.6, east: -73.8, north: 40.9 },
      },
      { fetchImpl, now: () => new Date("2026-08-26T12:00:00.000Z") }
    );
    expect(result.kind).toBe("unsupported_coverage");
    expect(result.sourceOutcomes?.officialEventContext).toBe("not_applicable");
    expect(result.evidence?.observations).toEqual([]);
  });
});
