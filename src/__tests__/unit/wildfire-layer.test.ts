import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoundingBox } from "@/contracts/common";
import { parseWildfireLayerEnvelope } from "@/contracts/wildfire-layer";
import {
  clearFirmsNrtLayerServerStateForTests,
  isSupportedFirmsNrtMapDate,
  parseFirmsNrtCsv,
  queryFirmsNrtLayer,
  queryFirmsNrtLayerGuarded,
} from "@/lib/fire/firms-nrt-layer";
import {
  WILDFIRE_LAYER_CLIENT_CACHE_MAX_ENTRIES,
  clearWildfireLayerClientCacheForTests,
  loadWildfireLayer,
} from "@/lib/fire/firms-nrt-layer-client";

const AREA: BoundingBox = { west: -119, south: 33, east: -117, north: 35 };
const NOW = "2026-08-13T16:00:00.000Z";
const DATE = "2026-08-13";
const CSV_HEADER =
  "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight";
const CSV = `${CSV_HEADER}\n34.1000,-118.2000,330.1,0.4,0.4,2026-08-13,1430,N20,VIIRS,n,2.0NRT,300.0,4.5,D\n`;

function response(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/csv", ...init.headers },
    ...init,
  });
}

describe("NASA FIRMS NRT wildfire layer adapter", () => {
  beforeEach(() => clearFirmsNrtLayerServerStateForTests());

  it("parses bounded NOAA-20 VIIRS pixels with observation metadata", () => {
    const features = parseFirmsNrtCsv(CSV, AREA, NOW, DATE);
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({
      geometry: { type: "Point", coordinates: [-118.2, 34.1] },
      properties: {
        acquiredAt: "2026-08-13T14:30:00Z",
        satellite: "N20",
        instrument: "VIIRS",
        confidence: "nominal",
        processing: "near_real_time",
        frpMw: 4.5,
        dayNight: "day",
      },
    });
  });

  it("rejects out-of-area and unsafe upstream values", () => {
    const outside = CSV.replace("-118.2000", "-116.0000");
    const unsafe = CSV.replace("2.0NRT", "<script>alert(1)</script>");
    expect(() => parseFirmsNrtCsv(outside, AREA, NOW, DATE)).toThrow("schema_validation");
    expect(() => parseFirmsNrtCsv(unsafe, AREA, NOW, DATE)).toThrow("schema_validation");
  });

  it("uses an injected fake credential and never returns it in layer output", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(CSV));
    const outcome = await queryFirmsNrtLayer(DATE, AREA, {
      fetch: fetchImpl as typeof fetch,
      nowIso: () => NOW,
      mapKey: "unit-test-map-key",
    });
    expect(outcome.kind).toBe("success");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const requestUrl = String(fetchImpl.mock.calls[0][0]);
    expect(requestUrl).toContain("/VIIRS_NOAA20_NRT/");
    expect(requestUrl).toContain("/-119,33,-117,35/1/2026-08-13");
    expect(JSON.stringify(outcome)).not.toContain("unit-test-map-key");
    if (outcome.kind === "success") {
      expect(outcome.result.evidenceState).toBe("observations_returned");
      expect(outcome.result.featureCollection.features).toHaveLength(1);
      expect(outcome.result.payloadHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(parseWildfireLayerEnvelope({ ok: true, result: outcome.result })).not.toBeNull();
    }
  });

  it("supports only today and the previous UTC day for the NRT map", async () => {
    expect(isSupportedFirmsNrtMapDate("2026-08-13", Date.parse(NOW))).toBe(true);
    expect(isSupportedFirmsNrtMapDate("2026-08-12", Date.parse(NOW))).toBe(true);
    expect(isSupportedFirmsNrtMapDate("2026-08-11", Date.parse(NOW))).toBe(false);
    expect(isSupportedFirmsNrtMapDate("2026-08-14", Date.parse(NOW))).toBe(false);

    for (const date of ["2026-08-11", "2026-08-14"]) {
      const fetchImpl = vi.fn();
      await expect(queryFirmsNrtLayer(date, AREA, {
        fetch: fetchImpl as typeof fetch,
        nowIso: () => NOW,
        mapKey: "unit-test-map-key",
      })).resolves.toEqual({ kind: "failure", error: "unsupported_date" });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("reports an unsupported historical map date even when FIRMS is unconfigured", async () => {
    const fetchImpl = vi.fn();
    await expect(queryFirmsNrtLayer("2020-01-01", AREA, {
      fetch: fetchImpl as typeof fetch,
      nowIso: () => NOW,
      mapKey: " ",
    })).resolves.toEqual({ kind: "failure", error: "unsupported_date" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns truthful no_observation without converting it to no danger", async () => {
    const outcome = await queryFirmsNrtLayer(DATE, AREA, {
      fetch: vi.fn(async () => response(`${CSV_HEADER}\n`)) as typeof fetch,
      nowIso: () => NOW,
      mapKey: "unit-test-map-key",
    });
    expect(outcome.kind).toBe("success");
    if (outcome.kind === "success") {
      expect(outcome.result.evidenceState).toBe("no_observation");
      expect(outcome.result.latestAcquiredAt).toBeNull();
      expect(outcome.result.featureCollection.features).toEqual([]);
      expect(outcome.result.limitations.join(" ")).toContain("no detection is not evidence of no fire or no danger");
    }
  });

  it("fails closed when unconfigured, rate-limited, malformed, or oversized", async () => {
    const neverFetch = vi.fn();
    await expect(queryFirmsNrtLayer(DATE, AREA, {
      fetch: neverFetch as typeof fetch,
      nowIso: () => NOW,
      mapKey: " ",
    })).resolves.toEqual({ kind: "failure", error: "unconfigured" });
    expect(neverFetch).not.toHaveBeenCalled();

    await expect(queryFirmsNrtLayer(DATE, AREA, {
      fetch: vi.fn(async () => response("rate", { status: 429 })) as typeof fetch,
      nowIso: () => NOW,
      mapKey: "unit-test-map-key",
    })).resolves.toEqual({ kind: "failure", error: "rate_limited" });

    await expect(queryFirmsNrtLayer(DATE, AREA, {
      fetch: vi.fn(async () => response("wrong,columns\n1,2\n")) as typeof fetch,
      nowIso: () => NOW,
      mapKey: "unit-test-map-key",
    })).resolves.toEqual({ kind: "failure", error: "schema_validation" });

    await expect(queryFirmsNrtLayer(DATE, AREA, {
      fetch: vi.fn(async () => response(CSV, { headers: {
        "Content-Type": "text/csv",
        "Content-Length": String(2 * 1024 * 1024 + 1),
      } })) as typeof fetch,
      nowIso: () => NOW,
      mapKey: "unit-test-map-key",
    })).resolves.toEqual({ kind: "failure", error: "response_too_large" });
  });
});

describe("NASA FIRMS private-key route guard", () => {
  beforeEach(() => clearFirmsNrtLayerServerStateForTests());

  it("coalesces and caches identical selected-area requests", async () => {
    const fetchImpl = vi.fn(async () => response(CSV));
    const deps = {
      fetch: fetchImpl as typeof fetch,
      nowIso: () => NOW,
      mapKey: "unit-test-map-key",
    };
    const [first, second] = await Promise.all([
      queryFirmsNrtLayerGuarded(DATE, AREA, deps),
      queryFirmsNrtLayerGuarded(DATE, AREA, deps),
    ]);
    const third = await queryFirmsNrtLayerGuarded(DATE, AREA, deps);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(first).toEqual(second);
    expect(third).toEqual(first);
  });

  it("rejects historical dates before consuming upstream concurrency", async () => {
    const fetchImpl = vi.fn();
    const outcome = await queryFirmsNrtLayerGuarded("2020-01-01", AREA, {
      fetch: fetchImpl as typeof fetch,
      nowIso: () => NOW,
      mapKey: "unit-test-map-key",
    });
    expect(outcome).toEqual({ kind: "failure", error: "unsupported_date" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("caps simultaneous upstream requests without retry or fallback", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchImpl = vi.fn(async () => {
      await gate;
      return response(CSV);
    });
    const deps = {
      fetch: fetchImpl as typeof fetch,
      nowIso: () => NOW,
      mapKey: "unit-test-map-key",
    };
    const first = queryFirmsNrtLayerGuarded(DATE, AREA, deps);
    const second = queryFirmsNrtLayerGuarded(
      DATE,      { west: -119.5, south: 33, east: -117.5, north: 35.5 },
      deps
    );
    const third = await queryFirmsNrtLayerGuarded(
      DATE,      { west: -118.8, south: 33.5, east: -117.8, north: 34.8 },
      deps
    );
    expect(third).toEqual({ kind: "failure", error: "rate_limited" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    release();
    await Promise.all([first, second]);
  });
});

describe("wildfire layer client boundary", () => {
  beforeEach(() => clearWildfireLayerClientCacheForTests());

  it("deduplicates simultaneous desktop and mobile requests and validates the response", async () => {
    const serverOutcome = await queryFirmsNrtLayer(DATE, AREA, {
      fetch: vi.fn(async () => response(CSV)) as typeof fetch,
      nowIso: () => NOW,
      mapKey: "unit-test-map-key",
    });
    if (serverOutcome.kind !== "success") throw new Error("test setup failed");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      result: serverOutcome.result,
    }), { headers: { "Content-Type": "application/json" } }));
    const [first, second] = await Promise.all([
      loadWildfireLayer(DATE, AREA, fetchImpl as typeof fetch, () => 1_000),
      loadWildfireLayer(DATE, AREA, fetchImpl as typeof fetch, () => 1_000),
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
  });

  it("rejects an unvalidated internal-route payload", async () => {
    const envelope = await loadWildfireLayer(
      DATE,
      AREA,
      vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { injected: true } }))) as typeof fetch,
      () => 2_000
    );
    expect(envelope).toEqual({ ok: false, error: "schema_validation" });
  });

  it("rejects a valid-looking response for a different analysis area", async () => {
    const serverOutcome = await queryFirmsNrtLayer(DATE, AREA, {
      fetch: vi.fn(async () => response(CSV)) as typeof fetch,
      nowIso: () => NOW,
      mapKey: "unit-test-map-key",
    });
    if (serverOutcome.kind !== "success") throw new Error("test setup failed");
    const envelope = await loadWildfireLayer(
      DATE,
      { west: -120, south: 32, east: -118, north: 34 },
      vi.fn(async () => new Response(JSON.stringify({
        ok: true,
        result: serverOutcome.result,
      }))) as typeof fetch,
      () => 3_000
    );
    expect(envelope).toEqual({ ok: false, error: "schema_validation" });
  });

  it("bounds successful per-area cache entries and evicts the oldest", async () => {
    const serverOutcome = await queryFirmsNrtLayer(DATE, AREA, {
      fetch: vi.fn(async () => response(CSV)) as typeof fetch,
      nowIso: () => NOW,
      mapKey: "unit-test-map-key",
    });
    if (serverOutcome.kind !== "success") throw new Error("test setup failed");
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const requestArea = {
        west: Number(url.searchParams.get("west")),
        south: Number(url.searchParams.get("south")),
        east: Number(url.searchParams.get("east")),
        north: Number(url.searchParams.get("north")),
      };
      return new Response(JSON.stringify({
        ok: true,
        result: { ...serverOutcome.result, requestArea },
      }), { headers: { "Content-Type": "application/json" } });
    });
    const areas = Array.from(
      { length: WILDFIRE_LAYER_CLIENT_CACHE_MAX_ENTRIES + 1 },
      (_, index) => ({
        ...AREA,
        west: AREA.west - index * 0.001,
        east: AREA.east + index * 0.001,
      })
    );

    for (const area of areas) {
      await loadWildfireLayer(DATE, area, fetchImpl as typeof fetch, () => 4_000);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(areas.length);
    await loadWildfireLayer(DATE, areas[0], fetchImpl as typeof fetch, () => 4_000);
    expect(fetchImpl).toHaveBeenCalledTimes(areas.length + 1);
    await loadWildfireLayer(
      DATE,
      areas.at(-1)!,
      fetchImpl as typeof fetch,
      () => 4_000
    );
    expect(fetchImpl).toHaveBeenCalledTimes(areas.length + 1);
  });
});
