import { beforeEach, describe, expect, it, vi } from "vitest";

const queryFloodExtentMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/flood/extent-live-adapter", () => ({
  queryFloodExtent: queryFloodExtentMock,
}));

import { GET } from "@/app/api/map/flood-extent/route";

const AREA = { west: -95.8, south: 29.4, east: -95, north: 30.1 };
const DATE = "2024-07-08";
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const OBSERVATION = {
  observationId: "obs-flood-map-test",
  provenance: {
    sourceId: "nasa_lance_flood_extent",
    sourceUrl: "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?test=mock",
    retrievedAt: "2026-08-14T20:00:00.000Z",
    observedAt: `${DATE}T00:00:00Z`,
    product: "VIIRS NOAA-20 and NOAA-21 3-Day Flood Composite visualization",
    payloadHash: "a".repeat(64),
    requestParameters: {},
  },
  variableName: "VIIRS flood extent visualization",
  textValue: "flood_extent_visualization_available",
  dataMode: "live",
  qualifiers: ["visualization_only"],
  metadata: {
    claimBoundary: "Visualization only; pixel classes are not interpreted.",
  },
};

function request(query: string): Request {
  return new Request(`http://localhost/api/map/flood-extent?${query}`);
}

function validQuery(): string {
  return `date=${DATE}&west=${AREA.west}&south=${AREA.south}&east=${AREA.east}&north=${AREA.north}`;
}

describe("GET /api/map/flood-extent", () => {
  beforeEach(() => queryFloodExtentMock.mockReset());

  it("rejects missing, duplicate, unknown, invalid-date, and invalid-area inputs before retrieval", async () => {
    for (const query of [
      `date=${DATE}&west=${AREA.west}&south=${AREA.south}&east=${AREA.east}`,
      `${validQuery()}&url=https://evil.example`,
      `${validQuery()}&west=-96`,
      `date=2024-02-30&west=${AREA.west}&south=${AREA.south}&east=${AREA.east}&north=${AREA.north}`,
      `date=${DATE}&west=-190&south=${AREA.south}&east=${AREA.east}&north=${AREA.north}`,
    ]) {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(queryFloodExtentMock).not.toHaveBeenCalled();
  });

  it("returns only a validated same-area image envelope", async () => {
    queryFloodExtentMock.mockResolvedValue({
      kind: "observation",
      observation: OBSERVATION,
      visualization: { imageDataUrl: PNG_DATA_URL, byteLength: 70 },
    });
    const response = await GET(request(validQuery()));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      result: {
        evidenceState: "observations_returned",
        observedDate: DATE,
        requestArea: AREA,
        imageDataUrl: PNG_DATA_URL,
      },
    });
    expect(queryFloodExtentMock).toHaveBeenCalledWith(DATE, AREA, {
      includeVisualization: true,
    });
  });

  it("keeps no-observation and failures explicit without an image fallback", async () => {
    queryFloodExtentMock.mockResolvedValue({
      kind: "no_observation",
      observation: {
        ...OBSERVATION,
        provenance: { ...OBSERVATION.provenance, observedAt: "unknown" },
        metadata: {
          claimBoundary: "A transparent response is no observation, not no flood and not no danger.",
        },
      },
      payloadHash: "a".repeat(64),
      sourceUrl: OBSERVATION.provenance.sourceUrl,
    });
    let response = await GET(request(validQuery()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      result: {
        evidenceState: "no_observation",
        observedDate: null,
        imageDataUrl: null,
      },
    });

    queryFloodExtentMock.mockResolvedValue({ kind: "source_failure", reason: "timeout" });
    response = await GET(request(validQuery()));
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ ok: false, error: "timeout" });
  });
});
