import { describe, expect, it } from "vitest";

import type { Observation } from "@/contracts/evidence";
import {
  DROUGHT_SYNTHETIC_FIXTURE_KIND,
  GIBS_DROUGHT_BBOX,
  GIBS_DROUGHT_IMAGE_SIZE,
  GIBS_DROUGHT_LAYER_ID,
  GIBS_DROUGHT_NATIVE_SCALE_METERS,
  GIBS_DROUGHT_PRODUCT,
  GIBS_DROUGHT_TILE_MATRIX_SET,
  USDM_ARIZONA_STATE_FIPS,
  USDM_DROUGHT_PRODUCT,
  USDM_PERCENT_TOLERANCE,
  assertGibsDroughtVegetationObservation,
  assertUsdmNoObservationMarker,
  assertUsdmRegionalDroughtObservation,
  buildGibsNdviDescribeDomainsUrl,
  buildGibsNdviWmsUrl,
  buildUsdmArizonaPercentRequest,
  gibsNdviBoundingBox,
  gibsNdviRequestParameters,
  validateDroughtSourceObservation,
  validateGibsNdviInspection,
  validateUsdmTraditionalPercentSummary,
} from "@/lib/drought/source-contracts";

const GIBS_DATE = "2024-05-24";
const USDM_DATE = "2024-06-04";
const RETRIEVED_AT = "2026-08-12T22:30:00Z";
const GIBS_HASH = "ad1fd88ad02d9ed2a160cb187b534f8d9532bd9a4d41b4246c245ee60dffcba9";
const USDM_HASH = "15737f7fb6a242cf28afeb9f33e009ec589cec07f8c4948ac90cc571ebe96369";

function gibsObservation(): Observation {
  return {
    observationId: "obs-wp10-gibs-synthetic-20240524",
    provenance: {
      sourceId: "nasa_gibs_modis_ndvi_16day",
      sourceUrl: buildGibsNdviWmsUrl(GIBS_DATE),
      retrievedAt: RETRIEVED_AT,
      observedAt: `${GIBS_DATE}T00:00:00Z`,
      product: GIBS_DROUGHT_PRODUCT,
      payloadHash: GIBS_HASH,
      requestParameters: gibsNdviRequestParameters(GIBS_DATE),
    },
    variableName: "16-day NDVI visualization",
    textValue: "synthetic_visualization_contract_fixture",
    dataMode: "fixture",
    qualifiers: [
      "synthetic_fixture",
      "visualization_only",
      "numeric_ndvi_not_inferred",
      "regional_not_property",
    ],
    metadata: {
      droughtRole: "satellite_vegetation_visualization",
      layerId: GIBS_DROUGHT_LAYER_ID,
      contentType: "image/png",
      imageWidth: GIBS_DROUGHT_IMAGE_SIZE,
      imageHeight: GIBS_DROUGHT_IMAGE_SIZE,
      nativeScaleMeters: GIBS_DROUGHT_NATIVE_SCALE_METERS,
      compositePeriodDays: 16,
      boundingBox: GIBS_DROUGHT_BBOX,
      byteLength: 0,
      opaqueSampleCount: 0,
      distinctColorCount: 0,
      fixtureKind: DROUGHT_SYNTHETIC_FIXTURE_KIND,
    },
  };
}

function usdmObservation(): Observation {
  const request = buildUsdmArizonaPercentRequest(USDM_DATE);
  return {
    observationId: "obs-wp10-usdm-synthetic-20240604",
    provenance: {
      sourceId: "us_drought_monitor_rest",
      sourceUrl: request.url,
      sourceRecordId:
        `synthetic-contract-fixture#StateStatistics#${USDM_ARIZONA_STATE_FIPS}#${USDM_DATE}`,
      retrievedAt: RETRIEVED_AT,
      observedAt: `${USDM_DATE}T00:00:00Z`,
      product: USDM_DROUGHT_PRODUCT,
      payloadHash: USDM_HASH,
      requestParameters: request.requestParameters,
    },
    variableName: "Regional drought area statistics",
    textValue: "synthetic_regional_statistics_contract_fixture",
    dataMode: "fixture",
    qualifiers: [
      "synthetic_fixture",
      "regional_state_scale",
      "weekly_product",
      "d0_is_not_drought",
      "property_inference_not_supported",
    ],
    metadata: {
      droughtRole: "regional_drought_statistics",
      areaType: "StateStatistics",
      stateFips: "04",
      areaName: "Arizona",
      statisticsFormat: "traditional_cumulative_percent_of_area",
      unit: "percent",
      mapValidDay: "Tuesday",
      releaseDay: "Thursday",
      cadenceDays: 7,
      nonePct: 40,
      d0Pct: 60,
      d1Pct: 45,
      d2Pct: 25,
      d3Pct: 10,
      d4Pct: 0,
      fixtureKind: DROUGHT_SYNTHETIC_FIXTURE_KIND,
    },
  };
}

describe("WP-10 drought request preparation", () => {
  it("builds allowlisted descriptions without making a request", () => {
    const gibs = new URL(buildGibsNdviWmsUrl(GIBS_DATE));
    expect(gibs.hostname).toBe("gibs.earthdata.nasa.gov");
    expect(gibs.pathname).toBe("/wms/epsg4326/std/wms.cgi");
    expect(gibs.searchParams.get("LAYERS")).toBe(GIBS_DROUGHT_LAYER_ID);
    expect(GIBS_DROUGHT_LAYER_ID).toBe("MODIS_Terra_L3_NDVI_16Day_v6.1_STD");
    expect(gibs.searchParams.get("BBOX")).toBe(GIBS_DROUGHT_BBOX);
    expect(gibs.searchParams.get("TIME")).toBe(GIBS_DATE);
    expect(GIBS_DROUGHT_TILE_MATRIX_SET).toBe("250m");
    expect(GIBS_DROUGHT_NATIVE_SCALE_METERS).toBe(250);

    const customArea = { west: -74.3, south: 40.4, east: -73.6, north: 41 };
    const customGibs = new URL(buildGibsNdviWmsUrl(GIBS_DATE, customArea));
    expect(customGibs.searchParams.get("BBOX")).toBe("-74.3,40.4,-73.6,41");
    expect(gibsNdviBoundingBox(customArea)).toBe("-74.3,40.4,-73.6,41");
    expect(gibsNdviRequestParameters(GIBS_DATE, customArea).BBOX).toBe(
      "-74.3,40.4,-73.6,41"
    );

    const domains = new URL(
      buildGibsNdviDescribeDomainsUrl("2024-05-01", "2024-06-30")
    );
    expect(domains.hostname).toBe("gitc.earthdata.nasa.gov");
    expect(domains.pathname).toBe(
      "/wmts/epsg4326/std/1.0.0/" +
        "MODIS_Terra_L3_NDVI_16Day_v6.1_STD/default/250m/all/" +
        "2024-05-01--2024-06-30.xml"
    );
    expect(domains.search).toBe("");

    const usdm = buildUsdmArizonaPercentRequest(USDM_DATE);
    expect(new URL(usdm.url).hostname).toBe("usdmdataservices.unl.edu");
    expect(new URL(usdm.url).pathname).toContain(
      "/StateStatistics/GetDroughtSeverityStatisticsByAreaPercent"
    );
    expect(usdm.headers).toEqual({ Accept: "application/json" });
    expect(usdm.requestParameters).toMatchObject({
      aoi: "04",
      startDate: "6/4/2024",
      endDate: "6/4/2024",
      statisticsType: "1",
    });
  });

  it("rejects non-Tuesday USDM requests before transport", () => {
    expect(() => buildUsdmArizonaPercentRequest("2024-06-05")).toThrow(/Tuesday/);
    expect(() => buildUsdmArizonaPercentRequest("2024-02-30")).toThrow(/calendar date/);
  });
});

describe("WP-10 drought normalized validators", () => {
  it("accepts the fixture-only visualization without numeric NDVI", () => {
    const observation = gibsObservation();
    expect(() => assertGibsDroughtVegetationObservation(observation)).not.toThrow();
    expect(() => validateDroughtSourceObservation(observation)).not.toThrow();
    expect(observation.value).toBeUndefined();
    expect(observation.unit).toBeUndefined();
  });

  it("rejects live mode and any synthetic image that impersonates inspected bytes", () => {
    const live = gibsObservation();
    live.dataMode = "live";
    expect(() => assertGibsDroughtVegetationObservation(live)).toThrow(/fixture-only/);

    const inventedPayload = gibsObservation();
    inventedPayload.metadata = { ...inventedPayload.metadata, byteLength: 100 };
    expect(() => assertGibsDroughtVegetationObservation(inventedPayload)).toThrow(
      /must not impersonate/
    );

    const obsoleteScale = gibsObservation();
    obsoleteScale.metadata = { ...obsoleteScale.metadata, nativeScaleMeters: 1000 };
    expect(() => assertGibsDroughtVegetationObservation(obsoleteScale)).toThrow(
      /nativeScaleMeters must remain 250/
    );
  });

  it("validates traditional cumulative USDM percentages and rejects drift", () => {
    expect(() => validateUsdmTraditionalPercentSummary({
      nonePct: 40,
      d0Pct: 60,
      d1Pct: 45,
      d2Pct: 25,
      d3Pct: 10,
      d4Pct: 0,
    })).not.toThrow();
    expect(() => validateUsdmTraditionalPercentSummary({
      nonePct: 40.005,
      d0Pct: 59.995,
      d1Pct: 60,
      d2Pct: 25,
      d3Pct: 10,
      d4Pct: 0,
    })).not.toThrow();
    expect(USDM_PERCENT_TOLERANCE).toBe(0.01);
    expect(() => validateUsdmTraditionalPercentSummary({
      nonePct: 40,
      d0Pct: 60,
      d1Pct: 65,
      d2Pct: 25,
      d3Pct: 10,
      d4Pct: 0,
    })).toThrow(/D0 >= D1/);
    expect(() => validateUsdmTraditionalPercentSummary({
      nonePct: 20,
      d0Pct: 60,
      d1Pct: 45,
      d2Pct: 25,
      d3Pct: 10,
      d4Pct: 0,
      unexpected: 5,
    })).toThrow(/unexpected/);
  });

  it("accepts separated regional statistics without making a property claim", () => {
    const observation = usdmObservation();
    expect(() => assertUsdmRegionalDroughtObservation(observation)).not.toThrow();
    expect(() => validateDroughtSourceObservation(observation)).not.toThrow();
    expect(observation.metadata?.d1Pct).toBe(45);
    expect(observation.qualifiers).toContain("property_inference_not_supported");
  });

  it("accepts a zero-row marker but never a zero-percent substitute", () => {
    const request = buildUsdmArizonaPercentRequest("2024-06-11");
    const marker: Observation = {
      observationId: "obs-wp10-usdm-synthetic-no-row-20240611",
      provenance: {
        sourceId: "us_drought_monitor_rest",
        sourceUrl: request.url,
        sourceRecordId: "synthetic-contract-fixture#StateStatistics#04#2024-06-11#no-row",
        retrievedAt: RETRIEVED_AT,
        observedAt: "2024-06-11T00:00:00Z",
        product: USDM_DROUGHT_PRODUCT,
        payloadHash: "8025c8334bb6bf55c98ddb228ba92026e70cccd169a0c84faf3a6c26b414fd87",
        requestParameters: request.requestParameters,
      },
      variableName: "Regional drought statistics response rows",
      textValue: "no_regional_row_returned",
      dataMode: "fixture",
      qualifiers: [
        "synthetic_fixture",
        "regional_state_scale",
        "weekly_product",
        "d0_is_not_drought",
        "property_inference_not_supported",
      ],
      metadata: {
        droughtRole: "regional_drought_statistics",
        areaType: "StateStatistics",
        stateFips: "04",
        areaName: "Arizona",
        statisticsFormat: "traditional_cumulative_percent_of_area",
        mapValidDay: "Tuesday",
        releaseDay: "Thursday",
        cadenceDays: 7,
        resultRowCount: 0,
        fixtureKind: DROUGHT_SYNTHETIC_FIXTURE_KIND,
      },
    };
    expect(() => assertUsdmNoObservationMarker(marker)).not.toThrow();
    expect(() => validateDroughtSourceObservation(marker)).not.toThrow();
    expect(marker.metadata).not.toHaveProperty("d0Pct");
  });

  it("validates inspection shape but does not interpret pixel colors", () => {
    expect(() => validateGibsNdviInspection({
      contentType: "image/png",
      imageWidth: 256,
      imageHeight: 256,
      byteLength: 0,
      opaqueSampleCount: 0,
      distinctColorCount: 0,
    })).not.toThrow();
    expect(() => validateGibsNdviInspection({
      contentType: "image/png",
      imageWidth: 512,
      imageHeight: 256,
      byteLength: 1,
      opaqueSampleCount: 1,
      distinctColorCount: 1,
    })).toThrow(/256x256/);
  });
});
