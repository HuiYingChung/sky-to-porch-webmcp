import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  HAZARD_DEFAULT_LAYERS,
  INITIAL_LAYERS,
  LayerManager,
  applyHazardDefaults,
  toggleLayer,
} from "@/components/map/layer-manager";
import type { WildfireLayerResult } from "@/contracts/wildfire-layer";
import type { FloodExtentLayerResult } from "@/contracts/flood-extent-layer";

const RESULT: WildfireLayerResult = {
  sourceId: "nasa_firms",
  sourceUrl: "https://firms.modaps.eosdis.nasa.gov/api/area/",
  product: "VIIRS_NOAA20_NRT",
  dataMode: "live",
  evidenceState: "observations_returned",
  retrievedAt: "2026-08-13T16:00:00.000Z",
  latestAcquiredAt: "2026-08-13T14:30:00Z",
  requestArea: { west: -119, south: 33, east: -117, north: 35 },
  featureCollection: {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "Point", coordinates: [-118.2, 34.1] },
      properties: {
        detectionId: "test-detection",
        acquiredAt: "2026-08-13T14:30:00Z",
        satellite: "N20",
        instrument: "VIIRS",
        confidence: "nominal",
        processing: "near_real_time",
        version: "2.0NRT",
        frpMw: 4.5,
        dayNight: "day",
      },
    }],
  },
  payloadHash: "a".repeat(64),
  limitations: ["Pixels are not perimeters.", "No detection is not no danger."],
};

const FLOOD_RESULT: FloodExtentLayerResult = {
  sourceId: "nasa_lance_flood_extent",
  sourceUrl: "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi",
  product: "VIIRS_Combined_Flood_3-Day",
  dataMode: "live",
  evidenceState: "observations_returned",
  retrievedAt: "2026-08-13T16:00:00.000Z",
  observedDate: "2024-07-08",
  requestArea: { west: -95.8, south: 29.4, east: -95, north: 30.1 },
  imageDataUrl: "data:image/png;base64,YQ==",
  imageWidth: 512,
  imageHeight: 512,
  payloadHash: "b".repeat(64),
  claimBoundary: "Visualization only.",
  limitations: ["Not depth.", "No observation is not no danger."],
};

function render(overrides: Partial<React.ComponentProps<typeof LayerManager>> = {}): string {
  return renderToStaticMarkup(
    <LayerManager
      layers={INITIAL_LAYERS}
      onToggle={vi.fn()}
      overlayDate="2026-08-12"
      {...overrides}
    />
  );
}

describe("Wildfire layer controls", () => {
  it("always shows the FIRMS and enabled flood controls", () => {
    expect(render()).toContain("layer-toggle-wildfire_nrt");
    expect(render()).toContain("layer-toggle-flood_extent");
    expect(render()).not.toContain("no validated flood-extent source");
  });

  it("shows viewport loading and positive thermal-anomaly semantics when enabled", () => {
    const layers = INITIAL_LAYERS.map((layer) =>
      layer.id === "wildfire_nrt" ? { ...layer, visible: true } : layer
    );
    expect(render({ layers, wildfireLayerStatus: "loading" }))
      .toContain("Loading and validating recent viewport detections");
    const positive = render({
      layers,
      wildfireLayerStatus: "ready",
      wildfireLayerResult: RESULT,
    });
    expect(positive).toContain("1 validated thermal-anomaly pixel");
    expect(positive).toContain("not severity, perimeter, official incident");
  });

  it("states that no observations and failures are not proof of safety", () => {
    const layers = INITIAL_LAYERS.map((layer) =>
      layer.id === "wildfire_nrt" ? { ...layer, visible: true } : layer
    );
    const noObservation = render({
      layers,
      wildfireLayerStatus: "ready",
      wildfireLayerResult: {
        ...RESULT,
        evidenceState: "no_observation",
        latestAcquiredAt: null,
        featureCollection: { type: "FeatureCollection", features: [] },
      },
    });
    expect(noObservation).toContain("does not mean no wildfire");
    expect(render({
      layers,
      wildfireLayerStatus: "error",
      wildfireLayerError: "unconfigured",
    })).toContain("without its NASA FIRMS access key");
  });

  it("keeps flood imagery, no-observation, and source failure separate", () => {
    const layers = INITIAL_LAYERS.map((layer) =>
      layer.id === "flood_extent" ? { ...layer, visible: true } : layer
    );
    const positive = render({
      layers,
      floodExtentLayerStatus: "ready",
      floodExtentLayerResult: FLOOD_RESULT,
    });
    // ADR-0040: the 3-day composite window is stated so detections from up
    // to two days before the selected end date are never misattributed.
    expect(positive).toContain("3-day composite covering 2024-07-06 to 2024-07-08 UTC");
    expect(positive).toContain("Detections may come from any day in that window");
    expect(positive).toContain("does not interpret its colors as depth or property impact");

    const noObservation = render({
      layers,
      floodExtentLayerStatus: "ready",
      floodExtentLayerResult: {
        ...FLOOD_RESULT,
        evidenceState: "no_observation",
        observedDate: null,
        imageDataUrl: null,
      },
    });
    expect(noObservation).toContain("does not mean no flood or no danger");
    expect(render({
      layers,
      floodExtentLayerStatus: "error",
      floodExtentLayerError: "timeout",
    })).toContain("took too long");
  });
});

describe("ADR-0046 always-on base layers", () => {
  it("renders no toggle for basemap, selected place, or analysis area", () => {
    const markup = render();
    expect(markup).not.toContain("layer-toggle-basemap");
    expect(markup).not.toContain("layer-toggle-selected_place");
    expect(markup).not.toContain("layer-toggle-analysis_area");
    expect(markup).toContain("layer-toggle-gibs_precipitation");
    expect(markup).toContain("layer-toggle-gibs_surface_temp");
    expect(markup).toContain("layer-toggle-wildfire_nrt");
    expect(markup).toContain("layer-toggle-flood_extent");
  });

  it("keeps the base layers visible in the initial state so the map always renders them", () => {
    for (const id of ["basemap", "selected_place", "analysis_area"] as const) {
      expect(INITIAL_LAYERS.find((layer) => layer.id === id)?.visible).toBe(true);
    }
  });
});

describe("ADR-0040 GIBS overlay status (Bug E)", () => {
  const rainVisible = INITIAL_LAYERS.map((layer) =>
    layer.id === "gibs_precipitation" ? { ...layer, visible: true } : layer
  );

  it("shows loading, error, and no-imagery states without a silent gap", () => {
    expect(render({ layers: rainVisible, gibsPrecipitationStatus: "loading" }))
      .toContain("Loading satellite imagery");
    const errored = render({ layers: rainVisible, gibsPrecipitationStatus: "error" });
    expect(errored).toContain("could not be loaded");
    expect(errored).toContain("not evidence of no hazard");
    const missing = render({ layers: rainVisible, gibsPrecipitationStatus: "no_imagery" });
    expect(missing).toContain("has not published imagery");
    expect(missing).toContain("2026-08-12 UTC");
    expect(missing).toContain("not evidence of no hazard");
  });

  it("renders no status element when ready or hidden", () => {
    expect(render({ layers: rainVisible, gibsPrecipitationStatus: "ready" }))
      .not.toContain("gibs_precipitation-layer-status");
    expect(render({ layers: INITIAL_LAYERS, gibsPrecipitationStatus: "error" }))
      .not.toContain("gibs_precipitation-layer-status");
  });
});

describe("ADR-0040 hazard-driven layer defaults (Bug G)", () => {
  it("enables the matching layers for each hazard without touching others", () => {
    const heat = applyHazardDefaults(INITIAL_LAYERS, "extreme_heat");
    expect(heat.find((layer) => layer.id === "gibs_surface_temp")?.visible).toBe(true);
    expect(heat.find((layer) => layer.id === "gibs_precipitation")?.visible).toBe(false);

    const flood = applyHazardDefaults(INITIAL_LAYERS, "flood_storm");
    expect(flood.find((layer) => layer.id === "gibs_precipitation")?.visible).toBe(true);
    expect(flood.find((layer) => layer.id === "flood_extent")?.visible).toBe(true);

    const fire = applyHazardDefaults(INITIAL_LAYERS, "fire_smoke");
    expect(fire.find((layer) => layer.id === "wildfire_nrt")?.visible).toBe(true);
  });

  it("never disables a layer and leaves null or unmapped hazards untouched", () => {
    const manuallyOn = toggleLayer(INITIAL_LAYERS, "gibs_precipitation");
    const afterHeat = applyHazardDefaults(manuallyOn, "extreme_heat");
    expect(afterHeat.find((layer) => layer.id === "gibs_precipitation")?.visible).toBe(true);
    expect(applyHazardDefaults(INITIAL_LAYERS, null)).toBe(INITIAL_LAYERS);
    expect(HAZARD_DEFAULT_LAYERS.drought_land).toEqual([]);
    expect(applyHazardDefaults(INITIAL_LAYERS, "drought_land")).toBe(INITIAL_LAYERS);
  });

  it("never enables an unavailable layer", () => {
    const unavailable = INITIAL_LAYERS.map((layer) =>
      layer.id === "wildfire_nrt" ? { ...layer, available: false } : layer
    );
    const applied = applyHazardDefaults(unavailable, "fire_smoke");
    expect(applied.find((layer) => layer.id === "wildfire_nrt")?.visible).toBe(false);
  });
});
