/**
 * ADR-0040 (Bug E): the GIBS availability probe distinguishes published
 * imagery from a transparent "no imagery for this date here" response, with
 * the same bounded fail-closed transport as the flood-extent layer.
 */

import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  GIBS_AVAILABILITY_PRODUCTS,
  buildGibsAvailabilityUrl,
  checkGibsAvailability,
} from "@/lib/map/gibs-availability";
import { GET } from "@/app/api/map/gibs-availability/route";

const AREA = { west: -112.34, south: 33.22, east: -111.81, north: 33.67 };
const DATE = "2026-08-18";

async function png(alpha: number): Promise<Buffer> {
  return sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha },
    },
  }).png().toBuffer();
}

function pngResponse(body: Buffer, init: ResponseInit = {}): Response {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { "Content-Type": "image/png" },
    ...init,
  });
}

describe("GIBS availability adapter", () => {
  it("builds an exact allowlisted WMS request per product", () => {
    const url = buildGibsAvailabilityUrl("surface_temp", DATE, AREA);
    expect(url.hostname).toBe("gibs.earthdata.nasa.gov");
    expect(url.searchParams.get("LAYERS")).toBe(GIBS_AVAILABILITY_PRODUCTS.surface_temp);
    expect(url.searchParams.get("TIME")).toBe(DATE);
    expect(url.searchParams.get("BBOX")).toBe("-112.34,33.22,-111.81,33.67");
  });

  it("reports opaque imagery as available and transparent imagery as absent", async () => {
    const available = await checkGibsAvailability(
      "rain",
      DATE,
      AREA,
      vi.fn(async () => pngResponse(await png(1))) as unknown as typeof fetch
    );
    expect(available).toMatchObject({ kind: "checked", available: true });

    const missing = await checkGibsAvailability(
      "rain",
      DATE,
      AREA,
      vi.fn(async () => pngResponse(await png(0))) as unknown as typeof fetch
    );
    expect(missing).toMatchObject({ kind: "checked", available: false, alphaMaximum: 0 });
  });

  it("fails closed on bad input, rate limits, and wrong media types", async () => {
    const neverFetch = vi.fn();
    expect(await checkGibsAvailability("rain", "2026-13-40", AREA, neverFetch as unknown as typeof fetch))
      .toEqual({ kind: "source_failure", reason: "invalid_input" });
    expect(neverFetch).not.toHaveBeenCalled();

    expect(await checkGibsAvailability(
      "rain",
      DATE,
      AREA,
      vi.fn(async () => new Response("busy", { status: 429 })) as unknown as typeof fetch
    )).toEqual({ kind: "source_failure", reason: "rate_limited" });

    expect(await checkGibsAvailability(
      "rain",
      DATE,
      AREA,
      vi.fn(async () => new Response("<xml/>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      })) as unknown as typeof fetch
    )).toEqual({ kind: "source_failure", reason: "media_type" });
  });
});

describe("GET /api/map/gibs-availability", () => {
  function request(query: string): Request {
    return new Request(`http://localhost/api/map/gibs-availability?${query}`);
  }

  it("rejects unknown products, missing or extra parameters, and bad dates", async () => {
    for (const query of [
      `product=rain&date=${DATE}&west=-112.34&south=33.22&east=-111.81`,
      `product=nope&date=${DATE}&west=-112.34&south=33.22&east=-111.81&north=33.67`,
      `product=rain&date=2026-13-40&west=-112.34&south=33.22&east=-111.81&north=33.67`,
      `product=rain&date=${DATE}&west=-112.34&south=33.22&east=-111.81&north=33.67&url=https://evil.example`,
    ]) {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
    }
  });
});
