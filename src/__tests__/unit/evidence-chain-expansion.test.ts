import { describe, expect, it, vi } from "vitest";
import { validateObservation } from "@/contracts/evidence";
import {
  observationsFromNceiCsv,
  parseNceiCsv,
  selectNceiDetailsFile,
} from "@/lib/storm/ncei-storm-events-live-adapter";
import { parseHurdat2, selectHurdat2Files } from "@/lib/storm/nhc-hurdat-live-adapter";
import { parseMrmsCatalog, queryMrmsQpe } from "@/lib/flood/mrms-qpe-live-adapter";
import { observationsFromWfigsGeoJson } from "@/lib/fire/wfigs-live-adapter";
import { observationsFromGvpGeoJson, queryGvpEruptions } from "@/lib/coverage-gap/gvp-eruption-live-adapter";
import { observationsFromAqsJson, queryEpaAqs } from "@/lib/coverage-gap/epa-aqs-live-adapter";
import { parseCanadaDroughtCatalog, queryCanadaDroughtMonitor } from "@/lib/drought/canada-drought-live-adapter";

const AREA = { west: -96, south: 29, east: -95, north: 30 };
const NOW = new Date("2026-08-30T12:00:00.000Z");

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe("expanded official evidence adapters", () => {
  it("parses quoted NCEI CSV and keeps only matching geolocated hazard records", () => {
    const csv = [
      "EVENT_ID,EVENT_TYPE,BEGIN_YEARMONTH,BEGIN_DAY,BEGIN_LAT,BEGIN_LON,END_LAT,END_LON,BEGIN_LOCATION,CZ_NAME,STATE,EVENT_NARRATIVE,EPISODE_NARRATIVE",
      '1001,Thunderstorm Wind,202608,28,29.76,-95.37,,,Houston,Harris,Texas,"Trees, signs, and power lines were reported down.",',
      "1002,Flash Flood,202608,28,29.77,-95.36,,,Houston,Harris,Texas,Flooded road,",
      "1003,Thunderstorm Wind,202608,28,31.00,-97.00,,,Outside,Other,Texas,Outside area,",
    ].join("\n");
    expect(parseNceiCsv('a,"b,b","c""d"\n')).toEqual([["a", "b,b", 'c"d']]);
    const observations = observationsFromNceiCsv(
      bytes(csv),
      "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/test.csv.gz",
      "test.csv.gz",
      AREA,
      "2026-08-28",
      "wind_storm",
      NOW.toISOString()
    );
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      observationId: "obs-ncei-storm-event-1001",
      provenance: { sourceId: "noaa_ncei_storm_events" },
      metadata: { eventType: "Thunderstorm Wind", reportedLatitude: 29.76, reportedLongitude: -95.37 },
    });
    expect(observations[0].textValue).toContain("Trees, signs, and power lines");
    expect(() => validateObservation(observations[0])).not.toThrow();
  });

  it("selects the newest NCEI publication revision for one year", () => {
    const html = [
      "StormEvents_details-ftp_v1.0_d2025_c20260101.csv.gz",
      "StormEvents_details-ftp_v1.0_d2025_c20260304.csv.gz",
      "StormEvents_details-ftp_v1.0_d2024_c20250101.csv.gz",
    ].join(" ");
    expect(selectNceiDetailsFile(html, 2025)).toBe("StormEvents_details-ftp_v1.0_d2025_c20260304.csv.gz");
  });

  it("parses both official HURDAT2 basins and six-hour track points", () => {
    expect(selectHurdat2Files([
      '<a href="hurdat2-1851-2024-010125.txt">old</a>',
      '<a href="hurdat2-1851-2025-040126.txt">new</a>',
      '<a href="hurdat2-nepac-1949-2025-040126.txt">pacific</a>',
    ].join(""))).toEqual([
      "hurdat2-1851-2025-040126.txt",
      "hurdat2-nepac-1949-2025-040126.txt",
    ]);
    const points = parseHurdat2([
      "AL022024, BERYL, 2,",
      "20240708, 0000, L, HU, 29.0N, 95.0W, 70, 982,",
      "20240708, 0600, , TS, 30.1N, 95.5W, 55, 990,",
    ].join("\n"));
    expect(points).toEqual([
      expect.objectContaining({ stormId: "AL022024", stormName: "BERYL", date: "2024-07-08", maximumWindKnots: 70, latitude: 29, longitude: -95 }),
      expect.objectContaining({ time: "0600", status: "TS", minimumPressureMb: 990 }),
    ]);
    expect(parseHurdat2([
      "AL011851, UNNAMED, 1,",
      "18510625, 0000, , HU, 28.0N, 94.8W, -99, -999,",
    ].join("\n"))[0]).toMatchObject({ maximumWindKnots: null, minimumPressureMb: null });
  });

  it("samples a finite recent MRMS QPE value only from an overlapping rolling raster", async () => {
    expect(parseMrmsCatalog({ features: [{ attributes: { objectid: 9, name: "conus_QPE_24H", idp_validendtime: Date.parse("2026-08-29T12:00:00Z") } }] }))
      .toHaveLength(1);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/query")) {
        return Response.json({ features: [
          { attributes: { objectid: 8, name: "alaska_QPE_24H", idp_validendtime: Date.parse("2026-08-29T12:00:00Z") } },
          { attributes: { objectid: 9, name: "conus_QPE_24H", idp_validendtime: Date.parse("2026-08-29T12:00:00Z") } },
        ] });
      }
      const rule = JSON.parse(url.searchParams.get("mosaicRule") ?? "{}") as { lockRasterIds?: number[] };
      return Response.json({ value: rule.lockRasterIds?.[0] === 9 ? "2.45" : "NoData" });
    }) as unknown as typeof fetch;
    const result = await queryMrmsQpe(AREA, "2026-08-29", { fetchImpl, now: () => NOW });
    expect(result.kind).toBe("observation");
    if (result.kind !== "observation") return;
    expect(result.observation).toMatchObject({ value: 2.45, unit: "in", provenance: { sourceId: "noaa_mrms_qpe", sourceRecordId: "9" } });
    expect(() => validateObservation(result.observation)).not.toThrow();
  });

  it("parses WFIGS perimeters as incident context rather than parcel truth", () => {
    const payload = { type: "FeatureCollection", features: [{
      type: "Feature",
      properties: {
        OBJECTID: 44,
        attr_IRWINID: "{fixture-irwin}",
        attr_IncidentName: "Fixture Fire",
        poly_FeatureCategory: "Wildfire Daily Fire Perimeter",
        poly_GISAcres: 1234.5,
        attr_PercentContained: 40,
      },
    }] };
    const raw = bytes(JSON.stringify(payload));
    const observations = observationsFromWfigsGeoJson(payload, raw, "https://services3.arcgis.com/example", "2026-08-28", NOW.toISOString());
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ provenance: { sourceId: "nifc_wfigs_fire_perimeters" }, metadata: { incidentName: "Fixture Fire", mappedAcres: 1234.5 } });
    expect(observations[0].qualifiers).toContain("not_property_or_tactical_truth");
  });

  it("filters Smithsonian GVP records by exact selected geometry and conservative date interval", () => {
    const payload = { type: "FeatureCollection", numberMatched: 1, features: [{
      type: "Feature",
      geometry: { type: "Point", coordinates: [-95.4, 29.7] },
      properties: {
        Volcano_Number: 123456,
        Volcano_Name: "Fixture Volcano",
        Eruption_Number: 9876,
        Activity_Type: "Confirmed Eruption",
        ExplosivityIndexMax: 2,
        StartDateYear: 2026,
        StartDateMonth: 8,
        StartDateDay: null,
        EndDateYear: 2026,
        EndDateMonth: 8,
        EndDateDay: null,
      },
    }] };
    const raw = bytes(JSON.stringify(payload));
    const observations = observationsFromGvpGeoJson(payload, raw, "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows", AREA, "2026-08-28", NOW.toISOString());
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ provenance: { sourceId: "smithsonian_gvp_eruptions" }, metadata: { volcanoName: "Fixture Volcano", maximumVei: 2 } });
  });

  it("bounds the Smithsonian GVP live query by selected area and requested year", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.has("bbox")).toBe(false);
      expect(url.searchParams.get("CQL_FILTER")).toBe("BBOX(GeoLocation,-96,29,-95,30,'EPSG:4326') AND StartDateYear <= 2026 AND (EndDateYear IS NULL OR EndDateYear = 0 OR EndDateYear >= 2026)");
      return Response.json({ type: "FeatureCollection", numberMatched: 0, features: [] });
    }) as unknown as typeof fetch;
    await expect(queryGvpEruptions(AREA, "2026-08-28", { fetchImpl, now: () => NOW }))
      .resolves.toEqual({ kind: "no_observation" });
  });

  it("keeps EPA AQS credentials server-only and parses validated in-area samples", async () => {
    expect(await queryEpaAqs(AREA, "2025-01-08", { credentials: { email: "", key: "" } })).toEqual({ kind: "credential_gate_closed" });
    const payload = {
      Header: { status: "Success" },
      Data: [{
        latitude: 29.75,
        longitude: -95.35,
        date_gmt: "2025-01-08",
        time_gmt: "12:00",
        sample_measurement: 9.5,
        units_of_measure: "Micrograms/cubic meter (LC)",
        parameter: "PM2.5 - Local Conditions",
        parameter_code: "88101",
        state_code: "48",
        county_code: "201",
        site_number: "0001",
        method_name: "Federal Reference Method",
        sample_duration: "24 HOUR",
        date_of_last_change: "2025-06-01",
      }],
    };
    const raw = bytes(JSON.stringify(payload));
    const observations = observationsFromAqsJson(payload, raw, AREA, "2025-01-08", NOW.toISOString());
    expect(observations).toHaveLength(1);
    expect(observations[0].provenance.sourceUrl).not.toContain("key=");
    expect(observations[0]).toMatchObject({ value: 9.5, provenance: { sourceId: "epa_aqs" } });
  });

  it("selects the latest published Canadian drought raster without guessing a class label", async () => {
    expect(parseCanadaDroughtCatalog({ features: [
      { attributes: { OBJECTID: 2, Name: "cdm_2026_07_31" } },
      { attributes: { OBJECTID: 1, Name: "cdm_2026_06_30" } },
    ] }).map((item) => item.name)).toEqual(["cdm_2026_07_31", "cdm_2026_06_30"]);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/query")
        ? Response.json({ features: [{ attributes: { OBJECTID: 2, Name: "cdm_2026_07_31" } }] })
        : Response.json({ value: "0" });
    }) as unknown as typeof fetch;
    const result = await queryCanadaDroughtMonitor(
      { west: -80, south: 43, east: -79, north: 44 },
      "2026-08-28",
      { fetchImpl, now: () => NOW }
    );
    expect(result.kind).toBe("observation");
    if (result.kind !== "observation") return;
    expect(result.observation.textValue).toBe("Official source raster class code 0");
    expect(result.observation.qualifiers).toContain("source_code_not_relabelled_without_verified_attribute_table");
  });
});
