"use client";

import type { HazardId } from "@/contracts/common";
import type {
  WildfireLayerErrorCode,
  WildfireLayerResult,
} from "@/contracts/wildfire-layer";
import type {
  FloodExtentLayerErrorCode,
  FloodExtentLayerResult,
} from "@/contracts/flood-extent-layer";

export type LayerId =
  | "basemap"
  | "selected_place"
  | "analysis_area"
  | "gibs_precipitation"
  | "gibs_surface_temp"
  | "wildfire_nrt"
  | "flood_extent";

export interface LayerState {
  id: LayerId;
  label: string;
  visible: boolean;
  description: string;
  available?: boolean;
  unavailableReason?: string;
}

/**
 * ADR-0046: basemap, selected_place, and analysis_area have no UI toggle and
 * must stay `visible: true` forever — nothing in the codebase may set them
 * false (toggleLayer is only reachable from the hazard toggles below, and
 * applyHazardDefaults only enables layers).
 */
export const INITIAL_LAYERS: LayerState[] = [
  {
    id: "basemap",
    label: "Basemap",
    visible: true,
    description: "OpenStreetMap geographic context.",
  },
  {
    id: "selected_place",
    label: "Selected place",
    visible: true,
    description: "Marker for the canonical query coordinate.",
  },
  {
    id: "analysis_area",
    label: "Analysis area",
    visible: true,
    description: "Approximate point-centred radius, not an official boundary.",
  },
  {
    id: "gibs_precipitation",
    label: "Rain (satellite)",
    visible: false,
    description: "NASA GIBS IMERG precipitation-rate imagery. Rain is not flood extent.",
  },
  {
    id: "gibs_surface_temp",
    label: "Surface heat (satellite)",
    visible: false,
    description: "NASA GIBS MODIS land-surface-temperature imagery. Surface is not air temperature.",
  },
  {
    id: "wildfire_nrt",
    label: "Thermal anomalies (FIRMS)",
    visible: false,
    description: "Recent validated NASA FIRMS thermal-anomaly pixels in the selected analysis area.",
  },
  {
    id: "flood_extent",
    label: "Flood extent",
    visible: false,
    description: "NASA VIIRS 3-day flood-extent visualization for the selected analysis area.",
  },
];

/**
 * ADR-0040 (Bug G): layers a hazard choice enables by default. Manual
 * toggles stay authoritative afterwards; the table is applied only when the
 * selected hazard changes.
 */
export const HAZARD_DEFAULT_LAYERS: Record<HazardId, readonly LayerId[]> = {
  fire_smoke: ["wildfire_nrt"],
  flood_storm: ["gibs_precipitation", "flood_extent"],
  wind_storm: [],
  extreme_heat: ["gibs_surface_temp"],
  drought_land: [],
  air_quality: [],
  earth_volcanoes: [],
};

/**
 * Enable the hazard's default layers (never disabling anything the user
 * already turned on, and never touching unavailable layers).
 */
export function applyHazardDefaults(
  layers: LayerState[],
  hazardId: HazardId | null
): LayerState[] {
  if (hazardId === null) return layers;
  const defaults = new Set<LayerId>(HAZARD_DEFAULT_LAYERS[hazardId]);
  if (defaults.size === 0) return layers;
  return layers.map((layer) =>
    defaults.has(layer.id) && layer.available !== false && !layer.visible
      ? { ...layer, visible: true }
      : layer
  );
}

/** ADR-0040 (Bug E): per-overlay retrieval status for the GIBS rasters. */
export type GibsOverlayStatus = "idle" | "loading" | "ready" | "error" | "no_imagery";

interface LayerManagerProps {
  layers: LayerState[];
  onToggle: (id: LayerId) => void;
  overlayDate: string | null;
  gibsPrecipitationStatus?: GibsOverlayStatus;
  gibsSurfaceTempStatus?: GibsOverlayStatus;
  wildfireLayerStatus?: "idle" | "loading" | "ready" | "error";
  wildfireLayerResult?: WildfireLayerResult | null;
  wildfireLayerError?: WildfireLayerErrorCode | null;
  floodExtentLayerStatus?: "idle" | "loading" | "ready" | "error";
  floodExtentLayerResult?: FloodExtentLayerResult | null;
  floodExtentLayerError?: FloodExtentLayerErrorCode | null;
}

function gibsStatusMessage(status: GibsOverlayStatus, date: string | null): string | null {
  if (date === null) {
    return "Choose one UTC map date. A multi-day analysis range is not silently collapsed to a map image date.";
  }
  if (status === "loading") return "Loading satellite imagery…";
  if (status === "error") {
    return "Satellite imagery could not be loaded for this view. Failure is not evidence of no hazard.";
  }
  if (status === "no_imagery") {
    return `The NASA GIBS availability check returned no visible pixels for this area on ${date} UTC. ` +
      "This does not distinguish an all-transparent valid image from unavailable coverage, and it is not evidence of no hazard.";
  }
  return null;
}

function wildfireErrorMessage(error: WildfireLayerErrorCode | null): string {
  if (error === "unsupported_date") {
    return "The FIRMS map layer supports only today or the previous UTC day. No request was sent for this older date; use environmental analysis for historical evidence.";
  }
  if (error === "unconfigured") {
    return "Fire hotspots are not available right now because this app is running without its NASA FIRMS access key. No substitute points are shown.";
  }
  if (error === "rate_limited") {
    return "NASA FIRMS received too many requests to check this area right now. This is not evidence of no wildfire.";
  }
  if (error === "response_too_large") {
    return "The response exceeded the safe display limit. No partial or silently truncated layer is shown.";
  }
  if (error === "schema_validation") {
    return "The source returned information this app could not verify, so no map points are shown.";
  }
  return "The FIRMS selected-area request failed. Failure is not evidence of no wildfire.";
}

/**
 * ADR-0040: the VIIRS product labeled D is a 3-day composite covering D-2..D
 * (verified against the GIBS time dimension on 2026-08-19), so the window
 * must be stated — a single date implies a single-day image and can show
 * water detected up to two days before the user's selected day.
 */
function floodCompositeWindow(endDate: string): string {
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(endMs)) return endDate;
  const start = new Date(endMs - 2 * 86_400_000).toISOString().slice(0, 10);
  return `${start} to ${endDate}`;
}

function floodExtentErrorMessage(error: FloodExtentLayerErrorCode | null): string {
  if (error === "rate_limited") {
    return "Flood imagery is temporarily busy. No layer is shown, and this does not mean there is no flood.";
  }
  if (error === "timeout") {
    return "Flood imagery took too long to respond. No layer is shown, and this does not mean there is no flood.";
  }
  if (error === "response_too_large") {
    return "Flood imagery exceeded the safe display limit. No partial image is shown.";
  }
  if (error === "schema_validation") {
    return "Flood imagery did not pass validation, so it is not shown. This does not mean there is no flood.";
  }
  return "Flood imagery could not be loaded. This does not mean there is no flood or no danger.";
}

function Toggle({ layer, onToggle }: { layer: LayerState; onToggle: (id: LayerId) => void }) {
  const available = layer.available !== false;
  return (
    <div>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          cursor: available ? "pointer" : "not-allowed",
          fontSize: "14px",
          color: available ? "var(--text-primary)" : "var(--text-muted)",
        }}
      >
        <input
          type="checkbox"
          checked={layer.visible}
          disabled={!available}
          onChange={() => onToggle(layer.id)}
          data-testid={`layer-toggle-${layer.id}`}
          aria-label={`Toggle ${layer.label} layer`}
        />
        {layer.label}
      </label>
      {!available && (
        <div data-testid={`${layer.id}-source-gap`}
          style={{ margin: "2px 0 4px 22px", fontSize: "14px", lineHeight: 1.35, color: "var(--text-muted)" }}>
          {layer.unavailableReason}
        </div>
      )}
    </div>
  );
}

function RasterLegend({ kind, date }: { kind: "rain" | "heat"; date: string | null }) {
  const rain = kind === "rain";
  return (
    <div data-testid={`legend-${kind}`} style={{ margin: "4px 0 6px 22px", fontSize: "14px", lineHeight: 1.35, color: "var(--text-muted)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span aria-hidden="true" style={{
          width: "56px", height: "8px", borderRadius: "4px",
          background: rain
            ? "linear-gradient(90deg, #dbeafe, #38bdf8, #1d4ed8, #7e22ce)"
            : "linear-gradient(90deg, #312e81, #06b6d4, #facc15, #dc2626)",
        }} />
        <span>{rain ? "lower → higher precipitation rate (mm/hour)" : "lower → higher land-surface temperature (K source scale)"}</span>
      </div>
      <div>{date ? `${date} UTC · NASA GIBS product palette` : "One UTC map date is required"}</div>
      <div>{rain ? "Rain intensity is not observed flood extent." : "Land surface is not outdoor air or indoor temperature."}</div>
    </div>
  );
}

function GibsStatus({ layerId, status, date }: {
  layerId: LayerId;
  status: GibsOverlayStatus;
  date: string | null;
}) {
  const message = gibsStatusMessage(status, date);
  if (!message) return null;
  return (
    <div role="status" aria-live="polite" data-testid={`${layerId}-layer-status`}
      style={{ margin: "2px 0 5px 22px", fontSize: "14px", lineHeight: 1.35, color: "var(--text-muted)" }}>
      {message}
    </div>
  );
}

export function LayerManager({
  layers,
  onToggle,
  overlayDate,
  gibsPrecipitationStatus = "idle",
  gibsSurfaceTempStatus = "idle",
  wildfireLayerStatus = "idle",
  wildfireLayerResult = null,
  wildfireLayerError = null,
  floodExtentLayerStatus = "idle",
  floodExtentLayerResult = null,
  floodExtentLayerError = null,
}: LayerManagerProps) {
  const wildfire = layers.find((layer) => layer.id === "wildfire_nrt")!;
  const rain = layers.find((layer) => layer.id === "gibs_precipitation")!;
  const heat = layers.find((layer) => layer.id === "gibs_surface_temp")!;
  const floodExtent = layers.find((layer) => layer.id === "flood_extent")!;

  return (
    <div
      data-testid="layer-manager"
      style={{
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div aria-label="Layer controls" style={{ display: "grid", gap: "4px" }}>
        <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-secondary)" }}>
          Hazard visuals
        </div>
        <Toggle layer={rain} onToggle={onToggle} />
        {rain.visible && <GibsStatus layerId="gibs_precipitation" status={gibsPrecipitationStatus} date={overlayDate} />}
        {rain.visible && <RasterLegend kind="rain" date={overlayDate} />}
        <Toggle layer={heat} onToggle={onToggle} />
        {heat.visible && <GibsStatus layerId="gibs_surface_temp" status={gibsSurfaceTempStatus} date={overlayDate} />}
        {heat.visible && <RasterLegend kind="heat" date={overlayDate} />}
        <Toggle layer={wildfire} onToggle={onToggle} />
        {wildfire.visible && (
          <div role="status" aria-live="polite" data-testid="wildfire-layer-status"
            style={{ margin: "2px 0 5px 22px", fontSize: "14px", lineHeight: 1.35, color: "var(--text-muted)" }}>
            {wildfireLayerStatus === "idle" && "Waiting for a selected analysis area."}
            {wildfireLayerStatus === "loading" && "Loading and validating recent selected-area detections…"}
            {wildfireLayerStatus === "error" && wildfireErrorMessage(wildfireLayerError)}
            {wildfireLayerStatus === "ready" && wildfireLayerResult?.evidenceState === "no_observation" &&
              `No hotspot pixels were returned for the selected analysis area on ${overlayDate ?? "the selected date"} UTC. This does not mean no wildfire.`}
            {wildfireLayerStatus === "ready" && wildfireLayerResult?.evidenceState === "observations_returned" && (
              <>
                <span data-testid="wildfire-layer-count">
                  {wildfireLayerResult.featureCollection.features.length} validated thermal-anomaly pixel{wildfireLayerResult.featureCollection.features.length === 1 ? "" : "s"}
                </span>{" "}
                for {overlayDate ?? "the selected date"} UTC.{" "}
                Latest: {wildfireLayerResult.latestAcquiredAt?.replace("T", " ").replace("Z", " UTC")}.
              </>
            )}
            <div style={{ marginTop: "3px" }}>
              <span aria-hidden="true" style={{ color: "#f97316" }}>●</span>{" "}
              Thermal anomaly / density cue; not severity, perimeter, official incident, or evacuation information.
            </div>
          </div>
        )}
        <Toggle layer={floodExtent} onToggle={onToggle} />
        {floodExtent.visible && (
          <div role="status" aria-live="polite" data-testid="flood-extent-layer-status"
            style={{ margin: "2px 0 5px 22px", fontSize: "14px", lineHeight: 1.35, color: "var(--text-muted)" }}>
            {floodExtentLayerStatus === "idle" && "Waiting for a selected analysis area."}
            {floodExtentLayerStatus === "loading" && "Checking available flood imagery…"}
            {floodExtentLayerStatus === "error" && floodExtentErrorMessage(floodExtentLayerError)}
            {floodExtentLayerStatus === "ready" && floodExtentLayerResult?.evidenceState === "no_observation" &&
              "No flood image was returned for this area and date. This does not mean no flood or no danger."}
            {floodExtentLayerStatus === "ready" && floodExtentLayerResult?.evidenceState === "observations_returned" && (
              <>
                <span data-testid="flood-extent-layer-date">
                  Flood imagery returned: 3-day composite covering {floodCompositeWindow(floodExtentLayerResult.observedDate ?? overlayDate ?? "unknown date")} UTC.
                </span>{" "}
                Detections may come from any day in that window, not only the selected end date. NASA&apos;s image is shown as supplied; Sky to Porch does not interpret its colors as depth or property impact.
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function toggleLayer(layers: LayerState[], id: LayerId): LayerState[] {
  return layers.map((layer) =>
    layer.id === id && layer.available !== false
      ? { ...layer, visible: !layer.visible }
      : layer
  );
}
