/**
 * src/data/dataset-registry.ts
 *
 * The authoritative WP-02 dataset registry.
 *
 * Every source candidate has an explicit `go`, `defer`, or `reject`
 * decision. Deferred and rejected entries remain visible for auditability but
 * are excluded from the queryable allowlist and active lookup helpers.
 *
 * No unregistered source may be queried by deterministic application code.
 */

import {
  type DatasetRegistryEntry,
  validateDatasetRegistryEntry,
} from "../contracts/dataset-registry.js";
import type { HazardId } from "../contracts/common.js";

const ENTRIES: DatasetRegistryEntry[] = [
  {
    sourceId: "noaa_hms_fire_points",
    displayName: "NOAA HMS Fire Detection Points",
    agency: "NOAA / NESDIS / OSPO",
    hazardIds: ["fire_smoke"],
    decision: "go",
    role:
      "Credential-free historical satellite fire-detection point observations. " +
      "Used for fire-presence evidence within a bounding box. " +
      "Not approved for tactical firefighting, evacuation guidance, or property-level certainty.",
    endpointTemplate:
      "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Fire_Points/KML/{YYYY}/{MM}/hms_fire{YYYYMMDD}.kml",
    requiresCredential: false,
    authNote: "No authentication required for historical archive access.",
    documentationUrl: "https://www.ospo.noaa.gov/products/land/hms.html",
    requiredLimitations: [
      "HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply.",
      "Processing and analyst-review delay may be several hours.",
      "Coordinate or placemark counts are not counts of distinct fires, threatened homes, or unsafe users.",
      "Not approved for tactical firefighting, evacuation decisions, or property-level fire certainty.",
    ],
    supportedDataModes: ["live", "fixture", "historical"],
  },
  {
    sourceId: "noaa_hms_smoke_polygons",
    displayName: "NOAA HMS Smoke Polygons",
    agency: "NOAA / NESDIS / OSPO",
    hazardIds: ["fire_smoke"],
    decision: "go",
    role:
      "Credential-free historical satellite smoke-polygon observations. " +
      "Provides smoke coverage areas classified by density (Light/Medium/Heavy). " +
      "Not approved for indoor air-quality assessment or evacuation guidance.",
    endpointTemplate:
      "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/{YYYY}/{MM}/hms_smoke{YYYYMMDD}.kml",
    requiresCredential: false,
    authNote: "No authentication required for historical archive access.",
    documentationUrl: "https://www.ospo.noaa.gov/products/land/hms.html",
    requiredLimitations: [
      "HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply.",
      "Smoke classification is broad regional density, not fine-grained AQI.",
      "Not a substitute for official AQI monitoring or indoor air-quality guidance.",
    ],
    supportedDataModes: ["live", "fixture", "historical"],
  },
  {
    sourceId: "nasa_firms",
    displayName: "NASA FIRMS Active Fire Data",
    agency: "NASA / LANCE / FIRMS",
    hazardIds: ["fire_smoke"],
    decision: "go",
    role:
      "UXFIX-02 / ADR-0025: Global VIIRS active-fire detections for map-selected " +
      "areas. The NRT product may be used as a validated live hotspot-point visualization; " +
      "standard processing remains the historical evidence path outside NOAA HMS coverage. " +
      "Server-only; requires the FIRMS_MAP_KEY " +
      "environment variable; fail-closed unconfigured. " +
      "Not approved for tactical firefighting, evacuation guidance, or property-level certainty.",
    endpointTemplate:
      "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{source}/{area}/{dayRange}/{date}",
    requiresCredential: true,
    authNote:
      "A free NASA FIRMS MAP_KEY is required (server-side FIRMS_MAP_KEY env var). " +
      "The key is never stored in evidence, logs, or client output.",
    documentationUrl: "https://firms.modaps.eosdis.nasa.gov/api/",
    requiredLimitations: [
      "Detection counts are satellite pixel detections, not counts of distinct fires, homes, or people.",
      "Near-real-time hotspot points are not wildfire perimeters or official incident records.",
      "Cloud cover, canopy, small/cool fires, and revisit timing cause missed detections; absence is not safety.",
      "Satellite active-fire detections do not establish property damage or evacuation need.",
    ],
    supportedDataModes: ["live"],
  },
  {
    sourceId: "nasa_gibs_imerg",
    displayName: "NASA GIBS IMERG Precipitation Rate Visualization",
    agency: "NASA / GSFC / GPM",
    hazardIds: ["flood_storm"],
    decision: "go",
    role:
      "Credential-free WMS visualization layer for IMERG half-hourly precipitation rate. " +
      "Returns a PNG tile as visual precipitation evidence. " +
      "Numeric rainfall must not be inferred from pixel colors without a separately validated algorithm. " +
      "Pre-IMERG era requests (before approximately 2000) return unsupported-coverage.",
    endpointTemplate:
      "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=IMERG_Precipitation_Rate&SRS=EPSG%3A4326&STYLES=&WIDTH=512&HEIGHT=512&TIME={YYYY-MM-DD}&BBOX={bbox}",
    requiresCredential: false,
    authNote: "No authentication required. Public WMS endpoint.",
    documentationUrl: "https://nasa-gibs.github.io/gibs-api-docs/",
    requiredLimitations: [
      "GIBS PNG is visual evidence only; numeric rainfall may not be inferred from pixel colors.",
      "IMERG is a modelled precipitation estimate, not a direct measurement.",
      "Half-hourly temporal resolution; processing delay of several hours applies.",
      "Requests before the IMERG era (approx. 2000) return transparent/no-data (unsupported coverage).",
      "Layer alias may drift; evidence must capture retrieved metadata and concept identifier.",
    ],
    supportedDataModes: ["live", "fixture", "historical"],
  },
  {
    sourceId: "nws_tropical_cyclone_report",
    displayName: "NWS Post-Tropical Cyclone Report",
    agency: "NOAA / National Weather Service",
    hazardIds: ["wind_storm"],
    decision: "go_supporting",
    role:
      "Pinned official post-event context for a documented tropical cyclone, scoped to the " +
      "reporting office, event date, and published regional observations. It does not establish " +
      "conditions or damage at a selected property.",
    endpointTemplate:
      "https://www.weather.gov/media/{office}/TropicalEventSummary/{report}.pdf",
    requiresCredential: false,
    authNote: "No authentication required. Public National Weather Service report.",
    documentationUrl: "https://www.weather.gov/hgx/beryl2024",
    requiredLimitations: [
      "A regional post-event report does not prove wind speed, damage, or causation at a selected property.",
      "Reported station gusts describe named observation sites and must not be transferred to a roof or address.",
      "A historical report is not a current warning, forecast, engineering inspection, or insurance determination.",
    ],
    supportedDataModes: ["historical"],
  },
  {
    sourceId: "nasa_imerg_raw",
    displayName: "NASA IMERG Raw GES DISC / PPS Products",
    agency: "NASA / GES DISC / GPM",
    hazardIds: ["flood_storm"],
    decision: "defer",
    role:
      "Deferred numeric precipitation candidate. Earthdata access, exact product selection, " +
      "HDF5/NetCDF parsing, quality flags, units, and validation remain unresolved.",
    endpointTemplate: "https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGHH_07/summary",
    requiresCredential: true,
    authNote: "Raw downloads require NASA Earthdata authentication.",
    documentationUrl: "https://gpm.nasa.gov/data/imerg",
    requiredLimitations: [
      "Deferred: raw IMERG values must not be presented until file, quality, unit, and provenance validation is implemented.",
      "IMERG is a satellite precipitation estimate, not a property-level flood observation.",
    ],
    supportedDataModes: ["unavailable"],
  },
  {
    sourceId: "usgs_instantaneous_values",
    displayName: "USGS Water Data OGC Continuous Values",
    agency: "USGS / Water Resources",
    hazardIds: ["flood_storm"],
    decision: "go_supporting",
    role:
      "Supporting modern OGC ground-observation service providing continuous gage-height values " +
      "at named USGS monitoring locations. Site identity is joined from the monitoring-locations " +
      "collection. Provisional single-station observations do not establish a universal Flood " +
      "threshold or property-level conclusion.",
    endpointTemplate:
      "https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items?f=json&monitoring_location_id=USGS-{siteId}&parameter_code={parameterCd}&datetime={startDT}T00:00:00Z/{endDT}T23:59:59Z",
    requiresCredential: false,
    authNote:
      "No authentication is required for the bounded public request. API keys are optional for higher rate limits and are not part of evidence semantics.",
    documentationUrl:
      "https://api.waterdata.usgs.gov/docs/ogcapi/migration/",
    requiredLimitations: [
      "USGS instantaneous values are provisional and subject to revision.",
      "A single gage reading does not establish a universal flood threshold.",
      "Station-level observations do not imply property-level flooding at other locations.",
      "Modern OGC responses require explicit pagination, schema, unit, site, parameter, and time validation.",
    ],
    supportedDataModes: ["live", "fixture", "historical"],
  },
  {
    sourceId: "noaa_ncei_storm_events",
    displayName: "NOAA NCEI Storm Events Database",
    agency: "NOAA / NCEI",
    hazardIds: ["flood_storm", "wind_storm"],
    decision: "go_supporting",
    role:
      "Supporting historical storm-event context for documented weather events. " +
      "Exact current bulk-download filename must be pinned before use in production adapters.",
    endpointTemplate:
      "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/{filename}",
    requiresCredential: false,
    authNote: "No authentication required. Public NCEI bulk download.",
    documentationUrl: "https://www.ncei.noaa.gov/stormevents/ftp.jsp",
    requiredLimitations: [
      "Historical event records only; not a real-time source.",
      "Exact current bulk-download filename must be verified and pinned before use.",
    ],
    supportedDataModes: ["fixture", "historical"],
  },
  {
    sourceId: "nasa_gibs_modis_lst_day",
    displayName: "NASA GIBS MODIS Terra Daytime Land-Surface Temperature",
    agency: "NASA / ESDIS / MODIS Terra",
    hazardIds: ["extreme_heat"],
    decision: "go",
    role:
      "Credential-free daily WMTS visualization of MODIS Terra daytime land-surface temperature. " +
      "The PNG is satellite surface-temperature visualization evidence only; application code may " +
      "not infer Celsius or Fahrenheit values from colors or treat it as air temperature.",
    endpointTemplate:
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Land_Surface_Temp_Day/default/{YYYY-MM-DD}/GoogleMapsCompatible_Level7/{z}/{row}/{col}.png",
    requiresCredential: false,
    authNote: "No authentication required. Public NASA GIBS WMTS endpoint.",
    documentationUrl:
      "https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/MODIS_Terra_Land_Surface_Temp_Day.json",
    requiredLimitations: [
      "GIBS PNG imagery is visualization evidence only; no Celsius or Fahrenheit value may be inferred from pixel colors.",
      "Land-surface temperature is not air temperature, heat index, indoor temperature, household certainty, or individual medical risk.",
      "Clouds, retrieval gaps, overpass timing, pixel scale, and surface materials limit what the daily visualization can establish.",
      "A successful tile request does not establish a current hazardous condition or property-level heat exposure.",
      "NASA GIBS imagery acknowledgement and exact layer, time, tile, retrieval time, and payload hash must accompany product evidence.",
    ],
    supportedDataModes: ["live", "fixture", "historical"],
  },
  {
    sourceId: "noaa_uscrn_heat_exposure",
    displayName: "NOAA USCRN Heat Exposure (Heat01)",
    agency: "NOAA / NCEI / USCRN",
    hazardIds: ["extreme_heat"],
    decision: "go_supporting",
    role:
      "Credential-free station-level hourly air temperature, relative humidity, and NOAA-derived " +
      "heat-index fields from the USCRN Heat01 product. It is supporting ground evidence and does " +
      "not measure indoor temperature or individual exposure.",
    endpointTemplate:
      "https://www.ncei.noaa.gov/pub/data/uscrn/products/heat01/CRNHE0101-{stationName}.csv",
    requiresCredential: false,
    authNote: "No authentication required. Public NOAA NCEI product directory.",
    documentationUrl:
      "https://www.ncei.noaa.gov/pub/data/uscrn/products/heat01/readme.txt",
    requiredLimitations: [
      "USCRN Heat01 values describe one named outdoor station and hour; they do not establish conditions at a selected home or across a city.",
      "Air temperature and the NOAA-derived heat index are different fields and must remain visibly separate.",
      "Heat index is a derived outdoor heat-exposure indicator, not a thermometer reading, indoor temperature, diagnosis, or individual medical-risk assessment.",
      "Missing, invalid, or unavailable station rows are not evidence of safe conditions or no danger.",
      "Station identity, coordinates, UTC hour, product version, units, retrieval time, and payload hash must accompany product evidence.",
    ],
    supportedDataModes: ["live", "fixture", "historical"],
  },
  {
    sourceId: "nws_station_observations",
    displayName: "NWS Station Observations (api.weather.gov)",
    agency: "NOAA / National Weather Service",
    hazardIds: ["extreme_heat"],
    decision: "go_supporting",
    role:
      "Credential-free hourly-cadence station observations (air temperature, relative humidity, " +
      "and the NWS-computed heat index when present) from the api.weather.gov observation " +
      "network, which covers U.S. metro areas the rural USCRN network does not. The API retains " +
      "roughly the last seven days; it is supporting ground evidence and does not measure " +
      "indoor temperature or individual exposure.",
    endpointTemplate:
      "https://api.weather.gov/stations/{stationId}/observations?start={start}&end={end}",
    requiresCredential: false,
    authNote:
      "No fee or API key; a product User-Agent is required and reasonable unpublished rate " +
      "limits apply.",
    documentationUrl: "https://www.weather.gov/documentation/services-web-api",
    requiredLimitations: [
      "NWS observations describe one named outdoor station; they do not establish conditions at a selected home or across a city.",
      "The NWS-provided heat index exists only when the service computed one; air temperature and heat index must remain visibly separate.",
      "Observations older than roughly seven days are not retrievable from this API; missing evidence is not evidence of safe conditions.",
      "Station identity, coordinates, observation timestamp, quality-control codes, units, retrieval time, and payload hash must accompany product evidence.",
    ],
    supportedDataModes: ["live"],
  },
  {
    sourceId: "noaa_ncei_global_hourly",
    displayName: "NOAA NCEI Global Historical Climatology Network-hourly (GHCNh)",
    agency: "NOAA / NCEI",
    hazardIds: ["extreme_heat", "wind_storm"],
    decision: "go_supporting",
    role:
      "Credential-free historical ground observations (hourly-cadence air temperature and " +
      "relative humidity, wind speed, and wind gust) from the GHCNh station-by-year PSV files. " +
      "The heat path uses these files when no operational " +
      "USCRN station lies inside the selected area and the date is older than the by-year " +
      "publication window (~4 weeks, verified 2026-08-19). Supporting ground evidence; NOAA " +
      "publishes no heat index in this product and none is derived.",
    endpointTemplate:
      "https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year/{year}/psv/GHCNh_{stationId}_{year}.psv",
    requiresCredential: false,
    authNote: "No authentication required. Public NOAA NCEI product directory.",
    documentationUrl:
      "https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly",
    requiredLimitations: [
      "Ground stations are point observations and may be absent or distant from the selected area.",
      "GHCNh station-by-year files publish roughly four weeks behind real time; an unpublished date is not evidence of safe conditions.",
      "Station quality flags are preserved verbatim and never reinterpreted; no heat index exists in this product and none is derived.",
      "An outdoor station does not establish indoor, household, property, or personal exposure conditions.",
      "Station wind is measured at a named observation site; it does not establish roof-level wind, damage, or causation at another location.",
    ],
    supportedDataModes: ["live", "historical"],
  },
  {
    sourceId: "nasa_ecostress",
    displayName: "NASA ECOSTRESS Land Surface Temperature",
    agency: "NASA / JPL / LP DAAC",
    hazardIds: ["extreme_heat"],
    decision: "defer",
    role:
      "Deferred extreme-heat candidate. Product choice, Earthdata/AppEEARS access, " +
      "tiling, cloud masks, coverage, and surface-temperature interpretation remain unresolved.",
    endpointTemplate:
      "https://lpdaac.usgs.gov/data/get-started-data/collection-overview/missions/ecostress-overview/",
    requiresCredential: true,
    authNote: "Earthdata authentication is required for the intended LP DAAC/AppEEARS workflow.",
    documentationUrl:
      "https://lpdaac.usgs.gov/data/get-started-data/collection-overview/missions/ecostress-overview/",
    requiredLimitations: [
      "Deferred: land-surface temperature is not the same as air temperature or a personal heat-exposure diagnosis.",
      "Cloud masks, irregular coverage, and product quality must be validated before use.",
    ],
    supportedDataModes: ["unavailable"],
  },
  {
    sourceId: "nasa_gibs_modis_ndvi_16day",
    displayName: "NASA GIBS MODIS Terra 16-Day NDVI Visualization",
    agency: "NASA / ESDIS / MODIS Terra",
    hazardIds: ["drought_land"],
    decision: "go",
    role:
      "WP-10 primary vegetation-evidence role. The validated server adapter and route accept the labelled " +
      "Tucson case and bounded canonical custom areas for global satellite visualization. A matching regional " +
      "drought classification, correction live smoke, deployment, and full WP-10 acceptance remain open.",
    endpointTemplate:
      "https://gibs.earthdata.nasa.gov/wms/epsg4326/std/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=MODIS_Terra_L3_NDVI_16Day_v6.1_STD&STYLES=&SRS=EPSG:4326&BBOX={west,south,east,north}&WIDTH=256&HEIGHT=256&TIME={YYYY-MM-DD}&FORMAT=image/png&TRANSPARENT=TRUE",
    requiresCredential: false,
    authNote:
      "No authentication is documented for public NASA GIBS WMS. Bounded development-live supports validated " +
      "custom-area bounding boxes; this correction still requires a separate authorized live smoke before broader product acceptance.",
    documentationUrl:
      "https://nasa-gibs.github.io/gibs-api-docs/access-basics/",
    requiredLimitations: [
      "NASA GIBS NDVI imagery is visualization evidence only; numeric NDVI, vegetation trend, drought cause, or crop condition may not be inferred from PNG colors.",
      "The MODIS v6.1 Standard 250 m, 16-day composite is regional satellite evidence, not a property-level vegetation, soil-moisture, crop-loss, or household water-supply measurement.",
      "Composite time, product scale, clouds, quality screening, retrieval gaps, and the requested map envelope must remain visible limitations.",
      "Missing or transparent imagery is unsupported or missing evidence, not proof of no drought or no land concern.",
      "Exact layer, requested time, bounding box, retrieval time, fixture/live mode, and payload or synthetic-fixture hash must accompany evidence.",
    ],
    supportedDataModes: ["live", "fixture"],
  },
  {
    sourceId: "nasa_smap",
    displayName: "NASA SMAP Soil Moisture Products",
    agency: "NASA / NSIDC DAAC",
    hazardIds: ["drought_land"],
    decision: "defer",
    role:
      "Deferred drought and land candidate. Exact product, Earthdata access, spatial scale, " +
      "quality flags, and interpretation boundaries remain unresolved.",
    endpointTemplate: "https://nsidc.org/data/smap",
    requiresCredential: true,
    authNote: "The intended data-download workflow requires NASA Earthdata authentication.",
    documentationUrl: "https://nsidc.org/data/smap",
    requiredLimitations: [
      "Deferred: coarse satellite soil-moisture estimates are not property-level soil or water-supply measurements.",
      "Product resolution and quality flags must be validated before use.",
    ],
    supportedDataModes: ["unavailable"],
  },
  {
    sourceId: "nasa_tempo",
    displayName: "NASA TEMPO Atmospheric Composition Products",
    agency: "NASA / Smithsonian Astrophysical Observatory",
    hazardIds: ["air_quality"],
    decision: "defer",
    role:
      "Deferred air-quality candidate. Earthdata access, product selection, NetCDF parsing, " +
      "quality flags, spatial coverage, and pollutant interpretation remain unresolved.",
    endpointTemplate: "https://www.earthdata.nasa.gov/data/instruments/tempo",
    requiresCredential: true,
    authNote: "The intended product-download workflow requires NASA Earthdata authentication.",
    documentationUrl: "https://www.earthdata.nasa.gov/data/instruments/tempo",
    requiredLimitations: [
      "Deferred: TEMPO column observations are not indoor-air measurements or direct personal exposure estimates.",
      "Quality flags and product-specific units must be validated before use.",
    ],
    supportedDataModes: ["unavailable"],
  },
  {
    sourceId: "airnow",
    displayName: "AirNow API",
    agency: "U.S. EPA and partner agencies",
    hazardIds: ["air_quality", "fire_smoke"],
    decision: "defer",
    role:
      "Deferred outdoor air-quality confirmation candidate. Account provisioning, API-key " +
      "storage, rate handling, observation status, and AQI interpretation remain unresolved.",
    endpointTemplate: "https://www.airnowapi.org/aq/observation/zipCode/current/",
    requiresCredential: true,
    authNote: "An AirNow API account and key are required.",
    documentationUrl: "https://docs.airnowapi.org/webservices",
    requiredLimitations: [
      "Deferred: preliminary outdoor observations are not indoor-air or regulatory findings.",
      "Missing station data is not evidence of safe air quality.",
    ],
    supportedDataModes: ["unavailable"],
  },
  {
    sourceId: "airnow_daily_data",
    displayName: "AirNow Daily Data File",
    agency: "U.S. EPA and partner agencies",
    hazardIds: ["air_quality", "fire_smoke"],
    decision: "go_supporting",
    role:
      "Credential-free historical outdoor monitoring-site AQI supporting evidence. The bounded " +
      "daily-file path validates U.S. rows and preserves preliminary, outdoor-only, local-date, " +
      "and missing-is-not-safe limitations.",
    endpointTemplate:
      "https://files.airnowtech.org/airnow/{YYYY}/{YYYYMMDD}/daily_data_v2.dat",
    requiresCredential: false,
    authNote: "The official nationwide daily-file product is documented without an API key.",
    documentationUrl: "https://files.airnowtech.org/airnow/docs/DailyDataFactSheet.pdf",
    requiredLimitations: [
      "AirNow daily values are preliminary outdoor monitoring-site summaries, not fully validated regulatory AQS findings.",
      "A monitoring-site AQI is not indoor air quality, individual exposure, medical advice, or property-level certainty.",
      "The valid date uses midnight-to-midnight Local Standard Time; the file does not provide a UTC instant for each daily row.",
      "Missing nearby rows or a failed file request is not evidence of clean or safe air.",
    ],
    supportedDataModes: ["live", "historical"],
  },
  {
    sourceId: "nasa_gibs_modis_aod",
    displayName: "NASA GIBS MODIS MAIAC Aerosol Optical Depth",
    agency: "NASA / LANCE / MODIS Terra and Aqua",
    hazardIds: ["air_quality", "fire_smoke"],
    decision: "go",
    role:
      "Credential-free daily satellite aerosol visualization validated through a bounded GIBS WMS product path. It provides broad atmospheric context but is not AQI, a ground pollutant concentration, or personal exposure.",
    endpointTemplate:
      "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&LAYERS=MODIS_Combined_MAIAC_L2G_AerosolOpticalDepth&TIME={date}&BBOX={bbox}",
    requiresCredential: false,
    authNote: "No authentication is documented for the public GIBS visualization service.",
    documentationUrl:
      "https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/MODIS_Combined_MAIAC_L2G_AerosolOpticalDepth.json",
    requiredLimitations: [
      "Aerosol optical depth is not AQI, PM2.5 concentration, indoor air quality, or individual exposure.",
      "Clouds, bright surfaces, retrieval gaps, overpass timing, and pixel scale limit coverage.",
      "No numeric pollutant value may be inferred from visualization colors without a validated product algorithm.",
    ],
    supportedDataModes: ["live", "fixture", "historical"],
  },
  {
    sourceId: "nasa_lance_flood_extent",
    displayName: "NASA LANCE MODIS/VIIRS Global Flood Extent",
    agency: "NASA / LANCE / MODIS and VIIRS",
    hazardIds: ["flood_storm"],
    decision: "go",
    role:
      "Credential-free VIIRS 3-day flood-extent visualization validated through a bounded GIBS WMS product path. Transparent imagery remains no observation; unvalidated colors are never converted into flood depth or property impact.",
    endpointTemplate:
      "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&LAYERS=VIIRS_Combined_Flood_3-Day&TIME={date}&BBOX={bbox}",
    requiresCredential: false,
    authNote: "Public GIBS imagery is credential-free; direct product downloads may use Earthdata services.",
    documentationUrl:
      "https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/VIIRS_Combined_Flood_3-Day.json",
    requiredLimitations: [
      "Satellite flood detection may contain cloud shadow, terrain shadow, standing water, and other false positives.",
      "Clouds, orbit gaps, vegetation, urban surfaces, and revisit timing can hide real flooding.",
      "A flood pixel is not a property inspection, road-closure record, water depth, or evacuation instruction.",
    ],
    supportedDataModes: ["live", "fixture", "historical"],
  },
  {
    sourceId: "noaa_nws_alerts",
    displayName: "U.S. National Weather Service API",
    agency: "NOAA / National Weather Service",
    hazardIds: ["fire_smoke", "flood_storm", "extreme_heat", "air_quality"],
    decision: "defer",
    role:
      "Prepared United States official alert and forecast supplement. It must be queried by validated point, zone, or alert area and never treated as global coverage.",
    endpointTemplate: "https://api.weather.gov/alerts/active?point={lat},{lon}",
    requiresCredential: false,
    authNote: "No fee or API key; a product User-Agent is required and reasonable unpublished rate limits apply.",
    documentationUrl: "https://www.weather.gov/documentation/services-web-api",
    requiredLimitations: [
      "No active alert does not mean no hazard, no local impact, or safe conditions.",
      "Alert geometry, effective time, expiry, sender, status, and message type must be validated.",
      "Forecasts and alerts do not establish property damage, road closure, medical diagnosis, or utility status.",
    ],
    supportedDataModes: ["unavailable"],
  },
  {
    sourceId: "canada_cwfis_fire",
    displayName: "Canadian Wildland Fire Information System",
    agency: "Natural Resources Canada / Canadian Forest Service",
    hazardIds: ["fire_smoke"],
    decision: "defer",
    role:
      "Prepared Canada-wide wildfire supplement for agency-reported active fires, hotspots, fire weather, and explicitly labelled perimeter estimates.",
    endpointTemplate:
      "https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs?service=WFS&request=GetFeature&typeName=public:activefires_current&bbox={bbox}",
    requiresCredential: false,
    authNote: "Public OGC and download services; cache and request-rate policy require validation.",
    documentationUrl:
      "https://cwfis.cfs.nrcan.gc.ca/downloads/CWFIS_DataServices_HowtoAccessDailyMaps%26DataLayers.pdf",
    requiredLimitations: [
      "CWFIS states that maps and services are approximations and may not show the most current fire situation.",
      "Agency-reported fires, satellite hotspots, danger ratings, and perimeter estimates must remain separate claim types.",
      "No record does not establish no fire or no danger.",
    ],
    supportedDataModes: ["unavailable"],
  },
  {
    sourceId: "canada_geomet",
    displayName: "Environment and Climate Change Canada MSC GeoMet",
    agency: "Environment and Climate Change Canada",
    hazardIds: ["flood_storm"],
    decision: "go_supporting",
    role:
      "Canada-wide anonymous supporting source for bounded hydrometric daily-mean water-level observations. Weather and AQHI collections remain outside this integration.",
    endpointTemplate: "https://api.weather.gc.ca/collections/hydrometric-daily-mean/items?bbox={bbox}&datetime={date}&limit=100&f=json",
    requiresCredential: false,
    authNote: "MSC GeoMet access is anonymous and free of charge.",
    documentationUrl: "https://eccc-msc.github.io/open-data/msc-geomet/readme_en/",
    requiredLimitations: [
      "Daily mean station water level is not a universal flood threshold and does not establish property flooding or route safety.",
      "Station values and quality symbols may be revised; discharge, when present, remains metadata and is not converted into a flood conclusion.",
      "No in-area station or returned feature is missing ground evidence, not safety.",
    ],
    supportedDataModes: ["live", "historical"],
  },
  {
    sourceId: "canada_drought_monitor",
    displayName: "Canadian Drought Monitor",
    agency: "Agriculture and Agri-Food Canada",
    hazardIds: ["drought_land"],
    decision: "defer",
    role:
      "Prepared official monthly Canada-wide drought classification supplement delivered through an ArcGIS ImageServer.",
    endpointTemplate:
      "https://agriculture.canada.ca/imagery-images/rest/services/canadian_drought_monitor/ImageServer/exportImage?bbox={bbox}&time={time}",
    requiresCredential: false,
    authNote: "Public Government of Canada image service; request-size and cache rules require validation.",
    documentationUrl:
      "https://agriculture.canada.ca/en/agricultural-production/weather/canadian-drought-monitor",
    requiredLimitations: [
      "The Canadian Drought Monitor is a monthly broad-area classification, not a property or household-water assessment.",
      "D0 is abnormally dry; missing imagery or no mapped class is not proof of no local impact.",
      "Nunavut and the Arctic Archipelago have stated coverage gaps.",
    ],
    supportedDataModes: ["unavailable"],
  },
  {
    sourceId: "mexico_conabio_satif",
    displayName: "Mexico CONABIO Early Fire Warning System",
    agency: "CONABIO",
    hazardIds: ["fire_smoke"],
    decision: "defer",
    role:
      "Prepared Mexico national fire-context candidate using near-real-time MODIS, VIIRS, and AVHRR detections. Stable machine API, schema, and reuse terms remain to be locked.",
    endpointTemplate: "https://incendios.conabio.gob.mx/{official-machine-access}",
    requiresCredential: false,
    authNote: "Public website; a stable supported machine interface is not yet confirmed.",
    documentationUrl: "https://incendios.conabio.gob.mx/",
    requiredLimitations: [
      "Thermal detections are not fire perimeters, incident commands, severity ratings, or property damage.",
      "The official machine interface and update guarantees must be confirmed before integration.",
    ],
    supportedDataModes: ["unavailable"],
  },
  {
    sourceId: "mexico_conagua_hydrology",
    displayName: "Mexico CONAGUA Hydrologic and Flood Data",
    agency: "CONAGUA / Servicio Meteorologico Nacional",
    hazardIds: ["flood_storm", "extreme_heat"],
    decision: "defer",
    role:
      "Prepared Mexico national supplement for river levels, precipitation, temperature, hydrometric stations, and published flood-zone files. Product freshness and stable machine access vary by collection.",
    endpointTemplate: "https://datos.conagua.gob.mx/{approved-collection}",
    requiresCredential: false,
    authNote: "Public open-data files; collection-specific formats and update cadence require validation.",
    documentationUrl: "https://datos.conagua.gob.mx/",
    requiredLimitations: [
      "River levels and precipitation are evidence, not universal flood thresholds or flood polygons.",
      "Published flood-zone files may be planning products rather than current flood extent.",
      "File age, station identity, units, and collection update cadence must be visible.",
    ],
    supportedDataModes: ["unavailable"],
  },
  {
    sourceId: "mexico_drought_monitor",
    displayName: "Monitor de Sequia en Mexico",
    agency: "CONAGUA / Servicio Meteorologico Nacional",
    hazardIds: ["drought_land"],
    decision: "defer",
    role:
      "Prepared official Mexico drought classification supplement. Public reports and municipality tables exist; stable automated polygon access and reuse workflow remain unresolved.",
    endpointTemplate:
      "https://smn.conagua.gob.mx/es/climatologia/monitor-de-sequia/monitor-de-sequia-en-mexico",
    requiresCredential: false,
    authNote: "Public reports; shapefile access currently requires a documented request workflow.",
    documentationUrl:
      "https://smn.conagua.gob.mx/es/climatologia/monitor-de-sequia/monitor-de-sequia-en-mexico",
    requiredLimitations: [
      "The national product is issued approximately twice monthly and does not represent property conditions.",
      "Municipality assignment and mapped polygons use documented aggregation rules that must remain visible.",
      "Unavailable polygon access is a source gap, not no drought.",
    ],
    supportedDataModes: ["unavailable"],
  },
  {
    sourceId: "mexico_sinaica",
    displayName: "Mexico SINAICA Air Quality Information",
    agency: "INECC / SEMARNAT and state or municipal monitoring networks",
    hazardIds: ["air_quality"],
    decision: "defer",
    role:
      "Prepared Mexico national air-quality supplement. The public system exposes real-time preliminary and historical validated monitoring data, but a stable documented API contract remains unresolved.",
    endpointTemplate: "https://sinaica.inecc.gob.mx/{approved-machine-access}",
    requiresCredential: false,
    authNote: "Public website; supported machine access and sustainable request policy require confirmation.",
    documentationUrl:
      "https://www.gob.mx/inecc/es/acciones-y-programas/sistema-nacional-de-informacion-de-la-calidad-del-aire-sinaica",
    requiredLimitations: [
      "Real-time SINAICA observations are preliminary and may later change after validation.",
      "Monitoring coverage depends on state and municipal networks and is not uniform across Mexico.",
      "Outdoor station data is not indoor air quality or personal medical assessment.",
    ],
    supportedDataModes: ["unavailable"],
  },
  {
    sourceId: "nasa_gibs_omps_so2",
    displayName: "NASA GIBS NOAA-20 OMPS Sulfur Dioxide",
    agency: "NASA GIBS / NOAA-20 OMPS",
    hazardIds: ["earth_volcanoes", "air_quality"],
    decision: "go",
    role:
      "Credential-free daily satellite sulfur-dioxide visualization validated through a bounded GIBS WMS product path for atmospheric context. It cannot identify eruption cause or predict activity by itself.",
    endpointTemplate:
      "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&LAYERS=OMPS_NOAA20_SO2_Lower_Troposphere&TIME={date}&BBOX={bbox}",
    requiresCredential: false,
    authNote: "No authentication is documented for the public GIBS visualization service.",
    documentationUrl:
      "https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/OMPS_NOAA20_SO2_Lower_Troposphere.json",
    requiredLimitations: [
      "Satellite sulfur dioxide is atmospheric column context, not proof that a named volcano erupted or caused a plume.",
      "The approximately 17 by 13 km swath scale, orbit timing, clouds, retrieval quality, and plume altitude assumptions limit interpretation.",
      "This product must never be used to predict eruption timing, earthquake activity, evacuation need, or individual exposure.",
    ],
    supportedDataModes: ["live", "fixture", "historical"],
  },
  {
    sourceId: "usgs_earthquake_geojson",
    displayName: "USGS Earthquake Catalog GeoJSON Query",
    agency: "USGS / Earthquake Hazards Program",
    hazardIds: ["earth_volcanoes"],
    decision: "go_supporting_only",
    role:
      "Observed earthquake catalog event data only. " +
      "Must never be used to predict future earthquakes or eruption timing. " +
      "'No observation' in a bounded query is not proof of seismic safety.",
    endpointTemplate:
      "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime={startUtc}&endtime={endUtc}&minlatitude={south}&maxlatitude={north}&minlongitude={west}&maxlongitude={east}&eventtype=earthquake&orderby=time-asc&limit=2000&nodata=204",
    requiresCredential: false,
    authNote: "No authentication required. Public bounded FDSN event query.",
    documentationUrl: "https://earthquake.usgs.gov/fdsnws/event/1/",
    requiredLimitations: [
      "This source reports observed catalog events that may be automatic, reviewed, or later revised.",
      "No earthquake or eruption prediction is or can be made from this data.",
      "Co-occurrence with satellite or volcano evidence does not establish causality.",
      "No observation in a bounded query is not proof of no seismic hazard.",
    ],
    supportedDataModes: ["live", "fixture", "historical"],
  },
  {
    sourceId: "usgs_volcano_hans",
    displayName: "USGS Volcano Hazards Notification System (HANS)",
    agency: "USGS / Volcano Hazards Program",
    hazardIds: ["earth_volcanoes"],
    decision: "go_supporting_only",
    role:
      "Official volcanic activity notices from USGS VHP. " +
      "Reports observed activity; must never be used to predict eruption timing or volcanic risk scores. " +
      "'No notice' is not proof of no volcanic hazard.",
    endpointTemplate: "https://volcanoes.usgs.gov/hans-public/api/vona",
    requiresCredential: false,
    authNote: "Public HANS API. Availability may vary; treat unavailability as source_failure.",
    documentationUrl: "https://volcanoes.usgs.gov/hans-public/",
    requiredLimitations: [
      "HANS reports observed volcanic activity; it does not predict eruption timing.",
      "No active notice is not proof of no volcanic hazard.",
      "API availability may vary; unavailability must be reported as source_failure.",
    ],
    supportedDataModes: ["live", "fixture"],
  },
  {
    sourceId: "us_drought_monitor_rest",
    displayName: "U.S. Drought Monitor REST Service",
    agency: "NDMC / USDA / NOAA",
    hazardIds: ["drought_land"],
    decision: "go_supporting",
    role:
      "Supporting weekly state or territory drought-category percentages for a validated U.S. canonical area. " +
      "Census geometry resolves the administrative area before the request; statewide percentages remain regional context and never property evidence.",
    endpointTemplate:
      "https://usdmdataservices.unl.edu/api/{areaType}/GetDroughtSeverityStatisticsByAreaPercent?aoi={areaCode}&startdate={M/D/YYYY}&enddate={M/D/YYYY}&statisticsType=1",
    requiresCredential: false,
    authNote:
      "No authentication is documented for the official statistics service. Request JSON with Accept: application/json. Census-to-USDM routing and a non-Arizona territory request passed the bounded live gate.",
    documentationUrl:
      "https://www.droughtmonitor.unl.edu/DmData/DataDownload/WebServiceInfo.aspx",
    requiredLimitations: [
      "U.S. Drought Monitor provides broad regional context, not property-level vegetation, soil-moisture, crop-loss, or household water-supply assessment.",
      "The weekly map is released Thursday and reflects conditions through the preceding Tuesday; valid date, retrieval time, and cadence must remain visible.",
      "D0 means abnormally dry and is not a drought category; D1 through D4 are drought categories.",
      "A regional None or D0 result is not proof of no local drought impact, no water concern, or safe property conditions.",
      "Missing rows, malformed percentages, unsupported areas, stale data, and source failure must remain separate fail-closed states.",
    ],
    supportedDataModes: ["live", "fixture"],
  },
  {
    sourceId: "us_census_tigerweb_state_boundaries",
    displayName: "U.S. Census TIGERweb State and Territory Boundaries",
    agency: "U.S. Census Bureau",
    hazardIds: ["drought_land"],
    decision: "go_supporting_only",
    role:
      "Live administrative routing source for resolving a validated canonical bounding box " +
      "to one geographically applicable U.S. state or territory before a USDM statistics request. " +
      "It contributes source selection only and is not hazard evidence.",
    endpointTemplate:
      "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query?geometry={bbox}&f=geojson",
    requiresCredential: false,
    authNote: "No authentication is documented for the public TIGERweb ArcGIS REST service.",
    documentationUrl:
      "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer",
    requiredLimitations: [
      "The boundary response selects an administrative statistics area; it is not drought evidence or a property boundary.",
      "Coastal, border, malformed, no-intersection, and provider-failure outcomes must fail closed rather than defaulting to a state.",
      "The selected state or territory is used only for broad-area U.S. Drought Monitor statistics.",
    ],
    supportedDataModes: ["live"],
  },
  {
    sourceId: "earth_volcano_satellite_primary",
    displayName: "Earth and Volcano Satellite Primary Source (Unselected)",
    agency: "Unselected",
    hazardIds: ["earth_volcanoes"],
    decision: "defer",
    role:
      "Deferred placeholder documenting that WP-02 selected no primary satellite dataset " +
      "for earthquake or volcano evidence. A later approved decision must name and validate a product.",
    endpointTemplate: "https://search.earthdata.nasa.gov/search",
    requiresCredential: true,
    authNote: "Authentication and access depend on the future selected product.",
    documentationUrl: "https://www.earthdata.nasa.gov/",
    requiredLimitations: [
      "No primary satellite source is selected or approved for this hazard in WP-02.",
      "Satellite observations must never be used to predict earthquake or eruption timing.",
    ],
    supportedDataModes: ["unavailable"],
  },
  {
    sourceId: "ai_in_space_lab",
    displayName: "Hands-on Labs 04_ai_in_space Training Exercise",
    agency: "Educational repository; not an authoritative data agency",
    hazardIds: [
      "fire_smoke",
      "flood_storm",
      "extreme_heat",
      "drought_land",
      "air_quality",
      "earth_volcanoes",
    ],
    decision: "reject",
    role:
      "Rejected as a product evidence source. Its hand-labelled machine-learning workflow " +
      "may inform teaching or method design but cannot support product observations or decisions.",
    endpointTemplate: "https://github.com/HuiYingChung/hands-on-labs/tree/main/04_ai_in_space",
    requiresCredential: false,
    authNote: "Public educational repository; access does not make it authoritative evidence.",
    documentationUrl: "https://github.com/HuiYingChung/hands-on-labs/tree/main/04_ai_in_space",
    requiredLimitations: [
      "Rejected: hand-labelled educational examples are not observations, official alerts, or authoritative scientific evidence.",
      "No product conclusion may cite this lab as a data source.",
    ],
    supportedDataModes: ["unavailable"],
  },
];

// Validate all entries at module load time.
// This prevents an unvalidated registry from being imported silently.
for (const entry of ENTRIES) {
  validateDatasetRegistryEntry(entry);
}

export const DATASET_REGISTRY: readonly DatasetRegistryEntry[] = ENTRIES;

/** Look up a registry entry by sourceId. Returns undefined when not found. */
export function getRegistryEntry(sourceId: string): DatasetRegistryEntry | undefined {
  return ENTRIES.find((e) => e.sourceId === sourceId);
}

/** Returns only entries with `go` or `go_supporting` or `go_supporting_only` decisions. */
export function getActiveEntries(): DatasetRegistryEntry[] {
  return ENTRIES.filter((e) => e.decision.startsWith("go"));
}

/** Returns entries applicable to a specific hazard ID. */
export function getEntriesForHazard(hazardId: HazardId): DatasetRegistryEntry[] {
  return ENTRIES.filter((e) => e.hazardIds.includes(hazardId) && e.decision.startsWith("go"));
}

/** Returns every candidate decision for a hazard, including defer and reject. */
export function getCandidateEntriesForHazard(hazardId: HazardId): DatasetRegistryEntry[] {
  return ENTRIES.filter((e) => e.hazardIds.includes(hazardId));
}
