import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { validateEvidenceObject } from "@/contracts/evidence";
import { DROUGHT_PINNED_FIXTURE_DATE } from "@/lib/drought/types";

// Mock the live adapter so integration tests never make real network calls
const mockQueryLive = vi.fn();
vi.mock("@/lib/drought/live-adapter", () => ({
  queryLiveDroughtEvidence: mockQueryLive,
}));

// Helper to call the route handler
async function postRoute(body: unknown): Promise<{ status: number; json: unknown }> {
  // Dynamic import after mocking
  const { POST } = await import("@/app/api/drought/query/route");
  const request = new Request("http://localhost/api/drought/query", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  const response = await POST(request);
  return { status: response.status, json: await response.json() };
}

describe("WP-10 drought route", () => {
  // Exact input rejection
  it("rejects missing placeId", async () => {
    const { status, json } = await postRoute({ date: "2024-06-04", mode: "fixture", concern: "home" });
    expect(status).toBe(400);
    expect(json).toMatchObject({ ok: false, error: "invalid_input" });
  });

  it("rejects missing date", async () => {
    const { status, json } = await postRoute({ placeId: "demo-tucson", mode: "fixture", concern: "home" });
    expect(status).toBe(400);
    expect(json).toMatchObject({ ok: false, error: "invalid_input" });
  });

  it("rejects invalid mode", async () => {
    const { status, json } = await postRoute({ placeId: "demo-tucson", date: "2024-06-04", mode: "cache", concern: "home" });
    expect(status).toBe(400);
    expect(json).toMatchObject({ ok: false, error: "invalid_input" });
  });

  it("rejects invalid concern", async () => {
    const { status, json } = await postRoute({ placeId: "demo-tucson", date: "2024-06-04", mode: "fixture", concern: "unknown_concern" });
    expect(status).toBe(400);
    expect(json).toMatchObject({ ok: false, error: "invalid_input" });
  });

  it("rejects extra keys", async () => {
    const { status, json } = await postRoute({ placeId: "demo-tucson", date: "2024-06-04", mode: "fixture", concern: "home", extra: "field" });
    expect(status).toBe(400);
    expect(json).toMatchObject({ ok: false, error: "invalid_input" });
  });

  it("rejects invalid JSON", async () => {
    const { POST } = await import("@/app/api/drought/query/route");
    const request = new Request("http://localhost/api/drought/query", {
      method: "POST",
      body: "not json }{",
      headers: { "Content-Type": "application/json" },
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json() as { ok: boolean; error: string };
    expect(body).toMatchObject({ ok: false, error: "invalid_input" });
  });

  it("rejects non-string placeId", async () => {
    const { status } = await postRoute({ placeId: 123, date: "2024-06-04", mode: "fixture", concern: "home" });
    expect(status).toBe(400);
  });

  // Fixture success (demo-tucson + pinned date)
  it("fixture success: returns 200 ok envelope with validated evidence", async () => {
    const { status, json } = await postRoute({
      placeId: "demo-tucson",
      date: DROUGHT_PINNED_FIXTURE_DATE,
      mode: "fixture",
      concern: "home",
    });
    expect(status).toBe(200);
    const body = json as { ok: boolean; result: { kind: string; evidence: unknown } };
    expect(body.ok).toBe(true);
    expect(body.result.kind).toBe("success");
    expect(() => validateEvidenceObject(body.result.evidence)).not.toThrow();
  });

  // Fixture no-observation
  it("fixture no-observation: returns 200 with no_observation kind", async () => {
    const { status, json } = await postRoute({
      placeId: "demo-tucson",
      date: "2024-06-11",
      mode: "fixture",
      concern: "health",
    });
    expect(status).toBe(200);
    const body = json as { ok: boolean; result: { kind: string } };
    expect(body.ok).toBe(true);
    expect(body.result.kind).toBe("no_observation");
  });

  // Live mocked success
  it("live mode: dispatches to live adapter and returns 200", async () => {
    // Use a source_failure mock (no observations, missions failed = empty contributedIds OK)
    // which has a valid evidence object that passes validateEvidenceObject
    const mockResult = {
      kind: "source_failure" as const,
      sourceOutcomes: { gibs: "failed" as const, usdm: "failed" as const },
      evidence: {
        evidenceId: "evd-wp10-drought-live-2024-06-04",
        hazardId: "drought_land",
        intentId: "intent-wp10-drought-live-demo-tucson-2024-06-04",
        evidenceState: "source_failure",
        dataMode: "failed",
        observations: [],
        derivedMetrics: [],
        missionAttributions: [
          {
            missionName: "Terra MODIS NDVI visualization",
            agency: "NASA",
            purpose: "Regional 16-day vegetation visualization.",
            selectionReason: "Primary vegetation-evidence role for regional drought context.",
            contributedObservationIds: [],
            retrievalStatus: "failed",
            keyLimitation: "Visualization only; it does not provide numeric NDVI or property conditions.",
            datasetId: "MODIS_Terra_L3_NDVI_16Day_v6.1_STD",
          },
          {
            missionName: "U.S. Drought Monitor regional statistics",
            agency: "NDMC / USDA / NOAA",
            purpose: "Weekly regional drought-category confirmation.",
            selectionReason: "Supporting official regional-confirmation role alongside the vegetation evidence.",
            contributedObservationIds: [],
            retrievalStatus: "failed",
            keyLimitation: "Statewide percentages do not establish property or household water conditions.",
            datasetId: "USDM_StateStatistics_PercentArea",
          },
        ],
        freshness: {
          status: "unknown",
          classificationBasis: "no_observation_time",
          evaluatedAt: "2026-08-13T12:00:00Z",
          note: "No usable observation time is available; missing evidence is not no drought or no danger.",
        },
        confidence: {
          level: "insufficient",
          rationale: "The bounded regional evidence chain contains no usable observation; no drought, property, household-water, or safety conclusion is supported.",
        },
        limitations: [
          {
            limitationId: "lim-wp10-gibs-visual-only",
            source: "nasa_gibs_modis_ndvi_16day",
            description: "GIBS NDVI imagery is visualization only; numeric NDVI, vegetation trend, drought cause, crop condition, and property condition are not inferred from PNG colors.",
            required: true,
          },
          {
            limitationId: "lim-wp10-usdm-regional",
            source: "us_drought_monitor_rest",
            description: "USDM percentages are weekly statewide context; D0 is not drought and no category establishes property or household water conditions.",
            required: true,
          },
          {
            limitationId: "lim-wp10-scale-mismatch",
            source: "nasa_gibs_modis_ndvi_16day",
            description: "The regional satellite visualization and statewide USDM statistics use different scales and cannot be treated as property-level agreement.",
            required: true,
          },
          {
            limitationId: "lim-wp10-failure-no-fallback",
            source: "us_drought_monitor_rest",
            description: "No fixture, stale value, cached value, or alternate source was substituted for failed live retrieval.",
            required: true,
          },
        ],
        explanations: [],
        assembledAt: "2026-08-13T12:00:00Z",
      },
      failureReason: "provider_failure" as const,
      failureStage: "gibs_domain_transport" as const,
    };

    mockQueryLive.mockResolvedValueOnce(mockResult);

    const area = { west: -111.3, south: 32, east: -110.7, north: 32.6 };

    const { status, json } = await postRoute({
      placeId: "custom-area",
      date: "2024-06-04",
      mode: "live",
      concern: "home",
      area,
    });
    expect(status).toBe(200);
    const body = json as { ok: boolean; result: { kind: string } };
    expect(body.ok).toBe(true);
    expect(body.result.kind).toBe("source_failure");
    expect(mockQueryLive).toHaveBeenCalledWith(
      expect.objectContaining({ placeId: "custom-area", date: "2024-06-04", mode: "live", area })
    );
  });

  it("live mocked success returns a validated live evidence envelope", async () => {
    const actualAdapter = await vi.importActual<typeof import("@/lib/drought/live-adapter")>(
      "@/lib/drought/live-adapter"
    );
    const png = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 4,
        background: { r: 80, g: 140, b: 90, alpha: 1 },
      },
    }).png().toBuffer();
    const pngBody = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(
          "<root><DimensionDomain>2024-05-08/2024-06-25/P16D</DimensionDomain></root>",
          { status: 200, headers: { "Content-Type": "text/xml" } }
        );
      }
      if (url.includes("gibs.earthdata.nasa.gov")) {
        return new Response(pngBody, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      return new Response(
        JSON.stringify([
          {
            mapDate: "6/4/2024",
            stateAbbreviation: "AZ",
            none: 28.64,
            d0: 71.36,
            d1: 20.02,
            d2: 3.15,
            d3: 0,
            d4: 0,
            validStart: "6/4/2024",
            validEnd: "6/10/2024",
            statisticFormatID: 1,
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;
    const liveResult = await actualAdapter.queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => new Date("2026-08-13T12:00:00Z") }
    );
    expect(liveResult.kind).toBe("success");
    mockQueryLive.mockResolvedValueOnce(liveResult);

    const area = { west: -111.3, south: 32, east: -110.7, north: 32.6 };

    const { status, json } = await postRoute({
      placeId: "custom-area",
      date: "2024-06-04",
      mode: "live",
      concern: "home",
      area,
    });

    expect(status).toBe(200);
    const body = json as {
      ok: boolean;
      result: { kind: string; evidence: { dataMode: string } };
    };
    expect(body.ok).toBe(true);
    expect(body.result.kind).toBe("success");
    expect(body.result.evidence.dataMode).toBe("live");
    expect(() => validateEvidenceObject(body.result.evidence)).not.toThrow();
  });

  it("rejects custom-area live input when the canonical bbox is missing", async () => {
    const { status, json } = await postRoute({
      placeId: "custom-area",
      date: "2024-06-04",
      mode: "live",
      concern: "home",
    });

    expect(status).toBe(400);
    expect(json).toMatchObject({ ok: false, error: "invalid_input" });
  });

  it("rejects a custom-area bbox in fixture mode", async () => {
    const { status } = await postRoute({
      placeId: "custom-area",
      date: "2024-06-04",
      mode: "fixture",
      concern: "home",
      area: { west: -74.3, south: 40.4, east: -73.6, north: 41 },
    });
    expect(status).toBe(400);
  });

  it("passes a validated custom-area bbox atomically to the live adapter", async () => {
    mockQueryLive.mockResolvedValueOnce({
      kind: "unsupported_place",
      sourceOutcomes: { gibs: "not_attempted", usdm: "not_attempted" },
      rejectionReason: "Adapter sentinel used by the route contract test.",
    });

    const area = { west: -74.3, south: 40.4, east: -73.6, north: 41 };

    const { status, json } = await postRoute({
      placeId: "custom-area",
      date: "2024-06-04",
      mode: "live",
      concern: "home",
      area,
    });
    expect(status).toBe(200);
    const body = json as { ok: boolean; result: { kind: string } };
    expect(body.ok).toBe(true);
    expect(body.result.kind).toBe("unsupported_place");
    expect(mockQueryLive).toHaveBeenLastCalledWith({
      placeId: "custom-area",
      date: "2024-06-04",
      mode: "live",
      area,
    });
  });

  // Unexpected 500
  it("unexpected throw returns 500 validation_failed", async () => {
    mockQueryLive.mockRejectedValueOnce(new Error("unexpected crash"));

    const { status, json } = await postRoute({
      placeId: "custom-area",
      date: "2024-06-04",
      mode: "live",
      concern: "home",
      area: { west: -111.3, south: 32, east: -110.7, north: 32.6 },
    });
    expect(status).toBe(500);
    expect(json).toMatchObject({ ok: false, error: "validation_failed" });
  });

  // Zero live network from fixture mode
  it("fixture mode makes zero live network calls", async () => {
    mockQueryLive.mockClear();
    await postRoute({
      placeId: "demo-tucson",
      date: DROUGHT_PINNED_FIXTURE_DATE,
      mode: "fixture",
      concern: "home",
    });
    expect(mockQueryLive).not.toHaveBeenCalled();
  });
});
