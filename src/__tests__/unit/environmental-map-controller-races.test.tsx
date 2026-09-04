import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoundingBox } from "@/contracts/common";
import type { WildfireLayerEnvelope, WildfireLayerResult } from "@/contracts/wildfire-layer";
import type {
  FloodExtentLayerEnvelope,
  FloodExtentLayerResult,
} from "@/contracts/flood-extent-layer";
import {
  useEnvironmentalMapController,
  type EnvironmentalMapController,
} from "@/components/map/use-environmental-map-controller";
import { buildGeocodedPlaceSelection } from "@/lib/location/selection";

interface DeferredRequest<T> {
  area: BoundingBox;
  resolve: (value: T) => void;
}

const mocks = vi.hoisted(() => ({
  wildfireRequests: [] as DeferredRequest<WildfireLayerEnvelope>[],
  floodRequests: [] as DeferredRequest<FloodExtentLayerEnvelope>[],
}));

vi.mock("@/lib/fire/firms-nrt-layer-client", () => ({
  loadWildfireLayer: vi.fn((_date: string, area: BoundingBox) =>
    new Promise<WildfireLayerEnvelope>((resolve) => {
      mocks.wildfireRequests.push({ area: { ...area }, resolve });
    })
  ),
}));

vi.mock("@/lib/flood/extent-layer-client", () => ({
  loadFloodExtentLayer: vi.fn((_date: string, area: BoundingBox) =>
    new Promise<FloodExtentLayerEnvelope>((resolve) => {
      mocks.floodRequests.push({ area: { ...area }, resolve });
    })
  ),
}));

vi.mock("@/lib/map/gibs-availability-client", () => ({
  loadGibsAvailability: vi.fn(() => new Promise(() => {})),
}));

const TODAY = new Date().toISOString().slice(0, 10);

function wildfireResult(area: BoundingBox): WildfireLayerResult {
  return {
    sourceId: "nasa_firms",
    sourceUrl: "https://firms.modaps.eosdis.nasa.gov/api/area/",
    product: "VIIRS_NOAA20_NRT",
    dataMode: "live",
    evidenceState: "no_observation",
    retrievedAt: `${TODAY}T12:00:00Z`,
    latestAcquiredAt: null,
    requestArea: area,
    featureCollection: { type: "FeatureCollection", features: [] },
    payloadHash: "a".repeat(64),
    limitations: ["Thermal pixels are not perimeters.", "Missing pixels do not prove safety."],
  };
}

function floodResult(area: BoundingBox): FloodExtentLayerResult {
  return {
    sourceId: "nasa_lance_flood_extent",
    sourceUrl: "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi",
    product: "VIIRS_Combined_Flood_3-Day",
    dataMode: "live",
    evidenceState: "no_observation",
    retrievedAt: `${TODAY}T12:00:00Z`,
    observedDate: null,
    requestArea: area,
    imageDataUrl: null,
    imageWidth: 512,
    imageHeight: 512,
    payloadHash: "b".repeat(64),
    claimBoundary: "Visualization only.",
    limitations: ["Flood imagery is not water depth.", "Missing imagery does not prove safety."],
  };
}

function wildfireObservationResult(area: BoundingBox): WildfireLayerResult {
  return {
    ...wildfireResult(area),
    evidenceState: "observations_returned",
    latestAcquiredAt: `${TODAY}T11:30:00Z`,
    featureCollection: {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [area.west, area.south] },
        properties: {
          detectionId: "test-detection",
          acquiredAt: `${TODAY}T11:30:00Z`,
          satellite: "N20",
          instrument: "VIIRS",
          confidence: "nominal",
          processing: "near_real_time",
          version: "2.0NRT",
          frpMw: 4.2,
          dayNight: "day",
        },
      }],
    },
  };
}

function floodObservationResult(area: BoundingBox): FloodExtentLayerResult {
  return {
    ...floodResult(area),
    evidenceState: "observations_returned",
    observedDate: TODAY,
    imageDataUrl: "data:image/png;base64,AA==",
  };
}

function selection(label: string, lon: number, lat: number) {
  return buildGeocodedPlaceSelection(
    label,
    { lon, lat },
    25,
    "custom",
    `${TODAY}T00:00:00Z`,
    `${TODAY}T23:59:59Z`
  );
}

interface RenderSnapshot {
  place: string;
  wildfireWest: number | null;
  floodWest: number | null;
}

let container: HTMLElement;
let root: Root;
let controller: EnvironmentalMapController;
let renderSnapshots: RenderSnapshot[];

function Probe({ place, value }: {
  place: string;
  value: ReturnType<typeof selection>;
}) {
  controller = useEnvironmentalMapController(value);
  renderSnapshots.push({
    place,
    wildfireWest: controller.wildfireState.status === "ready"
      ? controller.wildfireState.result.requestArea.west
      : null,
    floodWest: controller.floodExtentState.status === "ready"
      ? controller.floodExtentState.result.requestArea.west
      : null,
  });
  return null;
}

beforeEach(() => {
  mocks.wildfireRequests.length = 0;
  mocks.floodRequests.length = 0;
  renderSnapshots = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("environmental map controller request ownership", () => {
  it("reports fetched FIRMS and flood data as visible only after renderer confirmation", async () => {
    const selected = selection("Selected area", -95.36, 29.76);
    await act(async () => {
      root.render(<Probe place="selected" value={selected} />);
    });
    await act(async () => {
      controller.applyDesiredState(
        { thermal_anomalies_firms: true, flood_extent: true },
        { date: TODAY, contextChanged: true, origin: "human" }
      );
    });
    const contextRevision = controller.mapState.contextRevision;
    const wildfireRequest = mocks.wildfireRequests[0];
    const floodRequest = mocks.floodRequests[0];
    await act(async () => {
      wildfireRequest.resolve({
        ok: true,
        result: wildfireObservationResult(wildfireRequest.area),
      });
      floodRequest.resolve({
        ok: true,
        result: floodObservationResult(floodRequest.area),
      });
      await Promise.resolve();
    });

    expect(controller.wildfireState.status).toBe("ready");
    expect(controller.floodExtentState.status).toBe("ready");
    expect(controller.mapState.layers.thermal_anomalies_firms.status).toBe("loading");
    expect(controller.mapState.layers.flood_extent.status).toBe("loading");

    await act(async () => {
      controller.reportMapOverlayStatus(
        "thermal_anomalies_firms",
        "ready",
        TODAY,
        contextRevision
      );
      controller.reportMapOverlayStatus(
        "flood_extent",
        "ready",
        TODAY,
        contextRevision
      );
    });
    expect(controller.mapState.layers.thermal_anomalies_firms.status).toBe("ready");
    expect(controller.mapState.layers.flood_extent.status).toBe("ready");

    await act(async () => {
      controller.reportMapOverlayStatus(
        "thermal_anomalies_firms",
        "detached",
        TODAY,
        contextRevision
      );
      controller.reportMapOverlayStatus(
        "flood_extent",
        "detached",
        TODAY,
        contextRevision
      );
    });
    expect(controller.mapState.layers.thermal_anomalies_firms.status).toBe("loading");
    expect(controller.mapState.layers.flood_extent.status).toBe("loading");
  });

  it("allows a requested overlay to recover from renderer failure after remount", async () => {
    const selected = selection("Selected area", -95.36, 29.76);
    await act(async () => {
      root.render(<Probe place="selected" value={selected} />);
    });
    await act(async () => {
      controller.applyDesiredState(
        { rain_satellite: true },
        { date: TODAY, contextChanged: true, origin: "human" }
      );
    });
    const contextRevision = controller.mapState.contextRevision;

    await act(async () => {
      controller.reportMapOverlayStatus(
        "rain_satellite",
        "source_failure",
        TODAY,
        contextRevision
      );
    });
    expect(controller.mapState.layers.rain_satellite.status).toBe("source_failure");

    await act(async () => {
      controller.reportMapRendererStatus(
        "unavailable",
        TODAY,
        contextRevision
      );
      controller.reportMapOverlayStatus(
        "rain_satellite",
        "detached",
        TODAY,
        contextRevision
      );
    });
    expect(controller.mapState.layers.rain_satellite.status).toBe("source_failure");

    await act(async () => {
      controller.reportMapRendererStatus(
        "attached",
        TODAY,
        contextRevision
      );
    });
    expect(controller.mapState.layers.rain_satellite.status).toBe("loading");

    await act(async () => {
      controller.reportMapOverlayStatus(
        "rain_satellite",
        "ready",
        TODAY,
        contextRevision
      );
    });
    expect(controller.mapState.layers.rain_satellite.status).toBe("ready");
  });

  it("keeps every requested layer non-visible while the whole renderer is unavailable", async () => {
    const selected = selection("Selected area", -95.36, 29.76);
    await act(async () => {
      root.render(<Probe place="selected" value={selected} />);
    });
    await act(async () => {
      controller.applyDesiredState(
        { rain_satellite: true, thermal_anomalies_firms: true, flood_extent: true },
        { date: TODAY, contextChanged: true, origin: "human" }
      );
    });
    const contextRevision = controller.mapState.contextRevision;

    await act(async () => {
      controller.reportMapRendererStatus("unavailable", TODAY, contextRevision);
    });
    expect(controller.mapState.layers.rain_satellite.status).toBe("source_failure");
    expect(controller.mapState.layers.thermal_anomalies_firms.status).toBe("source_failure");
    expect(controller.mapState.layers.flood_extent.status).toBe("source_failure");

    await act(async () => {
      controller.applyDesiredState(
        { surface_heat_satellite: true },
        { date: TODAY, contextChanged: false, origin: "human" }
      );
    });
    expect(controller.mapState.layers.surface_heat_satellite.status).toBe("source_failure");

    const wildfireRequest = mocks.wildfireRequests[0];
    const floodRequest = mocks.floodRequests[0];
    await act(async () => {
      wildfireRequest.resolve({
        ok: true,
        result: wildfireObservationResult(wildfireRequest.area),
      });
      floodRequest.resolve({
        ok: true,
        result: floodObservationResult(floodRequest.area),
      });
      await Promise.resolve();
      controller.reportMapOverlayStatus(
        "rain_satellite",
        "ready",
        TODAY,
        contextRevision
      );
    });
    expect(controller.mapState.layers.rain_satellite.status).toBe("source_failure");
    expect(controller.mapState.layers.thermal_anomalies_firms.status).toBe("source_failure");
    expect(controller.mapState.layers.flood_extent.status).toBe("source_failure");

    await act(async () => {
      controller.reportMapRendererStatus("attached", TODAY, contextRevision);
    });
    for (const layerId of [
      "rain_satellite",
      "surface_heat_satellite",
      "thermal_anomalies_firms",
      "flood_extent",
    ] as const) {
      expect(controller.mapState.layers[layerId].status).toBe("loading");
    }
  });

  it("never exposes or commits old results after a same-date area change", async () => {
    const first = selection("First area", -95.36, 29.76);
    const second = selection("Second area", -96.8, 32.78);
    const third = selection("Third area", -97.74, 30.27);

    await act(async () => {
      root.render(<Probe place="first" value={first} />);
    });
    await act(async () => {
      controller.applyDesiredState(
        { thermal_anomalies_firms: true, flood_extent: true },
        { date: TODAY, contextChanged: true, origin: "human" }
      );
    });
    expect(mocks.wildfireRequests).toHaveLength(1);
    expect(mocks.floodRequests).toHaveLength(1);

    const firstWildfire = mocks.wildfireRequests[0];
    const firstFlood = mocks.floodRequests[0];
    await act(async () => {
      firstWildfire.resolve({ ok: true, result: wildfireResult(firstWildfire.area) });
      firstFlood.resolve({ ok: true, result: floodResult(firstFlood.area) });
      await Promise.resolve();
    });
    expect(controller.wildfireState.status).toBe("ready");
    expect(controller.floodExtentState.status).toBe("ready");

    const beforeSecond = renderSnapshots.length;
    await act(async () => {
      controller.applyDesiredState({}, {
        date: TODAY,
        contextChanged: true,
        origin: "human",
      });
      root.render(<Probe place="second" value={second} />);
      await Promise.resolve();
    });

    const secondAreaSnapshots = renderSnapshots.slice(beforeSecond)
      .filter((snapshot) => snapshot.place === "second");
    expect(secondAreaSnapshots).not.toContainEqual(expect.objectContaining({
      wildfireWest: firstWildfire.area.west,
    }));
    expect(secondAreaSnapshots).not.toContainEqual(expect.objectContaining({
      floodWest: firstFlood.area.west,
    }));
    expect(mocks.wildfireRequests).toHaveLength(2);
    expect(mocks.floodRequests).toHaveLength(2);

    const secondWildfire = mocks.wildfireRequests[1];
    const secondFlood = mocks.floodRequests[1];
    await act(async () => {
      controller.applyDesiredState({}, {
        date: TODAY,
        contextChanged: true,
        origin: "human",
      });
      root.render(<Probe place="third" value={third} />);
      await Promise.resolve();
    });
    await act(async () => {
      secondWildfire.resolve({ ok: true, result: wildfireResult(secondWildfire.area) });
      secondFlood.resolve({ ok: true, result: floodResult(secondFlood.area) });
      await Promise.resolve();
    });

    if (controller.wildfireState.status === "ready") {
      expect(controller.wildfireState.result.requestArea).not.toEqual(secondWildfire.area);
    }
    if (controller.floodExtentState.status === "ready") {
      expect(controller.floodExtentState.result.requestArea).not.toEqual(secondFlood.area);
    }
  });
});
