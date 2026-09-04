import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INITIAL_LAYERS,
  type LayerState,
} from "@/components/map/layer-manager";
import {
  buildGeocodedPlaceSelection,
  buildMapCoordinateSelection,
  type PlaceSelection,
} from "@/lib/location/selection";

const mocks = vi.hoisted(() => {
  const state = {
    currentSelection: null as PlaceSelection | null,
    instances: [] as Array<{
      fitBounds: ReturnType<typeof vi.fn>;
      flyTo: ReturnType<typeof vi.fn>;
      addSource: ReturnType<typeof vi.fn>;
      removeSource: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
      emit: (event: string, payload: unknown) => void;
    }>,
    controls: { failConstruction: false },
    setPlaceSelection: vi.fn(),
  };

  class Map {
    fitBounds = vi.fn();
    flyTo = vi.fn();
    addLayer = vi.fn((layer: { id: string; layout?: { visibility?: string } }) => {
      this.layers.add(layer.id);
      this.visibility.set(layer.id, layer.layout?.visibility ?? "visible");
    });
    addSource = vi.fn((id: string) => {
      this.sources.set(id, { setData: vi.fn() });
    });
    getLayer = vi.fn((id: string) => this.layers.has(id) ? { id } : undefined);
    getSource = vi.fn((id: string) => this.sources.get(id));
    getLayoutProperty = vi.fn((id: string, property: string) =>
      property === "visibility" ? this.visibility.get(id) : undefined
    );
    isSourceLoaded = vi.fn((id: string) => this.sources.has(id));
    getZoom = vi.fn(() => 6);
    getCanvas = vi.fn(() => document.createElement("canvas"));
    queryRenderedFeatures = vi.fn(() => []);
    removeLayer = vi.fn((id: string) => {
      this.visibility.delete(id);
      return this.layers.delete(id);
    });
    removeSource = vi.fn((id: string) => this.sources.delete(id));
    setLayoutProperty = vi.fn((id: string, property: string, value: unknown) => {
      if (property === "visibility") this.visibility.set(id, value);
    });
    remove = vi.fn();
    private layers = new Set<string>();
    private visibility = new globalThis.Map<string, unknown>();
    private sources = new globalThis.Map<
      string,
      { setData: ReturnType<typeof vi.fn> }
    >();
    private handlers = new globalThis.Map<
      string,
      Array<(payload: unknown) => void>
    >();

    constructor() {
      if (state.controls.failConstruction) throw new Error("WebGL unavailable");
      state.instances.push(this);
    }

    on(event: string, first: unknown, second?: unknown) {
      const callback = typeof first === "function" ? first : second;
      if (typeof callback === "function") {
        const handlers = this.handlers.get(event) ?? [];
        handlers.push(callback as (payload: unknown) => void);
        this.handlers.set(event, handlers);
        if (event === "load") queueMicrotask(() => callback());
      }
      return this;
    }

    emit(event: string, payload: unknown) {
      for (const handler of this.handlers.get(event) ?? []) handler(payload);
    }
  }

  class Marker {
    private element = document.createElement("div");
    setLngLat() { return this; }
    getElement() { return this.element; }
    addTo() { return this; }
    remove() { return this; }
  }

  class Popup {
    setLngLat() { return this; }
    setDOMContent() { return this; }
    addTo() { return this; }
  }

  return { ...state, Map, Marker, Popup };
});

vi.mock("maplibre-gl", () => ({
  default: { Map: mocks.Map, Marker: mocks.Marker, Popup: mocks.Popup },
}));

vi.mock("@/components/query/query-provider", () => ({
  useQueryDraft: () => ({
    placeSelection: mocks.currentSelection,
    setPlaceSelection: mocks.setPlaceSelection,
  }),
}));

import { MaplibreMapCanvas } from "@/components/map/maplibre-map-canvas";
import { circlePolygon } from "@/components/map/analysis-map";

let container: HTMLElement;
let root: Root;

function canvas(
  layers: LayerState[],
  overrides: Partial<React.ComponentProps<typeof MaplibreMapCanvas>> = {}
) {
  return (
    <MaplibreMapCanvas
      layers={layers}
      osmTileUrl="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      osmAttribution="OpenStreetMap"
      overlayDate="2024-07-08"
      overlayContextRevision={0}
      circlePolygon={circlePolygon}
      wildfireData={null}
      floodExtentData={null}
      onUseWithoutMap={vi.fn()}
      {...overrides}
    />
  );
}

async function renderCanvas(
  selection: PlaceSelection,
  layers: LayerState[] = INITIAL_LAYERS,
  overrides: Partial<React.ComponentProps<typeof MaplibreMapCanvas>> = {}
) {
  mocks.currentSelection = selection;
  await act(async () => {
    root.render(canvas(layers, overrides));
    await Promise.resolve();
    await Promise.resolve();
  });
  return mocks.instances.at(-1)!;
}

const wildfireData: NonNullable<
  React.ComponentProps<typeof MaplibreMapCanvas>["wildfireData"]
> = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    geometry: { type: "Point", coordinates: [-95.36, 29.76] },
    properties: {
      detectionId: "render-test",
      acquiredAt: "2024-07-08T12:00:00Z",
      satellite: "N20",
      instrument: "VIIRS",
      confidence: "nominal",
      processing: "near_real_time",
      version: "2.0NRT",
      frpMw: 5,
      dayNight: "day",
    },
  }],
};

const floodExtentData: NonNullable<
  React.ComponentProps<typeof MaplibreMapCanvas>["floodExtentData"]
> = {
  sourceId: "nasa_lance_flood_extent",
  sourceUrl: "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi",
  product: "VIIRS_Combined_Flood_3-Day",
  dataMode: "live",
  evidenceState: "observations_returned",
  retrievedAt: "2024-07-08T12:00:00Z",
  observedDate: "2024-07-08",
  requestArea: { west: -95.9, south: 29.5, east: -95, north: 30.1 },
  imageDataUrl: "data:image/png;base64,AA==",
  imageWidth: 512,
  imageHeight: 512,
  payloadHash: "a".repeat(64),
  claimBoundary: "Visualization only.",
  limitations: ["Not water depth.", "Not a safety determination."],
};

beforeEach(() => {
  mocks.instances.length = 0;
  mocks.controls.failConstruction = false;
  mocks.currentSelection = null;
  mocks.setPlaceSelection.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("MapLibre place framing", () => {
  it("fits a geocoder-supplied bounding box instead of flying to its centroid", async () => {
    const map = await renderCanvas(buildGeocodedPlaceSelection(
      "Houston, Texas",
      { lon: -95.3698, lat: 29.7604 },
      25,
      "custom",
      "2024-07-08T00:00:00Z",
      "2024-07-08T23:59:59Z",
      { west: -95.91, south: 29.52, east: -95.01, north: 30.11 }
    ));

    expect(map.fitBounds).toHaveBeenCalledWith(
      [[-95.91, 29.52], [-95.01, 30.11]],
      { padding: 48, maxZoom: 12, duration: 800 }
    );
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it("keeps coordinate selections on the point-centred flyTo path", async () => {
    const map = await renderCanvas(buildMapCoordinateSelection(
      { lon: -95.3698, lat: 29.7604 },
      25,
      "custom",
      "2024-07-08T00:00:00Z",
      "2024-07-08T23:59:59Z"
    ));

    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.flyTo).toHaveBeenCalledWith({
      center: [-95.3698, 29.7604],
      zoom: 7,
      duration: 800,
    });
  });

  it("does not reframe an unchanged selection when only the layer array changes", async () => {
    const selection = buildGeocodedPlaceSelection(
      "Houston, Texas",
      { lon: -95.3698, lat: 29.7604 },
      25,
      "custom",
      "2024-07-08T00:00:00Z",
      "2024-07-08T23:59:59Z",
      { west: -95.91, south: 29.52, east: -95.01, north: 30.11 }
    );
    const map = await renderCanvas(selection);
    const initialFitCount = map.fitBounds.mock.calls.length;

    const layerOnlyUpdate = INITIAL_LAYERS.map((layer) =>
      layer.id === "wildfire_nrt"
        ? { ...layer, visible: true }
        : { ...layer }
    );
    await act(async () => {
      root.render(canvas(layerOnlyUpdate));
      await Promise.resolve();
    });

    expect(map.fitBounds).toHaveBeenCalledTimes(initialFitCount);
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it("confirms FIRMS and flood visibility only after their active sources load", async () => {
    const selected = buildGeocodedPlaceSelection(
      "Houston, Texas",
      { lon: -95.3698, lat: 29.7604 },
      25,
      "custom",
      "2024-07-08T00:00:00Z",
      "2024-07-08T23:59:59Z"
    );
    const map = await renderCanvas(selected);
    const onDataOverlayStatus = vi.fn();
    await act(async () => {
      root.render(canvas(INITIAL_LAYERS, {
        wildfireData,
        floodExtentData,
        overlayContextRevision: 7,
        onDataOverlayStatus,
      }));
      await Promise.resolve();
    });
    const sourceIds = map.addSource.mock.calls.map(([sourceId]) => String(sourceId));
    const wildfireSourceId = sourceIds.find((id) => id.startsWith("firms-wildfire-nrt-"));
    const floodSourceId = sourceIds.find((id) => id.startsWith("viirs-flood-extent-image-"));
    expect(wildfireSourceId).toBeDefined();
    expect(floodSourceId).toBeDefined();
    expect(onDataOverlayStatus).not.toHaveBeenCalled();

    await act(async () => {
      map.emit("sourcedata", {
        sourceId: wildfireSourceId,
        dataType: "source",
        isSourceLoaded: true,
        sourceDataType: "visibility",
      });
    });
    expect(onDataOverlayStatus).not.toHaveBeenCalled();
    await act(async () => { map.emit("idle", {}); });

    expect(onDataOverlayStatus).toHaveBeenCalledWith(
      "wildfire_nrt",
      "ready",
      "2024-07-08",
      7
    );
    expect(onDataOverlayStatus).toHaveBeenCalledWith(
      "flood_extent",
      "ready",
      "2024-07-08",
      7
    );
    const mapCanvas = container.querySelector("[data-testid='map-canvas']");
    expect(mapCanvas?.getAttribute("data-wildfire-rendered-count")).toBe("1");
    expect(mapCanvas?.getAttribute("data-flood-extent-rendered")).toBe("true");

    onDataOverlayStatus.mockClear();
    await act(async () => {
      root.render(<div />);
      await Promise.resolve();
    });
    expect(onDataOverlayStatus).toHaveBeenCalledWith(
      "wildfire_nrt",
      "detached",
      "2024-07-08",
      7
    );
    expect(onDataOverlayStatus).toHaveBeenCalledWith(
      "flood_extent",
      "detached",
      "2024-07-08",
      7
    );
  });

  it("ignores late source events from a replaced data-overlay generation", async () => {
    const selected = buildMapCoordinateSelection(
      { lon: -95.36, lat: 29.76 },
      25,
      "custom",
      "2024-07-08T00:00:00Z",
      "2024-07-08T23:59:59Z"
    );
    const map = await renderCanvas(selected);
    const onDataOverlayStatus = vi.fn();
    await act(async () => {
      root.render(canvas(INITIAL_LAYERS, {
        wildfireData,
        overlayContextRevision: 1,
        onDataOverlayStatus,
      }));
      await Promise.resolve();
    });
    const firstSourceId = map.addSource.mock.calls
      .map(([sourceId]) => String(sourceId))
      .find((id) => id.startsWith("firms-wildfire-nrt-"));

    await act(async () => {
      root.render(canvas(INITIAL_LAYERS, {
        wildfireData,
        overlayContextRevision: 2,
        onDataOverlayStatus,
      }));
      await Promise.resolve();
    });
    const wildfireSourceIds = map.addSource.mock.calls
      .map(([sourceId]) => String(sourceId))
      .filter((id) => id.startsWith("firms-wildfire-nrt-"));
    const secondSourceId = wildfireSourceIds.at(-1);
    expect(secondSourceId).not.toBe(firstSourceId);
    onDataOverlayStatus.mockClear();

    await act(async () => { map.emit("error", { sourceId: firstSourceId }); });
    expect(onDataOverlayStatus).not.toHaveBeenCalled();

    await act(async () => { map.emit("idle", {}); });
    expect(onDataOverlayStatus).toHaveBeenCalledWith(
      "wildfire_nrt",
      "ready",
      "2024-07-08",
      2
    );
  });

  it("does not mark a newly visible GIBS layer ready on its visibility event", async () => {
    const selected = buildMapCoordinateSelection(
      { lon: -95.36, lat: 29.76 },
      25,
      "custom",
      "2024-07-08T00:00:00Z",
      "2024-07-08T23:59:59Z"
    );
    const map = await renderCanvas(selected);
    const onGibsOverlayStatus = vi.fn();
    const visibleRain = INITIAL_LAYERS.map((layer) =>
      layer.id === "gibs_precipitation"
        ? { ...layer, visible: true }
        : { ...layer }
    );
    await act(async () => {
      root.render(canvas(visibleRain, { onGibsOverlayStatus }));
      await Promise.resolve();
    });
    const sourceId = map.addSource.mock.calls
      .map(([id]) => String(id))
      .find((id) => id.startsWith("gibs-precipitation-"));
    expect(sourceId).toBeDefined();

    await act(async () => {
      map.emit("sourcedata", {
        sourceId,
        dataType: "source",
        sourceDataType: "visibility",
        isSourceLoaded: true,
      });
    });
    expect(onGibsOverlayStatus).not.toHaveBeenCalled();

    await act(async () => { map.emit("idle", {}); });
    expect(onGibsOverlayStatus).toHaveBeenCalledWith(
      "gibs_precipitation",
      "ready",
      "2024-07-08",
      0
    );
  });

  it("terminates the renderer and reports unavailable when the basemap fails", async () => {
    const onRendererStatus = vi.fn();
    const map = await renderCanvas(
      buildMapCoordinateSelection(
        { lon: -95.36, lat: 29.76 },
        25,
        "custom",
        "2024-07-08T00:00:00Z",
        "2024-07-08T23:59:59Z"
      ),
      INITIAL_LAYERS,
      { onRendererStatus, overlayContextRevision: 9 }
    );

    await act(async () => { map.emit("error", { sourceId: "osm" }); });

    expect(onRendererStatus).toHaveBeenCalledWith(
      "unavailable",
      "2024-07-08",
      9
    );
    expect(map.remove).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-testid='map-tile-error']")).not.toBeNull();
  });

  it("reports renderer construction failure instead of leaving layers loading", async () => {
    mocks.controls.failConstruction = true;
    mocks.currentSelection = buildMapCoordinateSelection(
      { lon: -95.36, lat: 29.76 },
      25,
      "custom",
      "2024-07-08T00:00:00Z",
      "2024-07-08T23:59:59Z"
    );
    const onRendererStatus = vi.fn();

    await act(async () => {
      root.render(canvas(INITIAL_LAYERS, {
        onRendererStatus,
        overlayContextRevision: 11,
      }));
      await Promise.resolve();
    });

    expect(onRendererStatus).toHaveBeenCalledWith(
      "unavailable",
      "2024-07-08",
      11
    );
    expect(container.querySelector("[data-testid='map-webgl-error']")).not.toBeNull();
  });
});
