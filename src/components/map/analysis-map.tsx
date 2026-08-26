"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { HazardId } from "@/contracts/common";
import type { WildfireLayerErrorCode, WildfireLayerResult } from "@/contracts/wildfire-layer";
import type {
  FloodExtentLayerErrorCode,
  FloodExtentLayerResult,
} from "@/contracts/flood-extent-layer";
import { useQueryDraft } from "@/components/query/query-provider";
import { SelectionSummary } from "@/components/selection/selection-summary";
import { latestCompletedUtcDate, tsToDateInput } from "@/lib/ui/date-input";
import { loadWildfireLayer } from "@/lib/fire/firms-nrt-layer-client";
import { loadFloodExtentLayer } from "@/lib/flood/extent-layer-client";
import { loadGibsAvailability } from "@/lib/map/gibs-availability-client";
import {
  LayerManager,
  INITIAL_LAYERS,
  applyHazardDefaults,
  toggleLayer,
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

type WildfireLayerUiState =
  | { status: "idle"; result: null; error: null }
  | { status: "loading"; result: null; error: null }
  | { status: "ready"; result: WildfireLayerResult; error: null }
  | { status: "error"; result: null; error: WildfireLayerErrorCode };

const EMPTY_WILDFIRE_STATE: WildfireLayerUiState = { status: "idle", result: null, error: null };

type FloodExtentLayerUiState =
  | { status: "idle"; result: null; error: null }
  | { status: "loading"; result: null; error: null }
  | { status: "ready"; result: FloodExtentLayerResult; error: null }
  | { status: "error"; result: null; error: FloodExtentLayerErrorCode };

const EMPTY_FLOOD_EXTENT_STATE: FloodExtentLayerUiState = { status: "idle", result: null, error: null };

type GibsOverlayId = "gibs_precipitation" | "gibs_surface_temp";
const GIBS_PRODUCT_BY_LAYER: Record<GibsOverlayId, "rain" | "surface_temp"> = {
  gibs_precipitation: "rain",
  gibs_surface_temp: "surface_temp",
};
/** ADR-0040 (Bug E): later signals never downgrade a stronger one. */
const GIBS_STATUS_PRIORITY: Record<GibsOverlayStatus, number> = {
  idle: 0,
  loading: 1,
  ready: 2,
  no_imagery: 3,
  error: 4,
};

export function AnalysisMap({ idPrefix }: { idPrefix: string }) {
  const [layers, setLayers] = useState<LayerState[]>(INITIAL_LAYERS);
  const [showNonMap, setShowNonMap] = useState(false);
  const [wildfireState, setWildfireState] = useState<WildfireLayerUiState>(EMPTY_WILDFIRE_STATE);
  const [floodExtentState, setFloodExtentState] = useState<FloodExtentLayerUiState>(EMPTY_FLOOD_EXTENT_STATE);
  const [gibsStatus, setGibsStatus] = useState<Record<GibsOverlayId, GibsOverlayStatus>>({
    gibs_precipitation: "idle",
    gibs_surface_temp: "idle",
  });
  const { placeSelection, draft } = useQueryDraft();
  const wildfireVisible = layers.find((layer) => layer.id === "wildfire_nrt")?.visible ?? false;
  const floodExtentVisible = layers.find((layer) => layer.id === "flood_extent")?.visible ?? false;
  const rainVisible = layers.find((layer) => layer.id === "gibs_precipitation")?.visible ?? false;
  const heatVisible = layers.find((layer) => layer.id === "gibs_surface_temp")?.visible ?? false;
  const canonicalArea = placeSelection?.analysisArea.boundingBox ?? null;
  // ADR-0040 (Bug H): every overlay describes the END of the selected time
  // range — "the day you asked about" — so the layers can no longer disagree
  // with each other about which date they show.
  const overlayDate =
    (placeSelection?.timeSelection.type === "custom"
      ? tsToDateInput(placeSelection.timeSelection.endTs)
      : "") || latestCompletedUtcDate();

  useEffect(() => {
    if (!wildfireVisible || !canonicalArea) {
      setWildfireState(EMPTY_WILDFIRE_STATE);
      return;
    }
    let cancelled = false;
    setWildfireState({ status: "loading", result: null, error: null });
    void loadWildfireLayer(overlayDate, canonicalArea).then((envelope) => {
      if (cancelled) return;
      setWildfireState(envelope.ok
        ? { status: "ready", result: envelope.result, error: null }
        : { status: "error", result: null, error: envelope.error });
    });
    return () => { cancelled = true; };
  }, [wildfireVisible, canonicalArea, overlayDate]);

  useEffect(() => {
    if (!floodExtentVisible || !canonicalArea) {
      setFloodExtentState(EMPTY_FLOOD_EXTENT_STATE);
      return;
    }
    let cancelled = false;
    setFloodExtentState({ status: "loading", result: null, error: null });
    void loadFloodExtentLayer(overlayDate, canonicalArea).then((envelope) => {
      if (cancelled) return;
      setFloodExtentState(envelope.ok
        ? { status: "ready", result: envelope.result, error: null }
        : { status: "error", result: null, error: envelope.error });
    });
    return () => { cancelled = true; };
  }, [floodExtentVisible, canonicalArea, overlayDate]);

  // ADR-0040 (Bug E): reset a GIBS overlay to "loading" whenever it becomes
  // visible or the date changes, and probe published availability so a
  // silently transparent layer becomes an explicit "no imagery" statement.
  useEffect(() => {
    let cancelled = false;
    for (const layerId of ["gibs_precipitation", "gibs_surface_temp"] as const) {
      const visible = layerId === "gibs_precipitation" ? rainVisible : heatVisible;
      if (!visible) {
        setGibsStatus((current) => ({ ...current, [layerId]: "idle" }));
        continue;
      }
      setGibsStatus((current) => ({ ...current, [layerId]: "loading" }));
      if (!canonicalArea) continue;
      void loadGibsAvailability(GIBS_PRODUCT_BY_LAYER[layerId], overlayDate, canonicalArea)
        .then((envelope) => {
          if (cancelled || !envelope.ok || envelope.available) return;
          setGibsStatus((current) =>
            GIBS_STATUS_PRIORITY.no_imagery >= GIBS_STATUS_PRIORITY[current[layerId]]
              ? { ...current, [layerId]: "no_imagery" }
              : current
          );
        });
    }
    return () => { cancelled = true; };
  }, [rainVisible, heatVisible, canonicalArea, overlayDate]);

  function handleGibsOverlayStatus(layerId: GibsOverlayId, status: "ready" | "error") {
    setGibsStatus((current) =>
      GIBS_STATUS_PRIORITY[status] >= GIBS_STATUS_PRIORITY[current[layerId]]
        ? { ...current, [layerId]: status }
        : current
    );
  }

  // ADR-0040 (Bug G): a hazard choice enables its matching layers once;
  // manual toggles stay authoritative afterwards.
  const hazardId: HazardId | null = draft.hazardId;
  const lastAppliedHazardRef = useRef<HazardId | null>(null);
  useEffect(() => {
    if (hazardId === lastAppliedHazardRef.current) return;
    lastAppliedHazardRef.current = hazardId;
    setLayers((current) => applyHazardDefaults(current, hazardId));
  }, [hazardId]);

  function handleLayerToggle(id: LayerId) {
    setLayers((current) => toggleLayer(current, id));
  }

  return (
    <div data-testid="analysis-map" style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      {!showNonMap && (
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          <MaplibreMapCanvas
            layers={layers}
            osmTileUrl={OSM_TILE_URL}
            osmAttribution={OSM_ATTRIBUTION}
            overlayDate={overlayDate}
            circlePolygon={circlePolygon}
            wildfireData={wildfireVisible && wildfireState.status === "ready"
              ? wildfireState.result.featureCollection
              : null}
            floodExtentData={floodExtentVisible && floodExtentState.status === "ready"
              ? floodExtentState.result
              : null}
            onUseWithoutMap={() => setShowNonMap(true)}
            onGibsOverlayStatus={handleGibsOverlayStatus}
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
                gibsPrecipitationStatus={gibsStatus.gibs_precipitation}
                gibsSurfaceTempStatus={gibsStatus.gibs_surface_temp}
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
            onClick={() => setShowNonMap(true)}
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
              onClick={() => setShowNonMap(false)}
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
