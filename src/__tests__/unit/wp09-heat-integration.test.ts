import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { validateEvidenceObject } from "@/contracts/evidence";
import {
  assembleIntent,
  validateModelCandidate,
  type ModelCandidate,
} from "@/lib/ai/intent-parser";
import { queryHeatFixture } from "@/lib/heat/fixture-adapter";
import { queryLiveHeatEvidence } from "@/lib/heat/live-adapter";
import { finalizeHeatQueryResult } from "@/lib/heat/service";
import {
  HEAT_PINNED_FIXTURE_DATE,
  HEAT_UNSUPPORTED_FIXTURE_DATE,
} from "@/lib/heat/types";

const NOW = new Date("2026-08-12T05:00:00Z");
const LIVE_INPUT = {
  placeId: "demo-tucson",
  date: HEAT_PINNED_FIXTURE_DATE,
  mode: "live" as const,
};

async function tile(alpha = 255, size = 256): Promise<Buffer> {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 180, g: 90, b: 30, alpha: alpha / 255 },
    },
  }).png().toBuffer();
}

function csv(options: { rows?: number; invalidHumidity?: boolean; wrongHeader?: boolean } = {}): string {
  const header = [
    "WBANNO",
    options.wrongHeader ? "DATE_HOUR" : "DATE_TIME",
    "LONGITUDE",
    "LATITUDE",
    "RELATIVE_HUMIDITY",
    "SURFACE_PRESSURE",
    "SOLAR_RADIATION",
    "ESTIMATED_10_METER_WIND_SPEED",
    "DRY_BULB_TEMPERATURE_C",
    "HEAT_INDEX_C",
    "APPARENT_TEMPERATURE_C",
    "WET_BULB_GLOBE_TEMPERATURE_C",
    "DRY_BULB_TEMPERATURE_F",
    "HEAT_INDEX_F",
    "APPARENT_TEMPERATURE_F",
    "WET_BULB_GLOBE_TEMPERATURE_F",
  ].join(",");
  const rows = Array.from({ length: options.rows ?? 24 }, (_, hour) => {
    const dateTime = `20240711${String(hour).padStart(2, "0")}`;
    const air = hour === 0 ? 41.7 : 30 + hour / 10;
    const index = hour === 0 ? 38.9 : 25 + hour / 10;
    const humidity = options.invalidHumidity && hour === 0 ? 101 : 11 + hour;
    return [
      "53131",
      dateTime,
      "-111.17",
      "32.24",
      humidity,
      "1010.0",
      "500.0",
      "2.0",
      air,
      index,
      air,
      air,
      air * 1.8 + 32,
      index * 1.8 + 32,
      air * 1.8 + 32,
      air * 1.8 + 32,
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

async function mockFetch(options: {
  alpha?: number;
  size?: number;
  rows?: number;
  invalidHumidity?: boolean;
  wrongHeader?: boolean;
  gibsStatus?: number;
  gibsContentType?: string;
  noaaContentType?: string;
  oversizeNoaa?: boolean;
} = {}): Promise<typeof fetch> {
  const png = await tile(options.alpha, options.size);
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === "gibs.earthdata.nasa.gov") {
      return new Response(options.gibsStatus === 429 ? "rate limited" : new Uint8Array(png), {
        status: options.gibsStatus ?? 200,
        headers: { "content-type": options.gibsContentType ?? "image/png" },
      });
    }
    if (url.hostname === "www.ncei.noaa.gov") {
      return new Response(csv(options), {
        headers: {
          "content-type": options.noaaContentType ?? "text/csv",
          // ADR-0037 raised the Heat01 cap to 32 MB; exceed the new bound.
          ...(options.oversizeNoaa ? { "content-length": "32000001" } : {}),
        },
      });
    }
    throw new Error(`Unexpected URL: ${url.toString()}`);
  }) as unknown as typeof fetch;
}

describe("WP-09 Heat fixtures and service", () => {
  it("finalizes the fixed Tucson fixture into six separated claims", async () => {
    const result = await finalizeHeatQueryResult(queryHeatFixture({
      placeId: "demo-tucson",
      date: HEAT_PINNED_FIXTURE_DATE,
      mode: "fixture",
    }), "health", null);

    expect(result.kind).toBe("success");
    expect(result.assessments?.map((assessment) => assessment.code)).toEqual([
      "satellite_land_surface_temperature_visualization",
      "ground_air_temperature",
      "derived_heat_index",
      "indoor_temperature",
      "household_heat_certainty",
      "individual_medical_risk",
    ]);
    expect(result.assessments?.slice(0, 3).every((item) => item.status === "evidence_present"))
      .toBe(true);
    expect(result.assessments?.slice(3).every((item) => item.status === "not_supported"))
      .toBe(true);
    expect(result.evidence?.observations[0].value).toBeUndefined();
    expect(result.explanationStatus).toEqual({ mode: "deterministic", reason: "ai_unavailable" });
    validateEvidenceObject(result.evidence);
  });

  it("keeps unsupported coverage and source failure explicit", () => {
    const unsupported = queryHeatFixture({
      placeId: "demo-tucson",
      date: HEAT_UNSUPPORTED_FIXTURE_DATE,
      mode: "fixture",
    });
    const failed = queryHeatFixture({
      placeId: "demo-source-failure",
      date: HEAT_PINNED_FIXTURE_DATE,
      mode: "fixture",
    });
    expect(unsupported.kind).toBe("unsupported_coverage");
    expect(unsupported.evidence?.observations).toEqual([]);
    expect(failed.kind).toBe("source_failure");
    expect(failed.evidence?.dataMode).toBe("failed");
    validateEvidenceObject(unsupported.evidence);
    validateEvidenceObject(failed.evidence);
  });

  it("never substitutes Tucson for another place or unpinned fixture date", () => {
    expect(queryHeatFixture({
      placeId: "demo-houston",
      date: HEAT_PINNED_FIXTURE_DATE,
      mode: "fixture",
    }).evidence).toBeUndefined();
    expect(queryHeatFixture({
      placeId: "demo-tucson",
      date: "2024-07-12",
      mode: "fixture",
    }).kind).toBe("unsupported_date");
  });
});

describe("WP-09 bounded Extreme Heat intent", () => {
  const candidate: ModelCandidate & { status: "parsed" } = {
    status: "parsed",
    placeId: "demo-tucson",
    hazardId: "extreme_heat",
    timeRange: {
      type: "custom",
      startTs: "2024-07-11T00:00:00Z",
      endTs: "2024-07-11T23:59:59Z",
    },
    concern: "home",
    sourceIds: [
      "nasa_gibs_modis_lst_day",
      "noaa_uscrn_heat_exposure",
      "nws_station_observations",
      "noaa_ncei_global_hourly",
    ],
    reasonCode: null,
  };

  it("accepts only the fixed Tucson route with the exact governed source set", () => {
    validateModelCandidate(candidate);
    const intent = assembleIntent(candidate, "What Extreme Heat evidence exists for Tucson?");
    expect(intent).toMatchObject({
      hazardId: "extreme_heat",
      place: {
        label: expect.stringMatching(/Tucson/i),
      },
    });
    expect(intent.place.coordinate.lat).toBeCloseTo(32.24, 8);
    expect(intent.place.coordinate.lon).toBeCloseTo(-111.17, 8);
  });

  it("rejects wrong sources, wrong place, and a multi-day Heat range", () => {
    expect(() => validateModelCandidate({
      ...candidate,
      sourceIds: ["nasa_gibs_imerg", "usgs_instantaneous_values"],
    })).toThrow();
    expect(() => assembleIntent({ ...candidate, placeId: "demo-houston" }, "Heat in Houston"))
      .toThrow();
    expect(() => assembleIntent({
      ...candidate,
      timeRange: {
        type: "custom",
        startTs: "2024-07-11T00:00:00Z",
        endTs: "2024-07-12T23:59:59Z",
      },
    }, "Two-day Heat range"))
      .toThrow();
  });
});

describe("WP-09 bounded live adapter with generated source-shaped responses", () => {
  it("builds validated visualization, air-temperature, and heat-index observations", async () => {
    const fetchImpl = await mockFetch();
    const result = await queryLiveHeatEvidence(LIVE_INPUT, { fetchImpl, now: () => NOW });
    expect(result.kind).toBe("success");
    expect(result.evidence?.observations).toHaveLength(3);
    expect(result.evidence?.observations[0]).toMatchObject({
      variableName: "Land-surface temperature visualization",
      textValue: "visualization_available",
    });
    expect(result.evidence?.observations[0]).not.toHaveProperty("value");
    expect(result.evidence?.observations[0]).not.toHaveProperty("unit");
    expect(result.evidence?.observations[1]).toMatchObject({
      variableName: "Hourly air temperature",
      value: 41.7,
      unit: "degC",
      provenance: {
        sourceRecordId: "CRNHE0101-AZ_Tucson_11_W.csv#2024071100",
        observedAt: "2024-07-11T00:00:00Z",
      },
    });
    expect(result.evidence?.observations[2]).toMatchObject({
      variableName: "Hourly heat index",
      value: 38.9,
      unit: "degC",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchImpl).mock.calls.map(([input]) => String(input))).toContain(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Land_Surface_Temp_Day/default/2024-07-11/GoogleMapsCompatible_Level7/7/51/24.png"
    );
    validateEvidenceObject(result.evidence);
  });

  it("classifies transparent imagery as unsupported coverage without numeric inference", async () => {
    const result = await queryLiveHeatEvidence(LIVE_INPUT, {
      fetchImpl: await mockFetch({ alpha: 0 }),
      now: () => NOW,
    });
    expect(result.kind).toBe("unsupported_coverage");
    expect(result.evidence?.evidenceState).toBe("unsupported_coverage");
    expect(result.evidence?.observations.every((observation) =>
      observation.provenance.sourceId !== "nasa_gibs_modis_lst_day"
    )).toBe(true);
  });

  it("keeps a missing NOAA date row inconclusive rather than safe", async () => {
    const result = await queryLiveHeatEvidence(LIVE_INPUT, {
      fetchImpl: await mockFetch({ rows: 0 }),
      now: () => NOW,
    });
    expect(result.kind).toBe("inconclusive_evidence");
    expect(result.evidence?.confidence.level).toBe("insufficient");
    expect(result.evidence?.observations).toHaveLength(1);
  });

  it.each([
    ["wrong PNG dimensions", { size: 128 }, "schema_validation", "gibs_payload"],
    ["invalid humidity", { invalidHumidity: true }, "schema_validation", "noaa_payload"],
    ["CSV schema drift", { wrongHeader: true }, "schema_validation", "noaa_payload"],
    ["wrong PNG content type", { gibsContentType: "text/html" }, "schema_validation", "gibs_transport"],
    ["wrong CSV content type", { noaaContentType: "application/json" }, "schema_validation", "noaa_transport"],
    ["oversize CSV", { oversizeNoaa: true }, "oversize", "noaa_transport"],
    ["rate limit", { gibsStatus: 429 }, "rate_limited", "gibs_transport"],
  ] as const)("fails closed on %s", async (_label, options, reason, stage) => {
    const result = await queryLiveHeatEvidence(LIVE_INPUT, {
      fetchImpl: await mockFetch(options),
      now: () => NOW,
    });
    expect(result).toMatchObject({
      kind: "source_failure",
      failureReason: reason,
      failureStage: stage,
    });
    expect(result.evidence?.observations).toEqual([]);
  });

  it("rejects place and date before fetch", async () => {
    const fetchImpl = vi.fn();
    expect((await queryLiveHeatEvidence({ ...LIVE_INPUT, placeId: "demo-houston" }, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
    })).kind).toBe("unsupported_place");
    expect((await queryLiveHeatEvidence({ ...LIVE_INPUT, date: "2026-08-12" }, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
    })).kind).toBe("unsupported_date");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
