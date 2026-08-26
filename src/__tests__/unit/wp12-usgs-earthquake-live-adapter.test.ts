import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  USGS_EARTHQUAKE_HOST,
  USGS_EARTHQUAKE_MAX_BYTES,
  USGS_EARTHQUAKE_MAX_EVENTS,
  USGS_EARTHQUAKE_PATH,
  USGS_EARTHQUAKE_TIMEOUT_MS,
  buildUsgsEarthquakeQueryUrl,
  queryUsgsEarthquakeEvents,
} from "@/lib/coverage-gap/usgs-earthquake-live-adapter";

const DATE = "2024-07-08";
const AREA = { west: -75, south: 40, east: -73, north: 42 };
const NOW = new Date("2024-07-10T12:00:00Z");
const EVENT_TIME = Date.parse("2024-07-08T12:34:56.000Z");

function eventFeature(overrides: Record<string, unknown> = {}) {
  return {
    type: "Feature",
    id: "us7000wp12",
    properties: {
      mag: 3.2,
      place: "Deterministic event inside the selected area",
      time: EVENT_TIME,
      updated: EVENT_TIME + 60_000,
      status: "reviewed",
      magType: "ml",
      type: "earthquake",
    },
    geometry: { type: "Point", coordinates: [-74, 41, 8.5] },
    ...overrides,
  };
}

function collection(features: unknown[], metadata: Record<string, unknown> = {}) {
  return {
    type: "FeatureCollection",
    metadata: {
      generated: Date.parse("2024-07-08T13:00:00Z"),
      count: features.length,
      status: 200,
      ...metadata,
    },
    features,
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const text = JSON.stringify(value);
  return new Response(text, {
    status: 200,
    ...init,
    headers: { "Content-Type": "application/json; charset=utf-8", ...init.headers },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("WP-12 USGS observed-earthquake adapter", () => {
  it("builds one fixed-host, bounded completed-UTC-day FDSN GeoJSON request", () => {
    const url = buildUsgsEarthquakeQueryUrl(DATE, AREA);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe(USGS_EARTHQUAKE_HOST);
    expect(url.pathname).toBe(USGS_EARTHQUAKE_PATH);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: "geojson",
      starttime: "2024-07-08T00:00:00.000Z",
      endtime: "2024-07-08T23:59:59.999Z",
      minlatitude: "40",
      maxlatitude: "42",
      minlongitude: "-75",
      maxlongitude: "-73",
      eventtype: "earthquake",
      orderby: "time-asc",
      limit: String(USGS_EARTHQUAKE_MAX_EVENTS),
      nodata: "204",
    });
  });

  it("rejects invalid dates and noncanonical areas before fetch", async () => {
    expect(() => buildUsgsEarthquakeQueryUrl("2024-02-30", AREA)).toThrow();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(queryUsgsEarthquakeEvents(DATE, {
      ...AREA,
      east: AREA.west,
    }, { fetchImpl, now: () => NOW })).resolves.toEqual({
      kind: "source_failure",
      reason: "schema_validation",
      stage: "event_query",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a provenance-complete observed event and hashes exact raw bytes", async () => {
    const payload = ` ${JSON.stringify(collection([eventFeature()]))}\n`;
    const bytes = new TextEncoder().encode(payload);
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init).toMatchObject({ method: "GET", redirect: "manual", cache: "no-store" });
      expect(new Headers(init?.headers).get("accept")).toBe("application/json");
      return new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "application/geo+json" },
      });
    }) as unknown as typeof fetch;
    const result = await queryUsgsEarthquakeEvents(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
    });
    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      variableName: "USGS observed earthquake event",
      value: 3.2,
      unit: "magnitude",
      dataMode: "live",
      qualifiers: ["observed_event_not_prediction", "no_eruption_causality", "reviewed_event"],
      provenance: {
        sourceId: "usgs_earthquake_geojson",
        sourceRecordId: "us7000wp12",
        observedAt: "2024-07-08T12:34:56.000Z",
        retrievedAt: NOW.toISOString(),
        payloadHash: createHash("sha256").update(bytes).digest("hex"),
        requestParameters: {
          date: DATE,
          bbox: "-75,40,-73,42",
          eventtype: "earthquake",
          format: "geojson",
        },
      },
      metadata: {
        longitude: -74,
        latitude: 41,
        depthKm: 8.5,
        reviewStatus: "reviewed",
        eventType: "earthquake",
      },
    });
    expect(result.observations[0].provenance.sourceUrl).toBe(
      "https://earthquake.usgs.gov/earthquakes/eventpage/us7000wp12"
    );
  });

  it("accepts an omitted redundant metadata count while retaining the hard feature limit", async () => {
    const body = collection([]);
    Reflect.deleteProperty(body.metadata, "count");
    const result = await queryUsgsEarthquakeEvents(DATE, AREA, {
      fetchImpl: vi.fn(async () => jsonResponse(body)) as unknown as typeof fetch,
      now: () => NOW,
    });

    expect(result).toEqual({ kind: "no_observation" });
  });

  it("preserves an observed event whose magnitude is not yet reported", async () => {
    const base = eventFeature();
    const feature = {
      ...base,
      properties: { ...base.properties, mag: null, magType: null },
    };
    const result = await queryUsgsEarthquakeEvents(DATE, AREA, {
      fetchImpl: vi.fn(async () => jsonResponse(collection([feature]))) as unknown as typeof fetch,
      now: () => NOW,
    });
    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    expect(result.observations[0]).toMatchObject({
      textValue: "observed_earthquake_event_without_reported_magnitude",
    });
    expect(result.observations[0]).not.toHaveProperty("value");
    expect(result.observations[0]).not.toHaveProperty("unit");
  });

  it.each([
    ["HTTP 204", new Response(null, { status: 204 })],
    ["empty FeatureCollection", jsonResponse(collection([]))],
  ])("returns no_observation for %s without claiming safety", async (_label, response) => {
    await expect(queryUsgsEarthquakeEvents(DATE, AREA, {
      fetchImpl: vi.fn(async () => response) as unknown as typeof fetch,
      now: () => NOW,
    })).resolves.toEqual({ kind: "no_observation" });
  });

  it.each([
    [302, "redirect"],
    [429, "rate_limited"],
    [503, "provider_failure"],
  ])("maps HTTP %i to %s", async (status, reason) => {
    await expect(queryUsgsEarthquakeEvents(DATE, AREA, {
      fetchImpl: vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch,
      now: () => NOW,
    })).resolves.toEqual({ kind: "source_failure", reason, stage: "event_query" });
  });

  it("separates media_type, malformed JSON, and network failures", async () => {
    const responses = [
      new Response("<html>no</html>", { status: 200, headers: { "Content-Type": "text/html" } }),
      new Response("{bad", { status: 200, headers: { "Content-Type": "application/json" } }),
    ];
    await expect(queryUsgsEarthquakeEvents(DATE, AREA, {
      fetchImpl: vi.fn(async () => responses[0]) as unknown as typeof fetch,
      now: () => NOW,
    })).resolves.toMatchObject({ kind: "source_failure", reason: "media_type" });
    await expect(queryUsgsEarthquakeEvents(DATE, AREA, {
      fetchImpl: vi.fn(async () => responses[1]) as unknown as typeof fetch,
      now: () => NOW,
    })).resolves.toMatchObject({ kind: "source_failure", reason: "malformed" });
    await expect(queryUsgsEarthquakeEvents(DATE, AREA, {
      fetchImpl: vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch,
      now: () => NOW,
    })).resolves.toMatchObject({ kind: "source_failure", reason: "network" });
  });

  it("keeps the timeout active through the request", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })) as unknown as typeof fetch;
    const pending = queryUsgsEarthquakeEvents(DATE, AREA, { fetchImpl, now: () => NOW });
    await vi.advanceTimersByTimeAsync(USGS_EARTHQUAKE_TIMEOUT_MS + 1);
    await expect(pending).resolves.toEqual({
      kind: "source_failure",
      reason: "timeout",
      stage: "event_query",
    });
  });

  it("keeps the timeout active while reading the response body", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), {
            once: true,
          });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const pending = queryUsgsEarthquakeEvents(DATE, AREA, { fetchImpl, now: () => NOW });
    await vi.advanceTimersByTimeAsync(USGS_EARTHQUAKE_TIMEOUT_MS + 1);
    await expect(pending).resolves.toEqual({
      kind: "source_failure",
      reason: "timeout",
      stage: "event_query",
    });
  });

  it("rejects declared oversized bodies before reading", async () => {
    const response = jsonResponse(collection([]), {
      headers: { "Content-Type": "application/json", "Content-Length": String(USGS_EARTHQUAKE_MAX_BYTES + 1) },
    });
    await expect(queryUsgsEarthquakeEvents(DATE, AREA, {
      fetchImpl: vi.fn(async () => response) as unknown as typeof fetch,
      now: () => NOW,
    })).resolves.toMatchObject({ kind: "source_failure", reason: "oversize" });
  });

  it.each([
    [
      "wrong root",
      { type: "Feature", metadata: {}, features: [] },
      { path: "$.type", expected: 'literal "FeatureCollection"', actualType: "string" },
    ],
    [
      "count mismatch",
      collection([eventFeature()], { count: 0 }),
      { path: "$.metadata.count", expected: "equal to $.features.length", actualType: "number" },
    ],
    [
      "negative count",
      collection([], { count: -1 }),
      { path: "$.metadata.count", expected: "safe non-negative integer", actualType: "number" },
    ],
    [
      "outside area",
      collection([eventFeature({ geometry: { type: "Point", coordinates: [-120, 41, 8] } })]),
      {
        path: "$.features[].geometry.coordinates[0]",
        expected: "longitude within requested bounds",
        actualType: "number",
      },
    ],
    ["outside day", collection([eventFeature({ properties: {
      ...eventFeature().properties,
      time: Date.parse("2024-07-09T00:00:00Z"),
      updated: Date.parse("2024-07-09T00:01:00Z"),
    } })]), {
      path: "$.features[].properties.time",
      expected: "epoch within requested UTC day",
      actualType: "number",
    }],
    ["non-earthquake event", collection([eventFeature({ properties: {
      ...eventFeature().properties,
      type: "quarry blast",
    } })]), {
      path: "$.features[].properties.type",
      expected: 'literal "earthquake"',
      actualType: "string",
    }],
    [
      "duplicate id",
      collection([eventFeature(), eventFeature()]),
      {
        path: "$.features[].id",
        expected: "unique event identifier",
        actualType: "string",
      },
    ],
  ])("fails closed on schema-invalid %s", async (_label, body, schemaDiagnostic) => {
    await expect(queryUsgsEarthquakeEvents(DATE, AREA, {
      fetchImpl: vi.fn(async () => jsonResponse(body)) as unknown as typeof fetch,
      now: () => NOW,
    })).resolves.toEqual({
      kind: "source_failure",
      reason: "schema_validation",
      stage: "event_query",
      schemaDiagnostic,
    });
  });

  it("reports only an allowlisted schema shape and never retains payload values", async () => {
    const rawMarker = "FDSN_RAW_MARKER_MUST_NOT_ESCAPE";
    const result = await queryUsgsEarthquakeEvents(DATE, AREA, {
      fetchImpl: vi.fn(async () => jsonResponse({ rawMarker })) as unknown as typeof fetch,
      now: () => NOW,
    });

    expect(result).toEqual({
      kind: "source_failure",
      reason: "schema_validation",
      stage: "event_query",
      schemaDiagnostic: {
        path: "$.type",
        expected: 'literal "FeatureCollection"',
        actualType: "missing",
      },
    });
    expect(JSON.stringify(result)).not.toContain(rawMarker);
  });

  it("fails closed instead of presenting a possibly truncated result set", async () => {
    const features = Array.from({ length: USGS_EARTHQUAKE_MAX_EVENTS }, (_unused, index) =>
      eventFeature({ id: `us${String(index).padStart(6, "0")}` }));
    await expect(queryUsgsEarthquakeEvents(DATE, AREA, {
      fetchImpl: vi.fn(async () => jsonResponse(collection(features))) as unknown as typeof fetch,
      now: () => NOW,
    })).resolves.toEqual({
      kind: "source_failure",
      reason: "result_limit",
      stage: "event_query",
    });
  });
});
