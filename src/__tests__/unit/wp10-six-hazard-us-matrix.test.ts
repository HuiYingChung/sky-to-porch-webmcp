import { describe, expect, it } from "vitest";
import { HAZARD_IDS } from "@/contracts/common";
import { getUsAdministrativeArea } from "@/data/us-administrative-areas";
import { US_COVERAGE_AREA_CASES } from "@/data/us-coverage-matrix";
import { buildAtmosphericRequest } from "@/lib/coverage-gap/atmospheric-source-contract";
import {
  buildGibsNdviWmsUrl,
  buildUsdmAdministrativePercentRequest,
} from "@/lib/drought/source-contracts";
import { selectFireAreaPrimarySource } from "@/lib/fire/live-adapter";
import { buildFloodExtentRequest } from "@/lib/flood/extent-source-contract";
import { buildPreparedGhcnhGroundPlan } from "@/lib/heat/ground-source-contract";
import { buildPreparedGhcnhWindPlan } from "@/lib/storm/ground-source-contract";

describe("seven-hazard U.S. coverage source-plan matrix", () => {
  it.each(US_COVERAGE_AREA_CASES)(
    "$region / $label has a deterministic geographically addressed path for every selectable hazard",
    (coverageCase) => {
      const administrativeArea = getUsAdministrativeArea(coverageCase.expectedUsdmArea.fips)!;
      const firePrimary = selectFireAreaPrimarySource(coverageCase.area);
      const floodExtent = buildFloodExtentRequest("2024-07-08", coverageCase.area);
      const heatGround = buildPreparedGhcnhGroundPlan("2024-07-08", coverageCase.area);
      const windGround = buildPreparedGhcnhWindPlan("2024-07-08", coverageCase.area);
      const droughtSatellite = new URL(buildGibsNdviWmsUrl("2024-06-04", coverageCase.area));
      const droughtRegional = buildUsdmAdministrativePercentRequest(
        "2024-06-04",
        administrativeArea
      );
      const airSatellite = buildAtmosphericRequest(
        "nasa_gibs_modis_aod",
        "2024-07-08",
        coverageCase.area
      );
      const volcanoSatellite = buildAtmosphericRequest(
        "nasa_gibs_omps_so2",
        "2024-07-08",
        coverageCase.area
      );

      const pathByHazard = {
        fire_smoke: firePrimary,
        flood_storm: floodExtent.sourceId,
        wind_storm: windGround.sourceId,
        extreme_heat: heatGround.sourceId,
        drought_land: `${droughtSatellite.searchParams.get("LAYERS")}:${droughtRegional.administrativeArea.fips}`,
        air_quality: airSatellite.sourceId,
        earth_volcanoes: volcanoSatellite.sourceId,
      } as const;

      expect(Object.keys(pathByHazard).sort()).toEqual([...HAZARD_IDS].sort());
      expect(Object.values(pathByHazard)).not.toContain("unsupported_place");
      expect(firePrimary).toBe(coverageCase.expectedFirePrimary);
      expect(new URL(floodExtent.url).searchParams.get("BBOX")).toBe(
        `${coverageCase.area.west},${coverageCase.area.south},${coverageCase.area.east},${coverageCase.area.north}`
      );
      expect(heatGround.area).toEqual(coverageCase.area);
      expect(windGround.area).toEqual(coverageCase.area);
      expect(windGround.requiredVariables).toEqual(["wind_direction", "wind_speed", "wind_gust"]);
      expect(windGround.outsideAreaFallback).toBe(false);
      expect(droughtSatellite.searchParams.get("BBOX")).toBe(
        `${coverageCase.area.west},${coverageCase.area.south},${coverageCase.area.east},${coverageCase.area.north}`
      );
      expect(airSatellite.area).toEqual(coverageCase.area);
      expect(volcanoSatellite.area).toEqual(coverageCase.area);

      // The bounded live gate promoted the three satellite paths. Heat ground
      // remains prepared because its station-inventory schema failed live validation.
      expect(floodExtent.externalCallsEnabled).toBe(true);
      expect(heatGround.externalCallsEnabled).toBe(false);
      expect(airSatellite.externalCallsEnabled).toBe(true);
      expect(volcanoSatellite.externalCallsEnabled).toBe(true);
    }
  );
});
