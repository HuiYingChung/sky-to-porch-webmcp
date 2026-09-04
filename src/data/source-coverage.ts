import type { HazardId } from "@/contracts/common";
import type { SourceId } from "@/contracts/dataset-registry";
import type { SourceCoverageProfile } from "@/contracts/source-coverage";
import { getRegistryEntry } from "@/data/dataset-registry";

export const HAZARD_LABELS: Record<HazardId, string> = {
  fire_smoke: "Fire & Smoke",
  flood_storm: "Flood & Heavy Rain",
  wind_storm: "Wind & Storm",
  extreme_heat: "Extreme Heat",
  drought_land: "Drought & Land",
  air_quality: "Air Quality",
  earth_volcanoes: "Earth & Volcanoes",
};

export const COVERAGE_STATUS_LABELS: Record<
  SourceCoverageProfile["integrationStatus"],
  string
> = {
  live_integrated: "Live integrated",
  live_key_required: "Live · server key required",
  prepared_for_live: "Prepared · live smoke pending",
  registered_deferred: "Registered candidate",
  supporting_only: "Supporting only",
};

const PROFILES: SourceCoverageProfile[] = [
  {
    sourceId: "nasa_firms",
    publicName: "NASA FIRMS Active Fire Data",
    hazardIds: ["fire_smoke"],
    level: "global",
    kind: "satellite",
    integrationStatus: "live_key_required",
    evidenceRole: "primary",
    regionLabel: "Global",
    countryCodes: [],
    temporalCoverage: "Near-real-time and bounded historical requests",
    updateCadence: "Typically within hours of satellite acquisition",
    spatialResolution: "VIIRS 375 m detection pixels; MODIS 1 km products also exist",
    coverageNote: "Global thermal anomalies. They are not incident perimeters or severity.",
    liveGateNote: "Integrated server path; a private FIRMS map key must remain server-only.",
    satellite: { platform: "Suomi-NPP / NOAA-20 / NOAA-21", sensor: "VIIRS", product: "FIRMS active-fire detections" },
  },
  {
    sourceId: "noaa_hms_fire_points",
    publicName: "NOAA HMS Fire Detection Points",
    hazardIds: ["fire_smoke"],
    level: "north_america",
    kind: "satellite",
    integrationStatus: "live_integrated",
    evidenceRole: "primary",
    regionLabel: "North America",
    countryCodes: ["US", "CA", "MX"],
    temporalCoverage: "Historical daily archive",
    updateCadence: "Daily product with analyst-processing delay",
    spatialResolution: "Detection-point scale varies by contributing sensor",
    coverageNote: "Credential-free North American fire detections; not tactical fire truth.",
    liveGateNote: "Integrated with deterministic KML validation and bounded requests.",
    satellite: { platform: "Multiple polar and geostationary satellites", sensor: "HMS contributing sensors", product: "HMS fire detection points" },
    lastVerifiedDate: "2026-08-27",
  },
  {
    sourceId: "noaa_hms_smoke_polygons",
    publicName: "NOAA HMS Smoke Polygons",
    hazardIds: ["fire_smoke"],
    level: "north_america",
    kind: "satellite",
    integrationStatus: "live_integrated",
    evidenceRole: "supporting",
    regionLabel: "North America",
    countryCodes: ["US", "CA", "MX"],
    temporalCoverage: "Historical daily archive",
    updateCadence: "Daily product with analyst-processing delay",
    spatialResolution: "Regional analyst-drawn smoke polygons",
    coverageNote: "Smoke density context, not AQI or indoor air quality.",
    liveGateNote: "Integrated with deterministic KML validation and separated smoke claims.",
    satellite: { platform: "Multiple satellites", sensor: "HMS contributing imagery", product: "HMS smoke polygons" },
    lastVerifiedDate: "2026-08-27",
  },
  {
    sourceId: "canada_cwfis_fire",
    publicName: "Canadian Wildland Fire Information System",
    hazardIds: ["fire_smoke"],
    level: "national",
    kind: "blended_official",
    integrationStatus: "prepared_for_live",
    evidenceRole: "supporting",
    regionLabel: "Canada",
    countryCodes: ["CA"],
    temporalCoverage: "Current-season and historical products vary by layer",
    updateCadence: "Daily or near-real-time by layer",
    spatialResolution: "Points, agency incidents, grids, and estimated polygons",
    coverageNote: "Separates agency-reported fires, hotspots, danger ratings, and perimeter estimates.",
    liveGateNote: "The replacement CWFIF layer is identified, but official migration and temporary service availability prevent a truthful live schema gate.",
  },
  {
    sourceId: "nifc_wfigs_fire_perimeters",
    publicName: "NIFC WFIGS Interagency Fire Perimeters",
    hazardIds: ["fire_smoke"],
    level: "national",
    kind: "official_event",
    integrationStatus: "live_integrated",
    evidenceRole: "supporting",
    regionLabel: "United States · WFIGS 2020-present",
    countryCodes: ["US"],
    temporalCoverage: "Incident perimeters from 2020 onward where agencies publish them",
    updateCadence: "Incident-driven; publication timing varies",
    spatialResolution: "Official incident perimeter polygons",
    coverageNote: "Perimeter context is separate from satellite detections, smoke, parcel damage, and tactical truth.",
    liveGateNote: "Integrated with exact selected-envelope intersection, incident-date filtering, record caps, and fail-closed ArcGIS validation.",
    lastVerifiedDate: "2026-08-30",
  },
  {
    sourceId: "mexico_conabio_satif",
    publicName: "Mexico CONABIO Early Fire Warning System",
    hazardIds: ["fire_smoke"],
    level: "national",
    kind: "satellite",
    integrationStatus: "registered_deferred",
    evidenceRole: "supporting",
    regionLabel: "Mexico",
    countryCodes: ["MX"],
    temporalCoverage: "Near-real-time program",
    updateCadence: "Near-real-time when satellite reception and processing permit",
    spatialResolution: "MODIS, VIIRS, and AVHRR detection scales",
    coverageNote: "Official Mexican satellite-fire program; this app cannot check it automatically yet.",
    liveGateNote: "Needs a stable documented endpoint, schema, and reuse policy.",
    satellite: { platform: "Terra / Aqua / Suomi-NPP / NOAA-20", sensor: "MODIS / VIIRS / AVHRR", product: "SATIF active-fire monitoring" },
  },
  {
    sourceId: "nasa_lance_flood_extent",
    publicName: "NASA LANCE MODIS/VIIRS Global Flood Extent",
    hazardIds: ["flood_storm"],
    level: "global",
    kind: "satellite",
    integrationStatus: "live_integrated",
    evidenceRole: "primary",
    regionLabel: "Global · North America first",
    countryCodes: [],
    temporalCoverage: "Completed-date VIIRS 3-day composite imagery where the product publishes coverage",
    updateCadence: "Daily, normally within the LANCE near-real-time window",
    spatialResolution: "Approximately 250 m",
    coverageNote: "Regional flood-extent visualization, distinct from rain and river-gage evidence; colors are not converted into depth or property impact.",
    liveGateNote: "The exact VIIRS 3-day WMS path and transparent no-observation state passed the bounded live gate; legend colors remain uninterpreted.",
    satellite: { platform: "NOAA-20 / NOAA-21", sensor: "VIIRS", product: "VCDWD 3-day global flood composite" },
    lastVerifiedDate: "2026-08-30",
  },
  {
    sourceId: "nws_tropical_cyclone_report",
    publicName: "NWS Post-Tropical Cyclone Report: Hurricane Beryl",
    hazardIds: ["wind_storm"],
    level: "regional",
    kind: "official_event",
    integrationStatus: "supporting_only",
    evidenceRole: "supporting",
    regionLabel: "NWS Houston/Galveston reporting area · Hurricane Beryl 2024",
    countryCodes: ["US"],
    temporalCoverage: "Pinned July 8, 2024 post-event report",
    updateCadence: "Published after the event; historical context only",
    spatialResolution: "Regional report with named stations; never property scale",
    coverageNote:
      "Official Beryl event context and named regional gust observations. The report does not " +
      "establish wind or damage at a selected home.",
    liveGateNote:
      "The pinned NWS Houston report and event page were verified on 2026-08-27. The adapter " +
      "adds this historical context only when the selected geometry overlaps the governed " +
      "Southeast Texas reporting box and the requested date is 2024-07-08.",
    lastVerifiedDate: "2026-08-27",
  },
  {
    sourceId: "nhc_hurdat2",
    publicName: "NHC HURDAT2 Best Track",
    hazardIds: ["wind_storm"],
    level: "regional",
    kind: "official_event",
    integrationStatus: "live_integrated",
    evidenceRole: "supporting",
    regionLabel: "Atlantic and Northeast Pacific basins",
    countryCodes: [],
    temporalCoverage: "Atlantic 1851-present publication; Northeast Pacific 1949-present publication",
    updateCadence: "Post-analysis annual best-track publication",
    spatialResolution: "Six-hour tropical-cyclone center track points",
    coverageNote: "A best-track center point is not a storm wind footprint or property observation.",
    liveGateNote: "Integrated with dynamic official-file discovery, bounded text parsing, exact date and in-area center-point filtering.",
    lastVerifiedDate: "2026-08-30",
  },
  {
    sourceId: "nasa_gibs_imerg",
    publicName: "NASA GIBS IMERG Precipitation Rate Visualization",
    hazardIds: ["flood_storm"],
    level: "global",
    kind: "satellite",
    integrationStatus: "live_integrated",
    evidenceRole: "supporting",
    regionLabel: "Global",
    countryCodes: [],
    temporalCoverage: "IMERG-era historical and recent completed dates",
    updateCadence: "Half-hourly product; application uses bounded date imagery",
    spatialResolution: "Regional precipitation raster visualization",
    coverageNote: "Rain context only. It is never labelled flood extent.",
    liveGateNote: "Integrated with visual-only claims and transparent/no-data handling.",
    satellite: { platform: "GPM constellation", sensor: "Multiple precipitation sensors", product: "IMERG precipitation rate" },
    lastVerifiedDate: "2026-08-30",
  },
  {
    sourceId: "noaa_mrms_qpe",
    publicName: "NOAA MRMS Quantitative Precipitation Estimate",
    hazardIds: ["flood_storm"],
    level: "national",
    kind: "blended_official",
    integrationStatus: "live_integrated",
    evidenceRole: "supporting",
    regionLabel: "United States MRMS domains",
    countryCodes: ["US"],
    temporalCoverage: "Rolling recent raster catalog only",
    updateCadence: "Operational rolling products",
    spatialResolution: "Approximately 1 km source raster; application samples the selected-area center",
    coverageNote: "Numeric radar-only precipitation estimate, not a historical archive or flood-depth observation.",
    liveGateNote: "Integrated with declared-valid-period overlap, locked raster ID, finite-value checks, and explicit NoData handling.",
    lastVerifiedDate: "2026-08-30",
  },
  {
    sourceId: "usgs_instantaneous_values",
    publicName: "USGS Water Data Continuous Values",
    hazardIds: ["flood_storm"],
    level: "national",
    kind: "ground_station",
    integrationStatus: "live_integrated",
    evidenceRole: "supporting",
    regionLabel: "United States",
    countryCodes: ["US"],
    temporalCoverage: "Recent and historical station observations",
    updateCadence: "Often about 15 minutes; telemetry delays vary",
    spatialResolution: "Named monitoring stations",
    coverageNote: "Gage height is evidence, not a flood polygon or universal threshold.",
    liveGateNote: "Integrated with station discovery, units, time, provenance, and provisional-data limits.",
    lastVerifiedDate: "2026-08-30",
  },
  {
    sourceId: "noaa_ncei_storm_events",
    publicName: "NOAA NCEI Storm Events Database",
    hazardIds: ["flood_storm", "wind_storm"],
    level: "national",
    kind: "official_event",
    integrationStatus: "live_integrated",
    evidenceRole: "supporting",
    regionLabel: "United States",
    countryCodes: ["US"],
    temporalCoverage: "Historical event records; reporting periods vary by event type",
    updateCadence: "Periodic NCEI bulk publication with a reporting delay",
    spatialResolution: "County- or zone-scale event records; never property scale",
    coverageNote:
      "Official historical storm-event context for documented weather events. Records are " +
      "delayed and geographically coarse, and they never prove that a storm caused damage at " +
      "one property.",
    liveGateNote:
      "The adapter discovers the latest official annual details publication, bounds compressed and decompressed bytes, parses quoted CSV, and accepts only matching event dates and reported coordinates inside the selected geometry.",
    lastVerifiedDate: "2026-09-04",
  },
  {
    sourceId: "nws_local_storm_reports",
    publicName: "NWS Preliminary Local Storm Reports",
    hazardIds: ["flood_storm", "wind_storm"],
    level: "national",
    kind: "official_event",
    integrationStatus: "live_integrated",
    evidenceRole: "supporting",
    regionLabel: "United States · applicable NWS forecast offices",
    countryCodes: ["US"],
    temporalCoverage: "Recent preliminary event reports in the bounded live products index",
    updateCadence: "Event-driven and normally issued close to real time",
    spatialResolution: "Reported event coordinates; never property-scale certainty",
    coverageNote:
      "Preliminary official event reports, separated by water versus wind/severe-weather type and filtered to the exact selected area.",
    liveGateNote:
      "The bounded points → office → LSR products path and the Houston 2026-08-28 Flash Flood report passed the live schema smoke. Empty recent indexes remain no observation, never no storm.",
    lastVerifiedDate: "2026-08-30",
  },
  {
    sourceId: "canada_geomet",
    publicName: "Environment and Climate Change Canada MSC GeoMet",
    hazardIds: ["flood_storm"],
    level: "national",
    kind: "ground_station",
    integrationStatus: "live_integrated",
    evidenceRole: "supporting",
    regionLabel: "Canada",
    countryCodes: ["CA"],
    temporalCoverage: "Archived daily means and recent completed daily records",
    updateCadence: "Daily; publication and quality-review timing varies by station",
    spatialResolution: "In-area hydrometric stations",
    coverageNote:
      "Official Canadian hydrometric daily-mean station levels; a station value is not a flood threshold or property-level finding.",
    liveGateNote:
      "Integrated with bounded bbox/date retrieval, exact schema and in-area coordinate validation, deterministic nearest-station selection, and fail-closed pagination limits.",
    lastVerifiedDate: "2026-08-26",
  },
  {
    sourceId: "mexico_conagua_hydrology",
    publicName: "Mexico CONAGUA Hydrologic and Flood Data",
    hazardIds: ["flood_storm", "extreme_heat"],
    level: "national",
    kind: "ground_station",
    integrationStatus: "registered_deferred",
    evidenceRole: "supporting",
    regionLabel: "Mexico",
    countryCodes: ["MX"],
    temporalCoverage: "Collection-specific recent and historical files",
    updateCadence: "Hourly, daily, monthly, or static by collection",
    spatialResolution: "Stations and published flood-zone files",
    coverageNote: "Official open-data collections exist, but current extent and station semantics differ.",
    liveGateNote: "Needs one supported collection per claim, freshness rules, and bounded parsers.",
  },
  {
    sourceId: "nasa_gibs_modis_lst_day",
    publicName: "NASA GIBS MODIS Terra Daytime Land-Surface Temperature",
    hazardIds: ["extreme_heat"],
    level: "global",
    kind: "satellite",
    integrationStatus: "live_integrated",
    evidenceRole: "primary",
    regionLabel: "Global",
    countryCodes: [],
    temporalCoverage: "Daily completed-date imagery",
    updateCadence: "Daily daytime overpass product",
    spatialResolution: "GIBS visualization tile; source product is regional, not property scale",
    coverageNote: "Land-surface temperature visualization, not air or indoor temperature.",
    liveGateNote: "Integrated for arbitrary selected areas with visual-only safeguards.",
    satellite: { platform: "Terra", sensor: "MODIS", product: "Daytime land-surface temperature" },
    lastVerifiedDate: "2026-08-27",
  },
  {
    sourceId: "noaa_uscrn_heat_exposure",
    publicName: "NOAA USCRN Heat Exposure",
    hazardIds: ["extreme_heat"],
    level: "national",
    kind: "ground_station",
    integrationStatus: "live_integrated",
    evidenceRole: "supporting",
    regionLabel: "United States · 156 operational allowlisted USCRN Heat01 stations",
    countryCodes: ["US"],
    temporalCoverage: "Hourly Heat01 rows for completed UTC dates at the selected station",
    updateCadence: "Hourly station observations published in the NCEI Heat01 product file",
    spatialResolution:
      "Named outdoor stations; USCRN sites are rural reference locations, so many metro areas " +
      "have no station inside a selected box",
    coverageNote:
      "Hourly outdoor air temperature and NOAA-derived heat index from one named USCRN station. " +
      "One outdoor station is never indoor temperature, household certainty, or individual evidence.",
    liveGateNote:
      "ADR-0037: the allowlist is every OPERATIONAL USCRN station publishing a Heat01 file " +
      "(generated from the official station registry; closed stations keep stale files and are " +
      "excluded). The station nearest to the selected area center is retrieved when its " +
      "coordinate lies inside the area; otherwise the no-station limitation stays visible.",
    lastVerifiedDate: "2026-08-27",
  },
  {
    sourceId: "nws_station_observations",
    publicName: "NWS Station Observations",
    hazardIds: ["extreme_heat"],
    level: "national",
    kind: "ground_station",
    integrationStatus: "live_integrated",
    evidenceRole: "supporting",
    regionLabel: "United States · NWS observation network (metro coverage, recent dates)",
    countryCodes: ["US"],
    temporalCoverage: "Roughly the last seven days of station observations (verified 2026-08-19)",
    updateCadence: "Hourly METAR-cadence observations plus specials, published continuously",
    spatialResolution:
      "Named outdoor stations (airports and partners); the in-area station nearest to the " +
      "selected area center is used",
    coverageNote:
      "Hourly outdoor air temperature with the NWS-computed heat index when the service " +
      "produced one. One outdoor station is never indoor temperature, household certainty, or " +
      "individual evidence.",
    liveGateNote:
      "ADR-0038: consulted only when no operational USCRN station lies inside the selected " +
      "area and the requested date is within the observation window; dates outside the window " +
      "carry an explicit retention limitation.",
    lastVerifiedDate: "2026-08-19",
  },
  {
    sourceId: "noaa_ncei_global_hourly",
    publicName: "NOAA NCEI Global Historical Climatology Network-hourly (GHCNh)",
    hazardIds: ["extreme_heat", "wind_storm"],
    level: "global",
    kind: "ground_station",
    integrationStatus: "live_integrated",
    evidenceRole: "supporting",
    regionLabel: "Global GHCNh station inventory (historical dates)",
    countryCodes: [],
    temporalCoverage:
      "Station history up to roughly four weeks behind real time (by-year publication lag, " +
      "verified 2026-08-19)",
    updateCadence: "Hourly/synoptic observations; by-year files regenerated on a lagging cycle",
    spatialResolution:
      "Named outdoor stations; the in-area station nearest to the selected area center is " +
      "used, with bounded next-nearest fallback",
    coverageNote:
      "Hourly outdoor air temperature, relative humidity, wind speed, and wind gust fields " +
      "from one named GHCNh station. NOAA publishes no heat index in this product and none is " +
      "derived. One station is never property-level or individual evidence.",
    liveGateNote:
      "The global official station inventory is parsed with bounded in-area selection and exact-field validation; Heat and Wind & Storm share the same coordinate-authoritative fallback.",
    lastVerifiedDate: "2026-08-30",
  },
  {
    sourceId: "nasa_gibs_modis_ndvi_16day",
    publicName: "NASA GIBS MODIS Terra 16-Day NDVI Visualization",
    hazardIds: ["drought_land"],
    level: "global",
    kind: "satellite",
    integrationStatus: "live_integrated",
    evidenceRole: "primary",
    regionLabel: "Global selected areas",
    countryCodes: [],
    temporalCoverage: "16-day composites on completed dates",
    updateCadence: "Every 16 days",
    spatialResolution: "250 m source product",
    coverageNote: "Vegetation visualization only; it is not a numeric drought or property assessment.",
    liveGateNote: "Custom-area request path is integrated; the fixed New York smoke passed, but it is not universal date/area proof.",
    satellite: { platform: "Terra", sensor: "MODIS", product: "L3 NDVI 16-day v6.1" },
    lastVerifiedDate: "2026-08-27",
  },
  {
    sourceId: "us_drought_monitor_rest",
    publicName: "U.S. Drought Monitor",
    hazardIds: ["drought_land"],
    level: "national",
    kind: "blended_official",
    integrationStatus: "live_integrated",
    evidenceRole: "supporting",
    regionLabel: "United States states and supported territories",
    countryCodes: ["US"],
    temporalCoverage: "Weekly Tuesday map-valid dates",
    updateCadence: "Weekly",
    spatialResolution: "State or territory percent-of-area; never property scale",
    coverageNote: "Weekly state or territory percent-of-area context resolved from the canonical selection; it is never property-scale evidence.",
    liveGateNote: "Census geometry resolution and a non-Arizona territory request passed the bounded live gate; no returned row remains no observation, not no drought.",
    lastVerifiedDate: "2026-08-27",
  },
  {
    sourceId: "canada_drought_monitor",
    publicName: "Canadian Drought Monitor",
    hazardIds: ["drought_land"],
    level: "national",
    kind: "blended_official",
    integrationStatus: "live_integrated",
    evidenceRole: "supporting",
    regionLabel: "Canada except stated Arctic gaps",
    countryCodes: ["CA"],
    temporalCoverage: "2002 onward in the image service",
    updateCadence: "Monthly, usually by the 10th for the prior month",
    spatialResolution: "5 km image-service pixels",
    coverageNote: "Official Canadian national drought classification.",
    liveGateNote: "Integrated with official monthly catalog selection, locked-raster center sampling, and source class-code preservation without guessing an unverified label mapping.",
    lastVerifiedDate: "2026-08-30",
  },
  {
    sourceId: "mexico_drought_monitor",
    publicName: "Mexico Drought Monitor",
    hazardIds: ["drought_land"],
    level: "national",
    kind: "blended_official",
    integrationStatus: "registered_deferred",
    evidenceRole: "supporting",
    regionLabel: "Mexico",
    countryCodes: ["MX"],
    temporalCoverage: "National product since 2014; North American work began earlier",
    updateCadence: "Approximately twice monthly",
    spatialResolution: "National polygons, state and municipality summaries",
    coverageNote: "Official product, but automated polygon access is not yet supported.",
    liveGateNote: "Needs supported machine distribution or a legally retained fixture path.",
  },
  {
    sourceId: "nasa_gibs_modis_aod",
    publicName: "NASA GIBS MODIS MAIAC Aerosol Optical Depth",
    hazardIds: ["air_quality", "fire_smoke"],
    level: "global",
    kind: "satellite",
    integrationStatus: "live_integrated",
    evidenceRole: "primary",
    regionLabel: "Global land observations",
    countryCodes: [],
    temporalCoverage: "Daily ongoing product",
    updateCadence: "Daily",
    spatialResolution: "1 km MAIAC source product",
    coverageNote: "Aerosol optical depth context. It is never converted into AQI or PM2.5 by color.",
    liveGateNote:
      "The exact MAIAC WMS path passed the bounded live gate and is queried through the canonical-area route with bounded cache and concurrency; image colors are not converted to AQI.",
    satellite: { platform: "Terra and Aqua", sensor: "MODIS", product: "MAIAC aerosol optical depth" },
    lastVerifiedDate: "2026-08-27",
  },
  {
    sourceId: "airnow",
    publicName: "AirNow Current Air Quality",
    hazardIds: ["air_quality", "fire_smoke"],
    level: "national",
    kind: "ground_station",
    integrationStatus: "prepared_for_live",
    evidenceRole: "supporting",
    regionLabel: "United States and participating North American reporting areas",
    countryCodes: ["US"],
    temporalCoverage: "Current and historical records",
    updateCadence: "Observations hourly; forecasts generally daily",
    spatialResolution: "Monitoring sites and reporting areas",
    coverageNote: "Official outdoor AQI source; reporting areas are not property or indoor measurements.",
    liveGateNote:
      "The Query route keeps the credential gate closed. API key approval, bounded cache, per-key limits, and rotated server-only secret handling are required before retrieval.",
  },
  {
    sourceId: "airnow_daily_data",
    publicName: "AirNow Daily Air Quality Data",
    hazardIds: ["air_quality", "fire_smoke"],
    level: "national",
    kind: "ground_station",
    integrationStatus: "live_integrated",
    evidenceRole: "supporting",
    regionLabel: "United States and participating international monitoring sites; this app uses U.S. records",
    countryCodes: ["US"],
    temporalCoverage: "Historical daily records, with a separate source for today",
    updateCadence: "Current and previous days update twice hourly; older dates retain the last daily publication",
    spatialResolution: "Outdoor monitoring sites",
    coverageNote: "Preliminary daily outdoor AQI summaries. Site data are not indoor, personal-exposure, medical, or regulatory findings.",
    liveGateNote:
      "One Houston historical-date cell passed the bounded live gate. The product route queries " +
      "the nationwide daily file and reports geographically filtered observations, no observation, " +
      "or source failure; it does not treat the Houston pass as nationwide station coverage proof.",
    lastVerifiedDate: "2026-08-27",
  },
  {
    sourceId: "epa_aqs",
    publicName: "EPA Air Quality System",
    hazardIds: ["air_quality"],
    level: "national",
    kind: "ground_station",
    integrationStatus: "live_key_required",
    evidenceRole: "supporting",
    regionLabel: "United States regulatory monitoring network",
    countryCodes: ["US"],
    temporalCoverage: "Validated historical samples; publication can lag six months or more",
    updateCadence: "Validation and certification dependent",
    spatialResolution: "Named outdoor monitoring stations",
    coverageNote: "Validated outdoor station samples remain separate from preliminary AirNow and satellite AOD.",
    liveGateNote: "Server-only EPA_AQS_EMAIL and EPA_AQS_KEY gate; bounded by-box PM2.5 parsing fails closed and never exposes credentials.",
  },
  {
    sourceId: "mexico_sinaica",
    publicName: "Mexico SINAICA Air Quality Information",
    hazardIds: ["air_quality"],
    level: "national",
    kind: "ground_station",
    integrationStatus: "registered_deferred",
    evidenceRole: "supporting",
    regionLabel: "Mexico · participating monitoring networks",
    countryCodes: ["MX"],
    temporalCoverage: "Preliminary real-time and validated historical data",
    updateCadence: "Network-dependent",
    spatialResolution: "State and municipal monitoring stations",
    coverageNote: "Official national system, but coverage is uneven and automated access is not yet available.",
    liveGateNote: "Needs a documented stable machine contract and preliminary/validated state separation.",
  },
  {
    sourceId: "nasa_gibs_omps_so2",
    publicName: "NASA GIBS NOAA-20 OMPS Sulfur Dioxide",
    hazardIds: ["earth_volcanoes", "air_quality"],
    level: "global",
    kind: "satellite",
    integrationStatus: "live_integrated",
    evidenceRole: "supporting",
    regionLabel: "Global orbital swaths",
    countryCodes: [],
    temporalCoverage: "Daily ongoing near-real-time product",
    updateCadence: "Daily orbital observations",
    spatialResolution: "Approximately 17 × 13 km swath pixels",
    coverageNote: "Atmospheric sulfur-dioxide context only; it cannot identify cause or predict eruptions.",
    liveGateNote:
      "The exact OMPS WMS path and transparent no-observation state passed the bounded live gate; the route never infers eruption cause or timing.",
    satellite: { platform: "NOAA-20", sensor: "OMPS Nadir Mapper", product: "Lower-troposphere SO2" },
  },
  {
    sourceId: "usgs_earthquake_geojson",
    publicName: "USGS Earthquake Catalog",
    hazardIds: ["earth_volcanoes"],
    level: "national",
    kind: "official_event",
    integrationStatus: "live_integrated",
    evidenceRole: "primary",
    regionLabel: "USGS global catalog for validated U.S. selections",
    countryCodes: ["US"],
    temporalCoverage: "Bounded historical and recent completed UTC dates",
    updateCadence: "Event-driven; automatic events may later be reviewed or revised",
    spatialResolution: "Point event origin with reported magnitude and depth",
    coverageNote: "Observed catalog events only; no earthquake/eruption prediction or volcano causality.",
    liveGateNote:
      "The bounded fixed-host FDSN GeoJSON product path passed its authorized live gate on 2026-08-18 " +
      "with 300 observed catalog events on the fixed Hawaii historical path. Observed events only, " +
      "never prediction; one fixed path is not nationwide coverage proof.",
    lastVerifiedDate: "2026-08-18",
  },
  {
    sourceId: "usgs_volcano_hans",
    publicName: "USGS Volcano Hazards Notification System (HANS)",
    hazardIds: ["earth_volcanoes"],
    level: "national",
    kind: "official_alert",
    integrationStatus: "live_integrated",
    evidenceRole: "primary",
    regionLabel: "United States volcano observatories",
    countryCodes: ["US"],
    temporalCoverage: "Recent notices and current elevated volcanoes",
    updateCadence: "Event-driven",
    spatialResolution: "Named volcano notices",
    coverageNote: "Observed official activity notices only; no eruption prediction.",
    liveGateNote:
      "The corrected notice decoder passed its authorized bounded live gate on 2026-08-18 with six " +
      "issuance observations on the fixed Hawaii historical path. Notices remain observed official " +
      "activity, never eruption prediction; availability may vary and failures stay visible.",
    lastVerifiedDate: "2026-08-18",
  },
  {
    sourceId: "smithsonian_gvp_eruptions",
    publicName: "Smithsonian Global Volcanism Program Eruptions",
    hazardIds: ["earth_volcanoes"],
    level: "global",
    kind: "official_event",
    integrationStatus: "live_integrated",
    evidenceRole: "primary",
    regionLabel: "Global Holocene eruption catalog",
    countryCodes: [],
    temporalCoverage: "Historical eruption records with source-specific date precision",
    updateCadence: "Catalog revisions as research and reports are incorporated",
    spatialResolution: "Volcano point and eruption-record interval",
    coverageNote: "Historical eruption evidence is not a real-time alert, exposure finding, or prediction.",
    liveGateNote: "Integrated through bounded GVP WFS GeoJSON with exact geometry and conservative incomplete-date interval handling.",
    lastVerifiedDate: "2026-08-30",
  },
];

function assertCoverageCatalog(profiles: readonly SourceCoverageProfile[]): void {
  const seenSourceIds = new Set<SourceId>();
  for (const profile of profiles) {
    if (seenSourceIds.has(profile.sourceId)) {
      throw new Error(`coverage source ${profile.sourceId} has duplicate profiles`);
    }
    seenSourceIds.add(profile.sourceId);
    const registry = getRegistryEntry(profile.sourceId);
    if (!registry) throw new Error(`coverage source ${profile.sourceId} is not registered`);
    if (profile.hazardIds.length === 0) {
      throw new Error(`coverage source ${profile.sourceId} has no hazard coverage`);
    }
    if (profile.kind === "satellite" && !profile.satellite) {
      throw new Error(`satellite coverage source ${profile.sourceId} lacks mission identity`);
    }
    if (
      (profile.integrationStatus === "live_integrated" ||
        profile.integrationStatus === "live_key_required") &&
      !registry.supportedDataModes.includes("live")
    ) {
      throw new Error(`coverage source ${profile.sourceId} claims live without a live registry mode`);
    }
    for (const hazardId of profile.hazardIds) {
      if (!registry.hazardIds.includes(hazardId)) {
        throw new Error(`coverage hazard ${hazardId} is not registered for ${profile.sourceId}`);
      }
    }
    if (profile.lastVerifiedDate !== undefined) {
      const parsed = Date.parse(`${profile.lastVerifiedDate}T00:00:00Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/u.test(profile.lastVerifiedDate) ||
        !Number.isFinite(parsed) ||
        new Date(parsed).toISOString().slice(0, 10) !== profile.lastVerifiedDate
      ) {
        throw new Error(
          `coverage source ${profile.sourceId} lastVerifiedDate must be a real YYYY-MM-DD UTC date`
        );
      }
    }
  }
}

assertCoverageCatalog(PROFILES);

export const SOURCE_COVERAGE_PROFILES: readonly SourceCoverageProfile[] = PROFILES;

export function coverageProfilesForHazard(hazardId: HazardId): SourceCoverageProfile[] {
  return PROFILES.filter((profile) => profile.hazardIds.includes(hazardId));
}

export function coverageProfileRegistryEntry(sourceId: SourceId) {
  return getRegistryEntry(sourceId);
}
