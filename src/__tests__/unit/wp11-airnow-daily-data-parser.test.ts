/**
 * src/__tests__/unit/wp11-airnow-daily-data-parser.test.ts
 *
 * WP-11 focused unit tests for parseAirNowDailyData.
 * Inline strings only — no fixture files or external I/O.
 */

import { describe, it, expect } from "vitest";
import {
  parseAirNowDailyData,
  AIRNOW_DAILY_MAX_LINES,
} from "@/lib/coverage-gap/airnow-daily-data-parser";
import type { AirNowDailyRecord } from "@/lib/coverage-gap/airnow-daily-data-parser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AREA = { west: -122.5, south: 37.2, east: -121.8, north: 37.9 };
const DATE = "2024-06-15";

/**
 * Build one valid pipe-delimited daily_data_v2.dat line.
 * Fields: date|aqsid|siteName|parameter|units|value|avgPeriod|dataSource|aqi|category|lat|lon|fullAqsid
 */
function makeLine(overrides: Partial<{
  date: string;
  aqsid: string;
  siteName: string;
  parameter: string;
  units: string;
  value: string;
  avgPeriod: string;
  dataSource: string;
  aqi: string;
  category: string;
  lat: string;
  lon: string;
  fullAqsid: string;
}> = {}): string {
  const d = {
    date: "06/15/24",
    aqsid: "060750005",
    siteName: "San Francisco",
    parameter: "OZONE-8HR",
    units: "PPB",
    value: "42",
    avgPeriod: "8",
    dataSource: "EPA AirNow",
    aqi: "40",
    category: "0",
    lat: "37.5",
    lon: "-122.1",
    fullAqsid: "840060750005",
    ...overrides,
  };
  return [
    d.date, d.aqsid, d.siteName, d.parameter, d.units,
    d.value, d.avgPeriod, d.dataSource, d.aqi, d.category,
    d.lat, d.lon, d.fullAqsid,
  ].join("|");
}

// ---------------------------------------------------------------------------
// 1. Valid ozone row returned correctly
// ---------------------------------------------------------------------------

describe("valid OZONE-8HR row", () => {
  it("returns records with correct fields", () => {
    const result = parseAirNowDailyData(makeLine(), DATE, AREA);
    expect(result.kind).toBe("records");
    const rec = (result as { kind: "records"; records: AirNowDailyRecord[] }).records[0];
    expect(rec.isoDate).toBe("2024-06-15");
    expect(rec.aqsid).toBe("060750005");
    expect(rec.fullAqsid).toBe("840060750005");
    expect(rec.parameter).toBe("OZONE-8HR");
    expect(rec.reportingUnits).toBe("PPB");
    expect(rec.value).toBe(42);
    expect(rec.averagingPeriod).toBe(8);
    expect(rec.aqi).toBe(40);
    expect(rec.aqiCategory).toBe(0);
    expect(rec.lat).toBe(37.5);
    expect(rec.lon).toBe(-122.1);
    expect(rec.qualifiers).toEqual([
      "outdoor_monitoring_site",
      "preliminary_airnow_data",
      "not_indoor_air",
      "not_personal_exposure",
      "not_regulatory_data",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. Valid PM2.5-24HR row returned correctly
// ---------------------------------------------------------------------------

describe("valid PM2.5-24HR row", () => {
  it("returns records", () => {
    const line = makeLine({
      parameter: "PM2.5-24HR",
      units: "UG/M3",
      avgPeriod: "24",
      value: "12",
      aqi: "51",
      category: "1",
    });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("records");
    const rec = (result as { kind: "records"; records: AirNowDailyRecord[] }).records[0];
    expect(rec.parameter).toBe("PM2.5-24HR");
    expect(rec.reportingUnits).toBe("UG/M3");
    expect(rec.averagingPeriod).toBe(24);
    expect(rec.aqi).toBe(51);
    expect(rec.aqiCategory).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Unsupported parameter is ignored (no_observation when no other rows)
// ---------------------------------------------------------------------------

describe("unsupported parameter filtering", () => {
  it("ignores NO2 and returns no_observation", () => {
    const line = makeLine({ parameter: "NO2", units: "PPB", avgPeriod: "1" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("no_observation");
  });

  it("ignores PM2.5 wrong units", () => {
    // PM2.5-24HR requires UG/M3 — PPB is wrong
    const line = makeLine({ parameter: "PM2.5-24HR", units: "PPB", avgPeriod: "24" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("no_observation");
  });

  it("ignores OZONE-8HR with wrong averaging period", () => {
    const line = makeLine({ parameter: "OZONE-8HR", units: "PPB", avgPeriod: "1" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("no_observation");
  });

  it("ignores an unsupported parameter with a blank averaging period", () => {
    const line = makeLine({ parameter: "NO2", units: "PPB", avgPeriod: "" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("no_observation");
  });
});

// ---------------------------------------------------------------------------
// 4. Area filtering — outside area is ignored (no failure), inside is kept
// ---------------------------------------------------------------------------

describe("area filtering", () => {
  it("ignores rows outside the bounding box", () => {
    const line = makeLine({ lat: "34.0", lon: "-118.0" }); // Los Angeles
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("no_observation");
  });

  it("keeps rows inside the bounding box", () => {
    const line = makeLine({ lat: "37.5", lon: "-122.1" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("records");
  });
});

// ---------------------------------------------------------------------------
// 5. Documented -999 AQI is skipped (no_observation)
// ---------------------------------------------------------------------------

describe("documented -999 AQI", () => {
  it("skips -999 AQI rows and returns no_observation", () => {
    const line = makeLine({ aqi: "-999", category: "0" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("no_observation");
  });

  it("skips -999 and returns the other valid row", () => {
    const skip = makeLine({ aqi: "-999", category: "0", aqsid: "060750001", fullAqsid: "840060750001", lon: "-122.2" });
    const keep = makeLine({ aqi: "40", category: "0", aqsid: "060750002", fullAqsid: "840060750002", lon: "-122.3" });
    const result = parseAirNowDailyData(`${skip}\n${keep}`, DATE, AREA);
    expect(result.kind).toBe("records");
    const rec = (result as { kind: "records"; records: AirNowDailyRecord[] }).records;
    expect(rec).toHaveLength(1);
    expect(rec[0].aqsid).toBe("060750002");
  });
});

// ---------------------------------------------------------------------------
// 6. Exact date matching
// ---------------------------------------------------------------------------

describe("date matching", () => {
  it("skips rows for a different date without failure", () => {
    const line = makeLine({ date: "06/14/24" }); // day before
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("no_observation");
  });

  it("fails schema_validation on a malformed date field", () => {
    const line = makeLine({ date: "2024-06-15" }); // wrong format
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation on invalid expectedDate", () => {
    const result = parseAirNowDailyData(makeLine(), "not-a-date", AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation on an impossible calendar date", () => {
    const result = parseAirNowDailyData(makeLine(), "2024-02-30", AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });
});

// ---------------------------------------------------------------------------
// 7. Exact 13-field validation
// ---------------------------------------------------------------------------

describe("13-field validation", () => {
  it("fails schema_validation when a line has 12 fields", () => {
    const line = makeLine().split("|").slice(0, 12).join("|");
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation when a line has 14 fields", () => {
    const line = makeLine() + "|extra";
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });
});

// ---------------------------------------------------------------------------
// 8. AQSID / full AQSID identifier checks
// ---------------------------------------------------------------------------

describe("identifier validation", () => {
  it("ignores non-nine-digit AQSID (non-U.S.)", () => {
    // Only 8 digits — treated as non-U.S. and silently ignored
    const line = makeLine({ aqsid: "06075000", fullAqsid: "84006075000" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("no_observation");
  });

  it("ignores full AQSID without 840 prefix (non-U.S.)", () => {
    const line = makeLine({ fullAqsid: "999060750005" }); // non-840 prefix
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("no_observation");
  });

  it("fails schema_validation when full AQSID digits mismatch AQSID", () => {
    const line = makeLine({ aqsid: "060750005", fullAqsid: "840060750006" }); // last digit differs
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });
});

// ---------------------------------------------------------------------------
// 9. AQI / category mismatch
// ---------------------------------------------------------------------------

describe("AQI/category mismatch", () => {
  it("fails schema_validation when AQI is outside range for category", () => {
    // AQI 80 belongs in cat 1 (51–100), not cat 0 (0–50)
    const line = makeLine({ aqi: "80", category: "0" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation for AQI above 500", () => {
    const line = makeLine({ aqi: "501", category: "5" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation for out-of-range category", () => {
    const line = makeLine({ aqi: "40", category: "6" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  // ---------------------------------------------------------------------------
  // Official category boundary table: both endpoints of all six ranges.
  // Official mapping: 0–50→cat0, 51–100→cat1, 101–150→cat2,
  //                   151–200→cat3, 201–300→cat4, 301–500→cat5
  // ---------------------------------------------------------------------------
  const VALID_BOUNDARIES: Array<[string, string, string]> = [
    ["0",   "0", "AQI 0   → cat 0 (lower bound)"],
    ["50",  "0", "AQI 50  → cat 0 (upper bound)"],
    ["51",  "1", "AQI 51  → cat 1 (lower bound)"],
    ["100", "1", "AQI 100 → cat 1 (upper bound)"],
    ["101", "2", "AQI 101 → cat 2 (lower bound)"],
    ["150", "2", "AQI 150 → cat 2 (upper bound)"],
    ["151", "3", "AQI 151 → cat 3 (lower bound)"],
    ["200", "3", "AQI 200 → cat 3 (upper bound)"],
    ["201", "4", "AQI 201 → cat 4 (lower bound)"],
    ["300", "4", "AQI 300 → cat 4 (upper bound)"],
    ["301", "5", "AQI 301 → cat 5 (lower bound)"],
    ["500", "5", "AQI 500 → cat 5 (upper bound)"],
  ];

  for (const [aqi, category, label] of VALID_BOUNDARIES) {
    it(`accepts ${label}`, () => {
      const line = makeLine({ aqi, category });
      const result = parseAirNowDailyData(line, DATE, AREA);
      expect(result.kind).toBe("records");
    });
  }

  // Wrong/adjacent-category rejections
  it("fails when AQI 50 is assigned category 1 (should be 0)", () => {
    const line = makeLine({ aqi: "50", category: "1" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails when AQI 51 is assigned category 0 (should be 1)", () => {
    const line = makeLine({ aqi: "51", category: "0" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails when AQI 300 is assigned category 5 (should be 4)", () => {
    const line = makeLine({ aqi: "300", category: "5" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails when AQI 301 is assigned category 4 (should be 5)", () => {
    const line = makeLine({ aqi: "301", category: "4" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });
});

// ---------------------------------------------------------------------------
// 10. Malformed coordinates
// ---------------------------------------------------------------------------

describe("malformed coordinates", () => {
  it("fails schema_validation when lat is non-numeric", () => {
    const line = makeLine({ lat: "abc" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation when lon is non-numeric", () => {
    const line = makeLine({ lon: "xyz" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation when lat is out of WGS-84 range", () => {
    const line = makeLine({ lat: "95.0" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation when lon is out of WGS-84 range", () => {
    const line = makeLine({ lon: "200.0" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });
});

// ---------------------------------------------------------------------------
// 11. No-observation state
// ---------------------------------------------------------------------------

describe("no-observation state", () => {
  it("returns no_observation for empty text", () => {
    const result = parseAirNowDailyData("", DATE, AREA);
    expect(result.kind).toBe("no_observation");
  });

  it("returns no_observation for whitespace-only text", () => {
    const result = parseAirNowDailyData("   \n   \n", DATE, AREA);
    expect(result.kind).toBe("no_observation");
  });

  it("returns no_observation when all rows are outside the area", () => {
    const line = makeLine({ lat: "34.0", lon: "-118.0" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("no_observation");
  });
});

// ---------------------------------------------------------------------------
// 12. 50,000 line bound
// ---------------------------------------------------------------------------

describe("50,000 non-empty line bound", () => {
  it("returns oversize when non-empty lines exceed 50,000", () => {
    // Build a string with exactly AIRNOW_DAILY_MAX_LINES + 1 non-empty lines
    const line = makeLine();
    const text = Array(AIRNOW_DAILY_MAX_LINES + 1).fill(line).join("\n");
    const result = parseAirNowDailyData(text, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("oversize");
  });

  it("accepts exactly 50,000 non-empty lines (processes them)", () => {
    // Use lines with non-matching dates to avoid building a huge records array
    const line = makeLine({ date: "06/14/24" }); // different date — skipped rows, not failure
    const text = Array(AIRNOW_DAILY_MAX_LINES).fill(line).join("\n");
    const result = parseAirNowDailyData(text, DATE, AREA);
    // All rows skipped (wrong date) → no_observation
    expect(result.kind).toBe("no_observation");
  });
});

// ---------------------------------------------------------------------------
// 13. Stable input order preserved
// ---------------------------------------------------------------------------

describe("input order preserved", () => {
  it("returns records in the same order they appear in the text", () => {
    const line1 = makeLine({ aqsid: "060750001", fullAqsid: "840060750001", aqi: "40", category: "0", lon: "-122.2" });
    const line2 = makeLine({ aqsid: "060750002", fullAqsid: "840060750002", aqi: "60", category: "1", lon: "-122.3" });
    const result = parseAirNowDailyData(`${line1}\n${line2}`, DATE, AREA);
    expect(result.kind).toBe("records");
    const recs = (result as { kind: "records"; records: AirNowDailyRecord[] }).records;
    expect(recs[0].aqsid).toBe("060750001");
    expect(recs[1].aqsid).toBe("060750002");
  });
});

// ---------------------------------------------------------------------------
// 14. PM10-24HR also retained
// ---------------------------------------------------------------------------

describe("PM10-24HR retained", () => {
  it("returns PM10-24HR records", () => {
    const line = makeLine({
      parameter: "PM10-24HR",
      units: "UG/M3",
      avgPeriod: "24",
      value: "30",
      aqi: "28",
      category: "0",
    });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("records");
    const rec = (result as { kind: "records"; records: AirNowDailyRecord[] }).records[0];
    expect(rec.parameter).toBe("PM10-24HR");
  });
});

// ---------------------------------------------------------------------------
// 15. Invalid area shape
// ---------------------------------------------------------------------------

describe("invalid area", () => {
  it("returns schema_validation for a bad area object", () => {
    const result = parseAirNowDailyData(makeLine(), DATE, { west: 10, south: 20, east: 5, north: 30 });
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });
});

// ---------------------------------------------------------------------------
// 16. Blank required numeric token → schema_validation
// ---------------------------------------------------------------------------

describe("blank required numeric tokens", () => {
  it("fails schema_validation for blank averaging period", () => {
    const line = makeLine({ avgPeriod: "" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation for whitespace-only averaging period", () => {
    const line = makeLine({ avgPeriod: "   " });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation for blank AQI token", () => {
    const line = makeLine({ aqi: "" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation for whitespace-only AQI token", () => {
    const line = makeLine({ aqi: "   " });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation for blank category token", () => {
    const line = makeLine({ category: "" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation for whitespace-only category token", () => {
    const line = makeLine({ category: "   " });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation for blank latitude token", () => {
    const line = makeLine({ lat: "" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation for whitespace-only latitude token", () => {
    const line = makeLine({ lat: "   " });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation for blank longitude token", () => {
    const line = makeLine({ lon: "" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation for whitespace-only longitude token", () => {
    const line = makeLine({ lon: "   " });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation for blank value token", () => {
    const line = makeLine({ value: "" });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });

  it("fails schema_validation for whitespace-only value token", () => {
    const line = makeLine({ value: "   " });
    const result = parseAirNowDailyData(line, DATE, AREA);
    expect(result.kind).toBe("source_failure");
    expect((result as { kind: "source_failure"; reason: string }).reason).toBe("schema_validation");
  });
});
