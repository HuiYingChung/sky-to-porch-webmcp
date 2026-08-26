import { describe, expect, it } from "vitest";

import type { Observation } from "@/contracts/evidence";
import {
  GIBS_HEAT_LAYER_ID,
  GIBS_HEAT_TILE_MATRIX_SET,
  USCRN_HEAT_PRODUCT,
  assertGibsHeatVisualizationObservation,
  assertUscrnAirTemperatureObservation,
  assertUscrnHeatIndexObservation,
  validateHeatSourceObservation,
} from "@/lib/heat/source-contracts";

const HASH = "7f26420eb6eb8f40c4a9b0f990b0afc99b62eba5c73a6c1068b21494a3bf54ba";

function gibsObservation(): Observation {
  return {
    observationId: "heat-gibs-tucson-2024-07-11",
    provenance: {
      sourceId: "nasa_gibs_modis_lst_day",
      sourceUrl:
        `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${GIBS_HEAT_LAYER_ID}/default/2024-07-11/${GIBS_HEAT_TILE_MATRIX_SET}/7/51/24.png`,
      retrievedAt: "2026-08-11T17:00:00-05:00",
      observedAt: "2024-07-11T00:00:00Z",
      product: GIBS_HEAT_LAYER_ID,
      payloadHash: HASH,
      requestParameters: {
        time: "2024-07-11",
        tileMatrixSet: GIBS_HEAT_TILE_MATRIX_SET,
        tileMatrix: "7",
        tileRow: "51",
        tileCol: "24",
      },
    },
    variableName: "Land-surface temperature visualization",
    textValue: "visualization_available",
    dataMode: "historical",
    metadata: {
      heatRole: "satellite_land_surface_temperature_visualization",
      layerId: GIBS_HEAT_LAYER_ID,
      contentType: "image/png",
      imageWidth: 256,
      imageHeight: 256,
      tileMatrixSet: GIBS_HEAT_TILE_MATRIX_SET,
      tileMatrix: 7,
      tileRow: 51,
      tileCol: 24,
      byteLength: 22974,
      opaqueSampleCount: 256,
      distinctColorCount: 36,
    },
  };
}

function uscrnObservation(
  role: "ground_air_temperature" | "derived_heat_index"
): Observation {
  const air = role === "ground_air_temperature";
  return {
    observationId: air
      ? "heat-uscrn-air-tucson-2024-07-11t00z"
      : "heat-uscrn-index-tucson-2024-07-11t00z",
    provenance: {
      sourceId: "noaa_uscrn_heat_exposure",
      sourceUrl:
        "https://www.ncei.noaa.gov/pub/data/uscrn/products/heat01/CRNHE0101-AZ_Tucson_11_W.csv",
      sourceRecordId: "CRNHE0101-AZ_Tucson_11_W.csv#2024071100",
      retrievedAt: "2026-08-11T17:00:00-05:00",
      observedAt: "2024-07-11T00:00:00Z",
      product: USCRN_HEAT_PRODUCT,
      payloadHash: "a".repeat(64),
      requestParameters: {
        station: "AZ_Tucson_11_W",
        utcDate: "2024-07-11",
      },
    },
    variableName: air ? "Hourly air temperature" : "Hourly heat index",
    value: air ? 41.7 : 38.9,
    unit: "degC",
    dataMode: "historical",
    periodStart: "2024-07-10T23:00:00Z",
    periodEnd: "2024-07-11T00:00:00Z",
    metadata: {
      heatRole: role,
      stationId: "AZ_Tucson_11_W",
      stationName: "AZ Tucson 11 W",
      stationLatitude: 32.24,
      stationLongitude: -111.17,
      relativeHumidityPct: 11,
      fieldName: air ? "DRY_BULB_TEMPERATURE_C" : "HEAT_INDEX_C",
      fileFormat: "CRNHE0101",
    },
  };
}

describe("WP-09 heat source contracts", () => {
  it("accepts the locked Tucson GIBS visualization without a numeric temperature", () => {
    const observation = gibsObservation();
    expect(() => assertGibsHeatVisualizationObservation(observation)).not.toThrow();
    expect(() => validateHeatSourceObservation(observation)).not.toThrow();
    expect(observation.value).toBeUndefined();
    expect(observation.unit).toBeUndefined();
  });

  it("rejects the nominal 1km label when used as a WMTS TileMatrixSet identifier", () => {
    const invalidMetadata = gibsObservation();
    invalidMetadata.metadata = { ...invalidMetadata.metadata, tileMatrixSet: "1km" };
    expect(() => assertGibsHeatVisualizationObservation(invalidMetadata)).toThrow(
      /GoogleMapsCompatible_Level7/
    );

    const invalidUrl = gibsObservation();
    invalidUrl.provenance.sourceUrl = invalidUrl.provenance.sourceUrl?.replace(
      GIBS_HEAT_TILE_MATRIX_SET,
      "1km"
    );
    expect(() => assertGibsHeatVisualizationObservation(invalidUrl)).toThrow(
      /GoogleMapsCompatible_Level7/
    );
  });

  it("accepts separated USCRN air-temperature and derived heat-index observations", () => {
    const air = uscrnObservation("ground_air_temperature");
    const index = uscrnObservation("derived_heat_index");
    expect(() => assertUscrnAirTemperatureObservation(air)).not.toThrow();
    expect(() => assertUscrnHeatIndexObservation(index)).not.toThrow();
    expect(() => validateHeatSourceObservation(air)).not.toThrow();
    expect(() => validateHeatSourceObservation(index)).not.toThrow();
  });

  it("fails closed if a GIBS color is presented as a Celsius value", () => {
    const invalid = gibsObservation();
    delete invalid.textValue;
    invalid.value = 45;
    invalid.unit = "degC";
    expect(() => assertGibsHeatVisualizationObservation(invalid)).toThrow(
      /visualization_available|numeric value/
    );
  });

  it("fails closed on swapped USCRN air-temperature and heat-index roles", () => {
    const invalid = uscrnObservation("ground_air_temperature");
    invalid.metadata = {
      ...invalid.metadata,
      heatRole: "derived_heat_index",
    };
    expect(() => assertUscrnAirTemperatureObservation(invalid)).toThrow(
      /ground_air_temperature/
    );
  });

  it("fails closed on unknown or inconsistent stations, invalid humidity, or non-hourly period", () => {
    // ADR-0037: a station outside the generated Heat01 allowlist is rejected.
    const unknownStation = uscrnObservation("derived_heat_index");
    unknownStation.metadata = { ...unknownStation.metadata, stationId: "ZZ_Nowhere_1_N" };
    expect(() => validateHeatSourceObservation(unknownStation)).toThrow(/stationId/);

    // An allowlisted station whose provenance still points at another
    // station's file is inconsistent evidence and must fail closed.
    const inconsistentStation = uscrnObservation("derived_heat_index");
    inconsistentStation.metadata = {
      ...inconsistentStation.metadata,
      stationId: "AZ_Elgin_5_S",
    };
    expect(() => validateHeatSourceObservation(inconsistentStation)).toThrow(/sourceUrl/);

    const invalidHumidity = uscrnObservation("derived_heat_index");
    invalidHumidity.metadata = { ...invalidHumidity.metadata, relativeHumidityPct: 101 };
    expect(() => validateHeatSourceObservation(invalidHumidity)).toThrow(/\[0, 100\]/);

    const invalidPeriod = uscrnObservation("derived_heat_index");
    invalidPeriod.periodStart = "2024-07-10T22:00:00Z";
    expect(() => validateHeatSourceObservation(invalidPeriod)).toThrow(/exactly one hour/);
  });

  it("rejects unregistered heat source roles instead of silently ignoring them", () => {
    const invalid = uscrnObservation("derived_heat_index");
    invalid.metadata = { ...invalid.metadata, heatRole: "indoor_temperature" };
    expect(() => validateHeatSourceObservation(invalid)).toThrow(/unsupported NOAA USCRN heat role/);
  });
});
