import type { BoundingBox } from "@/contracts/common";
import type { FireAreaPrimarySource } from "@/lib/fire/live-adapter";

export type UsCoverageTag =
  | "regional"
  | "coastal"
  | "border"
  | "territory"
  | "no_station_candidate";

export interface UsCoverageAreaCase {
  id: string;
  label: string;
  region: string;
  area: BoundingBox;
  tags: readonly UsCoverageTag[];
  expectedFirePrimary: FireAreaPrimarySource;
  expectedUsdmArea: { fips: string; name: string };
}

/**
 * Deterministic routing/acceptance cases, not observations and not a claim
 * that every hazard source currently has complete coverage in each area.
 */
export const US_COVERAGE_AREA_CASES: readonly UsCoverageAreaCase[] = [
  { id: "northeast-new-york", label: "New York metro", region: "Northeast", area: { west: -74.3, south: 40.4, east: -73.6, north: 41 }, tags: ["regional", "coastal"], expectedFirePrimary: "noaa_hms", expectedUsdmArea: { fips: "36", name: "New York" } },
  { id: "southeast-miami", label: "Miami coast", region: "Southeast", area: { west: -80.4, south: 25.6, east: -80, north: 26 }, tags: ["regional", "coastal"], expectedFirePrimary: "noaa_hms", expectedUsdmArea: { fips: "12", name: "Florida" } },
  { id: "great-lakes-chicago", label: "Chicago and Lake Michigan", region: "Great Lakes", area: { west: -88, south: 41.6, east: -87.4, north: 42.1 }, tags: ["regional", "coastal"], expectedFirePrimary: "noaa_hms", expectedUsdmArea: { fips: "17", name: "Illinois" } },
  { id: "plains-wichita", label: "Wichita area", region: "Plains", area: { west: -97.6, south: 37.4, east: -97.1, north: 37.9 }, tags: ["regional"], expectedFirePrimary: "noaa_hms", expectedUsdmArea: { fips: "20", name: "Kansas" } },
  { id: "mountain-west-denver", label: "Denver Front Range", region: "Mountain West", area: { west: -105.3, south: 39.5, east: -104.7, north: 40 }, tags: ["regional"], expectedFirePrimary: "noaa_hms", expectedUsdmArea: { fips: "08", name: "Colorado" } },
  { id: "southwest-tucson", label: "Tucson area", region: "Southwest", area: { west: -111.3, south: 32, east: -110.7, north: 32.6 }, tags: ["regional"], expectedFirePrimary: "noaa_hms", expectedUsdmArea: { fips: "04", name: "Arizona" } },
  { id: "pacific-seattle", label: "Seattle and Puget Sound", region: "Pacific", area: { west: -122.6, south: 47.4, east: -122.1, north: 47.9 }, tags: ["regional", "coastal"], expectedFirePrimary: "noaa_hms", expectedUsdmArea: { fips: "53", name: "Washington" } },
  { id: "alaska-anchorage", label: "Anchorage area", region: "Alaska", area: { west: -150.3, south: 60.9, east: -149.3, north: 61.5 }, tags: ["regional", "coastal"], expectedFirePrimary: "noaa_hms", expectedUsdmArea: { fips: "02", name: "Alaska" } },
  { id: "hawaii-honolulu", label: "Honolulu area", region: "Hawaii", area: { west: -158.2, south: 21.1, east: -157.5, north: 21.6 }, tags: ["regional", "coastal"], expectedFirePrimary: "noaa_hms", expectedUsdmArea: { fips: "15", name: "Hawaii" } },
  { id: "puerto-rico-san-juan", label: "San Juan area", region: "Puerto Rico", area: { west: -66.3, south: 18.2, east: -65.7, north: 18.6 }, tags: ["regional", "coastal", "territory"], expectedFirePrimary: "noaa_hms", expectedUsdmArea: { fips: "72", name: "Puerto Rico" } },
  { id: "usvi-st-croix", label: "St. Croix area", region: "U.S. Virgin Islands", area: { west: -65, south: 17.6, east: -64.5, north: 18 }, tags: ["coastal", "territory"], expectedFirePrimary: "noaa_hms", expectedUsdmArea: { fips: "78", name: "U.S. Virgin Islands" } },
  { id: "border-el-paso", label: "El Paso border area", region: "Southwest border", area: { west: -106.8, south: 31.5, east: -106.2, north: 32 }, tags: ["border"], expectedFirePrimary: "noaa_hms", expectedUsdmArea: { fips: "48", name: "Texas" } },
  { id: "no-station-central-nevada", label: "Central Nevada sparse-station case", region: "Mountain West", area: { west: -117.5, south: 38.5, east: -116.5, north: 39.5 }, tags: ["no_station_candidate"], expectedFirePrimary: "noaa_hms", expectedUsdmArea: { fips: "32", name: "Nevada" } },
  { id: "territory-guam", label: "Guam area", region: "Pacific territory", area: { west: 144.5, south: 13.2, east: 145, north: 13.7 }, tags: ["coastal", "territory"], expectedFirePrimary: "nasa_firms", expectedUsdmArea: { fips: "66", name: "Guam" } },
  { id: "territory-american-samoa", label: "Tutuila area", region: "Pacific territory", area: { west: -170.9, south: -14.5, east: -170.5, north: -14.1 }, tags: ["coastal", "territory"], expectedFirePrimary: "nasa_firms", expectedUsdmArea: { fips: "60", name: "American Samoa" } },
] as const;
