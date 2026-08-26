import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoundingBox } from "@/contracts/common";
import {
  FLOOD_EXTENT_LAYER_PRODUCT,
  FLOOD_EXTENT_LAYER_SOURCE_ID,
  FLOOD_EXTENT_LAYER_SOURCE_URL,
  parseFloodExtentLayerEnvelope,
  type FloodExtentLayerEnvelope,
} from "@/contracts/flood-extent-layer";
import {
  clearFloodExtentLayerClientCacheForTests,
  loadFloodExtentLayer,
} from "@/lib/flood/extent-layer-client";

const AREA: BoundingBox = { west: -95.8, south: 29.4, east: -95, north: 30.1 };
const DATE = "2024-07-08";
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function positiveEnvelope(): FloodExtentLayerEnvelope {
  return {
    ok: true,
    result: {
      sourceId: FLOOD_EXTENT_LAYER_SOURCE_ID,
      sourceUrl: FLOOD_EXTENT_LAYER_SOURCE_URL,
      product: FLOOD_EXTENT_LAYER_PRODUCT,
      dataMode: "live",
      evidenceState: "observations_returned",
      retrievedAt: "2026-08-14T20:00:00.000Z",
      observedDate: DATE,
      requestArea: AREA,
      imageDataUrl: PNG_DATA_URL,
      imageWidth: 512,
      imageHeight: 512,
      payloadHash: "a".repeat(64),
      claimBoundary: "Visualization only; pixel classes are not interpreted.",
      limitations: [
        "Not flood depth or property impact.",
        "No observation is not evidence of no danger.",
      ],
    },
  };
}

describe("flood-extent map layer contract", () => {
  it("accepts a bounded validated visualization envelope", () => {
    expect(parseFloodExtentLayerEnvelope(positiveEnvelope())).toEqual(positiveEnvelope());
  });

  it("requires image bytes only for observations_returned", () => {
    const noObservation = positiveEnvelope();
    if (!noObservation.ok) throw new Error("test setup failed");
    noObservation.result.evidenceState = "no_observation";
    noObservation.result.observedDate = null;
    noObservation.result.imageDataUrl = null;
    expect(parseFloodExtentLayerEnvelope(noObservation)).not.toBeNull();

    const missingImage = positiveEnvelope();
    if (!missingImage.ok) throw new Error("test setup failed");
    missingImage.result.imageDataUrl = null;
    expect(parseFloodExtentLayerEnvelope(missingImage)).toBeNull();
  });

  it("rejects extra fields and unsafe image schemes", () => {
    const extra = positiveEnvelope() as unknown as Record<string, unknown>;
    (extra.result as Record<string, unknown>).unexpected = true;
    expect(parseFloodExtentLayerEnvelope(extra)).toBeNull();

    const unsafe = positiveEnvelope();
    if (!unsafe.ok) throw new Error("test setup failed");
    unsafe.result.imageDataUrl = "https://example.test/unvalidated.png";
    expect(parseFloodExtentLayerEnvelope(unsafe)).toBeNull();
  });
});

describe("flood-extent map layer client", () => {
  beforeEach(() => clearFloodExtentLayerClientCacheForTests());

  it("coalesces identical canonical-area requests and caches successful results", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(positiveEnvelope()), {
      headers: { "Content-Type": "application/json" },
    }));
    const [first, second] = await Promise.all([
      loadFloodExtentLayer(DATE, AREA, fetchImpl as typeof fetch, () => 1_000),
      loadFloodExtentLayer(DATE, AREA, fetchImpl as typeof fetch, () => 1_000),
    ]);
    const third = await loadFloodExtentLayer(DATE, AREA, fetchImpl as typeof fetch, () => 2_000);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(first).toEqual(second);
    expect(third).toEqual(first);
  });

  it("rejects a valid response for a different area or date", async () => {
    const mismatched = positiveEnvelope();
    if (!mismatched.ok) throw new Error("test setup failed");
    mismatched.result.requestArea = { west: -90, south: 20, east: -89, north: 21 };
    const areaResult = await loadFloodExtentLayer(
      DATE,
      AREA,
      vi.fn(async () => new Response(JSON.stringify(mismatched))) as typeof fetch,
      () => 3_000
    );
    expect(areaResult).toEqual({ ok: false, error: "schema_validation" });

    clearFloodExtentLayerClientCacheForTests();
    const wrongDate = positiveEnvelope();
    if (!wrongDate.ok) throw new Error("test setup failed");
    wrongDate.result.observedDate = "2024-07-09";
    const dateResult = await loadFloodExtentLayer(
      DATE,
      AREA,
      vi.fn(async () => new Response(JSON.stringify(wrongDate))) as typeof fetch,
      () => 4_000
    );
    expect(dateResult).toEqual({ ok: false, error: "schema_validation" });
  });
});
