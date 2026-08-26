import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  queryVolcanoEvidence,
  type VolcanoEvidenceDiagnostics,
} from "@/lib/coverage-gap/service";
import { runWp12GuardedQuery } from "@/lib/coverage-gap/wp12-live-smoke-report";

const DATE = "2024-06-03";
const NOW = new Date("2026-08-17T20:45:00Z");
const AREA = { west: -156.2, south: 18.8, east: -154.7, north: 20.3 };

async function transparentOmpsPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toBuffer();
}

describe("WP-12 live-smoke safe diagnostics", () => {
  it("converts an unexpected product-path exception to a value-free safe report", async () => {
    const rawMarker = "UNEXPECTED_PRODUCT_PATH_RAW_MARKER_MUST_NOT_ESCAPE";
    const requests = [{
      role: "hans_search",
      host: "volcanoes.usgs.gov",
      path: "/hans-public/api/search/search",
      method: "POST",
    }];

    const guarded = await runWp12GuardedQuery(
      async () => { throw new Error(rawMarker); },
      { date: DATE, area: AREA, maximumRequests: 4, requests }
    );

    expect(guarded).toEqual({
      kind: "failure",
      report: {
        gate: "WP-12 Earth & Volcanoes three-source product path",
        date: DATE,
        area: AREA,
        maximumRequests: 4,
        realizedRequests: 1,
        requests,
        resultKind: "source_failure",
        sourceOutcomes: null,
        sourceFailureDiagnostics: [],
        observationCounts: null,
        payloadHashes: [],
        rejectionReason:
          "The product path failed closed before a validated evidence result was available.",
        noPrediction: true,
        rawPayloadRetained: false,
        retries: 0,
        fallbacks: 0,
        failureStage: "product_path",
        failureClass: "unexpected_exception",
      },
    });
    expect(JSON.stringify(guarded)).not.toContain(rawMarker);
  });

  it("captures only source failure class and stage without headers or payloads", async () => {
    const omps = await transparentOmpsPng();
    const fetchImpl = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      const url = new URL(request instanceof Request ? request.url : request.toString());
      if (url.hostname === "gibs.earthdata.nasa.gov") {
        return new Response(new Uint8Array(omps).buffer, {
          status: 200,
          headers: { "Content-Type": "image/png", "Content-Length": String(omps.byteLength) },
        });
      }
      if (url.pathname.endsWith("getUSVolcanoes")) {
        return Response.json([{
          volcano_cd: "hi-test",
          volcano_name: "Deterministic Hawaii volcano",
          latitude: 19.4,
          longitude: -155.3,
          obs_abbr: "HVO",
        }]);
      }
      if (url.pathname.endsWith("/search/search") && init?.method === "POST") {
        return Response.json({ rawMarker: "HANS_RAW_MARKER" }, {
          headers: { "X-Diagnostic-Secret": "not-for-output" },
        });
      }
      if (url.pathname === "/fdsnws/event/1/query") {
        return Response.json({ rawMarker: "FDSN_RAW_MARKER" });
      }
      throw new Error(`Unexpected deterministic request: ${url.hostname}${url.pathname}`);
    }) as unknown as typeof fetch;
    const diagnostics: VolcanoEvidenceDiagnostics = { sourceFailures: [] };

    const result = await queryVolcanoEvidence({
      placeId: "custom-area",
      area: AREA,
      date: DATE,
      concern: "community",
    }, { fetchImpl, now: () => NOW, diagnostics });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(result.kind).toBe("source_failure");
    expect(result.sourceOutcomes).toMatchObject({
      nasa_gibs_omps_so2: "no_observation",
      usgs_volcano_hans: "source_failure",
      usgs_earthquake_geojson: "source_failure",
      earthquake_prediction: "out_of_scope",
    });
    expect(diagnostics.sourceFailures).toEqual([
      {
        sourceId: "usgs_volcano_hans",
        reason: "schema_validation",
        stage: "notice_search",
        schemaDiagnostic: {
          path: "$.noticeTotal",
          expected: "safe non-negative integer",
          actualType: "missing",
        },
      },
      {
        sourceId: "usgs_earthquake_geojson",
        reason: "schema_validation",
        stage: "event_query",
        schemaDiagnostic: {
          path: "$.type",
          expected: 'literal "FeatureCollection"',
          actualType: "missing",
        },
      },
    ]);
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("RAW_MARKER");
    expect(serialized).not.toContain("Diagnostic-Secret");
    expect(serialized).not.toContain("not-for-output");
  });
});
