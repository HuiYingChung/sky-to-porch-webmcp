"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useQueryDraft } from "@/components/query/query-provider";
import { SelectionSummary } from "@/components/selection/selection-summary";
import { latestCompletedUtcDate } from "@/lib/ui/date-input";
import {
  ENVIRONMENTAL_LAYER_BY_MAP_LAYER_ID,
  type EnvironmentalMapLayerId,
} from "@/lib/map/environmental-map-state";
import {
  LayerManager,
  INITIAL_LAYERS,
  type GibsOverlayStatus,
  type LayerId,
  type LayerState,
} from "./layer-manager";
import { NonMapSelection } from "./non-map-selection";
import { DraggableMapCard } from "./draggable-map-card";

export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

export function circlePolygon(
  lon: number,
  lat: number,
  radiusKm: number
): GeoJSON.Feature<GeoJSON.Polygon> {
  const kmPerDegreeLatitude = 111.32;
  const cosLatitude = Math.cos((lat * Math.PI) / 180);
  const latitudeDelta = radiusKm / kmPerDegreeLatitude;
  const longitudeDelta = cosLatitude > 1e-10
    ? radiusKm / (kmPerDegreeLatitude * cosLatitude)
    : 0.001;
  const points: [number, number][] = [];
  for (let index = 0; index <= 64; index += 1) {
    const angle = (index / 64) * 2 * Math.PI;
    points.push([
      Math.max(-180, Math.min(180, lon + longitudeDelta * Math.cos(angle))),
      Math.max(-90, Math.min(90, lat + latitudeDelta * Math.sin(angle))),
    ]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [points] }, properties: {} };
}

function MapLoadingFallback() {
  return (
    <div role="status" style={{ display: "grid", placeItems: "center", height: "100%", fontSize: "14px" }}>
      Loading map…
    </div>
  );
}

const MaplibreMapCanvas = dynamic(
  () => import("./maplibre-map-canvas").then((module) => module.MaplibreMapCanvas),
  { ssr: false, loading: MapLoadingFallback }
);

function asGibsStatus(
  status: "hidden" | "loading" | "ready" | "no_imagery" | "source_failure" | "unsupported_date"
): GibsOverlayStatus {
  if (status === "hidden") return "idle";
  if (status === "source_failure" || status === "unsupported_date") return "error";
  return status;
}

export function AnalysisMap({ idPrefix }: { idPrefix: string }) {
  const [nonMapAtFocusRevision, setNonMapAtFocusRevision] =
    useState<number | null>(null);
  const {
    placeSelection,
    environmentalMapState,
    wildfireLayerState: wildfireState,
    floodExtentLayerState: floodExtentState,
    setEnvironmentalMapLayerVisible,
    reportMapOverlayStatus,
    reportMapRendererStatus,
  } = useQueryDraft();
  const showNonMap = nonMapAtFocusRevision ===
    environmentalMapState.placeFocusRevision;
  const layers: LayerState[] = INITIAL_LAYERS.map((layer) => {
    const environmentalId = ENVIRONMENTAL_LAYER_BY_MAP_LAYER_ID[
      layer.id as keyof typeof ENVIRONMENTAL_LAYER_BY_MAP_LAYER_ID
    ];
    return environmentalId
      ? { ...layer, visible: environmentalMapState.layers[environmentalId].visible }
      : layer;
  });
  const wildfireVisible = layers.find((layer) => layer.id === "wildfire_nrt")?.visible ?? false;
  const floodExtentVisible = layers.find((layer) => layer.id === "flood_extent")?.visible ?? false;
  const overlayDate = environmentalMapState.date;
  const canvasDate = overlayDate ?? latestCompletedUtcDate();
  const renderableStatuses = new Set(["loading", "ready"]);
  const canvasLayers = layers.map((layer) => {
    const environmentalId = ENVIRONMENTAL_LAYER_BY_MAP_LAYER_ID[
      layer.id as keyof typeof ENVIRONMENTAL_LAYER_BY_MAP_LAYER_ID
    ];
    if (!environmentalId) return layer;
    return {
      ...layer,
      visible: layer.visible && overlayDate !== null &&
        renderableStatuses.has(environmentalMapState.layers[environmentalId].status),
    };
  });

  function handleGibsOverlayStatus(
    layerId: "gibs_precipitation" | "gibs_surface_temp",
    status: "ready" | "error" | "detached",
    renderedDate: string,
    renderedContextRevision: number
  ) {
    const environmentalId: "rain_satellite" | "surface_heat_satellite" =
      layerId === "gibs_precipitation"
        ? "rain_satellite"
        : "surface_heat_satellite";
    reportMapOverlayStatus(
      environmentalId,
      status === "error" ? "source_failure" : status,
      renderedDate,
      renderedContextRevision
    );
  }

  function handleDataOverlayStatus(
    layerId: "wildfire_nrt" | "flood_extent",
    status: "ready" | "error" | "detached",
    renderedDate: string,
    renderedContextRevision: number
  ) {
    reportMapOverlayStatus(
      layerId === "wildfire_nrt"
        ? "thermal_anomalies_firms"
        : "flood_extent",
      status === "error" ? "source_failure" : status,
      renderedDate,
      renderedContextRevision
    );
  }

  function handleLayerToggle(id: LayerId) {
    const environmentalId = ENVIRONMENTAL_LAYER_BY_MAP_LAYER_ID[
      id as keyof typeof ENVIRONMENTAL_LAYER_BY_MAP_LAYER_ID
    ] as EnvironmentalMapLayerId | undefined;
    if (!environmentalId) return;
    setEnvironmentalMapLayerVisible(
      environmentalId,
      !environmentalMapState.layers[environmentalId].visible
    );
  }

  return (
    <div data-testid="analysis-map" style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      {!showNonMap && (
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          <MaplibreMapCanvas
            layers={canvasLayers}
            osmTileUrl={OSM_TILE_URL}
            osmAttribution={OSM_ATTRIBUTION}
            overlayDate={canvasDate}
            overlayContextRevision={environmentalMapState.contextRevision}
            focusRevision={environmentalMapState.placeFocusRevision}
            circlePolygon={circlePolygon}
            wildfireData={wildfireVisible && wildfireState.status === "ready"
              ? wildfireState.result.featureCollection
              : null}
            floodExtentData={floodExtentVisible && floodExtentState.status === "ready"
              ? floodExtentState.result
              : null}
            onUseWithoutMap={() => setNonMapAtFocusRevision(
              environmentalMapState.placeFocusRevision
            )}
            onGibsOverlayStatus={handleGibsOverlayStatus}
            onDataOverlayStatus={handleDataOverlayStatus}
            onRendererStatus={reportMapRendererStatus}
          />

          <div
            data-testid="map-top-overlays"
            style={{
              position: "absolute",
              top: "8px",
              left: "8px",
              right: "8px",
              bottom: "44px",
              zIndex: 10,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "8px",
              pointerEvents: "none",
            }}
          >
            {placeSelection && (
              <DraggableMapCard
                testId="map-selection-overlay"
                title="Selected area"
                initialStyle={{ width: "min(280px, 100%)" }}
              >
                <SelectionSummary selection={placeSelection} compact />
              </DraggableMapCard>
            )}
            <DraggableMapCard
              testId="map-layer-overlay"
              title="Layers & legends"
              initialStyle={{ width: "min(290px, 100%)", marginLeft: "auto" }}
            >
              <LayerManager
                layers={layers}
                onToggle={handleLayerToggle}
                overlayDate={overlayDate}
                gibsPrecipitationStatus={asGibsStatus(environmentalMapState.layers.rain_satellite.status)}
                gibsSurfaceTempStatus={asGibsStatus(environmentalMapState.layers.surface_heat_satellite.status)}
                wildfireLayerStatus={wildfireState.status}
                wildfireLayerResult={wildfireState.result}
                wildfireLayerError={wildfireState.error}
                floodExtentLayerStatus={floodExtentState.status}
                floodExtentLayerResult={floodExtentState.result}
                floodExtentLayerError={floodExtentState.error}
              />
            </DraggableMapCard>
          </div>

          <button
            type="button"
            onClick={() => setNonMapAtFocusRevision(
              environmentalMapState.placeFocusRevision
            )}
            data-testid="show-non-map-btn"
            aria-label="Show the selected area without the map"
            style={{
              position: "absolute",
              bottom: "8px",
              left: "8px",
              zIndex: 10,
              padding: "5px 9px",
              fontSize: "14px",
              border: "1px solid var(--border-default)",
              borderRadius: "4px",
              background: "var(--surface-1)",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            Use without map
          </button>
        </div>
      )}

      {showNonMap && (
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "6px 8px", background: "var(--surface-2)", borderBottom: "1px solid var(--border-default)" }}>
            <button
              type="button"
              onClick={() => setNonMapAtFocusRevision(null)}
              data-testid="show-map-btn"
              aria-label="Switch back to map"
              style={{
                padding: "5px 9px",
                fontSize: "14px",
                border: "1px solid var(--border-default)",
                borderRadius: "4px",
                background: "transparent",
                color: "var(--text-secondary)",
                cursor: "pointer",
              }}
            >
              ← Show map
            </button>
          </div>
          <NonMapSelection idPrefix={`${idPrefix}nm-`} />
        </div>
      )}
    </div>
  );
}
