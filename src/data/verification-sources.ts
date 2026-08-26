import type { ConcernType, HazardId } from "@/contracts/common";
import {
  type VerificationSource,
  type VerificationSourceId,
  type VerificationScopeId,
} from "@/contracts/verification-source";

const VERIFIED_AT = "2026-08-13";

export const VERIFICATION_SOURCES: readonly VerificationSource[] = [
  {
    id: "epa_airnow",
    label: "AirNow local air-quality checker",
    owner: "U.S. Environmental Protection Agency and AirNow partners",
    url: "https://www.airnow.gov/",
    kind: "checker",
    hazardIds: ["fire_smoke", "air_quality", "extreme_heat"],
    concernTypes: ["health", "pets", "community", "travel"],
    coverageLabel: "United States reporting areas",
    purpose: "Check current and forecast outdoor AQI for a location.",
    limitation: "AQI coverage and reporting times vary by location; this does not measure indoor exposure.",
    guidanceFacts: ["Current local outdoor air quality should be checked before making exposure-sensitive outdoor plans."],
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "epa_usfs_fire_smoke_map",
    label: "AirNow Fire and Smoke Map",
    owner: "U.S. Environmental Protection Agency and U.S. Forest Service",
    url: "https://fire.airnow.gov/",
    kind: "checker",
    hazardIds: ["fire_smoke", "air_quality"],
    coverageLabel: "North American fire and smoke context; local monitor coverage varies",
    purpose: "Inspect fire, smoke-plume, monitor, and sensor context for a location.",
    limitation: "A satellite smoke plume does not prove ground-level pollution at a specific place.",
    guidanceFacts: ["Smoke-plume imagery and ground-level air-quality readings answer different questions and should be checked separately."],
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "nws_weather",
    label: "National Weather Service local forecast and alerts",
    owner: "U.S. National Weather Service",
    url: "https://www.weather.gov/",
    kind: "checker",
    hazardIds: ["fire_smoke", "flood_storm", "extreme_heat", "drought_land"],
    coverageLabel: "United States and U.S. territories",
    purpose: "Check current official weather forecasts, watches, warnings, and local hazard information.",
    limitation: "This is an official forecast and alert entry point, not proof of conditions at one property.",
    guidanceFacts: ["Official local forecasts and alerts are the appropriate next check for current weather hazards."],
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "noaa_storm_events",
    label: "NOAA Storm Events Database",
    owner: "NOAA National Centers for Environmental Information",
    url: "https://www.ncei.noaa.gov/stormevents/",
    kind: "checker",
    hazardIds: ["flood_storm"],
    concernTypes: ["home", "community", "travel"],
    coverageLabel: "United States; event-type records and reporting periods vary",
    purpose: "Search official historical storm-event records, dates, locations, narratives, and reported damage.",
    limitation: "Records are delayed, geographically coarse, and cannot prove that a particular storm caused damage at one property.",
    guidanceFacts: ["A matching official event record can establish regional and temporal consistency, but property damage causation still requires inspection and local documentation."],
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "noaa_nwps",
    label: "NOAA National Water Prediction Service",
    owner: "U.S. National Oceanic and Atmospheric Administration",
    url: "https://water.noaa.gov/",
    kind: "checker",
    hazardIds: ["flood_storm"],
    coverageLabel: "United States; gauge, forecast, and inundation-map coverage varies",
    purpose: "Inspect official river observations, forecasts, flood categories, and available inundation maps.",
    limitation: "Flood inundation mapping is not available everywhere and a river forecast is not a property-level flood confirmation.",
    guidanceFacts: ["Official river forecasts and flood categories can help check where flooding may develop when local coverage exists."],
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "usgs_flood_inundation_mapper",
    label: "USGS Flood Inundation Mapper",
    owner: "U.S. Geological Survey",
    url: "https://apps.usgs.gov/fim/",
    kind: "checker",
    hazardIds: ["flood_storm"],
    coverageLabel: "Selected United States communities",
    purpose: "Inspect mapped flood-extent scenarios tied to supported stream stages.",
    limitation: "The maps cover limited locations and show stage scenarios, not universal real-time detected flooding.",
    guidanceFacts: ["A supported inundation map should be interpreted with the corresponding stream stage and forecast."],
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "nasa_lance_flood_viewer",
    label: "NASA LANCE FLOOD Viewer",
    owner: "NASA Land, Atmosphere Near real-time Capability for Earth observations",
    url: "https://lance.modaps.eosdis.nasa.gov/flood/viewer/",
    kind: "checker",
    hazardIds: ["flood_storm"],
    coverageLabel: "Global satellite coverage where cloud and observation conditions permit",
    purpose: "Inspect recent satellite-derived flood and surface-water imagery.",
    limitation: "The approximately 250 metre product can contain cloud-shadow and other false positives and must be checked against imagery and official local information.",
    guidanceFacts: ["Satellite flood and surface-water imagery is regional evidence and should be checked against visible imagery and official local sources."],
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "houston_transtar_traffic",
    label: "Houston TranStar live traffic map",
    owner: "Houston TranStar public-agency partnership",
    url: "https://traffic.houstontranstar.org/layers/?hl=en-US",
    kind: "checker",
    hazardIds: ["flood_storm"],
    concernTypes: ["travel"],
    scopeIds: ["greater_houston"],
    coverageLabel: "Greater Houston monitored roads; current coverage varies by roadway",
    purpose: "Check current speeds, incidents, high-water reports, road closures, cameras, and roadway-flood risk.",
    limitation: "Current traffic and weather layers can show conditions at the same time, but do not by themselves prove that weather caused a particular delay.",
    guidanceFacts: [
      "Flooding or high water can disrupt traffic and close roads; check traffic, incident, high-water, and closure layers separately.",
      "Traffic and weather shown at the same time do not by themselves establish the cause of a specific delay.",
    ],
    lastVerifiedAt: "2026-08-14",
  },
  {
    id: "houston_transtar_speed_archive",
    label: "Houston TranStar historical speed map archive",
    owner: "Houston TranStar public-agency partnership",
    url: "https://traffic.houstontranstar.org/map_archive/",
    kind: "checker",
    hazardIds: ["flood_storm"],
    concernTypes: ["travel"],
    scopeIds: ["greater_houston"],
    coverageLabel: "Greater Houston monitored roads; archived speed maps from January 2012 onward",
    purpose: "Check archived speed and travel-time maps for a user-selected date and time.",
    limitation: "The archive covers monitored roads and shows traffic conditions, but does not by itself prove that weather caused them.",
    guidanceFacts: [
      "Use the selected date and time to inspect archived speeds and travel times when the question is about past traffic.",
      "Compare traffic timing with validated weather records without treating timing alone as proof of causation.",
    ],
    lastVerifiedAt: "2026-08-14",
  },
  {
    id: "inciweb_incidents",
    label: "InciWeb active incident information",
    owner: "U.S. interagency incident management partners",
    url: "https://inciweb.wildfire.gov/accessible-view",
    kind: "incident_information",
    hazardIds: ["fire_smoke"],
    concernTypes: ["home", "travel", "community", "power_internet"],
    coverageLabel: "United States participating incidents",
    purpose: "Check official interagency incident updates, closures, maps, and announcements.",
    limitation: "Not every thermal anomaly is an InciWeb incident and incident postings can lag detections.",
    guidanceFacts: ["Official incident pages are the appropriate place to check named incidents, closures, and local announcements."],
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "usdm_map_viewer",
    label: "U.S. Drought Monitor Map Viewer",
    owner: "National Drought Mitigation Center and partner agencies",
    url: "https://droughtmonitor.unl.edu/Maps/MapViewer.aspx",
    kind: "checker",
    hazardIds: ["drought_land"],
    coverageLabel: "United States",
    purpose: "Inspect current and historical weekly U.S. Drought Monitor classifications.",
    limitation: "The weekly regional assessment is not a forecast or property-level water-availability finding.",
    guidanceFacts: ["Weekly drought classifications describe regional conditions rather than a specific property."],
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "drought_gov",
    label: "Drought.gov current conditions",
    owner: "U.S. National Integrated Drought Information System",
    url: "https://www.drought.gov/",
    kind: "checker",
    hazardIds: ["drought_land"],
    coverageLabel: "United States",
    purpose: "Check current official drought conditions, outlook context, and regional resources.",
    limitation: "Available products use different update times and spatial scales.",
    guidanceFacts: ["Current drought status should be checked at the regional scale and with each product's update date."],
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "cdc_heat_pets",
    label: "CDC Heat and Pets guidance",
    owner: "U.S. Centers for Disease Control and Prevention",
    url: "https://www.cdc.gov/heat-health/risk-factors/heat-and-pets.html",
    kind: "guidance",
    hazardIds: ["extreme_heat"],
    concernTypes: ["pets"],
    coverageLabel: "General public-health guidance; local conditions require a local checker",
    purpose: "Review official guidance about pets during hot weather and the local conditions to check.",
    limitation: "General guidance is not veterinary diagnosis and does not determine an individual animal's condition.",
    guidanceFacts: ["Hot-weather planning for pets should use current local conditions and avoid treating regional satellite surface temperature as an individual health assessment."],
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "nws_heatrisk",
    label: "NWS HeatRisk forecast",
    owner: "U.S. National Weather Service / Weather Prediction Center",
    url: "https://www.wpc.ncep.noaa.gov/heatrisk/",
    kind: "checker",
    hazardIds: ["extreme_heat"],
    coverageLabel: "United States; coverage and product status vary by region",
    purpose: "Check the official color-coded heat-risk outlook for a location over the coming days.",
    limitation: "A regional heat-risk forecast is not indoor temperature, an individual medical assessment, or a property-level finding.",
    guidanceFacts: ["The official heat-risk outlook is the appropriate next check when planning heat-sensitive outdoor activity, work, or travel."],
    lastVerifiedAt: "2026-08-20",
  },
  {
    id: "heat_gov",
    label: "Heat.gov heat and health information",
    owner: "U.S. National Integrated Heat Health Information System",
    url: "https://www.heat.gov/",
    kind: "guidance",
    hazardIds: ["extreme_heat"],
    coverageLabel: "United States; national guidance with links to local tools",
    purpose: "Review official heat-health guidance, current heat maps, and planning resources.",
    limitation: "National guidance and regional maps do not measure one household, vehicle, or person.",
    guidanceFacts: ["Official heat-health guidance should be combined with the current local forecast rather than replacing it."],
    lastVerifiedAt: "2026-08-20",
  },
] as const;

const BY_ID = new Map(VERIFICATION_SOURCES.map((source) => [source.id, source]));

export function getVerificationSource(id: VerificationSourceId): VerificationSource {
  const source = BY_ID.get(id);
  if (!source) throw new Error(`Unknown verification source: ${id}`);
  return source;
}

export function eligibleVerificationSources(
  hazardId: HazardId,
  concern: ConcernType,
  scopeIds: readonly VerificationScopeId[] = []
): VerificationSource[] {
  const matchedScopes = new Set(scopeIds);
  return VERIFICATION_SOURCES.filter((source) =>
    source.hazardIds.includes(hazardId) &&
    (!source.concernTypes || source.concernTypes.includes(concern)) &&
    (!source.scopeIds || source.scopeIds.some((scopeId) => matchedScopes.has(scopeId)))
  );
}

export function defaultVerificationSourceIds(
  hazardId: HazardId,
  concern: ConcernType,
  scopeIds: readonly VerificationScopeId[] = []
): VerificationSourceId[] {
  if (hazardId === "fire_smoke") {
    return concern === "health" || concern === "pets"
      ? ["epa_airnow", "epa_usfs_fire_smoke_map"]
      : ["inciweb_incidents", "epa_usfs_fire_smoke_map"];
  }
  if (hazardId === "flood_storm") {
    if (concern === "travel" && scopeIds.includes("greater_houston")) {
      return [
        "houston_transtar_traffic",
        "houston_transtar_speed_archive",
        "noaa_nwps",
      ];
    }
    return ["noaa_nwps", "nasa_lance_flood_viewer"];
  }
  if (hazardId === "extreme_heat") {
    if (concern === "pets") return ["nws_weather", "cdc_heat_pets", "epa_airnow"];
    // Travel plans need a forward-looking official check, so the HeatRisk
    // outlook and heat.gov guidance ride alongside the local forecast.
    if (concern === "travel") return ["nws_weather", "nws_heatrisk", "heat_gov"];
    return ["nws_weather", "nws_heatrisk"];
  }
  if (hazardId === "drought_land") return ["usdm_map_viewer", "drought_gov"];
  if (hazardId === "air_quality") return ["epa_airnow"];
  return [];
}
