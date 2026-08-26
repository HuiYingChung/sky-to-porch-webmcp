import { createHash } from "crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AIRNOW_DAILY_HOST,
  AIRNOW_DAILY_MAX_BYTES,
  AIRNOW_DAILY_MAX_OBSERVATIONS,
  buildAirNowDailyFileUrl,
  queryAirNowDailyData,
} from "@/lib/coverage-gap/airnow-daily-live-adapter";

const DATE = "2024-07-08";
const NOW = new Date("2026-08-15T19:30:00Z");
const AREA = { west: -96, south: 29, east: -94, north: 31 };

function line(overrides: Partial<Record<string, string>> = {}): string {
  const fields = {
    date: "07/08/24",
    aqsid: "482010024",
    site: "Mock Houston monitor",
    parameter: "PM2.5-24HR",
    units: "UG/M3",
    value: "11.2",
    period: "24",
    source: "Mock official agency",
    aqi: "42",
    category: "0",
    lat: "29.7604",
    lon: "-95.3698",
    fullAqsid: "840482010024",
    ...overrides,
  };
  return [
    fields.date,
    fields.aqsid,
    fields.site,
    fields.parameter,
    fields.units,
    fields.value,
    fields.period,
    fields.source,
    fields.aqi,
    fields.category,
    fields.lat,
    fields.lon,
    fields.fullAqsid,
  ].join("|");
}

function response(body: BodyInit, contentType = "application/octet-stream"): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": contentType } });
}

describe("WP-11 AirNow credential-free daily-file adapter", () => {
  it("constructs the exact official historical daily-file path without a credential", () => {
    const url = buildAirNowDailyFileUrl(DATE);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe(AIRNOW_DAILY_HOST);
    expect(url.pathname).toBe("/airnow/2024/20240708/daily_data_v2.dat");
    expect(url.search).toBe("");
  });

  it("fails closed before fetch unless an external call is explicitly authorized", async () => {
    const fetchImpl = vi.fn();
    const result = await queryAirNowDailyData(DATE, AREA, { fetchImpl });
    expect(result).toEqual({ kind: "source_failure", reason: "live_gate_closed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns validated outdoor AQI with payload hash and no invented UTC instant", async () => {
    const text = line();
    const fetchImpl = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      const url = new URL(request instanceof Request ? request.url : request.toString());
      expect(url.toString()).toBe(buildAirNowDailyFileUrl(DATE).toString());
      expect(init).toMatchObject({ method: "GET", redirect: "manual", cache: "no-store" });
      return response(text);
    });
    const result = await queryAirNowDailyData(DATE, AREA, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      cache: false,
      externalCallsAuthorized: true,
    });
    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    expect(result).toMatchObject({ cacheStatus: "miss", areaRecordCount: 1, truncated: false });
    expect(result.observations[0]).toMatchObject({
      value: 42,
      unit: "AQI",
      dataMode: "live",
      qualifiers: [
        "outdoor_monitoring_site",
        "preliminary_airnow_data",
        "not_indoor_air",
        "not_personal_exposure",
        "not_regulatory_data",
      ],
      provenance: {
        sourceId: "airnow_daily_data",
        observedAt: "unknown",
        product: "AirNow daily monitoring-site AQI summary",
        payloadHash: createHash("sha256").update(text).digest("hex"),
      },
      metadata: {
        validDate: DATE,
        timeBasis: "midnight-to-midnight Local Standard Time; UTC instant unavailable",
        resultTruncated: false,
      },
    });
  });

  it("returns no_observation when the valid nationwide file has no row in the area", async () => {
    const result = await queryAirNowDailyData(DATE, AREA, {
      fetchImpl: vi.fn(async () => response(line({ lat: "40.7", lon: "-74.0" }))) as typeof fetch,
      externalCallsAuthorized: true,
      cache: false,
    });
    expect(result).toEqual({ kind: "no_observation", cacheStatus: "miss" });
  });

  it("accepts the observed binary/octet-stream media token", async () => {
    const result = await queryAirNowDailyData(DATE, AREA, {
      fetchImpl: vi.fn(async () => response(line(), "Binary/Octet-Stream")) as typeof fetch,
      externalCallsAuthorized: true,
      cache: false,
    });

    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      value: 42,
      unit: "AQI",
      dataMode: "live",
      provenance: { sourceId: "airnow_daily_data" },
    });
  });

  it("caps returned observations while disclosing the full in-area count", async () => {
    const text = Array.from({ length: AIRNOW_DAILY_MAX_OBSERVATIONS + 1 }, (_, index) => {
      const aqsid = String(482010000 + index).padStart(9, "0");
      return line({ aqsid, fullAqsid: `840${aqsid}` });
    }).join("\n");
    const result = await queryAirNowDailyData(DATE, AREA, {
      fetchImpl: vi.fn(async () => response(text)) as typeof fetch,
      externalCallsAuthorized: true,
      cache: false,
    });
    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    expect(result.observations).toHaveLength(AIRNOW_DAILY_MAX_OBSERVATIONS);
    expect(result.areaRecordCount).toBe(AIRNOW_DAILY_MAX_OBSERVATIONS + 1);
    expect(result.truncated).toBe(true);
    expect(result.observations[0].metadata).toMatchObject({
      areaRecordCount: AIRNOW_DAILY_MAX_OBSERVATIONS + 1,
      returnedRecordCount: AIRNOW_DAILY_MAX_OBSERVATIONS,
      resultTruncated: true,
    });
  });

  it.each([
    ["redirect", new Response(null, { status: 302, headers: { Location: "https://example.invalid" } })],
    ["rate_limited", new Response(null, { status: 429 })],
    ["provider_failure", new Response(null, { status: 503 })],
    ["schema_validation", response("not|thirteen|fields")],
  ] as const)("fails closed for %s", async (reason, mockedResponse) => {
    const result = await queryAirNowDailyData(DATE, AREA, {
      fetchImpl: vi.fn(async () => mockedResponse) as typeof fetch,
      externalCallsAuthorized: true,
      cache: false,
    });
    expect(result).toEqual({ kind: "source_failure", reason });
  });

  it("reports only a normalized disallowed media type without reading the body", async () => {
    let bodyRead = false;
    const mockedResponse = {
      status: 200,
      ok: true,
      headers: new Headers({
        "Content-Type": "Text/HTML; charset=UTF-8; boundary=sensitive-value",
      }),
      get body() {
        bodyRead = true;
        throw new Error("body must not be read for a disallowed media type");
      },
    } as unknown as Response;
    const result = await queryAirNowDailyData(DATE, AREA, {
      fetchImpl: vi.fn(async () => mockedResponse) as typeof fetch,
      externalCallsAuthorized: true,
      cache: false,
    });

    expect(result).toEqual({
      kind: "source_failure",
      reason: "media_type",
      receivedMediaType: "text/html",
    });
    expect(bodyRead).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/charset|boundary|sensitive-value/iu);
  });

  it.each([null, "not a media type; charset=sensitive-value"])(
    "redacts a missing or malformed media type (%s)",
    async (contentType) => {
      const headers = new Headers();
      if (contentType !== null) headers.set("Content-Type", contentType);
      const mockedResponse = {
        status: 200,
        ok: true,
        headers,
        get body() {
          throw new Error("body must not be read for an invalid media type");
        },
      } as unknown as Response;
      const result = await queryAirNowDailyData(DATE, AREA, {
        fetchImpl: vi.fn(async () => mockedResponse) as typeof fetch,
        externalCallsAuthorized: true,
        cache: false,
      });

      expect(result).toEqual({
        kind: "source_failure",
        reason: "media_type",
        receivedMediaType: "invalid_or_missing",
      });
      expect(JSON.stringify(result)).not.toContain("sensitive-value");
    },
  );

  it("rejects malformed UTF-8 and a declared oversize response", async () => {
    const malformed = await queryAirNowDailyData(DATE, AREA, {
      fetchImpl: vi.fn(async () => response(new Uint8Array([0xc3, 0x28]))) as typeof fetch,
      externalCallsAuthorized: true,
      cache: false,
    });
    expect(malformed).toEqual({ kind: "source_failure", reason: "malformed" });

    const oversize = await queryAirNowDailyData(DATE, AREA, {
      fetchImpl: vi.fn(async () => new Response("x", {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
          "Content-Length": String(AIRNOW_DAILY_MAX_BYTES + 1),
        },
      })) as typeof fetch,
      externalCallsAuthorized: true,
      cache: false,
    });
    expect(oversize).toEqual({ kind: "source_failure", reason: "oversize" });
  });

  it("classifies a rejected fetch as network failure", async () => {
    const result = await queryAirNowDailyData(DATE, AREA, {
      fetchImpl: vi.fn(async () => { throw new Error("offline"); }) as typeof fetch,
      externalCallsAuthorized: true,
      cache: false,
    });
    expect(result).toEqual({ kind: "source_failure", reason: "network" });
  });
});
