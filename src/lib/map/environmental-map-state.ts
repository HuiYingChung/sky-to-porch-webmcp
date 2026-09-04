import type { HazardId } from "@/contracts/common";
import type { PlaceSelection } from "@/lib/location/selection";

export const ENVIRONMENTAL_MAP_LAYER_IDS = [
  "rain_satellite",
  "surface_heat_satellite",
  "thermal_anomalies_firms",
  "flood_extent",
] as const;

export type EnvironmentalMapLayerId =
  (typeof ENVIRONMENTAL_MAP_LAYER_IDS)[number];

export type EnvironmentalMapLayerStatus =
  | "hidden"
  | "loading"
  | "ready"
  | "no_imagery"
  | "source_failure"
  | "unsupported_date";

export interface EnvironmentalMapLayerRuntimeState {
  visible: boolean;
  status: EnvironmentalMapLayerStatus;
}

export interface EnvironmentalMapState {
  date: string | null;
  layers: Record<EnvironmentalMapLayerId, EnvironmentalMapLayerRuntimeState>;
  /** Changes only when desired map state or its place/date context changes. */
  revision: number;
  /** Changes only when the source-request area or UTC map date changes. */
  contextRevision: number;
  /** Changes for every Agent map request so mobile can reveal the Map view. */
  agentFocusRevision: number;
}

export type EnvironmentalMapLayerPatch = Partial<
  Record<EnvironmentalMapLayerId, boolean>
>;

export const MAP_LAYER_ID_BY_ENVIRONMENTAL_LAYER = {
  rain_satellite: "gibs_precipitation",
  surface_heat_satellite: "gibs_surface_temp",
  thermal_anomalies_firms: "wildfire_nrt",
  flood_extent: "flood_extent",
} as const;

export const ENVIRONMENTAL_LAYER_BY_MAP_LAYER_ID = {
  gibs_precipitation: "rain_satellite",
  gibs_surface_temp: "surface_heat_satellite",
  wildfire_nrt: "thermal_anomalies_firms",
  flood_extent: "flood_extent",
} as const;

export const DEFAULT_ENVIRONMENTAL_LAYERS_BY_HAZARD: Readonly<
  Record<HazardId, readonly EnvironmentalMapLayerId[]>
> = {
  fire_smoke: ["thermal_anomalies_firms"],
  flood_storm: ["rain_satellite", "flood_extent"],
  wind_storm: [],
  extreme_heat: ["surface_heat_satellite"],
  drought_land: [],
  air_quality: [],
  earth_volcanoes: [],
};

export const ENVIRONMENTAL_MAP_LIMITATIONS: Readonly<
  Record<EnvironmentalMapLayerId, string>
> = {
  rain_satellite:
    "NASA IMERG imagery visualizes precipitation rate; it is not flood amount, flood extent, property impact, or a safety determination.",
  surface_heat_satellite:
    "NASA MODIS imagery visualizes land-surface temperature, not air temperature, indoor temperature, heat exposure, or a safety determination.",
  thermal_anomalies_firms:
    "NASA FIRMS points are recent thermal-anomaly pixels, not fire perimeters, incident boundaries, evacuation guidance, severity, or a safety determination.",
  flood_extent:
    "NASA VIIRS flood extent is a 3-day visualization, not water depth, property impact, route status, or a safety determination.",
};

export const ENVIRONMENTAL_MAP_SOURCES: Readonly<
  Record<EnvironmentalMapLayerId, string>
> = {
  rain_satellite: "NASA GIBS IMERG_Precipitation_Rate",
  surface_heat_satellite: "NASA GIBS MODIS_Terra_Land_Surface_Temp_Day",
  thermal_anomalies_firms: "NASA FIRMS VIIRS_NOAA20_NRT",
  flood_extent: "NASA GIBS VIIRS_Combined_Flood_3-Day",
};

export function createInitialEnvironmentalMapState(): EnvironmentalMapState {
  return {
    date: null,
    layers: {
      rain_satellite: { visible: false, status: "hidden" },
      surface_heat_satellite: { visible: false, status: "hidden" },
      thermal_anomalies_firms: { visible: false, status: "hidden" },
      flood_extent: { visible: false, status: "hidden" },
    },
    revision: 0,
    contextRevision: 0,
    agentFocusRevision: 0,
  };
}

export function isStrictUtcMapDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value;
}

export function latestCompletedUtcDate(now: Date = new Date()): string {
  const completed = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - 1
  ));
  return completed.toISOString().slice(0, 10);
}

/** Return a single UTC day only; a multi-day range deliberately returns null. */
export function singleMapDateFromSelection(
  selection: PlaceSelection | null,
  now: Date = new Date()
): string | null {
  if (!selection) return null;
  if (selection.timeSelection.type !== "custom") {
    return latestCompletedUtcDate(now);
  }
  const start = selection.timeSelection.startTs?.slice(0, 10);
  const end = selection.timeSelection.endTs?.slice(0, 10);
  return start && end && start === end && isStrictUtcMapDate(start) ? start : null;
}

/**
 * The map route is explicitly NRT and its result contract rejects detections
 * older than 48 hours. With day-granularity requests, only today and the
 * previous UTC day can satisfy that freshness contract for every row.
 */
export function isFirmsNrtMapDateSupported(
  date: string,
  now: Date = new Date()
): boolean {
  if (!isStrictUtcMapDate(date)) return false;
  const today = now.toISOString().slice(0, 10);
  return date === today || date === latestCompletedUtcDate(now);
}

export function loadingStatusForLayer(
  layerId: EnvironmentalMapLayerId,
  date: string | null,
  now: Date = new Date()
): EnvironmentalMapLayerStatus {
  if (date === null) return "source_failure";
  if (
    layerId === "thermal_anomalies_firms" &&
    !isFirmsNrtMapDateSupported(date, now)
  ) return "unsupported_date";
  return "loading";
}

export function sameMapSelection(
  first: PlaceSelection | null,
  second: PlaceSelection | null
): boolean {
  if (first === second) return true;
  if (!first || !second) return false;
  return first.label === second.label &&
    first.coordinate.lon === second.coordinate.lon &&
    first.coordinate.lat === second.coordinate.lat &&
    first.analysisArea.radiusKm === second.analysisArea.radiusKm &&
    first.timeSelection.type === second.timeSelection.type &&
    first.timeSelection.startTs === second.timeSelection.startTs &&
    first.timeSelection.endTs === second.timeSelection.endTs &&
    JSON.stringify(first.placeBoundingBox ?? null) ===
      JSON.stringify(second.placeBoundingBox ?? null);
}

export function applyEnvironmentalMapDesiredState(
  current: EnvironmentalMapState,
  layerPatch: EnvironmentalMapLayerPatch,
  options: {
    date: string | null;
    contextChanged: boolean;
    origin: "human" | "agent";
    now?: Date;
  }
): EnvironmentalMapState {
  const nextLayers = structuredClone(current.layers);
  const contextReset = current.date !== options.date || options.contextChanged;
  let changed = contextReset;

  for (const layerId of ENVIRONMENTAL_MAP_LAYER_IDS) {
    const requested = layerPatch[layerId];
    const currentLayer = nextLayers[layerId];
    const visible = requested ?? currentLayer.visible;
    const visibilityChanged = currentLayer.visible !== visible;
    const shouldReset = contextReset && visible;
    if (requested === undefined && !shouldReset) continue;
    const status = !visible
      ? "hidden"
      : visibilityChanged || shouldReset
        ? loadingStatusForLayer(layerId, options.date, options.now)
        : currentLayer.status;
    if (
      currentLayer.visible !== visible ||
      currentLayer.status !== status
    ) changed = true;
    nextLayers[layerId] = { visible, status };
  }

  return {
    date: options.date,
    layers: nextLayers,
    revision: current.revision + (changed ? 1 : 0),
    contextRevision: current.contextRevision + (contextReset ? 1 : 0),
    agentFocusRevision: current.agentFocusRevision +
      (options.origin === "agent" ? 1 : 0),
  };
}
