/**
 * Public-facing presentation helpers.
 *
 * Evidence contracts intentionally keep stable identifiers and exact source
 * values for validation and auditing. These helpers form the boundary between
 * those internal values and text shown to a person. Unknown values use a
 * neutral fallback instead of exposing an identifier or trying to turn a code
 * into prose.
 */

import type { SourceId } from "@/contracts/dataset-registry";
import { getRegistryEntry } from "@/data/dataset-registry";

const PUBLIC_SOURCE_NAMES: Record<SourceId, string> = {
  noaa_hms_fire_points: "NOAA HMS Fire Detection Points",
  noaa_hms_smoke_polygons: "NOAA HMS Smoke Polygons",
  nasa_firms: "NASA FIRMS Active Fire Data",
  nasa_gibs_imerg: "NASA GIBS IMERG Precipitation Rate Visualization",
  nasa_imerg_raw: "NASA IMERG Rainfall Measurements",
  usgs_instantaneous_values: "USGS Water Data Continuous Values",
  noaa_ncei_storm_events: "NOAA NCEI Storm Events Database",
  nws_local_storm_reports: "NWS Preliminary Local Storm Reports",
  nws_tropical_cyclone_report: "NWS Post-Tropical Cyclone Report",
  nhc_hurdat2: "NHC HURDAT2 Best Track",
  noaa_mrms_qpe: "NOAA MRMS Quantitative Precipitation Estimate",
  nasa_gibs_modis_lst_day: "NASA GIBS MODIS Terra Daytime Land-Surface Temperature",
  noaa_uscrn_heat_exposure: "NOAA USCRN Heat Exposure",
  nws_station_observations: "NWS Station Observations",
  noaa_ncei_global_hourly: "NOAA NCEI Global Historical Climatology Network-hourly (GHCNh)",
  nasa_ecostress: "NASA ECOSTRESS Land Surface Temperature",
  nasa_gibs_modis_ndvi_16day: "NASA GIBS MODIS Terra 16-Day NDVI Visualization",
  nasa_smap: "NASA SMAP Soil Moisture Products",
  nifc_wfigs_fire_perimeters: "NIFC WFIGS Interagency Fire Perimeters",
  epa_aqs: "EPA Air Quality System",
  smithsonian_gvp_eruptions: "Smithsonian Global Volcanism Program Eruptions",
  nasa_tempo: "NASA TEMPO Atmospheric Composition Products",
  airnow: "AirNow Current Air Quality",
  airnow_daily_data: "AirNow Daily Air Quality Data",
  nasa_gibs_modis_aod: "NASA GIBS MODIS MAIAC Aerosol Optical Depth",
  nasa_lance_flood_extent: "NASA LANCE MODIS/VIIRS Global Flood Extent",
  noaa_nws_alerts: "U.S. National Weather Service Alerts",
  canada_cwfis_fire: "Canadian wildfire information",
  canada_geomet: "Environment and Climate Change Canada MSC GeoMet",
  canada_drought_monitor: "Canadian Drought Monitor",
  mexico_conabio_satif: "Mexico CONABIO Early Fire Warning System",
  mexico_conagua_hydrology: "Mexico CONAGUA Hydrologic and Flood Data",
  mexico_drought_monitor: "Monitor de Sequía en México",
  mexico_sinaica: "Mexico SINAICA Air Quality Information",
  nasa_gibs_omps_so2: "NASA GIBS NOAA-20 OMPS Sulfur Dioxide",
  usgs_earthquake_geojson: "USGS Earthquake Catalog",
  usgs_volcano_hans: "USGS Volcano Hazards Notification System (HANS)",
  us_drought_monitor_rest: "U.S. Drought Monitor",
  us_census_tigerweb_state_boundaries: "U.S. Census State and Territory Boundaries",
  earth_volcano_satellite_primary: "Satellite observations",
  ai_in_space_lab: "Educational example (not an evidence source)",
};

const PUBLIC_VARIABLE_NAMES: Readonly<Record<string, string>> = {
  fire_detections: "fire detections",
  smoke_area: "smoke coverage",
  smoke_density: "smoke density",
  wind_speed: "wind speed",
  "Canadian Drought Monitor source raster class": "Canadian Drought Monitor category",
  "Regional drought statistics response rows": "Regional drought records",
};

const PUBLIC_VARIABLE_NAMES_BY_LOWER = new Map(
  Object.entries(PUBLIC_VARIABLE_NAMES).map(([key, label]) => [key.toLocaleLowerCase("en-US"), label])
);

const PUBLIC_UNIT_NAMES: Readonly<Record<string, string>> = {
  coordinate_pairs: "source map points",
  degC: "°C",
  "m/s": "metres per second",
  kt: "knots",
  AQI: "air quality index",
  ft: "feet",
  m: "metres",
  in: "inches",
  percent: "%",
  mph: "mph",
  detections: "detections",
  records: "source records",
  magnitude: "magnitude",
  count: "count",
  category: "category",
  query_result_count: "source records",
  "km/h": "km/h",
  km2: "km²",
  "UG/M3": "µg/m³",
  "mm/hr": "mm/hr",
  "m³/m³": "m³/m³",
  "°C": "°C",
};

const UTC_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

const UTC_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZoneName: "short",
});

/** A stable, plain-language name for a registered source. */
export function publicSourceName(sourceId: unknown): string {
  if (typeof sourceId !== "string") return "Official data source";
  const entry = getRegistryEntry(sourceId);
  if (!entry) return "Official data source";
  return PUBLIC_SOURCE_NAMES[entry.sourceId];
}

/** Preserve professional organization names while hiding internal codes. */
export function publicAgencyName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "Official source organization";
  const trimmed = value.trim();
  if (
    /\b(?:obs|evd|intent|lim|src)-[a-z0-9_-]+\b/iu.test(trimmed) ||
    /\b(?:analysis|place)-[a-z0-9_-]{8,}\b/iu.test(trimmed) ||
    /\b[0-9a-f]{32,}\b/iu.test(trimmed) ||
    /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/iu.test(trimmed) ||
    /\.(?:csv|json|geojson|png|tiff?|kml|xml|psv|txt|zip|gz|pdf|nc|grib2?|hdf5?|parquet)\b/iu.test(trimmed)
  ) {
    return "Official source organization";
  }
  return trimmed;
}

/**
 * Preserve deliberately authored labels, map known internal names, and never
 * expose an unknown code-shaped value.
 */
export function publicVariableName(value: unknown): string {
  if (typeof value !== "string") return "reported condition";
  const trimmed = value.trim();
  if (!trimmed) return "reported condition";
  const mapped = PUBLIC_VARIABLE_NAMES[trimmed] ??
    PUBLIC_VARIABLE_NAMES_BY_LOWER.get(trimmed.toLocaleLowerCase("en-US"));
  if (mapped) return mapped;
  if (/^HMS fire detection coordinate pairs\b/iu.test(trimmed)) {
    return "Fire-detection source map points";
  }
  if (/^HMS smoke polygon coordinate pairs\b/iu.test(trimmed)) {
    return "Smoke-boundary source map points";
  }
  const localStormReport = trimmed.match(/^NWS Local Storm Report:\s*(.+)$/iu);
  if (localStormReport) return "National Weather Service local storm report";
  const outdoorAqi = trimmed.match(/^(.+?)\s+outdoor(?: daily)? AQI$/iu);
  if (outdoorAqi) {
    const pollutant = ({
      ozone: "ozone",
      "pm2.5": "fine-particle pollution (PM2.5)",
      pm10: "particle pollution (PM10)",
      co: "carbon monoxide",
      so2: "sulfur dioxide",
      no2: "nitrogen dioxide",
    } as const)[outdoorAqi[1].toLocaleLowerCase("en-US") as "ozone" | "pm2.5" | "pm10" | "co" | "so2" | "no2"] ?? "reported pollutant";
    return `${pollutant} outdoor air-quality index`;
  }
  const knownPollutant = ({
    ozone: "Ozone",
    "pm2.5": "Fine-particle pollution (PM2.5)",
    pm10: "Particle pollution (PM10)",
    "carbon monoxide": "Carbon monoxide",
    "sulfur dioxide": "Sulfur dioxide",
    "nitrogen dioxide": "Nitrogen dioxide",
  } as const)[trimmed.toLocaleLowerCase("en-US") as "ozone" | "pm2.5" | "pm10" | "carbon monoxide" | "sulfur dioxide" | "nitrogen dioxide"];
  if (knownPollutant) return knownPollutant;
  if (
    /\b(?:obs|evd|intent|lim|src)-[a-z0-9_-]+\b/iu.test(trimmed) ||
    /\b(?:analysis|place)-[a-z0-9_-]{8,}\b/iu.test(trimmed) ||
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu.test(trimmed) ||
    /\b[0-9a-f]{32,}\b/iu.test(trimmed) ||
    /^(?:[A-Za-z]:\\|\\\\|\/[^/])/u.test(trimmed) ||
    /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/u.test(trimmed) ||
    /\.(?:csv|json|geojson|png|tiff?|kml|xml|psv|txt|zip|gz|pdf|nc|grib2?|hdf5?|parquet)\b/iu.test(trimmed)
  ) {
    return "reported condition";
  }
  return trimmed;
}

/** Format reviewed public units while keeping unrecognized codes out of the UI. */
export function publicUnitName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "reported units";
  const trimmed = value.trim();
  const mapped = PUBLIC_UNIT_NAMES[trimmed];
  if (mapped) return mapped;
  if (/^[a-z0-9]+(?:[_/.-][a-z0-9]+)+$/iu.test(trimmed)) return "reported units";
  return trimmed;
}

/** Format a numeric reading with ordinary unit words and safe word order. */
export function publicObservationValue(value: unknown, unit: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Value not available";
  if (unit === "percent") return `${value}%`;
  if (unit === "magnitude") return `magnitude ${value}`;
  if (unit === "AQI") return `${value} on the air quality index`;
  if (unit === undefined || unit === null || unit === "") return String(value);
  return `${value} ${publicUnitName(unit)}`;
}

/** Format one valid instant in UTC without relying on the device time zone. */
export function formatUtcTimestamp(value: unknown): string {
  if (value === "unknown" || typeof value !== "string" || value.trim() === "") {
    return "Time not available";
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? UTC_DATE_TIME_FORMATTER.format(new Date(timestamp))
    : "Time not available";
}

/** Format one valid instant as a UTC calendar date. */
export function formatUtcDate(value: unknown): string {
  if (value === "unknown" || typeof value !== "string" || value.trim() === "") {
    return "Date not available";
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? `${UTC_DATE_FORMATTER.format(new Date(timestamp))} UTC`
    : "Date not available";
}

export const PUBLIC_ERROR_MESSAGES = {
  invalid_location: "We couldn't read the selected area. Please choose the place again.",
  invalid_date: "Choose a valid date from the available range.",
  unavailable_source: "This data source is not available right now. Please try again.",
  busy_source: "This data source is busy right now. Please try again shortly.",
  invalid_response: "The returned information could not be verified. Please try again.",
  no_match: "No matching information was found for this place and date.",
  unknown: "We couldn't complete this check. Please try again.",
} as const;

export type PublicErrorKind = keyof typeof PUBLIC_ERROR_MESSAGES;

/** Return only reviewed public copy; arbitrary error details never pass through. */
export function publicErrorMessage(error: unknown): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  const value = raw.toLocaleLowerCase("en-US");

  if (/(?:no[_ -]?observation|no[_ -]?match|not found)/u.test(value)) {
    return PUBLIC_ERROR_MESSAGES.no_match;
  }
  if (/(?:coordinate|bounding box|\bbbox\b|longitude|latitude|location|place)/u.test(value)) {
    return PUBLIC_ERROR_MESSAGES.invalid_location;
  }
  if (/(?:date|time range|timestamp|yyyy-mm-dd|\butc\b)/u.test(value)) {
    return PUBLIC_ERROR_MESSAGES.invalid_date;
  }
  if (/(?:rate.?limit|too many requests|\b429\b|busy)/u.test(value)) {
    return PUBLIC_ERROR_MESSAGES.busy_source;
  }
  if (/(?:credential|api key|access key|unauthori[sz]ed|forbidden|\b401\b|\b403\b)/u.test(value)) {
    return PUBLIC_ERROR_MESSAGES.unavailable_source;
  }
  if (/(?:timeout|timed out|abort|network|fetch|upstream|source.?failure|\b5\d\d\b)/u.test(value)) {
    return PUBLIC_ERROR_MESSAGES.unavailable_source;
  }
  if (/(?:malformed|schema|parse|structural|semantic|unexpected field|invalid response)/u.test(value)) {
    return PUBLIC_ERROR_MESSAGES.invalid_response;
  }
  return PUBLIC_ERROR_MESSAGES.unknown;
}

const PUBLIC_NARRATIVE_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bOfficial source raster class code \d+\b/giu, "The official drought map returned a category that this app cannot label safely"],
  [/\bbounded upstream schema retrieval\b/giu, "source check"],
  [/\bupstream retrieval\b/giu, "source check"],
  [/\bupstream request\b/giu, "source check"],
  [/\blive contract\b/giu, "available range"],
  [/\bvalidated schema\b/giu, "expected format"],
  [/\bschema\b/giu, "data format"],
  [/\bpayload\b/giu, "source response"],
  [/\bendpoint\b/giu, "service"],
  [/\bfixture\b/giu, "example data"],
];

function escapedPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const PUBLIC_SOURCE_ID_REPLACEMENTS = Object.entries(PUBLIC_SOURCE_NAMES).map(
  ([sourceId, label]) => [new RegExp(`\\b${escapedPattern(sourceId)}\\b`, "giu"), label] as const
);

const PUBLIC_REVIEWED_NARRATIVE_TEXT: Readonly<Record<string, string>> = {
  "NASA GIBS best-service layer IMERG_Precipitation_Rate; GetMap does not expose a numeric run or concept version":
    "NASA GIBS IMERG Precipitation Rate Visualization",
  "USGS Water Data OGC API v0 continuous values": "USGS Water Data Continuous Values",
  "NWS station observations (api.weather.gov)": "NWS Station Observations",
  "NOAA NCEI GHCNh Version 1 station-by-year PSV": "NOAA NCEI GHCNh Station Observations",
  "NOAA NCEI Storm Events Database details bulk CSV v1.0": "NOAA NCEI Storm Events Database",
  "EPA AQS sampleData/byBox validated sample data": "EPA Air Quality System Sample Data",
  "Smithsonian GVP Volcanoes of the World Holocene Eruptions WFS":
    "Smithsonian Global Volcanism Program Eruption Records",
  "USGS FDSN Earthquake Catalog GeoJSON": "USGS Earthquake Catalog",
  "Canadian Drought Monitor ArcGIS ImageServer": "Canadian Drought Monitor",
  "NOAA HMS Fire Detection Points KML": "NOAA HMS Fire Detection Points",
  "NOAA HMS Smoke Polygons KML": "NOAA HMS Smoke Polygons",
  "NOAA HMS Fire Detection Points Text": "NOAA HMS Fire Detection Points",
  "MODIS_Terra_Land_Surface_Temp_Day":
    "NASA GIBS MODIS Terra Daytime Land-Surface Temperature",
  "USCRN Heat01 v1.0": "NOAA USCRN Heat Exposure",
  VIIRS_SNPP_SP: "NASA FIRMS VIIRS Fire Detections",
  VIIRS_NOAA20_NRT: "NASA FIRMS VIIRS Fire Detections",
  "The public ImageServer is a rolling recent product, not a historical archive.":
    "This public source provides only recent observations, not a historical archive.",
  "The official service is migrating from CWFIS to CWFIF; the live schema and availability must be revalidated before this source becomes queryable.":
    "The official service is migrating from CWFIS to CWFIF. Its availability and data format must be checked again before this app can use it.",
  "No primary satellite source is selected or approved for this hazard in WP-02.":
    "No primary satellite source is currently selected or approved for this hazard.",
};

const PUBLIC_OBSERVATION_TEXT: Readonly<Record<string, string>> = {
  regional_aod_visualization_available:
    "Satellite haze imagery is available; no ground-level air-quality value was calculated.",
  regional_aerosol_visualization:
    "Satellite haze imagery is available; no ground-level air-quality value was calculated.",
  regional_so2_visualization_available:
    "Satellite sulfur dioxide imagery is available; no ground-level concentration was calculated.",
  regional_so2_visualization:
    "Satellite sulfur dioxide imagery is available; no ground-level concentration was calculated.",
  observed_earthquake_event_without_reported_magnitude:
    "An observed earthquake was reported without a magnitude.",
  official_activity_notice_returned: "An official volcano activity notice was returned.",
  regional_visualization_available:
    "Regional satellite imagery is available; no local condition was calculated.",
  regional_statistics_available: "Regional drought statistics are available.",
  no_regional_row_returned: "No matching regional drought record was returned.",
  synthetic_visualization_contract_fixture: "Example regional satellite imagery is available.",
  synthetic_regional_statistics_contract_fixture: "Example regional drought statistics are available.",
  visualization_available: "Satellite imagery is available; no numeric value was calculated.",
  flood_extent_visualization_available:
    "Satellite flood imagery is available; no water depth was calculated.",
  transparent_no_observation_not_no_flood:
    "No visible flood pixels were returned. This does not mean there was no flood.",
  no_active_fire: "No active fire detection was returned.",
};

/**
 * Make authored source notes safe for direct display without changing the
 * underlying record. Internal references are removed and common implementation
 * terms are translated at the final presentation boundary.
 */
export function publicNarrativeText(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "Details are not available.";
  const trimmed = value.trim();
  const reviewedNarrativeText = PUBLIC_REVIEWED_NARRATIVE_TEXT[trimmed];
  if (reviewedNarrativeText) return reviewedNarrativeText;
  if (/^NWS [A-Z]{3} Preliminary Local Storm Report$/u.test(trimmed)) {
    return "NWS Preliminary Local Storm Report";
  }
  const reviewedObservationText = PUBLIC_OBSERVATION_TEXT[trimmed];
  if (reviewedObservationText) return reviewedObservationText;
  const startedWithCapital = /^[A-Z]/u.test(trimmed);
  let text = trimmed;
  for (const [pattern, replacement] of PUBLIC_SOURCE_ID_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  text = text
    .replace(/\b(?:payload(?:Hash)?|hash)\s*[:=]?\s*[0-9a-f]{16,}\b/giu, "")
    .replace(/\b(?:obs|evd|intent|lim|src)-[a-z0-9_-]+\b/giu, "")
    .replace(/\b(?:analysis|place)-[a-z0-9_-]{8,}\b/giu, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, "")
    .replace(/\b[0-9a-f]{32,}\b/giu, "")
    .replace(/(?:[A-Za-z]:\\|\/)?(?:[^\s\\/]+[\\/])*[^\s\\/]+\.(?:csv|json|geojson|png|tiff?|kml|xml|psv|txt|zip|gz|pdf|nc|grib2?|hdf5?|parquet)\b/giu, "source file")
    .replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gu, "source detail")
    .replace(/\s+([.,;:])/gu, "$1")
    .replace(/\s{2,}/gu, " ");
  for (const [pattern, replacement] of PUBLIC_NARRATIVE_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  if (startedWithCapital && /^[a-z]/u.test(text)) {
    text = `${text[0].toUpperCase()}${text.slice(1)}`;
  }
  const publicText = text.trim();
  return publicText || "Details are not available.";
}
