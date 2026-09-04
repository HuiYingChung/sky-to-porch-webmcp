/**
 * OTH-WP-05-005 deterministic tests for bounded NOAA HMS temporal retrieval.
 * Fetch is always injected; this suite never contacts NOAA.
 */

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { validateEvidenceObject, validateObservation } from "@/contracts/evidence";
import { parseHmsKml } from "@/lib/fire/hms-kml";
import { queryLiveFireEvidence } from "@/lib/fire/live-adapter";
import type { HmsLiveDependencies } from "@/lib/fire/live-adapter";
import { HMS_COMMON_START_DATE, LA_FIRE_BOX, LAKE_MICHIGAN_FIRE_BOX } from "@/lib/fire/types";
import { observationsFromWfigsGeoJson } from "@/lib/fire/wfigs-live-adapter";

const KML_MEDIA_TYPE = "application/vnd.google-earth.kml+xml";
const TEXT_MEDIA_TYPE = "text/plain";
const FIXED_NOW = "2026-08-07T19:00:00.000Z";

const LA_FIRE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><Point><coordinates>-118.5,34.1,0</coordinates></Point></Placemark>
  <Placemark><Point><coordinates>-118.2,34.3,0</coordinates></Point></Placemark>
  <Placemark><Point><coordinates>-80,40,0</coordinates></Point></Placemark>
</Document></kml>`;

const LA_SMOKE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><Polygon>
  <outerBoundaryIs><LinearRing><coordinates>
    -118.5,34.1,0 -118.4,34.2,0 -118.3,34.1,0 -118.5,34.1,0
  </coordinates></LinearRing></outerBoundaryIs>
</Polygon></Placemark></Document></kml>`;

const EMPTY_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document></Document></kml>`;
const MALFORMED_XML = "this is not XML <<< broken";
const NO_KML_ROOT = `<?xml version="1.0"?><root><foo>bar</foo></root>`;

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function dayOfYear(date: string): string {
  const year = Number(date.slice(0, 4));
  const ms = Date.parse(`${date}T00:00:00Z`);
  const day = Math.floor((ms - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  return `${year}${String(day).padStart(3, "0")}`;
}

function fireText(date: string, rows: string[] = [
  `-118.500000, 34.100000, ${dayOfYear(date)}, 0201, GOES-EAST, NGFS, 62, 40.390`,
  `-80.000000, 40.000000, ${dayOfYear(date)}, 1345, GOES-WEST, NGFS, 42, 5.000`,
]): string {
  return [
    "Lon, Lat, YearDay, Time, Satellite, Method, Ecosystem, FRP",
    ...rows,
    "",
  ].join("\n");
}

function byteResponse(
  payload: string | Uint8Array,
  mediaType: string,
  init: ResponseInit = {},
): Response {
  const bytes = typeof payload === "string" ? encode(payload) : payload;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", mediaType);
  return new Response(body, { ...init, headers });
}

function urlText(value: string | URL | Request): string {
  return typeof value === "string" ? value : value instanceof URL ? value.href : value.url;
}

function isoDateFromProductUrl(url: string): string {
  const match = url.match(/hms_(?:fire|smoke)(\d{8})\.(?:txt|kml)$/);
  if (!match) throw new Error(`unexpected test URL: ${url}`);
  return `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`;
}

function completedHeaders(date: string): HeadersInit {
  const nextDayTenUtc = Date.parse(`${date}T00:00:00Z`) + 34 * 60 * 60 * 1000;
  return { "Last-Modified": new Date(nextDayTenUtc).toUTCString() };
}

function successfulFetch(options: {
  smoke?: string;
  fireKml?: string;
  fireTextForDate?: (date: string) => string;
  wfigsForDate?: (date: string) => unknown;
} = {}): HmsLiveDependencies["fetch"] {
  return vi.fn(async (request) => {
    const url = urlText(request);
    if (url.includes("WFIGS_Interagency_Perimeters")) {
      const where = new URL(url).searchParams.get("where") ?? "";
      const requestedDate = where.match(/DATE '(\d{4}-\d{2}-\d{2})/u)?.[1];
      if (!requestedDate) throw new Error(`missing WFIGS requested date: ${url}`);
      return Response.json(
        options.wfigsForDate?.(requestedDate) ?? {
          type: "FeatureCollection",
          features: [],
        },
      );
    }
    const date = isoDateFromProductUrl(url);
    if (url.includes("Smoke_Polygons")) {
      return byteResponse(options.smoke ?? LA_SMOKE_KML, KML_MEDIA_TYPE, {
        headers: completedHeaders(date),
      });
    }
    if (url.endsWith(".kml")) {
      return byteResponse(options.fireKml ?? LA_FIRE_KML, KML_MEDIA_TYPE, {
        headers: completedHeaders(date),
      });
    }
    return byteResponse(options.fireTextForDate?.(date) ?? fireText(date), TEXT_MEDIA_TYPE, {
      headers: completedHeaders(date),
    });
  }) as HmsLiveDependencies["fetch"];
}

function deps(fetch: HmsLiveDependencies["fetch"]): HmsLiveDependencies {
  return { fetch, nowIso: () => FIXED_NOW };
}

function rangeInput(startDate = "2026-08-06", endDate = startDate) {
  return {
    placeId: "demo-los-angeles",
    mode: "live" as const,
    time: { kind: "range" as const, startDate, endDate },
  };
}

describe("parseHmsKml", () => {
  it("counts fire points and smoke coordinates inside a box", () => {
    const fire = parseHmsKml(encode(LA_FIRE_KML), "fire_points", LA_FIRE_BOX);
    const smoke = parseHmsKml(encode(LA_SMOKE_KML), "smoke_polygons", LA_FIRE_BOX);
    expect(fire).toMatchObject({ totalCoordinatePairs: 3, inBoxCoordinatePairs: 2, placemarkCount: 3 });
    expect(smoke.inBoxCoordinatePairs).toBe(4);
  });

  it("returns zero for valid empty KML and for data outside the box", () => {
    expect(parseHmsKml(encode(EMPTY_KML), "fire_points", LA_FIRE_BOX).totalCoordinatePairs).toBe(0);
    expect(parseHmsKml(encode(LA_FIRE_KML), "fire_points", LAKE_MICHIGAN_FIRE_BOX).inBoxCoordinatePairs).toBe(0);
  });

  it("rejects malformed XML, absent roots, invalid coordinates, and wrong geometry", () => {
    expect(() => parseHmsKml(encode(MALFORMED_XML), "fire_points", LA_FIRE_BOX)).toThrow();
    expect(() => parseHmsKml(encode(NO_KML_ROOT), "fire_points", LA_FIRE_BOX)).toThrow(/kml/i);
    expect(() => parseHmsKml(
      encode("<kml><Placemark><Point><coordinates>999,34,0</coordinates></Point></Placemark></kml>"),
      "fire_points",
      LA_FIRE_BOX,
    )).toThrow(/world bounds/i);
    expect(() => parseHmsKml(encode(LA_FIRE_KML), "smoke_polygons", LA_FIRE_BOX)).toThrow(/Polygon geometry/i);
  });
});

describe("WFIGS live retrieval identity", () => {
  it("keeps the source record identity while making the daily observation identity date-specific", () => {
    const payload = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {
          OBJECTID: 44,
          attr_IRWINID: "{fixture-irwin}",
          attr_IncidentName: "Fixture Fire",
        },
      }],
    };
    const raw = encode(JSON.stringify(payload));
    const [observation] = observationsFromWfigsGeoJson(
      payload,
      raw,
      "https://services3.arcgis.com/example",
      "2026-08-06",
      FIXED_NOW,
    );

    expect(() => validateObservation(observation)).not.toThrow();
    expect(observation).toMatchObject({
      observationId: "obs-wfigs-perimeter-44-2026-08-06",
      dataMode: "live",
      provenance: {
        sourceRecordId: "{fixture-irwin}",
        observedAt: "2026-08-06T12:00:00.000Z",
        requestParameters: { requestedDate: "2026-08-06" },
      },
      periodStart: "2026-08-06T00:00:00.000Z",
      periodEnd: "2026-08-06T23:59:59.999Z",
    });
  });
});

describe("queryLiveFireEvidence temporal success", () => {
  it("retrieves an arbitrary supported historical day from exact allowlisted templates", async () => {
    const fetch = vi.fn(successfulFetch());
    const result = await queryLiveFireEvidence(rangeInput(), deps(fetch as HmsLiveDependencies["fetch"]));

    expect(result.kind).toBe("success");
    expect(result.temporalCoverage).toMatchObject({
      requestType: "custom",
      status: "complete",
      requestedStartDate: "2026-08-06",
      requestedEndDate: "2026-08-06",
      resolvedStartDate: "2026-08-06",
      resolvedEndDate: "2026-08-06",
    });
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/2026/08/hms_smoke20260806.kml",
      "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Fire_Points/Text/2026/08/hms_fire20260806.txt",
      expect.stringContaining("WFIGS_Interagency_Perimeters"),
    ]);
    for (const [, options] of fetch.mock.calls.slice(0, 2)) {
      expect(options).toMatchObject({
        method: "GET",
        cache: "no-store",
        redirect: "manual",
        headers: { "Accept-Encoding": "identity" },
      });
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("keeps per-day URLs, dates, hashes, bytes, total counts, and in-box counts", async () => {
    const firePayload = fireText("2026-08-06");
    const result = await queryLiveFireEvidence(rangeInput(), deps(successfulFetch()));
    expect(() => validateEvidenceObject(result.evidence!)).not.toThrow();
    expect(result.evidence?.dataMode).toBe("live");
    expect(result.evidence?.freshness.status).toBe("historical");
    expect(result.evidence?.observations).toHaveLength(2);

    const fire = result.evidence!.observations.find((item) => item.provenance.sourceId === "noaa_hms_fire_points")!;
    expect(fire).toMatchObject({
      value: 1,
      unit: "records",
      periodStart: "2026-08-06T00:00:00Z",
      periodEnd: "2026-08-06T23:59:59Z",
      metadata: { observationDate: "2026-08-06", totalCount: 2, inBoxCount: 1 },
      provenance: {
        observedAt: "2026-08-06T00:00:00Z",
        retrievedAt: FIXED_NOW,
        requestParameters: {
          date: "2026-08-06",
          place: "demo-los-angeles",
          bounds: "W-119 S33 E-117 N35",
        },
      },
    });
    expect(fire.provenance.payloadHash).toBe(
      createHash("sha256").update(encode(firePayload)).digest("hex").toUpperCase(),
    );
    expect(fire.metadata!.rawByteCount).toBe(encode(firePayload).byteLength);
    expect(fire.metadata).toMatchObject({
      sourceRecordCount: 2,
      excludedDifferentObservationDayRecords: 0,
    });
    expect(fire.metadata!.sourceLastModifiedAt).toBe("2026-08-07T10:00:00.000Z");
    const smoke = result.evidence!.observations.find((item) => item.provenance.sourceId === "noaa_hms_smoke_polygons")!;
    expect(smoke.metadata).toMatchObject({ observationDate: "2026-08-06", totalCount: 4, inBoxCount: 4 });
  });

  it("combines HMS and WFIGS observations for one custom day without mixing retrieval modes", async () => {
    const result = await queryLiveFireEvidence(
      rangeInput(),
      deps(successfulFetch({
        wfigsForDate: () => ({
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: {
              OBJECTID: 44,
              attr_IRWINID: "{fixture-irwin}",
              attr_IncidentName: "Fixture Fire",
            },
          }],
        }),
      })),
    );

    expect(result.kind).toBe("success");
    expect(() => validateEvidenceObject(result.evidence!)).not.toThrow();
    expect(result.evidence?.observations).toHaveLength(3);
    expect(result.evidence?.observations.every((observation) => observation.dataMode === "live")).toBe(true);
    expect(result.evidence?.observations.find(
      (observation) => observation.provenance.sourceId === "nifc_wfigs_fire_perimeters",
    )).toMatchObject({
      observationId: "obs-wfigs-perimeter-44-2026-08-06",
      provenance: {
        sourceRecordId: "{fixture-irwin}",
        requestParameters: { requestedDate: "2026-08-06" },
      },
    });
  });

  it("keeps one WFIGS perimeter independently traceable across a three-day custom range", async () => {
    const result = await queryLiveFireEvidence(
      rangeInput("2026-08-04", "2026-08-06"),
      deps(successfulFetch({
        wfigsForDate: () => ({
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: {
              OBJECTID: 44,
              attr_IncidentName: "Fixture Fire",
            },
          }],
        }),
      })),
    );

    expect(result.kind).toBe("success");
    expect(() => validateEvidenceObject(result.evidence!)).not.toThrow();
    expect(result.evidence?.observations).toHaveLength(9);
    const wfigs = result.evidence!.observations.filter(
      (observation) => observation.provenance.sourceId === "nifc_wfigs_fire_perimeters",
    );
    expect(wfigs.map((observation) => observation.observationId)).toEqual([
      "obs-wfigs-perimeter-44-2026-08-04",
      "obs-wfigs-perimeter-44-2026-08-05",
      "obs-wfigs-perimeter-44-2026-08-06",
    ]);
    expect(wfigs.map((observation) => observation.provenance.sourceRecordId)).toEqual([
      "44",
      "44",
      "44",
    ]);
    expect(wfigs.map((observation) => observation.provenance.requestParameters?.requestedDate)).toEqual([
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
    ]);
    expect(new Set(result.evidence?.observations.map((observation) => observation.observationId)).size).toBe(9);
  });

  it("excludes valid rows from a different observation day without misattributing them", async () => {
    const expected = dayOfYear("2026-08-06");
    const adjacent = dayOfYear("2026-08-05");
    const fetch = successfulFetch({
      fireTextForDate: () => fireText("2026-08-06", [
        `-118.500000, 34.100000, ${expected}, 0201, GOES-EAST, NGFS, 62, 40.390`,
        `-118.400000, 34.200000, ${adjacent}, 2345, GOES-WEST, NGFS, 42, 5.000`,
      ]),
    });

    const result = await queryLiveFireEvidence(rangeInput(), deps(fetch));
    expect(result.kind).toBe("success");
    const fire = result.evidence!.observations.find(
      (item) => item.provenance.sourceId === "noaa_hms_fire_points"
    )!;
    expect(fire.value).toBe(1);
    expect(fire.metadata).toMatchObject({
      totalCount: 1,
      inBoxCount: 1,
      sourceRecordCount: 2,
      excludedDifferentObservationDayRecords: 1,
    });
  });

  it("preserves the immutable 2025-01-08 KML live-regression path and raw hash", async () => {
    const fetch = vi.fn(successfulFetch());
    const result = await queryLiveFireEvidence(
      { placeId: "demo-los-angeles", mode: "live", date: "2025-01-08" },
      deps(fetch as HmsLiveDependencies["fetch"]),
    );
    expect(result.kind).toBe("success");
    expect(result.temporalCoverage?.requestType).toBe("legacy_regression");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/2025/01/hms_smoke20250108.kml",
      "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Fire_Points/KML/2025/01/hms_fire20250108.kml",
    ]);
    const fire = result.evidence!.observations.find((item) => item.provenance.sourceId === "noaa_hms_fire_points")!;
    expect(fire.provenance.payloadHash).toBe(
      createHash("sha256").update(encode(LA_FIRE_KML)).digest("hex").toUpperCase(),
    );
  });

  it("resolves latest from yesterday UTC and never probes incomplete today", async () => {
    const fetch = vi.fn(successfulFetch());
    const result = await queryLiveFireEvidence(
      { placeId: "demo-los-angeles", mode: "live", time: { kind: "latest", days: 1 } },
      deps(fetch as HmsLiveDependencies["fetch"]),
    );
    expect(result.kind).toBe("success");
    expect(result.temporalCoverage?.resolvedEndDate).toBe("2026-08-06");
    expect(fetch.mock.calls.slice(0, 2).every(([url]) => String(url).includes("20260806"))).toBe(true);
    expect(fetch.mock.calls.every(([url]) => !String(url).includes("20260807"))).toBe(true);
  });

  it("backtracks latest only across explicit missing days and records every candidate", async () => {
    const fetch = vi.fn(async (request) => {
      const url = urlText(request);
      if (url.includes("20260806")) return new Response(null, { status: 404 });
      return successfulFetch()(request);
    }) as HmsLiveDependencies["fetch"];
    const result = await queryLiveFireEvidence(
      { placeId: "demo-los-angeles", mode: "live", time: { kind: "latest", days: 1 } },
      deps(fetch),
    );
    expect(result.kind).toBe("success");
    expect(result.temporalCoverage?.resolvedEndDate).toBe("2026-08-05");
    expect(result.temporalCoverage?.days).toEqual([
      { date: "2026-08-06", status: "unsupported", fireStatus: "not_checked", smokeStatus: "missing" },
      { date: "2026-08-05", status: "complete", fireStatus: "complete", smokeStatus: "complete" },
    ]);
  });

  it("returns seven separately traceable UTC days without a cross-day aggregate", async () => {
    const result = await queryLiveFireEvidence(
      { placeId: "demo-los-angeles", mode: "live", time: { kind: "latest", days: 7 } },
      deps(successfulFetch()),
    );
    expect(result.kind).toBe("success");
    expect(result.temporalCoverage).toMatchObject({
      requestType: "latest_7d",
      requestedStartDate: "2026-07-31",
      requestedEndDate: "2026-08-06",
    });
    expect(result.evidence?.observations).toHaveLength(14);
    expect(new Set(result.evidence?.observations.map((item) => item.metadata?.observationDate)).size).toBe(7);
    expect(result.evidence?.derivedMetrics).toHaveLength(0);
  });

  it("returns no_observation without converting zero records into a safety claim", async () => {
    const result = await queryLiveFireEvidence(
      { placeId: "demo-lake-michigan", mode: "live", time: { kind: "range", startDate: "2026-08-06", endDate: "2026-08-06" } },
      deps(successfulFetch({ smoke: EMPTY_KML, fireTextForDate: (date) => fireText(date, []) })),
    );
    expect(result.kind).toBe("no_observation");
    expect(result.evidence?.confidence.level).toBe("insufficient");
    expect(result.evidence?.limitations.some((item) =>
      item.required && item.description.includes("does not mean there was no fire or danger")
    )).toBe(true);
  });
});

describe("queryLiveFireEvidence partial and unsupported coverage", () => {
  it("marks an explicitly missing requested day as partial and does not synthesize observations", async () => {
    const fetch = vi.fn(async (request) => {
      const url = urlText(request);
      if (url.includes("Smoke_Polygons") && url.includes("20260806")) {
        return new Response(null, { status: 404 });
      }
      return successfulFetch()(request);
    }) as HmsLiveDependencies["fetch"];
    const result = await queryLiveFireEvidence(rangeInput("2026-08-05", "2026-08-06"), deps(fetch));
    expect(result.kind).toBe("partial_coverage");
    expect(result.temporalCoverage?.status).toBe("partial");
    expect(result.evidence?.evidenceState).toBe("inconclusive_evidence");
    expect(result.evidence?.observations).toHaveLength(2);
    expect(result.evidence?.observations.every((item) => item.metadata?.observationDate === "2026-08-05")).toBe(true);
    expect(result.temporalCoverage?.days[1]).toEqual({
      date: "2026-08-06",
      status: "unsupported",
      fireStatus: "not_checked",
      smokeStatus: "missing",
    });
  });

  it("returns unsupported_date when no day has a common Fire and Smoke pair", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 410 })) as HmsLiveDependencies["fetch"];
    const result = await queryLiveFireEvidence(rangeInput("2026-08-05", "2026-08-06"), deps(fetch));
    expect(result.kind).toBe("unsupported_date");
    expect(result.evidence).toBeUndefined();
    expect(result.temporalCoverage?.status).toBe("unsupported");
    expect(result.temporalCoverage?.days).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("treats a same-day or unsettled source modification as incomplete, not as zero", async () => {
    const fetch = vi.fn(async (request) => {
      const date = isoDateFromProductUrl(urlText(request));
      return byteResponse(LA_SMOKE_KML, KML_MEDIA_TYPE, {
        headers: { "Last-Modified": new Date(`${date}T20:00:00Z`).toUTCString() },
      });
    }) as HmsLiveDependencies["fetch"];
    const result = await queryLiveFireEvidence(rangeInput(), deps(fetch));
    expect(result.kind).toBe("unsupported_date");
    expect(result.evidence).toBeUndefined();
    expect(result.temporalCoverage?.days[0]).toMatchObject({
      status: "unsupported",
      smokeStatus: "incomplete",
      fireStatus: "not_checked",
    });
  });

  it("fails closed when latest cannot find a common pair in seven candidates", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 })) as HmsLiveDependencies["fetch"];
    const result = await queryLiveFireEvidence(
      { placeId: "demo-los-angeles", mode: "live", time: { kind: "latest", days: 1 } },
      deps(fetch),
    );
    expect(result.kind).toBe("unsupported_date");
    expect(result.temporalCoverage?.days).toHaveLength(7);
    expect(fetch).toHaveBeenCalledTimes(7);
  });

  it.each([
    ["range longer than seven days", rangeInput("2026-07-30", "2026-08-06")],
    ["date before common coverage", rangeInput("2005-08-04")],
    ["today is incomplete", rangeInput("2026-08-07")],
    ["invalid ISO date", rangeInput("2026-02-30")],
  ])("rejects %s before fetch", async (_label, input) => {
    const fetch = vi.fn(successfulFetch());
    const result = await queryLiveFireEvidence(input, deps(fetch as HmsLiveDependencies["fetch"]));
    expect(result.kind).toBe("unsupported_date");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects unsupported places and non-regression legacy dates before fetch", async () => {
    const fetch = vi.fn(successfulFetch());
    const unsupportedPlace = await queryLiveFireEvidence(
      { placeId: "demo-source-failure", mode: "live", time: { kind: "latest", days: 1 } },
      deps(fetch as HmsLiveDependencies["fetch"]),
    );
    const legacyDate = await queryLiveFireEvidence(
      { placeId: "demo-los-angeles", mode: "live", date: "2026-08-06" },
      deps(fetch as HmsLiveDependencies["fetch"]),
    );
    expect(unsupportedPlace.kind).toBe("unsupported_place");
    expect(legacyDate.kind).toBe("unsupported_date");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("documents the common source boundary", () => {
    expect(HMS_COMMON_START_DATE).toBe("2005-08-05");
  });
});

describe("queryLiveFireEvidence fail-closed retrieval", () => {
  it.each([
    ["429", "rate_limited", async () => new Response(null, { status: 429 })],
    ["500", "provider_failure", async () => new Response(null, { status: 500 })],
    ["redirect", "redirect", async () => new Response(null, { status: 301 })],
    ["network", "network", async () => { throw new Error("network detail"); }],
    ["wrong media type", "schema_validation", async () => byteResponse(LA_SMOKE_KML, TEXT_MEDIA_TYPE)],
    ["malformed smoke", "malformed", async (request: string | URL | Request) => {
      const date = isoDateFromProductUrl(urlText(request));
      return byteResponse(MALFORMED_XML, KML_MEDIA_TYPE, { headers: completedHeaders(date) });
    }],
  ])("maps %s to provider-detail-free %s with no fixture fallback", async (_label, reason, implementation) => {
    const fetch = vi.fn(implementation) as HmsLiveDependencies["fetch"];
    const result = await queryLiveFireEvidence(rangeInput(), deps(fetch));
    expect(result.kind).toBe("source_failure");
    expect(result.failureReason).toBe(reason);
    expect(result.evidence?.dataMode).toBe("failed");
    expect(result.evidence?.observations).toHaveLength(0);
    expect(result.evidence?.limitations.filter((item) => item.required).length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(result)).not.toContain("network detail");
    expect(result.evidence?.dataMode).not.toBe("fixture");
  });

  it("fails the whole query for invalid Fire Text schema after Smoke succeeds", async () => {
    const fetch = vi.fn(async (request) => {
      const url = urlText(request);
      const date = isoDateFromProductUrl(url);
      if (url.includes("Smoke_Polygons")) {
        return byteResponse(LA_SMOKE_KML, KML_MEDIA_TYPE, { headers: completedHeaders(date) });
      }
      return byteResponse(
        "Lon, Lat, YearDay, Time, Satellite, Method, Ecosystem, FRP\n-118.5,34.1,1900001,0201,GOES,NGFS,62,1\n",
        TEXT_MEDIA_TYPE,
        { headers: completedHeaders(date) },
      );
    }) as HmsLiveDependencies["fetch"];
    const result = await queryLiveFireEvidence(rangeInput(), deps(fetch));
    expect(result.kind).toBe("source_failure");
    expect(result.failureReason).toBe("schema_validation");
    expect(result.temporalCoverage?.days[0]).toMatchObject({ fireStatus: "failed", smokeStatus: "complete" });
  });

  it("rejects a declared Fire Text payload over the researched 24 MiB stream cap", async () => {
    const fetch = vi.fn(async (request) => {
      const url = urlText(request);
      const date = isoDateFromProductUrl(url);
      if (url.includes("Smoke_Polygons")) {
        return byteResponse(LA_SMOKE_KML, KML_MEDIA_TYPE, { headers: completedHeaders(date) });
      }
      return byteResponse("", TEXT_MEDIA_TYPE, {
        headers: {
          ...completedHeaders(date),
          "Content-Length": String(24 * 1024 * 1024 + 1),
        },
      });
    }) as HmsLiveDependencies["fetch"];
    const result = await queryLiveFireEvidence(rangeInput(), deps(fetch));
    expect(result.kind).toBe("source_failure");
    expect(result.failureReason).toBe("oversize");
  });

  it("times out a stalled body deterministically", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(async (request) => new Response(
        new ReadableStream<Uint8Array>({ start() {} }),
        {
          status: 200,
          headers: {
            "Content-Type": KML_MEDIA_TYPE,
            ...completedHeaders(isoDateFromProductUrl(urlText(request))),
          },
        },
      )) as HmsLiveDependencies["fetch"];
      const pending = queryLiveFireEvidence(rangeInput(), deps(fetch));
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await pending;
      expect(result.kind).toBe("source_failure");
      expect(result.failureReason).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });
});
