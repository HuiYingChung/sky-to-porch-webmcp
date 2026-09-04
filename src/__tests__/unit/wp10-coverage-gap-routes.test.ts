import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONCERN_TYPES, type ConcernType } from "@/contracts/common";
import { US_COVERAGE_AREA_CASES } from "@/data/us-coverage-matrix";
import { POST as postAir } from "@/app/api/air/query/route";
import { POST as postVolcano } from "@/app/api/volcano/query/route";
import {
  airNowGuardContract,
  buildAtmosphericRequest,
} from "@/lib/coverage-gap/atmospheric-source-contract";
import {
  queryAirQualityEvidence,
  queryVolcanoEvidence,
} from "@/lib/coverage-gap/service";
import { CoverageGapInsightPanel } from "@/components/coverage-gap/coverage-gap-panel";

const NOW = new Date("2026-08-14T12:00:00Z");

function input(concern: ConcernType = "home") {
  return {
    placeId: "custom-area" as const,
    area: US_COVERAGE_AREA_CASES[0].area,
    date: "2024-07-08",
    concern,
  };
}

async function png(alpha = 255): Promise<Buffer> {
  return sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 40, g: 80, b: 120, alpha: alpha / 255 },
    },
  }).png().toBuffer();
}

function airNowDailyLine(latitude = "40.7128", longitude = "-74.0060"): string {
  return [
    "07/08/24",
    "360610007",
    "Deterministic New York monitor",
    "PM2.5-24HR",
    "UG/M3",
    "11.2",
    "24",
    "Deterministic AirNow fixture",
    "42",
    "0",
    latitude,
    longitude,
    "840360610007",
  ].join("|");
}

async function mockFetch(
  alpha = 255,
  airNowStatus = 200,
  airNowBody = airNowDailyLine(),
  earthquakeFeatures: unknown[] = [],
): Promise<typeof fetch> {
  const image = await png(alpha);
  return vi.fn(async (request: string | URL | Request) => {
    const url = new URL(request instanceof Request ? request.url : request.toString());
    if (url.hostname === "gibs.earthdata.nasa.gov") {
      return new Response(new Uint8Array(image).buffer, {
        status: 200,
        headers: { "Content-Type": "image/png", "Content-Length": String(image.byteLength) },
      });
    }
    if (url.hostname === "files.airnowtech.org") {
      return airNowStatus === 200
        ? new Response(airNowBody, {
            status: 200,
            headers: { "Content-Type": "binary/octet-stream" },
          })
        : new Response(null, { status: airNowStatus });
    }
    if (url.pathname.endsWith("getUSVolcanoes")) {
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/fdsnws/event/1/query") {
      return Response.json({
        type: "FeatureCollection",
        metadata: { generated: Date.parse("2024-07-08T13:00:00Z"), count: earthquakeFeatures.length, status: 200 },
        features: earthquakeFeatures,
      });
    }
    if (url.hostname === "webservices.volcano.si.edu") {
      return Response.json({ type: "FeatureCollection", numberMatched: 0, features: [] });
    }
    throw new Error(`unexpected mocked request ${url.hostname}${url.pathname}`);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Air Quality and Earth & Volcanoes live query routes", () => {
  it.each(US_COVERAGE_AREA_CASES)(
    "builds exact queryable AOD and OMPS contracts for $region / $label",
    (coverageCase) => {
      for (const sourceId of ["nasa_gibs_modis_aod", "nasa_gibs_omps_so2"] as const) {
        const request = buildAtmosphericRequest(sourceId, "2024-07-08", coverageCase.area);
        const url = new URL(request.url);
        expect(url.searchParams.get("BBOX")).toBe(
          `${coverageCase.area.west},${coverageCase.area.south},${coverageCase.area.east},${coverageCase.area.north}`
        );
        expect(request.externalCallsEnabled).toBe(true);
        expect(request.productQueryable).toBe(true);
      }
    }
  );

  it("keeps AirNow behind server-only cache/rate/concurrency controls without reading a key", () => {
    expect(airNowGuardContract()).toMatchObject({
      requiresServerKey: true,
      serverOnly: true,
      maximumUpstreamRequestsPerQuery: 1,
      maximumConcurrentUpstreamRequests: 2,
      minimumCacheTtlSeconds: 300,
      maximumQueriesPerClientPerMinute: 6,
      credentialValueRead: false,
      externalCallsEnabled: false,
      productQueryable: false,
    });
  });

  it("keeps concern and question out of deterministic source selection", async () => {
    const fetchImpl = await mockFetch();
    const air = await Promise.all(CONCERN_TYPES.map((concern) => queryAirQualityEvidence({
      ...input(),
      concern,
      optionalQuestion: concern === "pets" ? "What about my dog?" : undefined,
    }, { fetchImpl, now: () => NOW })));
    expect(new Set(air.map((result) => JSON.stringify(result.sourceOutcomes))).size).toBe(1);
    expect(new Set(air.map((result) => JSON.stringify(result.area))).size).toBe(1);
    expect(air.every((result) => result.kind === "success")).toBe(true);

    const volcano = await Promise.all(CONCERN_TYPES.map((concern) => queryVolcanoEvidence({
      ...input(), concern,
    }, { fetchImpl, now: () => NOW })));
    expect(new Set(volcano.map((result) => JSON.stringify(result.sourceOutcomes))).size).toBe(1);
    expect(volcano.every((result) => result.sourceOutcomes.earthquake_prediction === "out_of_scope"))
      .toBe(true);
  });

  it("composes live satellite context with separate AirNow daily outdoor AQI", async () => {
    vi.stubGlobal("fetch", await mockFetch());
    const response = await postAir(new Request("http://localhost/api/air/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input()),
    }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.result.kind).toBe("success");
    expect(payload.result.retrievalAttempted).toBe(true);
    expect(payload.result.sourceOutcomes).toEqual({
      nasa_gibs_modis_aod: "success",
      airnow_daily_data: "success",
      epa_aqs: "credential_gate_closed",
    });
    expect(payload.result.evidence.observations).toHaveLength(2);
    expect(payload.result.evidence.observations[1]).toMatchObject({
      value: 42,
      unit: "AQI",
      provenance: { sourceId: "airnow_daily_data", observedAt: "unknown" },
      metadata: { validDate: "2024-07-08" },
    });
  });

  it("keeps satellite evidence separate when the AirNow daily source fails", async () => {
    const result = await queryAirQualityEvidence(input(), {
      fetchImpl: await mockFetch(255, 503),
      now: () => NOW,
    });
    expect(result.kind).toBe("inconclusive_evidence");
    expect(result.sourceOutcomes).toEqual({
      nasa_gibs_modis_aod: "success",
      airnow_daily_data: "source_failure",
      epa_aqs: "credential_gate_closed",
    });
    expect(result.evidence?.observations).toHaveLength(1);
    expect(result.rejectionReason).toContain("missing ground evidence is not clean air");
  });

  it("keeps AirNow no-observation distinct from clean air", async () => {
    const result = await queryAirQualityEvidence(input(), {
      fetchImpl: await mockFetch(255, 200, airNowDailyLine("29.7604", "-95.3698")),
      now: () => NOW,
    });
    expect(result.kind).toBe("inconclusive_evidence");
    expect(result.sourceOutcomes).toEqual({
      nasa_gibs_modis_aod: "success",
      airnow_daily_data: "no_observation",
      epa_aqs: "credential_gate_closed",
    });
    expect(result.evidence?.observations).toHaveLength(1);
    expect(result.rejectionReason).toContain("no nearby row is not clean air");
  });

  it("returns truthful volcano no_observation without prediction", async () => {
    vi.stubGlobal("fetch", await mockFetch(0));
    const response = await postVolcano(new Request("http://localhost/api/volcano/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input()),
    }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.kind).toBe("no_observation");
    expect(payload.result.retrievalAttempted).toBe(true);
    expect(payload.result.sourceOutcomes.earthquake_prediction).toBe("out_of_scope");
    expect(payload.result.sourceOutcomes.usgs_earthquake_geojson).toBe("no_observation");
    expect(payload.result.evidence.observations).toHaveLength(0);
  });

  it("keeps an observed earthquake event separate when satellite evidence does not contribute", async () => {
    const area = input().area;
    const eventTime = Date.parse("2024-07-08T12:00:00Z");
    const earthquake = {
      type: "Feature",
      id: "us7000integration",
      properties: {
        mag: 2.4,
        place: "Deterministic observed event",
        time: eventTime,
        updated: eventTime + 60_000,
        status: "reviewed",
        magType: "ml",
        type: "earthquake",
      },
      geometry: {
        type: "Point",
        coordinates: [(area.west + area.east) / 2, (area.south + area.north) / 2, 5],
      },
    };
    const result = await queryVolcanoEvidence(input(), {
      fetchImpl: await mockFetch(0, 200, airNowDailyLine(), [earthquake]),
      now: () => NOW,
    });
    expect(result.kind).toBe("inconclusive_evidence");
    expect(result.sourceOutcomes).toEqual({
      nasa_gibs_omps_so2: "no_observation",
      usgs_volcano_hans: "no_observation",
      usgs_earthquake_geojson: "success",
      smithsonian_gvp_eruptions: "no_observation",
      earthquake_prediction: "out_of_scope",
    });
    expect(result.evidence?.observations).toHaveLength(1);
    expect(result.evidence?.observations[0]).toMatchObject({
      value: 2.4,
      unit: "magnitude",
      provenance: { sourceId: "usgs_earthquake_geojson" },
    });
    expect(result.rejectionReason).toContain("no meaningful satellite connection is claimed");
    expect(result.limitations.join(" ")).toContain("do not predict earthquakes or eruptions");
  });

  // Both coverage-gap routes use deterministic explanation over validated evidence.
  it("attaches the air explanation with the official EPA category", async () => {
    vi.stubGlobal("fetch", await mockFetch());
    const response = await postAir(new Request("http://localhost/api/air/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input("health")),
    }));
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.result.explanationStatus).toEqual({
      mode: "deterministic",
      reason: "validated_evidence",
    });
    const directAnswer = payload.result.explanation.meaning.directAnswer as string;
    expect(directAnswer).toContain("air-quality index at 42");
    expect(directAnswer).toContain('"Good" on the official U.S. EPA Air Quality Index scale');
    expect(payload.result.evidence.explanations).toHaveLength(1);
    expect(payload.result.explanation.aiGenerated).toBe(false);
  });

  it("attaches the earth explanation without inventing a prediction", async () => {
    const area = input().area;
    const eventTime = Date.parse("2024-07-08T12:00:00Z");
    const earthquake = {
      type: "Feature",
      id: "us7000adr0045",
      properties: {
        mag: 4.6,
        place: "Deterministic strongest event",
        time: eventTime,
        updated: eventTime + 60_000,
        status: "reviewed",
        magType: "ml",
        type: "earthquake",
      },
      geometry: {
        type: "Point",
        coordinates: [(area.west + area.east) / 2, (area.south + area.north) / 2, 5],
      },
    };
    vi.stubGlobal("fetch", await mockFetch(0, 200, airNowDailyLine(), [earthquake]));
    const response = await postVolcano(new Request("http://localhost/api/volcano/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input("community")),
    }));
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.result.kind).toBe("inconclusive_evidence");
    expect(payload.result.explanationStatus.mode).toBe("deterministic");
    expect(payload.result.explanation.meaning.answerMode).toBe("deterministic_fallback");
    const meaningText = JSON.stringify(payload.result.explanation.meaning);
    expect(meaningText).not.toMatch(/predict(?:s|ed)? (?:an )?(?:earthquake|eruption)/iu);
    expect(payload.result.evidence.explanations).toHaveLength(1);
  });

  // Regression (found on the real Kīlauea 2024-06-03 card, 306 observations):
  // a conflict listing hundreds of observation ids overflowed the limitation
  // section's 700-char Meaning contract and crashed the route to a 500.
  it("clamps the conflict limitation on an earthquake-swarm day instead of failing", async () => {
    const area = input().area;
    const eventTime = Date.parse("2024-07-08T12:00:00Z");
    const swarm = Array.from({ length: 300 }, (_, index) => ({
      type: "Feature",
      id: `us-swarm-${index}`,
      properties: {
        mag: 1 + (index % 40) / 10,
        place: "Deterministic swarm event",
        time: eventTime + index * 1_000,
        updated: eventTime + index * 1_000 + 60_000,
        status: "reviewed",
        magType: "ml",
        type: "earthquake",
      },
      geometry: {
        type: "Point",
        coordinates: [(area.west + area.east) / 2, (area.south + area.north) / 2, 5],
      },
    }));
    vi.stubGlobal("fetch", await mockFetch(0, 200, airNowDailyLine(), swarm));
    const response = await postVolcano(new Request("http://localhost/api/volcano/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input("power_internet")),
    }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.result.explanationStatus.mode).toBe("deterministic");
    for (const section of payload.result.explanation.meaning.sections) {
      expect(section.body.length).toBeLessThanOrEqual(700);
    }
  });

  it("rejects non-canonical identity and does not turn today into evidence", async () => {
    const badPlace = await postAir(new Request("http://localhost/api/air/query", {
      method: "POST",
      body: JSON.stringify({ ...input(), placeId: "demo-new-york" }),
    }));
    expect(badPlace.status).toBe(400);

    const result = await queryVolcanoEvidence(
      { ...input(), date: "2026-08-14" },
      { fetchImpl: vi.fn() as unknown as typeof fetch, now: () => NOW }
    );
    expect(result.kind).toBe("unsupported_date");
    expect(result.retrievalAttempted).toBe(false);
  });

  it("renders live Meaning, Evidence, and Missions without changing retrieval", async () => {
    const result = await queryAirQualityEvidence({
      ...input("pets"),
      optionalQuestion: "Can my dog go outside?",
    }, { fetchImpl: await mockFetch(), now: () => NOW });
    const html = ["meaning", "evidence", "missions"].map((tab) =>
      renderToStaticMarkup(
        React.createElement(CoverageGapInsightPanel, {
          result,
          tab: tab as "meaning" | "evidence" | "missions",
        })
      )
    ).join("\n");
    expect(html).toContain("Live retrieval");
    expect(html).toContain("Retrieval attempted: <strong>yes</strong>");
    expect(html).toContain("AirNow daily outdoor AQI");
    expect(html).toContain("42 on the air quality index");
    expect(html).toContain("UTC instant unavailable");
    expect(html).toContain("AOD is never rewritten as AQI");
    expect(html).toContain("Validated observations");

    const visible = document.createElement("div");
    visible.innerHTML = html;
    const visibleText = visible.textContent ?? "";
    for (const observation of result.evidence?.observations ?? []) {
      expect(visibleText).not.toContain(observation.observationId);
      expect(visibleText).not.toContain(observation.provenance.sourceId);
      expect(visibleText).not.toContain(observation.provenance.payloadHash);
      expect(visibleText).not.toContain(observation.provenance.product);
    }
  });
});
