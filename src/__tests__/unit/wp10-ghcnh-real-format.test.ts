/**
 * ADR-0035: GHCNh parsers against the REAL NOAA file formats.
 *
 * The two fixtures under src/data/fixtures/ghcnh/ are verbatim heads of the
 * real NCEI files fetched by the owner on 2026-08-19 (station list and the
 * Houston Intercontinental 2026 station-year PSV). They are the authority for
 * header names, column counts, dirty STATE data, and untagged-UTC DATEs.
 * No test here performs a network request.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GHCNH_STATION_LIST_MAX_BYTES,
  GHCNH_STATION_YEAR_MAX_BYTES,
  GHCNH_STATION_YEAR_TIMEOUT_MS,
  GHCNH_TIMEOUT_MS,
  nearestStations,
  parseGhcnhRows,
  parseGhcnhStationList,
  queryGhcnhGroundEvidence,
  stationYearUrl,
} from "@/lib/heat/ground-live-adapter";

const REAL_STATION_LIST = readFileSync(
  resolve(process.cwd(), "src/data/fixtures/ghcnh/station-list-head.csv"),
  "utf8"
);
const REAL_IAH_PSV = readFileSync(
  resolve(process.cwd(), "src/data/fixtures/ghcnh/ghcnh-iah-head.psv"),
  "utf8"
);
const REAL_STATION_HEADER = REAL_STATION_LIST.split(/\r?\n/u)[0];

// Synthetic rows in the exact real column layout (11 columns).
function stationRow(overrides: Partial<Record<
  "id" | "lat" | "lon" | "elev" | "state" | "name" | "iso",
  string
>> = {}): string {
  const cells = {
    id: "USW00012960",
    lat: "29.9844",
    lon: "-95.3608",
    elev: "29.0",
    state: "TX",
    name: "HOUSTON INTERCONTINENTAL AP",
    iso: "US",
    ...overrides,
  };
  return [
    cells.id, cells.lat, cells.lon, cells.elev, cells.state, cells.name,
    "", "", "72206", "KIAH", cells.iso,
  ].join(",");
}

describe("ADR-0035 GHCNh station-list parsing (real header)", () => {
  it("accepts the verbatim real sample and keeps STATE as untrusted metadata only", () => {
    // The real sample contains only Antigua (AG) stations, one of which
    // carries the dirty value STATE=TX. ISO_CODE scoping must exclude both.
    const inventory = parseGhcnhStationList(REAL_STATION_LIST + "\n" + stationRow());
    expect(REAL_STATION_HEADER).toBe(
      "GHCN_ID,LATITUDE,LONGITUDE,ELEVATION,STATE,NAME,GSN,(US)HCN_(US)CRN,WMO_ID,ICAO,ISO_CODE"
    );
    expect(inventory.dataRowCount).toBe(3);
    expect(inventory.skippedRowCount).toBe(0);
    expect(inventory.stations).toHaveLength(1);
    expect(inventory.stations[0]).toEqual({
      id: "USW00012960",
      latitude: 29.9844,
      longitude: -95.3608,
      elevationM: 29,
      state: "TX",
      name: "HOUSTON INTERCONTINENTAL AP",
    });
  });

  it("accepts the sample station IDs under the existing ID pattern", () => {
    for (const id of ["USW00012960", "ACL000BARA9", "ACM00078861"]) {
      expect(/^[A-Z0-9-]{6,20}$/u.test(id)).toBe(true);
    }
  });

  it("skips and counts malformed and duplicate rows within the 2% tolerance", () => {
    const validRows = Array.from({ length: 100 }, (_, index) =>
      stationRow({ id: `USW${String(index).padStart(8, "0")}` })
    );
    const text = [
      REAL_STATION_HEADER,
      ...validRows,
      "USWDUPLICATE,10.0,10.0,1.0,TX,FIRST OF DUPLICATE,,,,,US",
      "USWDUPLICATE,11.0,11.0,1.0,TX,SECOND KEEPS FIRST,,,,,US",
      "TOO,FEW,CELLS",
    ].join("\n");
    const inventory = parseGhcnhStationList(text);
    // 103 data rows, 2 skipped (duplicate keeps first + wrong cell count).
    expect(inventory.dataRowCount).toBe(103);
    expect(inventory.skippedRowCount).toBe(2);
    expect(inventory.stations).toHaveLength(101);
    expect(inventory.stations.find((station) => station.id === "USWDUPLICATE")?.name)
      .toBe("FIRST OF DUPLICATE");
  });

  it("fails closed when the skipped fraction exceeds 2% of data rows", () => {
    const text = [
      REAL_STATION_HEADER,
      ...Array.from({ length: 20 }, (_, index) =>
        stationRow({ id: `USW${String(index).padStart(8, "0")}` })
      ),
      "BROKEN,ROW",
    ].join("\n");
    // 21 data rows, 1 skipped => ~4.8% > 2%.
    expect(() => parseGhcnhStationList(text)).toThrow("schema_validation");
  });

  it("fails closed when no valid U.S. station remains", () => {
    // Valid rows, but none with ISO_CODE US (the real sample alone).
    expect(() => parseGhcnhStationList(REAL_STATION_LIST)).toThrow("schema_validation");
  });

  it("requires the real header names and rejects the previously assumed ID header", () => {
    const oldFormat = [
      "ID,LATITUDE,LONGITUDE,ELEVATION,STATE,NAME",
      "USW00012960,29.9844,-95.3608,29.0,TX,HOUSTON INTERCONTINENTAL AP",
    ].join("\n");
    expect(() => parseGhcnhStationList(oldFormat)).toThrow("schema_validation");
  });
});

describe("ADR-0035 GHCNh station-year PSV parsing (real header)", () => {
  it("parses the verbatim real IAH row with UTC time and preserved quality codes", () => {
    const result = parseGhcnhRows(REAL_IAH_PSV, "USW00012960", "2026-01-01");
    expect(result.requestedDateRowCount).toBe(1);
    expect(result.skippedRowCount).toBe(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      recordId: "USW00012960#2026-01-01T00:00:00",
      observedAt: "2026-01-01T00:00:00.000Z",
      temperatureC: 12.2,
      relativeHumidityPct: 43,
      temperatureQc: "1",
      relativeHumidityQc: "",
    });
  });

  it("treats untagged GHCNh DATEs as UTC even under a non-UTC server timezone", () => {
    const priorTz = process.env.TZ;
    try {
      process.env.TZ = "America/Chicago";
      // Guard: this environment must actually exercise the bug — a bare ISO
      // datetime parses as LOCAL time and differs from the UTC instant.
      expect(Date.parse("2026-01-01T00:00:00")).not.toBe(Date.parse("2026-01-01T00:00:00Z"));

      const result = parseGhcnhRows(REAL_IAH_PSV, "USW00012960", "2026-01-01");
      // Under the previous (buggy) local-time parsing this row would have
      // been shifted to 2026-01-01T06:00:00Z.
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].observedAt).toBe("2026-01-01T00:00:00.000Z");

      // A local-time interpretation would also pull this 2025-12-31T23:00Z
      // row into 2026-01-01; UTC parsing must keep it out.
      const previousDayRow = REAL_IAH_PSV.split(/\r?\n/u)[1]
        .replace("2026-01-01T00:00:00", "2025-12-31T23:00:00");
      const shifted = parseGhcnhRows(
        `${REAL_IAH_PSV.split(/\r?\n/u)[0]}\n${previousDayRow}`,
        "USW00012960",
        "2026-01-01"
      );
      expect(shifted.rows).toHaveLength(0);
      expect(shifted.requestedDateRowCount).toBe(0);
    } finally {
      if (priorTz === undefined) delete process.env.TZ;
      else process.env.TZ = priorTz;
    }
  });

  it("rejects the previously assumed temperature_QC header names", () => {
    const oldFormat = [
      "STATION|DATE|temperature|temperature_QC|relative_humidity|relative_humidity_QC",
      "USW00012960|2026-01-01T00:00:00Z|12.2|1|43|",
    ].join("\n");
    expect(() => parseGhcnhRows(oldFormat, "USW00012960", "2026-01-01")).toThrow(
      "schema_validation"
    );
  });

  it("keeps blank-variable rows unskipped and applies the 10% malformed tolerance", () => {
    const [header, realRow] = REAL_IAH_PSV.split(/\r?\n/u);
    const hourRow = (hour: number, temperature: string, humidity: string): string => {
      const cells = realRow.split("|");
      cells[2] = `2026-01-01T${String(hour).padStart(2, "0")}:00:00`;
      cells[11] = temperature;
      cells[59] = humidity;
      return cells.join("|");
    };
    const tolerated = parseGhcnhRows(
      [
        header,
        hourRow(0, "12.2", "43"),
        hourRow(1, "", "40"), // blank temperature: valid row, no observation
        hourRow(2, "13.5", ""), // blank humidity: valid row, no observation
        ...Array.from({ length: 8 }, (_, index) =>
          hourRow(3 + index, String(14 + index), "39")
        ),
        "ONE|MALFORMED|LINE", // structurally malformed: skipped and counted
      ].join("\n"),
      "USW00012960",
      "2026-01-01"
    );
    // 11 date rows + 1 malformed => 1/12 skipped (~8.3%) stays under 10%.
    expect(tolerated.requestedDateRowCount).toBe(11);
    expect(tolerated.skippedRowCount).toBe(1);
    expect(tolerated.rows).toHaveLength(9);

    // 1 date row + 1 malformed => 50% skipped fails closed.
    expect(() => parseGhcnhRows(
      [header, hourRow(0, "12.2", "43"), "ONE|MALFORMED|LINE"].join("\n"),
      "USW00012960",
      "2026-01-01"
    )).toThrow("schema_validation");

    // Out-of-range non-blank values are corrupt data, skipped and counted.
    const corrupt = parseGhcnhRows(
      [
        header,
        ...Array.from({ length: 10 }, (_, index) => hourRow(index, "20.5", "50")),
        hourRow(10, "212.0", "50"),
      ].join("\n"),
      "USW00012960",
      "2026-01-01"
    );
    expect(corrupt.skippedRowCount).toBe(1);
    expect(corrupt.rows).toHaveLength(10);
  });

  it("fails closed above the 240-row per-date cap after filtering", () => {
    const [header, realRow] = REAL_IAH_PSV.split(/\r?\n/u);
    const rows = Array.from({ length: 241 }, (_, index) => {
      const cells = realRow.split("|");
      const hour = String(Math.floor(index / 11)).padStart(2, "0");
      const minute = String((index % 11) * 5).padStart(2, "0");
      cells[2] = `2026-01-01T${hour}:${minute}:00`;
      return cells.join("|");
    });
    expect(() => parseGhcnhRows([header, ...rows].join("\n"), "USW00012960", "2026-01-01"))
      .toThrow("oversize");
  });
});

describe("ADR-0035 adapter integration with the real formats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns observations end-to-end from real-format station list and PSV", async () => {
    const houstonArea = { west: -95.63, south: 29.72, east: -95.11, north: 30.24 };
    const stationList = [REAL_STATION_HEADER, stationRow()].join("\n");
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const body = url.pathname.endsWith("ghcnh-station-list.csv") ? stationList : REAL_IAH_PSV;
      return new Response(body, { status: 200, headers: { "Content-Type": "text/plain" } });
    });
    const result = await queryGhcnhGroundEvidence("2026-01-01", houstonArea, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-08-19T12:00:00Z"),
      stationCache: false,
    });
    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    expect(result.station.id).toBe("USW00012960");
    expect(result.observations[0]).toMatchObject({
      variableName: "Hourly outdoor air temperature",
      value: 12.2,
      unit: "degC",
    });
    expect(result.observations[1]).toMatchObject({
      variableName: "Hourly relative humidity",
      value: 43,
      unit: "percent",
    });
    expect(result.observations[0].provenance.observedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.observations[0].metadata.temperatureQc).toBe("1");
    expect(result.observations[0].metadata.relativeHumidityQc).toBe("blank");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const psvUrl = String(fetchImpl.mock.calls[1][0]);
    expect(psvUrl).toBe(stationYearUrl("USW00012960", "2026").toString());
  });

  it("keeps the raised byte caps and per-request timeouts explicit", () => {
    expect(GHCNH_STATION_LIST_MAX_BYTES).toBe(30_000_000);
    expect(GHCNH_STATION_YEAR_MAX_BYTES).toBe(64_000_000);
    expect(GHCNH_TIMEOUT_MS).toBe(10_000);
    expect(GHCNH_STATION_YEAR_TIMEOUT_MS).toBe(30_000);
  });

  it("still fails closed on an oversize station list via content-length", async () => {
    const fetchImpl = vi.fn(async () => new Response("GHCN_ID", {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Length": String(GHCNH_STATION_LIST_MAX_BYTES + 1),
      },
    }));
    const result = await queryGhcnhGroundEvidence(
      "2026-01-01",
      { west: -95.63, south: 29.72, east: -95.11, north: 30.24 },
      { fetchImpl: fetchImpl as typeof fetch, stationCache: false }
    );
    expect(result).toEqual({
      kind: "source_failure",
      reason: "oversize",
      stage: "station_discovery",
    });
  });

  it("finds nearest stations for the Houston and Tucson demo areas from synthetic US rows", () => {
    const inventory = parseGhcnhStationList([
      REAL_STATION_HEADER,
      stationRow(),
      stationRow({ id: "USW00023160", lat: "32.1313", lon: "-110.9552", name: "TUCSON INTL AP", state: "AZ" }),
    ].join("\n"));
    const houston = nearestStations(inventory.stations, {
      west: -95.63, south: 29.72, east: -95.11, north: 30.24,
    });
    const tucson = nearestStations(inventory.stations, {
      west: -111.43, south: 32.02, east: -110.91, north: 32.47,
    });
    expect(houston[0]?.id).toBe("USW00012960");
    expect(tucson[0]?.id).toBe("USW00023160");
  });
});
