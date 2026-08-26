import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { validateEvidenceObject } from "@/contracts/evidence";
import { queryFloodFixture } from "@/lib/flood/fixture-adapter";
import { queryLiveFloodEvidence } from "@/lib/flood/live-adapter";
import { finalizeFloodQueryResult } from "@/lib/flood/service";
import {
  FLOOD_PINNED_FIXTURE_DATE,
  FLOOD_UNSUPPORTED_FIXTURE_DATE,
} from "@/lib/flood/types";

const NOW = new Date("2026-08-11T15:00:00Z");
// ADR-0043: the live adapter accepts only the canonical map-selected area;
// this box covers central Houston and contains the mocked gage coordinate.
const HOUSTON_AREA = { west: -95.6, south: 29.5, east: -95.2, north: 30.0 };
const LIVE_INPUT = {
  placeId: "custom-area",
  area: HOUSTON_AREA,
  startDate: "2024-07-08",
  endDate: "2024-07-08",
  mode: "live" as const,
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/geo+json" },
  });
}

function continuousRow(time: string, value: string, index: number): Record<string, unknown> {
  return {
    type: "Feature",
    id: `USGS-08074500-00065-${index + 1}`,
    properties: {
      monitoring_location_id: "USGS-08074500",
      parameter_code: "00065",
      unit_of_measure: "ft",
      time,
      time_series_id: "ts-08074500-00065",
      value,
      approval_status: "Provisional",
      qualifier: ["P"],
    },
  };
}

function continuousCollection(unit = "ft", features = 1): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    numberReturned: features,
    links: [],
    features: Array.from({ length: features }, (_, index) => {
      const row = continuousRow(
        `2024-07-08T${String(12 + index).padStart(2, "0")}:00:00Z`,
        String(20.5 + index),
        index
      );
      (row.properties as Record<string, unknown>).unit_of_measure = unit;
      return row;
    }),
  };
}

/** bbox discovery response with one in-area USGS gage. */
const DISCOVERY = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-95.4, 29.76] },
      properties: {
        agency_code: "USGS",
        monitoring_location_number: "08074500",
        monitoring_location_name: "Whiteoak Bayou at Houston",
      },
    },
  ],
};

async function png(alpha: number): Promise<Buffer> {
  return sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 10, g: 80, b: 160, alpha: alpha / 255 },
    },
  }).png().toBuffer();
}

async function mockFloodFetch(options: {
  alpha?: number;
  unit?: string;
  features?: number;
  gibsStatus?: number;
  continuous?: Record<string, unknown>;
} = {}): Promise<typeof fetch> {
  const tile = await png(options.alpha ?? 255);
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === "gibs.earthdata.nasa.gov") {
      const body: BodyInit = options.gibsStatus === 429
        ? "rate limited"
        : new Uint8Array(tile).buffer;
      return new Response(body, {
        status: options.gibsStatus ?? 200,
        headers: { "content-type": "image/png" },
      });
    }
    if (url.pathname.includes("/collections/continuous/items")) {
      return jsonResponse(
        options.continuous ?? continuousCollection(options.unit, options.features ?? 1)
      );
    }
    // ADR-0043: the only monitoring-locations request is the bbox discovery;
    // the pinned per-site location lookup no longer exists.
    if (url.pathname.endsWith("/collections/monitoring-locations/items")) {
      return jsonResponse(DISCOVERY);
    }
    throw new Error(`Unexpected URL: ${url.toString()}`);
  }) as unknown as typeof fetch;
}

describe("WP-08 fixture and service integration", () => {
  it("finalizes the pinned Houston fixture with all six separated claims", async () => {
    const adapterResult = queryFloodFixture({
      placeId: "demo-houston",
      date: FLOOD_PINNED_FIXTURE_DATE,
      mode: "fixture",
    });
    const result = await finalizeFloodQueryResult(adapterResult, "home");

    expect(result.kind).toBe("success");
    expect(result.assessments).toHaveLength(6);
    expect(result.assessments?.map((assessment) => assessment.code)).toEqual([
      "satellite_precipitation_visualization",
      "ground_gage_height",
      "surface_water",
      "official_warning",
      "route_disruption",
      "property_impact",
    ]);
    expect(result.assessments?.slice(2).map((assessment) => assessment.status)).toEqual([
      "not_provided",
      "not_provided",
      "not_supported",
      "not_supported",
    ]);
    expect(result.explanationStatus).toEqual({ mode: "deterministic", reason: "validated_evidence" });
    expect(result.explanation?.notSupported.join(" ")).toMatch(/property|route/i);
    validateEvidenceObject(result.evidence);
  });

  it("keeps unsupported coverage and source failure explicit without fallback", () => {
    const unsupported = queryFloodFixture({
      placeId: "demo-houston",
      date: FLOOD_UNSUPPORTED_FIXTURE_DATE,
      mode: "fixture",
    });
    const failed = queryFloodFixture({
      placeId: "demo-source-failure",
      date: FLOOD_PINNED_FIXTURE_DATE,
      mode: "fixture",
    });

    expect(unsupported.kind).toBe("unsupported_coverage");
    expect(unsupported.evidence?.evidenceState).toBe("unsupported_coverage");
    expect(failed.kind).toBe("source_failure");
    expect(failed.evidence?.observations).toEqual([]);
    expect(failed.evidence?.confidence.level).toBe("insufficient");
    validateEvidenceObject(failed.evidence);
  });

  it("rejects unpinned places and dates instead of substituting Houston", () => {
    expect(queryFloodFixture({ placeId: "demo-los-angeles", date: FLOOD_PINNED_FIXTURE_DATE, mode: "fixture" }).kind)
      .toBe("unsupported_place");
    expect(queryFloodFixture({ placeId: "demo-houston", date: "2024-07-09", mode: "fixture" }).kind)
      .toBe("unsupported_date");
  });
});

describe("WP-08 live adapter with mocked official-source responses", () => {
  it("builds validated regional visualization and station evidence without numeric pixel inference", async () => {
    const fetchImpl = await mockFloodFetch();
    const result = await queryLiveFloodEvidence(LIVE_INPUT, { fetchImpl, now: () => NOW });

    expect(result.kind).toBe("success");
    expect(result.evidence?.observations).toHaveLength(3);
    expect(result.evidence?.observations[0].value).toBeUndefined();
    expect(result.evidence?.observations[0].textValue).toMatch(/no numeric precipitation/i);
    expect(result.evidence?.observations[1]).toMatchObject({
      variableName: "VIIRS flood extent visualization",
    });
    expect(result.evidence?.observations[2]).toMatchObject({
      variableName: "Gage height",
      value: 20.5,
      unit: "ft",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const hosts = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.map(([input]) => new URL(String(input)).hostname);
    expect(new Set(hosts)).toEqual(new Set(["gibs.earthdata.nasa.gov", "api.waterdata.usgs.gov"]));
    validateEvidenceObject(result.evidence);

    const finalized = await finalizeFloodQueryResult(result, "home");
    expect(finalized.assessments?.[2]).toMatchObject({
      code: "surface_water",
      status: "evidence_present",
      sourceIds: ["nasa_lance_flood_extent"],
    });
  });

  it("keeps a returned gage inconclusive when both satellite roles are transparent", async () => {
    const result = await queryLiveFloodEvidence(LIVE_INPUT, {
      fetchImpl: await mockFloodFetch({ alpha: 0 }),
      now: () => NOW,
    });
    expect(result.kind).toBe("inconclusive_evidence");
    expect(result.evidence?.evidenceState).toBe("inconclusive_evidence");
    expect(result.evidence?.observations[0].textValue).toMatch(/not zero precipitation/i);
  });

  it("keeps missing ground observations inconclusive", async () => {
    const result = await queryLiveFloodEvidence(LIVE_INPUT, {
      fetchImpl: await mockFloodFetch({ features: 0 }),
      now: () => NOW,
    });
    expect(result.kind).toBe("inconclusive_evidence");
    expect(result.evidence?.observations).toHaveLength(2);
    expect(result.evidence?.confidence.level).toBe("insufficient");
  });

  it("fails closed on a wrong USGS unit or a rate limit", async () => {
    const wrongUnit = await queryLiveFloodEvidence(LIVE_INPUT, {
      fetchImpl: await mockFloodFetch({ unit: "m" }),
      now: () => NOW,
    });
    const rateLimited = await queryLiveFloodEvidence(LIVE_INPUT, {
      fetchImpl: await mockFloodFetch({ gibsStatus: 429 }),
      now: () => NOW,
    });
    expect(wrongUnit).toMatchObject({ kind: "source_failure", failureReason: "schema_validation" });
    expect(rateLimited).toMatchObject({ kind: "source_failure", failureReason: "rate_limited" });
    expect(wrongUnit.evidence?.observations).toEqual([]);
    expect(rateLimited.evidence?.observations).toEqual([]);
  });

  it("rejects an invalid live range before fetch", async () => {
    // UXFIX-02 (ADR-0022): the inclusive live range is now 1-7 days, so the
    // first invalid range is 8 days.
    const fetchImpl = vi.fn();
    const result = await queryLiveFloodEvidence({
      ...LIVE_INPUT,
      endDate: "2024-07-15",
    }, { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => NOW });
    expect(result.kind).toBe("unsupported_date");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies live rejections as date vs place problems (ADR-0043)", async () => {
    const fetchImpl = vi.fn();
    const dependencies = { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => NOW };

    // A non-canonical placeId (including the removed demo-houston live
    // branch) is a place rejection.
    const badPlace = await queryLiveFloodEvidence(
      { ...LIVE_INPUT, placeId: "demo-houston" },
      dependencies
    );
    expect(badPlace.kind).toBe("unsupported_place");

    // Date problems are date rejections, never "Location not supported".
    const preRecord = await queryLiveFloodEvidence(
      { ...LIVE_INPUT, startDate: "1999-12-31", endDate: "1999-12-31" },
      dependencies
    );
    expect(preRecord.kind).toBe("unsupported_date");
    expect(preRecord.rejectionReason).toContain("2000-06-01");

    const incompleteDay = await queryLiveFloodEvidence(
      { ...LIVE_INPUT, startDate: "2026-08-11", endDate: "2026-08-11" },
      dependencies
    );
    expect(incompleteDay.kind).toBe("unsupported_date");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("filters a provider boundary timestamp instead of failing the query (ADR-0043)", async () => {
    const boundary = {
      type: "FeatureCollection",
      numberReturned: 2,
      links: [],
      features: [
        continuousRow("2024-07-08T12:00:00Z", "20.5", 0),
        // Just past the requested window: excluded, not a schema failure.
        continuousRow("2024-07-09T00:00:00Z", "21.5", 1),
      ],
    };
    const result = await queryLiveFloodEvidence(LIVE_INPUT, {
      fetchImpl: await mockFloodFetch({ continuous: boundary }),
      now: () => NOW,
    });
    expect(result.kind).toBe("success");
    const gage = result.evidence?.observations.find(
      (observation) => observation.variableName === "Gage height"
    );
    expect(gage?.value).toBe(20.5);
    expect(gage?.provenance.observedAt).toBe("2024-07-08T12:00:00.000Z");
    validateEvidenceObject(result.evidence);
  });

  it("keeps the Meaning contract intact for a multi-day range (700-char section cap)", async () => {
    // Regression (found in ADR-0044 live verification): a successful
    // multi-day range produces one observation sentence per day and the
    // observed Meaning section exceeded the 700-character contract, crashing
    // the whole query to a 500. The section is now clamped; the full
    // observations stay in the Evidence tab.
    const result = await queryLiveFloodEvidence(
      { ...LIVE_INPUT, startDate: "2024-07-04", endDate: "2024-07-10" },
      { fetchImpl: await mockFloodFetch(), now: () => NOW }
    );
    expect(result.kind).toBe("success");
    expect(result.evidence?.observations.length).toBeGreaterThanOrEqual(9);
    const finalized = await finalizeFloodQueryResult(result, "home");
    const observedSection = finalized.explanation?.meaning?.sections.find(
      (section) => section.kind === "observed"
    );
    expect(observedSection).toBeDefined();
    expect(observedSection!.body.length).toBeLessThanOrEqual(700);
    expect(observedSection!.body.length).toBeGreaterThan(500);
  });

  it("states the flood-extent composite window in the evidence (ADR-0043)", async () => {
    const result = await queryLiveFloodEvidence(LIVE_INPUT, {
      fetchImpl: await mockFloodFetch(),
      now: () => NOW,
    });
    const visualOnly = result.evidence?.limitations.find(
      (limitation) => limitation.limitationId === "lim-wp10-live-flood-extent-visual-only"
    );
    expect(visualOnly?.description).toContain("2024-07-06 through 2024-07-08 UTC");
    expect(visualOnly?.description).toMatch(/any day in that window/i);
  });
});
