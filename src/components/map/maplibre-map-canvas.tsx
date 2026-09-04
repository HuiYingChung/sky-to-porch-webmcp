"use client";
/**
 * src/components/map/maplibre-map-canvas.tsx
 *
 * The MapLibre GL JS map canvas — dynamically imported (ssr: false).
 * This file must only run in the browser (requires DOM and WebGL).
 *
 * Reads placeSelection from QueryProvider context to display the
 * selected coordinate marker and analysis area.
 *
 * WebGL failure → explicit error state shown; non-map controls remain operable.
 * Tile failure → explicit basemap-unavailable state.
 *
 * Shows ONLY: OSM basemap, selected coordinate marker, analysis area polygon.
 * No hazard layers, no observations, no missions.
 */

import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useQueryDraft } from "@/components/query/query-provider";
import { buildMapCoordinateSelection } from "@/lib/location/selection";
import type { WildfirePointProperties } from "@/contracts/wildfire-layer";
import type { FloodExtentLayerResult } from "@/contracts/flood-extent-layer";
import { shouldSelectMapClick } from "@/lib/location/map-click";
import { FailureGapStatus } from "@/components/states/failure-gap-status";
import type { LayerState } from "./layer-manager";

interface MaplibreMapCanvasProps {
  layers: LayerState[];
  osmTileUrl: string;
  osmAttribution: string;
  /** UXFIX-02: UTC date (YYYY-MM-DD) for the NASA GIBS satellite overlays. */
  overlayDate: string;
  /** Source-request generation for the current selected area and map date. */
  overlayContextRevision: number;
  /** Agent focus event, including a repeated lookup of the same place. */
  focusRevision: number;
  circlePolygon: (
    lon: number,
    lat: number,
    radiusKm: number
  ) => GeoJSON.Feature<GeoJSON.Polygon>;
  wildfireData: GeoJSON.FeatureCollection<GeoJSON.Point, WildfirePointProperties> | null;
  floodExtentData: FloodExtentLayerResult | null;
  onUseWithoutMap: () => void;
  /**
   * ADR-0040 (Bug E): tile-level retrieval signals for the GIBS overlays.
   * "ready" fires when a source finishes loading, "error" when one of its
   * tile requests fails. The owner of layer state decides what to display.
   */
  onGibsOverlayStatus?: (
    layerId: "gibs_precipitation" | "gibs_surface_temp",
    status: "ready" | "error" | "detached",
    date: string,
    contextRevision: number
  ) => void;
  /** Renderer confirmation for fetched FIRMS and flood-extent data. */
  onDataOverlayStatus?: (
    layerId: "wildfire_nrt" | "flood_extent",
    status: "ready" | "error" | "detached",
    date: string,
    contextRevision: number
  ) => void;
  /** Whole-renderer lifecycle, separate from source-specific failures. */
  onRendererStatus?: (
    status: "attached" | "unavailable",
    date: string,
    contextRevision: number
  ) => void;
}

/**
 * UXFIX-02: NASA GIBS WMTS overlay definitions (EPSG:3857, credential-free).
 * The same products the flood/heat evidence adapters retrieve, drawn on the
 * map as visualization-only raster tiles. GIBS path order is {z}/{y}/{x}.
 */
const GIBS_OVERLAYS = [
  {
    layerId: "gibs_precipitation" as const,
    mapLayerId: "gibs-precipitation-tiles",
    sourceId: "gibs-precipitation",
    product: "IMERG_Precipitation_Rate",
    matrixSet: "GoogleMapsCompatible_Level6",
    maxzoom: 6,
  },
  {
    layerId: "gibs_surface_temp" as const,
    mapLayerId: "gibs-surface-temp-tiles",
    sourceId: "gibs-surface-temp",
    product: "MODIS_Terra_Land_Surface_Temp_Day",
    matrixSet: "GoogleMapsCompatible_Level7",
    maxzoom: 7,
  },
];

type GibsOverlay = (typeof GIBS_OVERLAYS)[number];
type GibsLayerId = GibsOverlay["layerId"];

interface GibsSourceContext {
  layerId: GibsLayerId;
  date: string;
  contextRevision: number;
}

interface DataOverlayContext {
  layerId: "wildfire_nrt" | "flood_extent";
  date: string;
  contextRevision: number;
  renderedCount?: number;
}

const GIBS_ATTRIBUTION = "Imagery courtesy of NASA GIBS / Worldview";
const WILDFIRE_SOURCE_PREFIX = "firms-wildfire-nrt";
const WILDFIRE_HALO_LAYER_ID = "firms-wildfire-nrt-halo";
const WILDFIRE_POINT_LAYER_ID = "firms-wildfire-nrt-points";
const FLOOD_EXTENT_SOURCE_PREFIX = "viirs-flood-extent-image";
const FLOOD_EXTENT_LAYER_ID = "viirs-flood-extent-raster";
function wildfirePopupContent(properties: WildfirePointProperties): HTMLElement {
  const container = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = "NASA FIRMS hotspot pixel";
  const details = document.createElement("div");
  details.textContent =
    `Acquired ${properties.acquiredAt.replace("T", " ").replace("Z", " UTC")} · ` +
    `${properties.confidence} confidence · FRP ${properties.frpMw} MW`;
  const limitation = document.createElement("div");
  limitation.textContent = "Thermal anomaly only — not a wildfire perimeter or official incident.";
  limitation.style.marginTop = "4px";
  container.append(title, details, limitation);
  return container;
}

function gibsTileUrl(product: string, matrixSet: string, date: string): string {
  return (
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${product}/default/` +
    `${date}/${matrixSet}/{z}/{y}/{x}.png`
  );
}

type CanvasStatus = "loading" | "ready" | "webgl_error" | "tile_error";

const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

export function MaplibreMapCanvas({
  layers,
  osmTileUrl,
  osmAttribution,
  overlayDate,
  overlayContextRevision,
  focusRevision,
  circlePolygon,
  wildfireData,
  floodExtentData,
  onUseWithoutMap,
  onGibsOverlayStatus,
  onDataOverlayStatus,
  onRendererStatus,
}: MaplibreMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const [status, setStatus] = useState<CanvasStatus>("loading");
  const [mapSelectionError, setMapSelectionError] = useState<string | null>(null);
  const [wildfireRenderedCount, setWildfireRenderedCount] = useState(0);
  const [floodExtentRendered, setFloodExtentRendered] = useState(false);
  const { placeSelection, setPlaceSelection } = useQueryDraft();

  // Keep a ref to the latest selection for use inside map callbacks
  const placeSelectionRef = useRef(placeSelection);
  useEffect(() => { placeSelectionRef.current = placeSelection; }, [placeSelection]);

  // ADR-0040 (Bug E): stable handle to the overlay-status callback for use
  // inside long-lived map event handlers.
  const onGibsOverlayStatusRef = useRef(onGibsOverlayStatus);
  useEffect(() => { onGibsOverlayStatusRef.current = onGibsOverlayStatus; }, [onGibsOverlayStatus]);
  const onDataOverlayStatusRef = useRef(onDataOverlayStatus);
  useEffect(() => {
    onDataOverlayStatusRef.current = onDataOverlayStatus;
  }, [onDataOverlayStatus]);
  const onRendererStatusRef = useRef(onRendererStatus);
  useEffect(() => {
    onRendererStatusRef.current = onRendererStatus;
  }, [onRendererStatus]);
  const layersRef = useRef(layers);
  useEffect(() => { layersRef.current = layers; }, [layers]);

  // Each installed raster source has a unique date generation. Keep the
  // source-to-request mapping after replacement so a late event from a removed
  // source is still attributed to its original date and rejected by the owner.
  const overlayDateRef = useRef(overlayDate);
  useEffect(() => { overlayDateRef.current = overlayDate; }, [overlayDate]);
  const overlayContextRevisionRef = useRef(overlayContextRevision);
  useEffect(() => {
    overlayContextRevisionRef.current = overlayContextRevision;
  }, [overlayContextRevision]);
  const gibsSourceGenerationRef = useRef(0);
  const activeGibsSourceIdsRef = useRef<Partial<Record<GibsLayerId, string>>>({});
  const gibsSourceContextsRef = useRef(new Map<string, GibsSourceContext>());
  const dataSourceGenerationRef = useRef(0);
  const activeDataSourceIdsRef = useRef<Partial<
    Record<DataOverlayContext["layerId"], string>
  >>({});
  const dataOverlayContextsRef = useRef(new Map<string, DataOverlayContext>());

  function installGibsOverlay(
    map: maplibregl.Map,
    overlay: GibsOverlay,
    date: string,
    contextRevision: number,
    visible: boolean
  ) {
    const generation = ++gibsSourceGenerationRef.current;
    const sourceId = `${overlay.sourceId}-${date}-${generation}`;
    activeGibsSourceIdsRef.current[overlay.layerId] = sourceId;
    gibsSourceContextsRef.current.set(sourceId, {
      layerId: overlay.layerId,
      date,
      contextRevision,
    });
    map.addSource(sourceId, {
      type: "raster",
      tiles: [gibsTileUrl(overlay.product, overlay.matrixSet, date)],
      tileSize: 256,
      maxzoom: overlay.maxzoom,
      attribution: GIBS_ATTRIBUTION,
    });
    map.addLayer(
      {
        id: overlay.mapLayerId,
        type: "raster",
        source: sourceId,
        layout: { visibility: visible ? "visible" : "none" },
        paint: { "raster-opacity": 0.65 },
      },
      map.getLayer("analysis-area-fill") ? "analysis-area-fill" : undefined
    );
  }

  // Rebuild when the requested date or source-request area generation changes.
  // A status-only render keeps the current generation; visibility is handled
  // independently.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    for (const overlay of GIBS_OVERLAYS) {
      const visible = layers.find((l) => l.id === overlay.layerId)?.visible ?? false;
      const currentSourceId = activeGibsSourceIdsRef.current[overlay.layerId];
      const currentContext = currentSourceId
        ? gibsSourceContextsRef.current.get(currentSourceId)
        : undefined;
      if (
        currentSourceId &&
        currentContext?.date === overlayDate &&
        currentContext.contextRevision === overlayContextRevision
      ) continue;
      if (map.getLayer(overlay.mapLayerId)) map.removeLayer(overlay.mapLayerId);
      if (currentSourceId && map.getSource(currentSourceId)) {
        map.removeSource(currentSourceId);
      }
      if (currentSourceId) gibsSourceContextsRef.current.delete(currentSourceId);
      installGibsOverlay(
        map,
        overlay,
        overlayDate,
        overlayContextRevision,
        visible
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayContextRevision, overlayDate, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    const previousSourceId = activeDataSourceIdsRef.current.wildfire_nrt;
    if (map.getLayer(WILDFIRE_HALO_LAYER_ID)) {
      map.removeLayer(WILDFIRE_HALO_LAYER_ID);
    }
    if (map.getLayer(WILDFIRE_POINT_LAYER_ID)) {
      map.removeLayer(WILDFIRE_POINT_LAYER_ID);
    }
    if (previousSourceId && map.getSource(previousSourceId)) {
      map.removeSource(previousSourceId);
    }
    if (previousSourceId) dataOverlayContextsRef.current.delete(previousSourceId);
    delete activeDataSourceIdsRef.current.wildfire_nrt;
    setWildfireRenderedCount(0);
    if (!wildfireData) return;

    const sourceId = `${WILDFIRE_SOURCE_PREFIX}-${overlayDate}-${
      overlayContextRevision
    }-${++dataSourceGenerationRef.current}`;
    activeDataSourceIdsRef.current.wildfire_nrt = sourceId;
    dataOverlayContextsRef.current.set(sourceId, {
      layerId: "wildfire_nrt",
      date: overlayDate,
      contextRevision: overlayContextRevision,
      renderedCount: wildfireData.features.length,
    });
    try {
      map.addSource(sourceId, {
        type: "geojson",
        data: wildfireData,
      });
      map.addLayer({
        id: WILDFIRE_HALO_LAYER_ID,
        type: "circle",
        source: sourceId,
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": 12,
          "circle-color": "#f97316",
          "circle-opacity": 0.2,
        },
      });
      map.addLayer({
        id: WILDFIRE_POINT_LAYER_ID,
        type: "circle",
        source: sourceId,
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": 6,
          "circle-color": "#f97316",
          "circle-opacity": 0.9,
          "circle-stroke-color": "#7c2d12",
          "circle-stroke-width": 1.5,
        },
      });
    } catch {
      if (map.getLayer(WILDFIRE_HALO_LAYER_ID)) {
        map.removeLayer(WILDFIRE_HALO_LAYER_ID);
      }
      if (map.getLayer(WILDFIRE_POINT_LAYER_ID)) {
        map.removeLayer(WILDFIRE_POINT_LAYER_ID);
      }
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      dataOverlayContextsRef.current.delete(sourceId);
      delete activeDataSourceIdsRef.current.wildfire_nrt;
      onDataOverlayStatusRef.current?.(
        "wildfire_nrt",
        "error",
        overlayDate,
        overlayContextRevision
      );
    }
  }, [wildfireData, status, overlayDate, overlayContextRevision]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    const previousSourceId = activeDataSourceIdsRef.current.flood_extent;
    if (map.getLayer(FLOOD_EXTENT_LAYER_ID)) map.removeLayer(FLOOD_EXTENT_LAYER_ID);
    if (previousSourceId && map.getSource(previousSourceId)) {
      map.removeSource(previousSourceId);
    }
    if (previousSourceId) dataOverlayContextsRef.current.delete(previousSourceId);
    delete activeDataSourceIdsRef.current.flood_extent;
    setFloodExtentRendered(false);
    if (
      !floodExtentData ||
      floodExtentData.evidenceState !== "observations_returned" ||
      !floodExtentData.imageDataUrl
    ) {
      setFloodExtentRendered(false);
      return;
    }
    const { west, south, east, north } = floodExtentData.requestArea;
    const sourceId = `${FLOOD_EXTENT_SOURCE_PREFIX}-${overlayDate}-${
      overlayContextRevision
    }-${++dataSourceGenerationRef.current}`;
    activeDataSourceIdsRef.current.flood_extent = sourceId;
    dataOverlayContextsRef.current.set(sourceId, {
      layerId: "flood_extent",
      date: overlayDate,
      contextRevision: overlayContextRevision,
    });
    try {
      map.addSource(sourceId, {
        type: "image",
        url: floodExtentData.imageDataUrl,
        coordinates: [
          [west, north],
          [east, north],
          [east, south],
          [west, south],
        ],
      });
      map.addLayer(
        {
          id: FLOOD_EXTENT_LAYER_ID,
          type: "raster",
          source: sourceId,
          layout: { visibility: "visible" },
          paint: { "raster-opacity": 0.72 },
        },
        map.getLayer("analysis-area-fill") ? "analysis-area-fill" : undefined
      );
    } catch {
      if (map.getLayer(FLOOD_EXTENT_LAYER_ID)) {
        map.removeLayer(FLOOD_EXTENT_LAYER_ID);
      }
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      dataOverlayContextsRef.current.delete(sourceId);
      delete activeDataSourceIdsRef.current.flood_extent;
      onDataOverlayStatusRef.current?.(
        "flood_extent",
        "error",
        overlayDate,
        overlayContextRevision
      );
    }
  }, [
    floodExtentData,
    status,
    overlayDate,
    overlayContextRevision,
  ]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialDate = overlayDateRef.current;
    const initialContextRevision = overlayContextRevisionRef.current;
    onRendererStatusRef.current?.(
      "attached",
      initialDate,
      initialContextRevision
    );

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: [osmTileUrl],
              tileSize: 256,
              attribution: osmAttribution,
            },
          },
          layers: [
            {
              id: "osm-tiles",
              type: "raster",
              source: "osm",
              minzoom: 0,
              maxzoom: 22,
            },
          ],
        },
        center: [-95.5, 29.5], // Default: Houston demo area
        zoom: 6,
        // attributionControl defaults to showing OSM attribution when not set to false
      });
    } catch {
      onRendererStatusRef.current?.(
        "unavailable",
        initialDate,
        initialContextRevision
      );
      setStatus("webgl_error");
      return;
    }

    mapRef.current = map;
    let basemapReady = false;
    const installedGibsSourceContexts = gibsSourceContextsRef.current;
    const installedDataOverlayContexts = dataOverlayContextsRef.current;
    let rendererTerminated = false;

    const terminateRenderer = (terminalStatus: "tile_error") => {
      if (rendererTerminated) return;
      rendererTerminated = true;
      setWildfireRenderedCount(0);
      setFloodExtentRendered(false);
      onRendererStatusRef.current?.(
        "unavailable",
        overlayDateRef.current,
        overlayContextRevisionRef.current
      );
      map.remove();
      mapRef.current = null;
      setStatus(terminalStatus);
    };

    map.on("load", () => {
      basemapReady = true;
      setStatus("ready");

      // UXFIX-02: NASA GIBS satellite overlays (hidden until toggled on).
      for (const overlay of GIBS_OVERLAYS) {
        const visible = layersRef.current.find(
          (layer) => layer.id === overlay.layerId
        )?.visible ?? false;
        installGibsOverlay(
          map,
          overlay,
          overlayDateRef.current,
          overlayContextRevisionRef.current,
          visible
        );
      }

      // Add analysis area source and layers
      map.addSource("analysis-area", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "analysis-area-fill",
        type: "fill",
        source: "analysis-area",
        paint: {
          "fill-color": "#3b82d4",
          "fill-opacity": 0.15,
        },
      });
      map.addLayer({
        id: "analysis-area-outline",
        type: "line",
        source: "analysis-area",
        paint: {
          "line-color": "#3b82d4",
          "line-width": 2,
        },
      });

      map.on("mouseenter", WILDFIRE_POINT_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", WILDFIRE_POINT_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", WILDFIRE_POINT_LAYER_ID, (event) => {
        event.originalEvent.preventDefault();
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point" || !feature.properties) return;
        const coordinates = feature.geometry.coordinates as [number, number];
        new maplibregl.Popup({ closeButton: true, closeOnClick: true })
          .setLngLat(coordinates)
          .setDOMContent(wildfirePopupContent(feature.properties as WildfirePointProperties))
          .addTo(map);
      });
    });

    // Source `visibility` events can report loaded before newly visible tiles
    // are scheduled. MapLibre emits `idle` only after the current view has no
    // outstanding source/tile work, so renderer-ready claims are made there.
    map.on("idle", () => {
      for (const overlay of GIBS_OVERLAYS) {
        const sourceId = activeGibsSourceIdsRef.current[overlay.layerId];
        const sourceContext = sourceId
          ? installedGibsSourceContexts.get(sourceId)
          : undefined;
        if (
          !sourceId ||
          !sourceContext ||
          !map.getLayer(overlay.mapLayerId) ||
          map.getLayoutProperty(overlay.mapLayerId, "visibility") === "none" ||
          !map.isSourceLoaded(sourceId)
        ) continue;
        onGibsOverlayStatusRef.current?.(
          sourceContext.layerId,
          "ready",
          sourceContext.date,
          sourceContext.contextRevision
        );
      }
      for (const [layerId, sourceId] of Object.entries(
        activeDataSourceIdsRef.current
      ) as Array<[DataOverlayContext["layerId"], string]>) {
        const dataContext = installedDataOverlayContexts.get(sourceId);
        const mapLayerId = layerId === "wildfire_nrt"
          ? WILDFIRE_POINT_LAYER_ID
          : FLOOD_EXTENT_LAYER_ID;
        if (
          !dataContext ||
          !map.getLayer(mapLayerId) ||
          map.getLayoutProperty(mapLayerId, "visibility") === "none" ||
          !map.isSourceLoaded(sourceId)
        ) continue;
        if (layerId === "wildfire_nrt") {
          setWildfireRenderedCount(dataContext.renderedCount ?? 0);
        } else {
          setFloodExtentRendered(true);
        }
        onDataOverlayStatusRef.current?.(
          layerId,
          "ready",
          dataContext.date,
          dataContext.contextRevision
        );
      }
    });

    map.on("error", (event) => {
      // P0-D: only a basemap ("osm") failure makes the whole map unavailable.
      // MapLibre forwards source/tile errors with the failing sourceId; an
      // overlay source (GIBS rasters, wildfire, flood extent) failing must
      // never replace a working basemap with the unavailable panel.
      const sourceId = (event as { sourceId?: string }).sourceId;
      if (sourceId !== undefined) {
        if (sourceId === "osm") {
          terminateRenderer("tile_error");
          return;
        }
        // ADR-0040 (Bug E): overlay tile failures surface per-layer status
        // instead of being swallowed.
        const sourceContext = installedGibsSourceContexts.get(sourceId);
        if (
          sourceContext &&
          activeGibsSourceIdsRef.current[sourceContext.layerId] === sourceId
        ) {
          onGibsOverlayStatusRef.current?.(
            sourceContext.layerId,
            "error",
            sourceContext.date,
            sourceContext.contextRevision
          );
        }
        const dataContext = installedDataOverlayContexts.get(sourceId);
        if (
          dataContext &&
          activeDataSourceIdsRef.current[dataContext.layerId] === sourceId
        ) {
          if (dataContext.layerId === "wildfire_nrt") {
            setWildfireRenderedCount(0);
          } else {
            setFloodExtentRendered(false);
          }
          onDataOverlayStatusRef.current?.(
            dataContext.layerId,
            "error",
            dataContext.date,
            dataContext.contextRevision
          );
        }
        return;
      }
      // No sourceId means a style/runtime error. Before the style loads that
      // is fatal for the basemap, so keep the original behavior. After the
      // map is ready the basemap is already rendering; nuking the canvas for
      // a non-source runtime error would destroy working functionality, so
      // ignore it here (per-layer status UI is a later phase).
      if (!basemapReady) terminateRenderer("tile_error");
    });

    // Map click → coordinate selection (labeled "Map point", not geocoded)
    // Preserves the current radius and complete custom-time start/end timestamps.
    map.on("click", (e) => {
      const hotspotCount = map.getLayer(WILDFIRE_POINT_LAYER_ID)
        ? map.queryRenderedFeatures(e.point, { layers: [WILDFIRE_POINT_LAYER_ID] }).length
        : 0;
      if (!shouldSelectMapClick(e.originalEvent.defaultPrevented, hotspotCount)) return;
      const lon = e.lngLat.lng;
      const lat = e.lngLat.lat;
      const current = placeSelectionRef.current;
      const currentRadius = current?.analysisArea.radiusKm ?? 25;
      const currentTimeType = current?.timeSelection.type ?? "latest";
      const currentStartTs = current?.timeSelection.startTs;
      const currentEndTs = current?.timeSelection.endTs;
      try {
        const sel = buildMapCoordinateSelection(
          { lon, lat },
          currentRadius,
          currentTimeType,
          currentStartTs,
          currentEndTs
        );
        setMapSelectionError(null);
        setPlaceSelection(sel);
      } catch (err) {
        // Coordinate validation error (e.g. out of bounds) — show persistent alert
        setMapSelectionError(
          err instanceof Error ? err.message : "Map click location is not valid for selection."
        );
      }
    });

    return () => {
      for (const [layerId, sourceId] of Object.entries(
        activeGibsSourceIdsRef.current
      ) as Array<[GibsLayerId, string]>) {
        const sourceContext = installedGibsSourceContexts.get(sourceId);
        if (sourceContext) {
          onGibsOverlayStatusRef.current?.(
            layerId,
            "detached",
            sourceContext.date,
            sourceContext.contextRevision
          );
        }
      }
      for (const dataContext of installedDataOverlayContexts.values()) {
        onDataOverlayStatusRef.current?.(
          dataContext.layerId,
          "detached",
          dataContext.date,
          dataContext.contextRevision
        );
      }
      activeGibsSourceIdsRef.current = {};
      activeDataSourceIdsRef.current = {};
      installedGibsSourceContexts.clear();
      installedDataOverlayContexts.clear();
      if (!rendererTerminated) {
        map.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osmTileUrl, osmAttribution]);

  // A failed canvas remains mounted as an explicit recovery panel. Reassert
  // renderer unavailability when the selected date/area context changes so a
  // new desired-state transaction cannot strand layers in `loading`.
  useEffect(() => {
    if (status !== "webgl_error" && status !== "tile_error") return;
    onRendererStatus?.("unavailable", overlayDate, overlayContextRevision);
  }, [status, overlayDate, overlayContextRevision, onRendererStatus]);

  // The desktop shell sidebars can change the map column without changing the
  // browser viewport. Keep MapLibre's canvas synchronized with its container.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Update layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    for (const layer of layers) {
      const visibility = layer.visible ? "visible" : "none";
      if (layer.id === "basemap" && map.getLayer("osm-tiles")) {
        map.setLayoutProperty("osm-tiles", "visibility", visibility);
      } else if (layer.id === "gibs_precipitation" || layer.id === "gibs_surface_temp") {
        const overlay = GIBS_OVERLAYS.find((entry) => entry.layerId === layer.id);
        if (overlay && map.getLayer(overlay.mapLayerId)) {
          map.setLayoutProperty(overlay.mapLayerId, "visibility", visibility);
        }
      } else if (layer.id === "analysis_area") {
        if (map.getLayer("analysis-area-fill")) {
          map.setLayoutProperty("analysis-area-fill", "visibility", visibility);
          map.setLayoutProperty("analysis-area-outline", "visibility", visibility);
        }
      } else if (layer.id === "wildfire_nrt") {
        if (map.getLayer(WILDFIRE_HALO_LAYER_ID)) {
          map.setLayoutProperty(WILDFIRE_HALO_LAYER_ID, "visibility", visibility);
          map.setLayoutProperty(WILDFIRE_POINT_LAYER_ID, "visibility", visibility);
        }
      } else if (layer.id === "flood_extent" && map.getLayer(FLOOD_EXTENT_LAYER_ID)) {
        map.setLayoutProperty(FLOOD_EXTENT_LAYER_ID, "visibility", visibility);
      }
    }
  }, [layers, status]);

  // Update marker and analysis area polygon when selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;

    // Remove old marker
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }

    if (!placeSelection) {
      const src = map.getSource("analysis-area") as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const { coordinate, analysisArea } = placeSelection;
    const marker = new maplibregl.Marker({ color: "#3b82d4" })
      .setLngLat([coordinate.lon, coordinate.lat]);
    // This marker is visual communication only. It must not intercept a click
    // intended for a validated hotspot rendered at the same coordinate.
    marker.getElement().style.pointerEvents = "none";
    marker.getElement().setAttribute("aria-hidden", "true");
    marker.addTo(map);
    markerRef.current = marker;

    // Update analysis area polygon
    const src = map.getSource("analysis-area") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      const feature = circlePolygon(coordinate.lon, coordinate.lat, analysisArea.radiusKm);
      src.setData({ type: "FeatureCollection", features: [feature] });
    }

    // A geocoder-supplied place extent frames the actual place. Coordinate
    // selections have no authoritative extent and keep the point-centred path.
    if (placeSelection.placeBoundingBox) {
      const { west, south, east, north } = placeSelection.placeBoundingBox;
      map.fitBounds(
        [[west, south], [east, north]],
        { padding: 48, maxZoom: 12, duration: 800 }
      );
    } else {
      map.flyTo({
        center: [coordinate.lon, coordinate.lat],
        zoom: Math.max(7, map.getZoom()),
        duration: 800,
      });
    }
  }, [placeSelection, status, circlePolygon, focusRevision]);

  if (status === "webgl_error") {
    return (
      <div
        data-testid="map-webgl-error"
        style={{
          height: "100%",
          display: "grid",
          alignContent: "center",
          padding: "1rem",
          fontSize: "14px",
          gap: "8px",
        }}
      >
        <FailureGapStatus state={{ kind: "map_failure" }} onRecover={onUseWithoutMap} />
        <p style={{ margin: 0, color: "var(--text-muted)" }}>
          WebGL is unavailable in this browser environment. The validated non-map
          selection and evidence path remains operable.
        </p>
      </div>
    );
  }

  if (status === "tile_error") {
    return (
      <div
        data-testid="map-tile-error"
        style={{
          height: "100%",
          display: "grid",
          alignContent: "center",
          padding: "1rem",
          fontSize: "14px",
          gap: "8px",
        }}
      >
        <FailureGapStatus state={{ kind: "map_failure" }} onRecover={onUseWithoutMap} />
        <p style={{ margin: 0, color: "var(--text-muted)" }}>
          Basemap tiles could not be loaded ({OSM_ATTRIBUTION}). Selection controls
          and the validated non-map evidence path remain operable.
        </p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        ref={containerRef}
        data-testid="map-canvas"
        data-wildfire-rendered-count={wildfireRenderedCount}
        data-flood-extent-rendered={floodExtentRendered ? "true" : "false"}
        style={{ width: "100%", height: "100%", minHeight: "200px" }}
      />
      {status === "loading" && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.3)",
            color: "var(--text-primary)",
            fontSize: "14px",
          }}
        >
          Loading map…
        </div>
      )}
      {mapSelectionError && (
        <div
          role="alert"
          data-testid="map-selection-error"
          style={{
            position: "absolute",
            bottom: "40px",
            left: "50%",
            transform: "translateX(-50%)",
            maxWidth: "340px",
            width: "calc(100% - 32px)",
            zIndex: 20,
            fontSize: "14px",
            color: "var(--status-error-fg)",
            background: "var(--status-error-bg)",
            border: "1px solid var(--status-error-border)",
            borderRadius: "4px",
            padding: "6px 10px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
          }}
        >
          {mapSelectionError}
        </div>
      )}
    </div>
  );
}
