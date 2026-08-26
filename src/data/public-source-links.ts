const PUBLIC_SOURCE_URLS: Readonly<Record<string, string>> = {
  noaa_hms_fire_points: "https://www.ospo.noaa.gov/products/land/hms.html",
  noaa_hms_smoke_polygons: "https://www.ospo.noaa.gov/products/land/hms.html",
  nasa_firms: "https://firms.modaps.eosdis.nasa.gov/",
  nasa_gibs_imerg: "https://worldview.earthdata.nasa.gov/",
  nasa_gibs_modis_lst_day: "https://worldview.earthdata.nasa.gov/",
  nasa_gibs_modis_ndvi_16day: "https://worldview.earthdata.nasa.gov/",
  usgs_instantaneous_values: "https://waterdata.usgs.gov/nwis",
  canada_geomet: "https://api.weather.gc.ca/",
  noaa_uscrn_heat_exposure: "https://www.ncei.noaa.gov/access/crn/",
  nws_station_observations: "https://www.weather.gov/documentation/services-web-api",
  noaa_ncei_global_hourly:
    "https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly",
  us_drought_monitor_rest: "https://droughtmonitor.unl.edu/DmData/WebServiceInfo.aspx",
};

/** Safe public documentation/viewer URL; never returns an observation request URL. */
export function publicSourceUrl(sourceId: string): string | null {
  return PUBLIC_SOURCE_URLS[sourceId] ?? null;
}
