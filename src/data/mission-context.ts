export interface MissionContextReference {
  label: string;
  instrument: string;
  overviewUrl: string;
  imageryUrl: string;
  imageryLabel: string;
}

const TERRA: MissionContextReference = {
  label: "NASA Terra",
  instrument: "MODIS (Moderate Resolution Imaging Spectroradiometer)",
  overviewUrl: "https://science.nasa.gov/mission/terra/",
  imageryUrl: "https://science.nasa.gov/science-research/earth-science/terra-the-end-of-an-era/",
  imageryLabel: "Official Terra spacecraft, instrument diagram, and example imagery",
};

const GPM: MissionContextReference = {
  label: "NASA/JAXA Global Precipitation Measurement",
  instrument: "GMI and DPR; IMERG combines the GPM constellation",
  overviewUrl: "https://gpm.nasa.gov/missions/GPM",
  imageryUrl: "https://gpm.nasa.gov/resources/images",
  imageryLabel: "Official GPM spacecraft, instrument diagrams, and example imagery",
};

const NOAA_HMS: MissionContextReference = {
  label: "NOAA Hazard Mapping System",
  instrument: "Analyst-reviewed GOES ABI, VIIRS, MODIS, and related fire/smoke inputs",
  overviewUrl: "https://www.ospo.noaa.gov/products/land/hms.html",
  imageryUrl: "https://www.ospo.noaa.gov/products/land/fire.html",
  imageryLabel: "Official NOAA fire/smoke product examples and sensor context",
};

const FIRMS_VIIRS: MissionContextReference = {
  label: "NASA FIRMS / VIIRS",
  instrument: "VIIRS on Suomi NPP and NOAA-20/NOAA-21 platforms",
  overviewUrl: "https://www.earthdata.nasa.gov/data/tools/firms",
  imageryUrl: "https://viirsland.gsfc.nasa.gov/",
  imageryLabel: "Official VIIRS instrument and mission imagery",
};

const USDM: MissionContextReference = {
  label: "U.S. Drought Monitor",
  instrument: "Multi-agency convergence-of-evidence assessment; not a satellite instrument",
  overviewUrl: "https://www.droughtmonitor.unl.edu/About/WhatistheUSDM.aspx",
  imageryUrl: "https://www.droughtmonitor.unl.edu/Maps/MapViewer.aspx",
  imageryLabel: "Official U.S. Drought Monitor map examples",
};

const CANADIAN_DROUGHT_MONITOR: MissionContextReference = {
  label: "Canadian Drought Monitor",
  instrument: "Multi-source monthly assessment; not a satellite instrument",
  overviewUrl:
    "https://agriculture.canada.ca/en/agriculture-and-environment/drought-watch-and-agroclimate/canadian-drought-monitor",
  imageryUrl:
    "https://agriculture.canada.ca/en/agricultural-production/weather/canadian-drought-monitor/drought-analysis",
  imageryLabel: "Official Canadian Drought Monitor maps and comparisons",
};

export function missionContextReference(
  datasetId: string | undefined,
  missionName: string
): MissionContextReference | null {
  const key = `${datasetId ?? ""} ${missionName}`.toLowerCase();
  if (key.includes("canadian drought monitor") || key.includes("canada_drought_monitor")) {
    return CANADIAN_DROUGHT_MONITOR;
  }
  if (key.includes("u.s. drought monitor") || key.includes("us_drought_monitor")) return USDM;
  if (key.includes("gpm") || key.includes("imerg") || key.includes("precipitation measurement")) return GPM;
  if (key.includes("terra") || key.includes("modis") || key.includes("surface_temp") || key.includes("ndvi")) return TERRA;
  if (key.includes("firms") || key.includes("suomi") || key.includes("viirs")) return FIRMS_VIIRS;
  if (key.includes("hms") || key.includes("hazard mapping")) return NOAA_HMS;
  return null;
}
