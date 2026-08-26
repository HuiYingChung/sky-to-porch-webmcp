/**
 * ADR-0036: bounded next-nearest GHCNh station fallback.
 *
 * The 2026-08-19 authorized live smoke and HEAD diagnostics proved two real
 * conditions the adapter could not survive around downtown Houston: the
 * nearest inventory station publishes NO station-year file for the requested
 * year (HTTP 404, closed legacy station), and the next one publishes a file
 * with NO usable rows for the requested date (mid-year-defunct station). An
 * active airport station (Hobby AP) was fourth in distance order. Only those
 * two conditions advance to the next candidate, at most
 * NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS stations are tried, and every other
 * failure still fails closed immediately. No test performs a network request.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ghcnhGuardSummary,
  queryGhcnhGroundEvidence,
  stationYearUrl,
} from "@/lib/heat/ground-live-adapter";
import {
  NCEI_GHCNH_MAX_REQUESTS,
  NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS,
} from "@/lib/heat/ground-source-contract";

const REAL_STATION_LIST = readFileSync(
  resolve(process.cwd(), "src/data/fixtures/ghcnh/station-list-head.csv"),
  "utf8"
);
const REAL_IAH_PSV = readFileSync(
  resolve(process.cwd(), "src/data/fixtures/ghcnh/ghcnh-iah-head.psv"),
  "utf8"
);
const REAL_STATION_HEADER = REAL_STATION_LIST.split(/\r?\n/u)[0];

const HOUSTON_AREA = { west: -95.63, south: 29.72, east: -95.11, north: 30.24 };
// Distance order from the area center (-95.37, 29.98): ids below, then FAR ids.
const NO_FILE_ID = "USW00012945"; // closed legacy station: year file 404
const EMPTY_ROWS_ID = "USW00000188"; // defunct station: file exists, no date rows
const ACTIVE_ID = "USW00012960"; // active airport station with data
const FOURTH_ID = "USW00088888";
const FIFTH_ID = "USW00099999"; // beyond the 4-attempt bound

function stationRow(id: string, lat: string, lon: string, name: string): string {
  return [id, lat, lon, "29.0", "TX", name, "", "", "72206", "KIAH", "US"].join(",");
}

const STATION_LIST = [
  REAL_STATION_HEADER,
  stationRow(NO_FILE_ID, "29.98", "-95.37", "HOUSTON NEAREST NO FILE"),
  stationRow(EMPTY_ROWS_ID, "29.985", "-95.375", "HOUSTON DEFUNCT EMPTY FILE"),
  stationRow(ACTIVE_ID, "29.9844", "-95.3608", "HOUSTON INTERCONTINENTAL AP"),
  stationRow(FOURTH_ID, "30.10", "-95.50", "HOUSTON FOURTH"),
  stationRow(FIFTH_ID, "30.20", "-95.60", "HOUSTON FIFTH BEYOND BOUND"),
].join("\n");

// A real-format PSV whose single row belongs to `stationId` on 2025-12-31, so
// a 2026-01-01 query sees a well-formed file with zero requested-date rows.
function emptyDatePsv(stationId: string): string {
  const [header, row] = REAL_IAH_PSV.split(/\r?\n/u);
  return [
    header,
    row.replaceAll("USW00012960", stationId).replace("2026-01-01T00:00:00", "2025-12-31T23:00:00"),
  ].join("\n");
}

type FetchResponder = (stationId: string | null) => Response | Promise<Response>;

function fetchForPsv(respond: FetchResponder) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname.endsWith("ghcnh-station-list.csv")) {
      return new Response(STATION_LIST, {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      });
    }
    const match = url.pathname.match(/GHCNh_([A-Z0-9-]+)_\d{4}\.psv$/u);
    return respond(match ? match[1] : null);
  });
}

function queryHouston(fetchImpl: ReturnType<typeof fetchForPsv>) {
  return queryGhcnhGroundEvidence("2026-01-01", HOUSTON_AREA, {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => new Date("2026-08-19T12:00:00Z"),
    stationCache: false,
  });
}

const psvOk = (body: string) =>
  new Response(body, { status: 200, headers: { "Content-Type": "text/plain" } });

describe("ADR-0036 bounded next-nearest station fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("advances past a 404 and an empty-date file and records both skips honestly", async () => {
    const fetchImpl = fetchForPsv((stationId) => {
      if (stationId === NO_FILE_ID) return new Response(null, { status: 404 });
      if (stationId === EMPTY_ROWS_ID) return psvOk(emptyDatePsv(EMPTY_ROWS_ID));
      if (stationId === ACTIVE_ID) return psvOk(REAL_IAH_PSV);
      return new Response(null, { status: 404 });
    });
    const result = await queryHouston(fetchImpl);
    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    expect(result.station.id).toBe(ACTIVE_ID);
    expect(result.observations[0]).toMatchObject({
      variableName: "Hourly outdoor air temperature",
      value: 12.2,
      unit: "degC",
    });
    expect(result.observations[0].metadata.selectionBasis).toBe(
      "next_nearest_station_inside_canonical_area_after_skipped_stations"
    );
    expect(result.observations[0].metadata.stationsSkippedForMissingYearFile).toBe(NO_FILE_ID);
    expect(result.observations[0].metadata.stationsSkippedWithoutUsableDateRows).toBe(
      EMPTY_ROWS_ID
    );
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(String(fetchImpl.mock.calls[1][0])).toBe(
      stationYearUrl(NO_FILE_ID, "2026").toString()
    );
    expect(String(fetchImpl.mock.calls[2][0])).toBe(
      stationYearUrl(EMPTY_ROWS_ID, "2026").toString()
    );
    expect(String(fetchImpl.mock.calls[3][0])).toBe(stationYearUrl(ACTIVE_ID, "2026").toString());
  });

  it("keeps the nearest-station selection basis when no fallback was needed", async () => {
    const fetchImpl = fetchForPsv((stationId) =>
      stationId === NO_FILE_ID
        ? psvOk(REAL_IAH_PSV.replaceAll("USW00012960", NO_FILE_ID))
        : new Response(null, { status: 404 })
    );
    const result = await queryHouston(fetchImpl);
    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    expect(result.station.id).toBe(NO_FILE_ID);
    expect(result.observations[0].metadata.selectionBasis).toBe(
      "nearest_station_inside_canonical_area"
    );
    expect(result.observations[0].metadata.stationsSkippedForMissingYearFile).toBeUndefined();
    expect(result.observations[0].metadata.stationsSkippedWithoutUsableDateRows).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed as not_found when every bounded attempt is a 404, never trying a fifth station", async () => {
    const fetchImpl = fetchForPsv(() => new Response(null, { status: 404 }));
    const result = await queryHouston(fetchImpl);
    expect(result).toEqual({
      kind: "source_failure",
      reason: "not_found",
      stage: "station_year",
    });
    // Station list + exactly NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS PSV attempts;
    // the fifth in-area candidate is never contacted.
    expect(fetchImpl).toHaveBeenCalledTimes(1 + NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS);
    const attemptedUrls = fetchImpl.mock.calls.slice(1).map((call) => String(call[0])).join(" ");
    expect(attemptedUrls).not.toContain(FIFTH_ID);
  });

  it("returns no_observation when attempts exhaust and at least one file existed", async () => {
    const fetchImpl = fetchForPsv((stationId) =>
      stationId === EMPTY_ROWS_ID
        ? psvOk(emptyDatePsv(EMPTY_ROWS_ID))
        : new Response(null, { status: 404 })
    );
    const result = await queryHouston(fetchImpl);
    expect(result).toEqual({ kind: "no_observation", stage: "station_year" });
    expect(fetchImpl).toHaveBeenCalledTimes(1 + NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS);
  });

  it("does not fall back on non-404 failures: a 500 fails closed immediately", async () => {
    const fetchImpl = fetchForPsv(() => new Response(null, { status: 500 }));
    const result = await queryHouston(fetchImpl);
    expect(result).toEqual({
      kind: "source_failure",
      reason: "provider_failure",
      stage: "station_year",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps the request budget and attempt bound consistent and explicit", () => {
    expect(NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS).toBe(4);
    expect(NCEI_GHCNH_MAX_REQUESTS).toBe(1 + NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS);
    expect(ghcnhGuardSummary()).toMatchObject({
      maximumRequestsPerQuery: 5,
      maximumStationYearAttempts: 4,
    });
  });
});
