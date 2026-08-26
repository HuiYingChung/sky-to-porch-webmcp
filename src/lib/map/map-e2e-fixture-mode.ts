/**
 * ADR-0040: deterministic E2E containment for the map layer routes that
 * retrieve NASA GIBS imagery server-side (flood extent, GIBS availability).
 * Mirrors the coverage-gap pattern: activation requires the exact loopback
 * Playwright environment, and a partial or unsafe configuration fails closed
 * instead of falling back live. Production and development are unaffected.
 */

import sharp from "sharp";

const FIXTURE_MODE = "coverage-gap-v1";

type FixtureEnvironment = {
  PLAYWRIGHT_TEST_SERVER?: string;
  SKY_TO_PORCH_E2E_FIXTURES?: string;
};

/** Deterministic opaque PNG responder for gibs.earthdata.nasa.gov requests. */
export const mapLayersE2eFetch: typeof fetch = async (input) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.hostname !== "gibs.earthdata.nasa.gov") {
    throw new Error(`map E2E fixture fetch refuses non-GIBS host: ${url.hostname}`);
  }
  const size = Number(url.searchParams.get("WIDTH") ?? "256");
  const bytes = await sharp({
    create: {
      width: Number.isInteger(size) && size > 0 && size <= 1024 ? size : 256,
      height: Number.isInteger(size) && size > 0 && size <= 1024 ? size : 256,
      channels: 4,
      background: { r: 30, g: 60, b: 120, alpha: 1 },
    },
  }).png().toBuffer();
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "Content-Type": "image/png" },
  });
};

export function mapLayersFetchForRequest(
  request: Request,
  environment: FixtureEnvironment = {
    PLAYWRIGHT_TEST_SERVER: process.env.PLAYWRIGHT_TEST_SERVER,
    SKY_TO_PORCH_E2E_FIXTURES: process.env.SKY_TO_PORCH_E2E_FIXTURES,
  }
): typeof fetch | undefined {
  const requested = environment.SKY_TO_PORCH_E2E_FIXTURES !== undefined;
  if (!requested) return undefined;
  const url = new URL(request.url);
  if (
    environment.SKY_TO_PORCH_E2E_FIXTURES !== FIXTURE_MODE ||
    environment.PLAYWRIGHT_TEST_SERVER !== "1" ||
    (url.hostname !== "localhost" && url.hostname !== "127.0.0.1")
  ) {
    throw new Error("Map-layer E2E fixtures were requested outside the bounded local test server");
  }
  return mapLayersE2eFetch;
}
