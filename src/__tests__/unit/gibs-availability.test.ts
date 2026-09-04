/**
 * ADR-0040 (Bug E): the GIBS probe distinguishes visible pixels from a fully
 * transparent response without claiming why that response is transparent.
 */

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GIBS_AVAILABILITY_MAX_BYTES,
  GIBS_AVAILABILITY_MAX_REQUESTS_PER_WINDOW,
  GIBS_AVAILABILITY_PRODUCTS,
  buildGibsAvailabilityUrl,
  checkGibsAvailability,
  clearGibsAvailabilityServerStateForTests,
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

async function sizedPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 1 },
    },
  }).png().toBuffer();
}

async function grayscaleAlphaPng(alpha: number): Promise<Buffer> {
  const pixels = Buffer.alloc(256 * 256 * 2);
  for (let offset = 0; offset < pixels.length; offset += 2) {
    pixels[offset] = 120;
    pixels[offset + 1] = alpha;
  }
  return sharp(pixels, {
    raw: { width: 256, height: 256, channels: 2 },
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
  beforeEach(() => clearGibsAvailabilityServerStateForTests());
  afterEach(() => vi.unstubAllGlobals());

  it("builds an exact allowlisted WMS request per product", () => {
    const url = buildGibsAvailabilityUrl("surface_temp", DATE, AREA);
    expect(url.hostname).toBe("gibs.earthdata.nasa.gov");
    expect(url.searchParams.get("LAYERS")).toBe(GIBS_AVAILABILITY_PRODUCTS.surface_temp);
    expect(url.searchParams.get("TIME")).toBe(DATE);
    expect(url.searchParams.get("BBOX")).toBe("-112.34,33.22,-111.81,33.67");
  });

  it("reports whether opaque or transparent imagery contains visible pixels", async () => {
    const available = await checkGibsAvailability(
      "rain",
      DATE,
      AREA,
      vi.fn(async () => pngResponse(await png(1))) as unknown as typeof fetch
    );
    expect(available).toMatchObject({
      kind: "checked",
      visiblePixelsDetected: true,
    });

    const missing = await checkGibsAvailability(
      "rain",
      DATE,
      AREA,
      vi.fn(async () => pngResponse(await png(0))) as unknown as typeof fetch
    );
    expect(missing).toMatchObject({
      kind: "checked",
      visiblePixelsDetected: false,
      alphaMaximum: 0,
    });
  });

  it("reads the final alpha band for grayscale-alpha PNG responses", async () => {
    const transparent = await checkGibsAvailability(
      "rain",
      DATE,
      AREA,
      vi.fn(async () => pngResponse(await grayscaleAlphaPng(0))) as unknown as typeof fetch
    );
    expect(transparent).toEqual({
      kind: "checked",
      visiblePixelsDetected: false,
      alphaMaximum: 0,
    });

    const opaque = await checkGibsAvailability(
      "rain",
      DATE,
      AREA,
      vi.fn(async () => pngResponse(await grayscaleAlphaPng(255))) as unknown as typeof fetch
    );
    expect(opaque).toEqual({
      kind: "checked",
      visiblePixelsDetected: true,
      alphaMaximum: 255,
    });
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

  it("rejects an oversized declared body before reading it", async () => {
    let pullCount = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        controller.enqueue(new Uint8Array([137, 80, 78, 71]));
        controller.close();
      },
    });
    const outcome = await checkGibsAvailability(
      "rain",
      DATE,
      AREA,
      vi.fn(async () => new Response(body, {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(GIBS_AVAILABILITY_MAX_BYTES + 1),
        },
      })) as unknown as typeof fetch
    );
    expect(outcome).toEqual({ kind: "source_failure", reason: "oversize" });
    expect(pullCount).toBeLessThanOrEqual(1);
  });

  it("enforces the byte limit while streaming when length is undeclared", async () => {
    const chunkSize = 400_000;
    let chunksSent = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksSent += 1;
        controller.enqueue(new Uint8Array(chunkSize));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    const outcome = await checkGibsAvailability(
      "rain",
      DATE,
      AREA,
      vi.fn(async () => new Response(body, {
        headers: { "Content-Type": "image/png" },
      })) as unknown as typeof fetch
    );
    expect(outcome).toEqual({ kind: "source_failure", reason: "oversize" });
    expect(chunksSent).toBe(3);
    expect(cancelled).toBe(true);
  });

  it("rejects a compressed image whose decoded dimensions exceed the exact probe", async () => {
    const outcome = await checkGibsAvailability(
      "rain",
      DATE,
      AREA,
      vi.fn(async () => pngResponse(await sizedPng(512, 256))) as unknown as typeof fetch
    );
    expect(outcome).toEqual({ kind: "source_failure", reason: "malformed" });
  });

  it("coalesces identical production requests before fetch and decode", async () => {
    const bytes = await png(1);
    let release: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      release = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = checkGibsAvailability("rain", DATE, AREA);
    const second = checkGibsAvailability("rain", DATE, AREA);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release?.(pngResponse(bytes));

    await expect(first).resolves.toMatchObject({
      kind: "checked",
      visiblePixelsDetected: true,
    });
    await expect(second).resolves.toMatchObject({
      kind: "checked",
      visiblePixelsDetected: true,
    });
  });

  it("bounds concurrent production requests and the rolling start rate", async () => {
    const bytes = await png(1);
    const releases: Array<(response: Response) => void> = [];
    const deferredFetch = vi.fn(() => new Promise<Response>((resolve) => {
      releases.push(resolve);
    }));
    vi.stubGlobal("fetch", deferredFetch);
    const first = checkGibsAvailability("rain", DATE, AREA);
    const secondArea = { ...AREA, west: AREA.west + 0.01, east: AREA.east + 0.01 };
    const second = checkGibsAvailability("rain", DATE, secondArea);
    await expect(checkGibsAvailability(
      "rain",
      DATE,
      { ...AREA, west: AREA.west + 0.02, east: AREA.east + 0.02 }
    )).resolves.toEqual({ kind: "source_failure", reason: "rate_limited" });
    expect(deferredFetch).toHaveBeenCalledTimes(2);
    for (const resolve of releases) resolve(pngResponse(bytes));
    await Promise.all([first, second]);

    clearGibsAvailabilityServerStateForTests();
    const immediateFetch = vi.fn(async () => pngResponse(bytes));
    vi.stubGlobal("fetch", immediateFetch);
    for (let index = 0; index < GIBS_AVAILABILITY_MAX_REQUESTS_PER_WINDOW; index += 1) {
      const offset = index * 0.001;
      await expect(checkGibsAvailability("surface_temp", DATE, {
        ...AREA,
        west: AREA.west + offset,
        east: AREA.east + offset,
      })).resolves.toMatchObject({ kind: "checked" });
    }
    await expect(checkGibsAvailability("surface_temp", DATE, {
      ...AREA,
      west: AREA.west + 0.1,
      east: AREA.east + 0.1,
    })).resolves.toEqual({ kind: "source_failure", reason: "rate_limited" });
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
