import { describe, expect, it } from "vitest";
import { US_ADMINISTRATIVE_AREAS, getUsAdministrativeArea } from "@/data/us-administrative-areas";
import { US_COVERAGE_AREA_CASES } from "@/data/us-coverage-matrix";
import { buildUsdmAdministrativePercentRequest } from "@/lib/drought/source-contracts";
import {
  NCEI_GHCNH_DATASET_SLUG,
  buildPreparedGhcnhGroundPlan,
  getGhcnhReadiness,
} from "@/lib/heat/ground-source-contract";

describe("nationwide Heat ground and USDM administrative preparation", () => {
  it("keeps a complete allowlist of states, DC, and named inhabited territories", () => {
    expect(US_ADMINISTRATIVE_AREAS).toHaveLength(56);
    expect(new Set(US_ADMINISTRATIVE_AREAS.map((area) => area.fips)).size).toBe(56);
    expect(getUsAdministrativeArea("11")?.name).toBe("District of Columbia");
    expect(getUsAdministrativeArea("72")?.name).toBe("Puerto Rico");
  });

  it.each(US_COVERAGE_AREA_CASES)(
    "builds a truthful regional USDM contract for $region / $label",
    (coverageCase) => {
      const administrativeArea = getUsAdministrativeArea(coverageCase.expectedUsdmArea.fips)!;
      expect(administrativeArea.name).toBe(coverageCase.expectedUsdmArea.name);
      const request = buildUsdmAdministrativePercentRequest("2024-06-04", administrativeArea);
      expect(request.requestParameters.aoi).toBe(administrativeArea.fips);
      expect(request.url).toContain("/StateStatistics/GetDroughtSeverityStatisticsByAreaPercent");
      expect(request.productScale).toBe("state_or_territory_percent_of_area");
      expect(request.propertyScaleSupported).toBe(false);
    }
  );

  it("rejects unregistered or label-mismatched administrative inputs", () => {
    expect(() => buildUsdmAdministrativePercentRequest("2024-06-04", {
      fips: "99",
      name: "Invented",
      postalCode: "XX",
      kind: "territory",
    })).toThrow("allowlist");
    expect(() => buildUsdmAdministrativePercentRequest("2024-06-04", {
      ...getUsAdministrativeArea("36")!,
      name: "New Jersey",
    })).toThrow("allowlist");
  });

  it.each(US_COVERAGE_AREA_CASES)(
    "builds an inert GHCNh nearest-station preparation plan for $region / $label",
    (coverageCase) => {
      const plan = buildPreparedGhcnhGroundPlan("2024-07-08", coverageCase.area);
      const url = new URL(plan.discoveryUrl);
      expect(plan.datasetSlug).toBe(NCEI_GHCNH_DATASET_SLUG);
      expect(url.hostname).toBe("www.ncei.noaa.gov");
      expect(url.searchParams.get("bbox")).toBe(
        `${coverageCase.area.north},${coverageCase.area.west},${coverageCase.area.south},${coverageCase.area.east}`
      );
      expect(plan.requiredVariables).toEqual(["temperature", "relative_humidity"]);
      expect(plan.maximumRequests).toBe(5);
      expect(plan.maximumConcurrency).toBe(1);
      expect(plan.externalCallsEnabled).toBe(false);
      expect(plan.productQueryable).toBe(true);
    }
  );

  it("reports the GHCNh product path as wired after the authorized live gate (ADR-0039)", () => {
    const readiness = getGhcnhReadiness();
    expect(readiness).toMatchObject({
      registryDecision: "go_supporting",
      productQueryable: true,
    });
    expect(readiness.wiringNote).toMatch(/ADR-0035\/0036/);
    expect(readiness.wiringNote).toMatch(/smoke:ghcnh:live/);
    expect(readiness.wiringNote).toMatch(/ADR-0039/);
    expect(readiness.wiringNote).toMatch(/publication window/i);
  });
});
