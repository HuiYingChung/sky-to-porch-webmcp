import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/heat/query/route";
import { HEAT_PINNED_FIXTURE_DATE } from "@/lib/heat/types";

function request(body: unknown): Request {
  return new Request("http://localhost/api/heat/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("WP-09 Heat route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the validated fixed Tucson fixture without a provider", async () => {
    const response = await POST(request({
      placeId: "demo-tucson",
      date: HEAT_PINNED_FIXTURE_DATE,
      mode: "fixture",
      concern: "home",
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      result: {
        kind: "success",
        explanationStatus: { mode: "deterministic", reason: "ai_unavailable" },
      },
    });
    expect(body.result.assessments).toHaveLength(6);
  });

  it("returns station-backed live evidence for a custom area over Tucson", async () => {
    const png = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 4,
        background: { r: 180, g: 90, b: 30, alpha: 1 },
      },
    }).png().toBuffer();
    const header = "WBANNO,DATE_TIME,RELATIVE_HUMIDITY,DRY_BULB_TEMPERATURE_C,HEAT_INDEX_C";
    const rows = Array.from({ length: 24 }, (_, hour) => [
      "53131",
      `20240711${String(hour).padStart(2, "0")}`,
      11 + hour,
      hour === 0 ? 41.7 : 30 + hour / 10,
      hour === 0 ? 38.9 : 25 + hour / 10,
    ].join(","));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "gibs.earthdata.nasa.gov") {
        return new Response(new Uint8Array(png), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      if (url.hostname === "www.ncei.noaa.gov") {
        return new Response([header, ...rows].join("\n"), {
          status: 200,
          headers: { "content-type": "text/csv" },
        });
      }
      throw new Error(`Unexpected URL in route test: ${url.toString()}`);
    }));

    const response = await POST(request({
      placeId: "custom-area",
      area: { west: -111.27, south: 32.14, east: -111.07, north: 32.34 },
      date: "2024-07-11",
      mode: "live",
      concern: "travel",
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, result: { kind: "success" } });
    expect(body.result.evidence.observations).toHaveLength(3);
    expect(body.result.evidence.observations.map(
      (observation: { observationId: string }) => observation.observationId
    )).toEqual([
      "obs-gibs-modis-lst-custom-area-20240711",
      "obs-uscrn-air-tucson-2024071100",
      "obs-uscrn-heat-index-tucson-2024071100",
    ]);
    const limitationIds = body.result.evidence.limitations.map(
      (limitation: { limitationId: string }) => limitation.limitationId
    );
    expect(limitationIds).toContain("lim-wp09-live-uscrn-station");
    expect(limitationIds).not.toContain("lim-uxfix02-heat-no-station-in-area");
  });

  it("rejects extra keys and invalid concerns", async () => {
    for (const body of [
      { placeId: "demo-tucson", date: HEAT_PINNED_FIXTURE_DATE, mode: "fixture", concern: "home", extra: true },
      { placeId: "demo-tucson", date: HEAT_PINNED_FIXTURE_DATE, mode: "fixture", concern: "diagnosis" },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
    }
  });
});
