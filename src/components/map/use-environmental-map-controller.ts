"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WildfireLayerErrorCode,
  WildfireLayerResult,
} from "@/contracts/wildfire-layer";
import type {
  FloodExtentLayerErrorCode,
  FloodExtentLayerResult,
} from "@/contracts/flood-extent-layer";
import { loadWildfireLayer } from "@/lib/fire/firms-nrt-layer-client";
import { loadFloodExtentLayer } from "@/lib/flood/extent-layer-client";
import { loadGibsAvailability } from "@/lib/map/gibs-availability-client";
import {
  applyEnvironmentalMapDesiredState,
  createInitialEnvironmentalMapState,
  ENVIRONMENTAL_MAP_LAYER_IDS,
  isFirmsNrtMapDateSupported,
  type EnvironmentalMapLayerId,
  type EnvironmentalMapLayerPatch,
  type EnvironmentalMapLayerStatus,
  type EnvironmentalMapState,
} from "@/lib/map/environmental-map-state";
import type { PlaceSelection } from "@/lib/location/selection";

export type WildfireLayerUiState =
  | { status: "idle"; result: null; error: null }
  | { status: "loading"; result: null; error: null }
  | { status: "ready"; result: WildfireLayerResult; error: null }
  | { status: "error"; result: null; error: WildfireLayerErrorCode };

export type FloodExtentLayerUiState =
  | { status: "idle"; result: null; error: null }
  | { status: "loading"; result: null; error: null }
  | { status: "ready"; result: FloodExtentLayerResult; error: null }
  | { status: "error"; result: null; error: FloodExtentLayerErrorCode };

const EMPTY_WILDFIRE_STATE: WildfireLayerUiState = {
  status: "idle",
  result: null,
  error: null,
};
const EMPTY_FLOOD_EXTENT_STATE: FloodExtentLayerUiState = {
  status: "idle",
  result: null,
  error: null,
};

const STATUS_PRIORITY: Record<EnvironmentalMapLayerStatus, number> = {
  hidden: 0,
  loading: 1,
  ready: 2,
  no_imagery: 3,
  unsupported_date: 4,
  source_failure: 5,
};

export interface EnvironmentalMapController {
  mapState: EnvironmentalMapState;
  wildfireState: WildfireLayerUiState;
  floodExtentState: FloodExtentLayerUiState;
  /** Authoritative synchronous state for browser-tool transactions. */
  readState: () => EnvironmentalMapState;
  applyDesiredState: (
    patch: EnvironmentalMapLayerPatch,
    options: {
      date: string | null;
      contextChanged: boolean;
      origin: "human" | "agent";
      now?: Date;
    }
  ) => EnvironmentalMapState;
  reportMapOverlayStatus: (
    layerId: EnvironmentalMapLayerId,
    status: "ready" | "source_failure" | "detached",
    date: string,
    contextRevision: number
  ) => void;
  reportMapRendererStatus: (
    status: "attached" | "unavailable",
    date: string,
    contextRevision: number
  ) => void;
}

export function useEnvironmentalMapController(
  placeSelection: PlaceSelection | null
): EnvironmentalMapController {
  const [mapState, setMapState] = useState(createInitialEnvironmentalMapState);
  const mapStateRef = useRef(mapState);
  const [wildfireState, setWildfireState] = useState<WildfireLayerUiState>(
    EMPTY_WILDFIRE_STATE
  );
  const [floodExtentState, setFloodExtentState] =
    useState<FloodExtentLayerUiState>(EMPTY_FLOOD_EXTENT_STATE);
  // React props deliberately lag synchronous WebMCP transactions until the
  // next render. This generation invalidates any request started for the old
  // place/date before that render and its effect cleanup can occur.
  const requestGenerationRef = useRef(0);
  const rendererFailureRef = useRef<null | {
    date: string;
    contextRevision: number;
    affectedLayers: Set<EnvironmentalMapLayerId>;
  }>(null);
  // `source_failure` can originate either in a provider request or in the
  // MapLibre renderer. Only renderer-owned failures are safe to retry merely
  // because a fresh canvas attaches.
  const overlayRendererFailureRef = useRef(new Map<
    EnvironmentalMapLayerId,
    { date: string; contextRevision: number }
  >());

  const commitMapState = useCallback(
    (next: EnvironmentalMapState): EnvironmentalMapState => {
      mapStateRef.current = next;
      setMapState(next);
      return next;
    },
    []
  );

  const applyDesiredState = useCallback((
    patch: EnvironmentalMapLayerPatch,
    options: {
      date: string | null;
      contextChanged: boolean;
      origin: "human" | "agent";
      now?: Date;
    }
  ): EnvironmentalMapState => {
    const current = mapStateRef.current;
    if (options.contextChanged || current.date !== options.date) {
      requestGenerationRef.current += 1;
      overlayRendererFailureRef.current.clear();
      // Queue the clear in the same React batch as the new selection/map
      // state. This prevents old same-date area data from rendering once
      // under the new place while passive effects are still being replaced.
      setWildfireState(EMPTY_WILDFIRE_STATE);
      setFloodExtentState(EMPTY_FLOOD_EXTENT_STATE);
    }
    let next = applyEnvironmentalMapDesiredState(current, patch, options);
    const rendererFailure = rendererFailureRef.current;
    if (
      rendererFailure &&
      rendererFailure.date === next.date &&
      rendererFailure.contextRevision === next.contextRevision
    ) {
      const layers = { ...next.layers };
      let rendererStatusChanged = false;
      for (const layerId of ENVIRONMENTAL_MAP_LAYER_IDS) {
        const layer = layers[layerId];
        if (
          layer.visible &&
          (layer.status === "loading" || layer.status === "ready")
        ) {
          rendererFailure.affectedLayers.add(layerId);
          layers[layerId] = { ...layer, status: "source_failure" };
          rendererStatusChanged = true;
        }
      }
      if (rendererStatusChanged) next = { ...next, layers };
    }
    return commitMapState(next);
  }, [commitMapState]);

  const readState = useCallback(() => mapStateRef.current, []);

  const setRuntimeStatus = useCallback((
    layerId: EnvironmentalMapLayerId,
    status: EnvironmentalMapLayerStatus,
    options: {
      date: string;
      contextRevision?: number;
      onlyUpgrade?: boolean;
      onlyFrom?: readonly EnvironmentalMapLayerStatus[];
    }
  ) => {
    const current = mapStateRef.current;
    if (current.date !== options.date || !current.layers[layerId].visible) return;
    if (
      options.contextRevision !== undefined &&
      current.contextRevision !== options.contextRevision
    ) return;
    const previous = current.layers[layerId].status;
    const rendererFailure = rendererFailureRef.current;
    if (
      (status === "loading" || status === "ready") &&
      rendererFailure?.date === current.date &&
      rendererFailure.contextRevision === current.contextRevision
    ) return;
    if (options.onlyFrom && !options.onlyFrom.includes(previous)) return;
    if (options.onlyUpgrade && STATUS_PRIORITY[status] < STATUS_PRIORITY[previous]) return;
    if (previous === status) return;
    commitMapState({
      ...current,
      layers: {
        ...current.layers,
        [layerId]: { ...current.layers[layerId], status },
      },
    });
  }, [commitMapState]);

  const reportMapOverlayStatus = useCallback((
    layerId: EnvironmentalMapLayerId,
    status: "ready" | "source_failure" | "detached",
    date: string,
    contextRevision: number
  ) => {
    const current = mapStateRef.current;
    const ownsCurrentContext =
      current.date === date && current.contextRevision === contextRevision;
    if (status === "source_failure" && ownsCurrentContext) {
      overlayRendererFailureRef.current.set(layerId, { date, contextRevision });
    } else if (status === "ready") {
      const rendererFailure = overlayRendererFailureRef.current.get(layerId);
      if (
        rendererFailure?.date === date &&
        rendererFailure.contextRevision === contextRevision
      ) overlayRendererFailureRef.current.delete(layerId);
    }
    if (status === "detached") {
      setRuntimeStatus(layerId, "loading", {
        date,
        contextRevision,
        // A remount is a fresh renderer attempt. Recover both a previously
        // ready layer and a renderer-specific failure, while preserving
        // source-derived no-imagery and unsupported-date outcomes.
        onlyFrom: ["ready", "source_failure"],
      });
      return;
    }
    setRuntimeStatus(layerId, status, {
      date,
      contextRevision,
      onlyUpgrade: true,
    });
  }, [setRuntimeStatus]);

  const reportMapRendererStatus = useCallback((
    status: "attached" | "unavailable",
    date: string,
    contextRevision: number
  ) => {
    const current = mapStateRef.current;
    if (current.date !== date || current.contextRevision !== contextRevision) return;

    if (status === "attached") {
      const failure = rendererFailureRef.current;
      rendererFailureRef.current = null;
      if (
        !failure ||
        failure.date !== date ||
        failure.contextRevision !== contextRevision
      ) return;
      const layers = { ...current.layers };
      let changed = false;
      for (const layerId of failure.affectedLayers) {
        const layer = layers[layerId];
        if (layer.visible && layer.status === "source_failure") {
          layers[layerId] = { ...layer, status: "loading" };
          changed = true;
        }
      }
      if (changed) commitMapState({ ...current, layers });
      return;
    }

    const priorFailure = rendererFailureRef.current;
    const affectedLayers =
      priorFailure?.date === date &&
      priorFailure.contextRevision === contextRevision
        ? new Set(priorFailure.affectedLayers)
        : new Set<EnvironmentalMapLayerId>();
    const layers = { ...current.layers };
    let changed = false;
    for (const layerId of ENVIRONMENTAL_MAP_LAYER_IDS) {
      const layer = layers[layerId];
      const overlayFailure = overlayRendererFailureRef.current.get(layerId);
      const retryableRendererFailure =
        layer.status === "source_failure" &&
        overlayFailure?.date === date &&
        overlayFailure.contextRevision === contextRevision;
      if (layer.visible && retryableRendererFailure) {
        affectedLayers.add(layerId);
      }
      if (
        layer.visible &&
        (layer.status === "loading" || layer.status === "ready")
      ) {
        affectedLayers.add(layerId);
        layers[layerId] = { ...layer, status: "source_failure" };
        changed = true;
      }
    }
    rendererFailureRef.current = { date, contextRevision, affectedLayers };
    if (changed) commitMapState({ ...current, layers });
  }, [commitMapState]);

  const area = placeSelection?.analysisArea.boundingBox ?? null;
  const areaKey = area
    ? `${area.west},${area.south},${area.east},${area.north}`
    : "";
  const date = mapState.date;
  const wildfireVisible = mapState.layers.thermal_anomalies_firms.visible;
  const floodVisible = mapState.layers.flood_extent.visible;
  const rainVisible = mapState.layers.rain_satellite.visible;
  const heatVisible = mapState.layers.surface_heat_satellite.visible;

  useEffect(() => {
    if (!wildfireVisible) {
      setWildfireState(EMPTY_WILDFIRE_STATE);
      return;
    }
    if (!date || !area) {
      setWildfireState(EMPTY_WILDFIRE_STATE);
      return;
    }
    if (!isFirmsNrtMapDateSupported(date)) {
      setWildfireState({ status: "error", result: null, error: "unsupported_date" });
      setRuntimeStatus("thermal_anomalies_firms", "unsupported_date", { date });
      return;
    }

    let cancelled = false;
    const requestGeneration = requestGenerationRef.current;
    setWildfireState({ status: "loading", result: null, error: null });
    setRuntimeStatus("thermal_anomalies_firms", "loading", { date });
    void loadWildfireLayer(date, area).then((envelope) => {
      if (cancelled || requestGeneration !== requestGenerationRef.current) return;
      if (!envelope.ok) {
        setWildfireState({ status: "error", result: null, error: envelope.error });
        setRuntimeStatus(
          "thermal_anomalies_firms",
          envelope.error === "unsupported_date"
            ? "unsupported_date"
            : "source_failure",
          { date }
        );
        return;
      }
      setWildfireState({ status: "ready", result: envelope.result, error: null });
      setRuntimeStatus(
        "thermal_anomalies_firms",
        envelope.result.evidenceState === "observations_returned"
          ? "loading"
          : "no_imagery",
        { date }
      );
    });
    return () => { cancelled = true; };
    // areaKey is the stable dependency; area object identity may change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wildfireVisible, date, areaKey, setRuntimeStatus]);

  useEffect(() => {
    if (!floodVisible) {
      setFloodExtentState(EMPTY_FLOOD_EXTENT_STATE);
      return;
    }
    if (!date || !area) {
      setFloodExtentState(EMPTY_FLOOD_EXTENT_STATE);
      return;
    }

    let cancelled = false;
    const requestGeneration = requestGenerationRef.current;
    setFloodExtentState({ status: "loading", result: null, error: null });
    setRuntimeStatus("flood_extent", "loading", { date });
    void loadFloodExtentLayer(date, area).then((envelope) => {
      if (cancelled || requestGeneration !== requestGenerationRef.current) return;
      if (!envelope.ok) {
        setFloodExtentState({ status: "error", result: null, error: envelope.error });
        setRuntimeStatus("flood_extent", "source_failure", { date });
        return;
      }
      setFloodExtentState({ status: "ready", result: envelope.result, error: null });
      setRuntimeStatus(
        "flood_extent",
        envelope.result.evidenceState === "observations_returned"
          ? "loading"
          : "no_imagery",
        { date }
      );
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floodVisible, date, areaKey, setRuntimeStatus]);

  useEffect(() => {
    let cancelled = false;
    const requestGeneration = requestGenerationRef.current;
    const probes = [
      {
        layerId: "rain_satellite" as const,
        product: "rain" as const,
        visible: rainVisible,
      },
      {
        layerId: "surface_heat_satellite" as const,
        product: "surface_temp" as const,
        visible: heatVisible,
      },
    ];
    for (const probe of probes) {
      if (!probe.visible || !date || !area) continue;
      setRuntimeStatus(probe.layerId, "loading", { date });
      void loadGibsAvailability(probe.product, date, area).then((envelope) => {
        if (cancelled || requestGeneration !== requestGenerationRef.current) return;
        // This bounded pixel probe is supplementary. Its failure means
        // availability is unknown; MapLibre tile events remain authoritative
        // for whether the visible raster source itself failed.
        if (!envelope.ok) return;
        if (!envelope.visiblePixelsDetected) {
          setRuntimeStatus(probe.layerId, "no_imagery", {
            date,
            onlyUpgrade: true,
          });
        }
      });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rainVisible, heatVisible, date, areaKey, setRuntimeStatus]);

  return {
    mapState,
    wildfireState,
    floodExtentState,
    readState,
    applyDesiredState,
    reportMapOverlayStatus,
    reportMapRendererStatus,
  };
}
