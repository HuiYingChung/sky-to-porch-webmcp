import { beforeEach, describe, expect, it, vi } from "vitest";

const queryFirmsNrtLayerGuardedMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/fire/firms-nrt-layer", () => ({
  queryFirmsNrtLayerGuarded: queryFirmsNrtLayerGuardedMock,
}));

import { GET } from "@/app/api/map/wildfire/route";

const RESULT = {
  sourceId: "nasa_firms",
  sourceUrl: "https://firms.modaps.eosdis.nasa.gov/api/area/",
  product: "VIIRS_NOAA20_NRT",
  dataMode: "live",
  evidenceState: "no_observation",
  retrievedAt: "2026-08-13T16:00:00.000Z",
  latestAcquiredAt: null,
  requestArea: { west: -119, south: 33, east: -117, north: 35 },
  featureCollection: { type: "FeatureCollection", features: [] },
  payloadHash: "a".repeat(64),
  limitations: [
    "Hotspots are pixels, not perimeters.",
    "No detection is not evidence of no fire or no danger.",
  ],
} as const;

function request(query: string): Request {
  return new Request(`http://localhost/api/map/wildfire?${query}`);
}

describe("GET /api/map/wildfire", () => {
  beforeEach(() => queryFirmsNrtLayerGuardedMock.mockReset());

  it("rejects unknown, missing, duplicate, and out-of-range parameters before retrieval", async () => {
    for (const query of [
      "date=2026-08-13&west=-119&south=33&east=-117",
      "west=-119&south=33&east=-117&north=35",
      "date=2026-08-13&west=-119&south=33&east=-117&north=35&url=https://evil.example",
      "date=2026-08-13&west=-119&west=-118&south=33&east=-117&north=35",
      "date=2026-08-13&west=-190&south=33&east=-117&north=35",
      "date=2026-13-40&west=-119&south=33&east=-117&north=35",
    ]) {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(queryFirmsNrtLayerGuardedMock).not.toHaveBeenCalled();
  });

  it("passes only a validated date and selected area to the server adapter", async () => {
    queryFirmsNrtLayerGuardedMock.mockResolvedValue({ kind: "success", result: RESULT });
    const response = await GET(request("date=2026-08-13&west=-119&south=33&east=-117&north=35"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: RESULT });
    expect(queryFirmsNrtLayerGuardedMock).toHaveBeenCalledOnce();
    expect(queryFirmsNrtLayerGuardedMock.mock.calls[0][0]).toBe("2026-08-13");
    expect(queryFirmsNrtLayerGuardedMock.mock.calls[0][1]).toEqual(RESULT.requestArea);
    expect(queryFirmsNrtLayerGuardedMock.mock.calls[0][2]).toMatchObject({ fetch: globalThis.fetch });
  });

  it.each([
    ["unconfigured", 503],
    ["source_failure", 502],
    ["rate_limited", 429],
    ["schema_validation", 502],
    ["response_too_large", 502],
  ] as const)("maps %s to a bounded public failure", async (error, status) => {
    queryFirmsNrtLayerGuardedMock.mockResolvedValue({ kind: "failure", error });
    const response = await GET(request("date=2026-08-13&west=-119&south=33&east=-117&north=35"));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, error });
  });
});
