import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { US_COVERAGE_AREA_CASES } from "@/data/us-coverage-matrix";
import {
  FLOOD_EXTENT_GIBS_HOST,
  FLOOD_EXTENT_GIBS_PATH,
  FLOOD_EXTENT_LAYER,
  FLOOD_EXTENT_MAX_BYTES,
  FLOOD_EXTENT_MAX_CONCURRENCY,
  FLOOD_EXTENT_TIMEOUT_MS,
  FloodExtentContractError,
  assertFloodExtentUrl,
  buildFloodExtentRequest,
  getFloodExtentReadiness,
  inspectPreparedFloodExtentPng,
} from "@/lib/flood/extent-source-contract";

async function png(alpha: number, width = 512, height = 512): Promise<Uint8Array> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 10, g: 80, b: 160, alpha },
    },
  }).png().toBuffer();
}

describe("live NASA LANCE VIIRS flood-extent source contract", () => {
  it.each(US_COVERAGE_AREA_CASES)(
    "builds the same allowlisted product contract for $region / $label",
    (coverageCase) => {
      const request = buildFloodExtentRequest("2024-07-08", coverageCase.area);
      const url = new URL(request.url);
      expect(url.hostname).toBe(FLOOD_EXTENT_GIBS_HOST);
      expect(url.pathname).toBe(FLOOD_EXTENT_GIBS_PATH);
      expect(url.searchParams.get("LAYERS")).toBe(FLOOD_EXTENT_LAYER);
      expect(url.searchParams.get("BBOX")).toBe(
        `${coverageCase.area.west},${coverageCase.area.south},${coverageCase.area.east},${coverageCase.area.north}`
      );
      expect(request).toMatchObject({
        timeoutMs: FLOOD_EXTENT_TIMEOUT_MS,
        maximumBytes: FLOOD_EXTENT_MAX_BYTES,
        requestCount: 1,
        externalCallsEnabled: true,
      });
      expect(FLOOD_EXTENT_MAX_CONCURRENCY).toBe(2);
    }
  );

  it("rejects invalid dates and unvalidated areas before request construction", () => {
    expect(() => buildFloodExtentRequest("2024-02-30", US_COVERAGE_AREA_CASES[0].area))
      .toThrowError(new FloodExtentContractError("invalid_date"));
    expect(() => buildFloodExtentRequest("2024-07-08", {
      west: -120,
      south: 20,
      east: -100,
      north: 30,
    })).toThrowError(new FloodExtentContractError("invalid_area"));
  });

  it("rejects a mutated host or parameter set", () => {
    const request = buildFloodExtentRequest("2024-07-08", US_COVERAGE_AREA_CASES[0].area);
    const wrongHost = new URL(request.url);
    wrongHost.hostname = "example.com";
    expect(() => assertFloodExtentUrl(wrongHost)).toThrow("schema_validation");

    const extraParameter = new URL(request.url);
    extraParameter.searchParams.set("token", "unexpected");
    expect(() => assertFloodExtentUrl(extraParameter)).toThrow("schema_validation");
  });

  it("distinguishes a returned visualization from transparent no-observation without classifying pixels", async () => {
    await expect(inspectPreparedFloodExtentPng(await png(1))).resolves.toMatchObject({
      outcome: "visualization_returned",
      width: 512,
      height: 512,
      legendStatus: "unvalidated",
    });
    await expect(inspectPreparedFloodExtentPng(await png(0))).resolves.toMatchObject({
      outcome: "no_observation",
      alphaMaximum: 0,
      legendStatus: "unvalidated",
    });
  });

  it("fails closed on malformed, wrong-size, and oversized payloads", async () => {
    await expect(inspectPreparedFloodExtentPng(new TextEncoder().encode("not a png")))
      .rejects.toMatchObject({ reason: "malformed" });
    await expect(inspectPreparedFloodExtentPng(await png(1, 256, 256)))
      .rejects.toMatchObject({ reason: "schema_validation" });
    await expect(inspectPreparedFloodExtentPng(new Uint8Array(FLOOD_EXTENT_MAX_BYTES + 1)))
      .rejects.toMatchObject({ reason: "oversize" });
  });

  it("promotes the source after the bounded live gate", () => {
    expect(getFloodExtentReadiness()).toEqual({
      registryDecision: "go",
      supportedDataModes: ["live", "fixture", "historical"],
      productQueryable: true,
      reason:
        "Bounded live feasibility validated the exact VIIRS 3-day WMS product and transparent no-observation state; legend colors remain uninterpreted.",
    });
  });
});
