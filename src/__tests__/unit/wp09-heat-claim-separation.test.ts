/// <reference types="vite/client" />

/**
 * src/__tests__/unit/wp09-heat-claim-separation.test.ts
 *
 * WP-09 focused unit tests for separateHeatEvidence.
 *
 * Covers all ten acceptance groups from the canonical prompt.
 * Zero network, environment, filesystem, provider, timer, or random calls.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import {
  separateHeatEvidence,
  HEAT_EVIDENCE_CODES,
} from "@/lib/heat/claim-separation";
import type { EvidenceObject, Observation } from "@/contracts/evidence";

// Static import assertion: the implementation module must not import from
// any network transport, filesystem, or provider module.
import claimSeparationSource from "@/lib/heat/claim-separation.ts?raw";

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

let obsCounter = 0;

function makeGibsObs(overrides: Partial<Observation> = {}): Observation {
  obsCounter += 1;
  const id = `gibs-obs-${obsCounter}`;
  return {
    observationId: id,
    provenance: {
      sourceId: "nasa_gibs_modis_lst_day",
      sourceUrl:
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Land_Surface_Temp_Day/default/2024-07-11/GoogleMapsCompatible_Level7/7/28/35.png",
      sourceRecordId: `gibs-tile-2024-07-11-7-28-35`,
      retrievedAt: "2024-07-11T18:00:00Z",
      observedAt: "2024-07-11T00:00:00Z",
      product: "MODIS_Terra_Land_Surface_Temp_Day",
      payloadHash:
        "a3f4b2c1d0e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1",
    },
    variableName: "Land-surface temperature visualization",
    textValue: "visualization_available",
    dataMode: "fixture",
    metadata: {
      heatRole: "satellite_land_surface_temperature_visualization",
      layerId: "MODIS_Terra_Land_Surface_Temp_Day",
      contentType: "image/png",
      imageWidth: 256,
      imageHeight: 256,
      tileMatrixSet: "GoogleMapsCompatible_Level7",
      tileMatrix: 7,
      tileRow: 28,
      tileCol: 35,
      byteLength: 12345,
      opaqueSampleCount: 100,
      distinctColorCount: 42,
    },
    ...overrides,
  } as Observation;
}

function makeUscrnAirTempObs(overrides: Partial<Observation> = {}): Observation {
  obsCounter += 1;
  const id = `uscrn-air-${obsCounter}`;
  return {
    observationId: id,
    provenance: {
      sourceId: "noaa_uscrn_heat_exposure",
      sourceUrl:
        "https://www.ncei.noaa.gov/pub/data/uscrn/products/heat01/CRNHE0101-AZ_Tucson_11_W.csv",
      sourceRecordId: "CRNHE0101-AZ_Tucson_11_W.csv#2024071118",
      retrievedAt: "2024-07-11T18:30:00Z",
      observedAt: "2024-07-11T18:00:00Z",
      product: "USCRN Heat01 v1.0",
      payloadHash:
        "b4f5c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4",
    },
    variableName: "Hourly air temperature",
    value: 38.5,
    unit: "degC",
    dataMode: "fixture",
    periodStart: "2024-07-11T17:00:00Z",
    periodEnd: "2024-07-11T18:00:00Z",
    metadata: {
      heatRole: "ground_air_temperature",
      stationId: "AZ_Tucson_11_W",
      stationName: "AZ Tucson 11 W",
      stationLatitude: 32.24,
      stationLongitude: -111.17,
      relativeHumidityPct: 15,
      fieldName: "DRY_BULB_TEMPERATURE_C",
      fileFormat: "CRNHE0101",
    },
    ...overrides,
  } as Observation;
}

function makeUscrnHeatIndexObs(overrides: Partial<Observation> = {}): Observation {
  obsCounter += 1;
  const id = `uscrn-hi-${obsCounter}`;
  return {
    observationId: id,
    provenance: {
      sourceId: "noaa_uscrn_heat_exposure",
      sourceUrl:
        "https://www.ncei.noaa.gov/pub/data/uscrn/products/heat01/CRNHE0101-AZ_Tucson_11_W.csv",
      sourceRecordId: "CRNHE0101-AZ_Tucson_11_W.csv#2024071118",
      retrievedAt: "2024-07-11T18:30:00Z",
      observedAt: "2024-07-11T18:00:00Z",
      product: "USCRN Heat01 v1.0",
      payloadHash:
        "c5a6d4e3f2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5",
    },
    variableName: "Hourly heat index",
    value: 42.1,
    unit: "degC",
    dataMode: "fixture",
    periodStart: "2024-07-11T17:00:00Z",
    periodEnd: "2024-07-11T18:00:00Z",
    metadata: {
      heatRole: "derived_heat_index",
      stationId: "AZ_Tucson_11_W",
      stationName: "AZ Tucson 11 W",
      stationLatitude: 32.24,
      stationLongitude: -111.17,
      relativeHumidityPct: 15,
      fieldName: "HEAT_INDEX_C",
      fileFormat: "CRNHE0101",
    },
    ...overrides,
  } as Observation;
}

function makeBaseEvidence(
  observations: Observation[],
  overrides: Partial<EvidenceObject> = {}
): EvidenceObject {
  return {
    evidenceId: "ev-wp09-test-001",
    hazardId: "extreme_heat",
    intentId: "intent-heat-test",
    evidenceState: "observations_returned",
    dataMode: "fixture",
    observations,
    derivedMetrics: [],
    missionAttributions: [],
    freshness: {
      status: "historical",
      classificationBasis: "historical_context",
      mostRecentObservationAt: "2024-07-11T18:00:00Z",
      evaluatedAt: "2024-07-11T18:30:00Z",
      ageSeconds: 1800,
      note: "Fixed historical Tucson path",
    },
    confidence: {
      level: "moderate",
      rationale: "Single Tucson station and GIBS visualization",
    },
    limitations: [
      {
        limitationId: "lim-gibs-visualization-only",
        source: "nasa_gibs_modis_lst_day",
        description:
          "GIBS imagery is visualization only; no numeric temperature is derived from colors.",
        required: true,
      },
      {
        limitationId: "lim-uscrn-tucson-only",
        source: "noaa_uscrn_heat_exposure",
        description:
          "Evidence is from a single Tucson station and cannot establish indoor, household, or personal conditions.",
        required: true,
      },
    ],
    explanations: [],
    assembledAt: "2024-07-11T18:30:00Z",
    ...overrides,
  } as EvidenceObject;
}

/**
 * Per-state suppressed evidence factories that satisfy the EvidenceObject
 * validator constraints for each suppressed evidenceState/dataMode.
 */
function makeSuppressedEvidence(
  state:
    | "no_observation"
    | "source_failure"
    | "unsupported_coverage"
    | "stale_data"
    | "inconclusive_evidence"
    | "failed_mode"
    | "unavailable_mode"
): EvidenceObject {
  const base: EvidenceObject = {
    evidenceId: "ev-wp09-suppressed",
    hazardId: "extreme_heat",
    intentId: "intent-heat-test",
    evidenceState: "no_observation",
    dataMode: "unavailable",
    observations: [],
    derivedMetrics: [],
    missionAttributions: [],
    freshness: {
      status: "unknown",
      classificationBasis: "no_observation_time",
      evaluatedAt: "2024-07-11T18:30:00Z",
      note: "No observation time available",
    },
    confidence: {
      level: "insufficient",
      rationale: "No observations available",
    },
    limitations: [
      {
        limitationId: "lim-no-data",
        source: "noaa_uscrn_heat_exposure",
        description: "No data available for this period.",
        required: true,
      },
    ],
    explanations: [],
    assembledAt: "2024-07-11T18:30:00Z",
  } as EvidenceObject;

  if (state === "no_observation") {
    return { ...base, evidenceState: "no_observation", dataMode: "unavailable" };
  }
  if (state === "source_failure") {
    return {
      ...base,
      evidenceState: "source_failure",
      dataMode: "failed",
    };
  }
  if (state === "unsupported_coverage") {
    return {
      ...base,
      evidenceState: "unsupported_coverage",
      dataMode: "unavailable",
    };
  }
  if (state === "stale_data") {
    // stale_data requires freshness.status="stale".
    // Use age_thresholds: evaluatedAt 2 hours after mostRecentObservationAt
    // (7200s). currentAgeLimitSeconds=600, recentAgeLimitSeconds=3600;
    // 7200 > 3600 → stale status.
    // assembledAt must be >= evaluatedAt.
    return {
      ...base,
      evidenceState: "stale_data",
      dataMode: "historical",
      confidence: { level: "low", rationale: "Stale data" },
      freshness: {
        status: "stale",
        classificationBasis: "age_thresholds",
        mostRecentObservationAt: "2024-07-11T18:00:00Z",
        evaluatedAt: "2024-07-11T20:00:00Z",
        ageSeconds: 7200,
        currentAgeLimitSeconds: 600,
        recentAgeLimitSeconds: 3600,
        note: "Observation is more than the recent window",
      },
      assembledAt: "2024-07-11T20:00:00Z",
    } as EvidenceObject;
  }
  if (state === "inconclusive_evidence") {
    return {
      ...base,
      evidenceState: "inconclusive_evidence",
      dataMode: "fixture",
      confidence: { level: "low", rationale: "Inconclusive evidence" },
      freshness: {
        status: "unknown",
        classificationBasis: "no_observation_time",
        evaluatedAt: "2024-07-11T18:30:00Z",
        note: "No observation time available",
      },
    } as EvidenceObject;
  }
  if (state === "failed_mode") {
    // source_failure + failed dataMode
    return {
      ...base,
      evidenceState: "source_failure",
      dataMode: "failed",
    };
  }
  // unavailable_mode: source_failure + unavailable
  return {
    ...base,
    evidenceState: "source_failure",
    dataMode: "unavailable",
  };
}

/**
 * Create a valid unrelated observation (non-heat source) that passes
 * EvidenceObject validation.
 */
function makeUnrelatedObs(): Observation {
  obsCounter += 1;
  return {
    observationId: `unrelated-obs-${obsCounter}`,
    provenance: {
      sourceId: "noaa_hms_fire_points",
      sourceUrl:
        "https://www.ospo.noaa.gov/Products/land/hms.html",
      retrievedAt: "2024-07-11T18:00:00Z",
      observedAt: "2024-07-11T18:00:00Z",
      product: "HMS Fire Points",
      payloadHash:
        "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    },
    variableName: "Fire detection status",
    textValue: "no_active_fire",
    dataMode: "fixture",
  } as unknown as Observation;
}

// ---------------------------------------------------------------------------
// Acceptance group 1: valid GIBS + USCRN air-temp + USCRN heat-index
// produces evidence_present only for the first three categories
// ---------------------------------------------------------------------------

describe("Acceptance group 1 — valid GIBS + USCRN all-present", () => {
  const gibs = makeGibsObs();
  const airTemp = makeUscrnAirTempObs();
  const heatIndex = makeUscrnHeatIndexObs();
  const ev = makeBaseEvidence([gibs, airTemp, heatIndex]);
  const result = separateHeatEvidence(ev);

  it("returns exactly six assessments", () => {
    expect(result).toHaveLength(6);
  });

  it("codes are in HEAT_EVIDENCE_CODES order", () => {
    expect(result.map((a) => a.code)).toEqual([...HEAT_EVIDENCE_CODES]);
  });

  it("satellite_land_surface_temperature_visualization is evidence_present", () => {
    const a = result[0];
    expect(a.status).toBe("evidence_present");
    expect(a.observationIds).toContain(gibs.observationId);
    expect(a.sourceIds).toContain("nasa_gibs_modis_lst_day");
  });

  it("ground_air_temperature is evidence_present", () => {
    const a = result[1];
    expect(a.status).toBe("evidence_present");
    expect(a.observationIds).toContain(airTemp.observationId);
    expect(a.sourceIds).toContain("noaa_uscrn_heat_exposure");
  });

  it("derived_heat_index is evidence_present", () => {
    const a = result[2];
    expect(a.status).toBe("evidence_present");
    expect(a.observationIds).toContain(heatIndex.observationId);
    expect(a.sourceIds).toContain("noaa_uscrn_heat_exposure");
  });
});

// ---------------------------------------------------------------------------
// Acceptance group 2: not_supported categories are always locked
// ---------------------------------------------------------------------------

describe("Acceptance group 2 — not_supported with empty IDs", () => {
  const ev = makeBaseEvidence([makeGibsObs(), makeUscrnAirTempObs(), makeUscrnHeatIndexObs()]);
  const result = separateHeatEvidence(ev);

  it("indoor_temperature is always not_supported", () => {
    const a = result.find((x) => x.code === "indoor_temperature")!;
    expect(a.status).toBe("not_supported");
    expect(a.observationIds).toEqual([]);
    expect(a.sourceIds).toEqual([]);
  });

  it("household_heat_certainty is always not_supported", () => {
    const a = result.find((x) => x.code === "household_heat_certainty")!;
    expect(a.status).toBe("not_supported");
    expect(a.observationIds).toEqual([]);
    expect(a.sourceIds).toEqual([]);
  });

  it("individual_medical_risk is always not_supported", () => {
    const a = result.find((x) => x.code === "individual_medical_risk")!;
    expect(a.status).toBe("not_supported");
    expect(a.observationIds).toEqual([]);
    expect(a.sourceIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Acceptance group 3: numeric GIBS, swapped role/field, wrong source shape,
// wrong hazard, invalid EvidenceObject fail closed
// ---------------------------------------------------------------------------

describe("Acceptance group 3 — malformed inputs fail closed", () => {
  it("numeric GIBS observation (has value field) throws", () => {
    const badGibs = makeGibsObs({ value: 45.0, unit: "degC" });
    const ev = makeBaseEvidence([badGibs]);
    expect(() => separateHeatEvidence(ev)).toThrow();
  });

  it("GIBS with missing textValue throws", () => {
    const badGibs = makeGibsObs({ textValue: undefined });
    const ev = makeBaseEvidence([badGibs]);
    expect(() => separateHeatEvidence(ev)).toThrow();
  });

  it("GIBS with wrong textValue throws", () => {
    const badGibs = makeGibsObs({ textValue: "visualization_unavailable" });
    const ev = makeBaseEvidence([badGibs]);
    expect(() => separateHeatEvidence(ev)).toThrow();
  });

  it("USCRN: role says ground_air_temperature but fieldName is HEAT_INDEX_C throws", () => {
    // Swapped fieldName is detected by the source contract assertion
    const realSwap = makeUscrnAirTempObs({
      metadata: {
        heatRole: "ground_air_temperature",
        stationId: "AZ_Tucson_11_W",
        stationName: "AZ Tucson 11 W",
        stationLatitude: 32.24,
        stationLongitude: -111.17,
        relativeHumidityPct: 15,
        fieldName: "HEAT_INDEX_C",
        fileFormat: "CRNHE0101",
      },
    });
    const ev = makeBaseEvidence([realSwap]);
    expect(() => separateHeatEvidence(ev)).toThrow();
  });

  it("USCRN with wrong source shape (missing required metadata key) throws", () => {
    const bad = makeUscrnAirTempObs({
      metadata: {
        // Missing "heatRole" and other required keys
        stationId: "AZ_Tucson_11_W",
      },
    });
    const ev = makeBaseEvidence([bad]);
    expect(() => separateHeatEvidence(ev)).toThrow();
  });

  it("wrong hazardId throws", () => {
    // Use a valid non-Heat hazard to exercise the Heat guard (not a TS-invalid value).
    // Use a GIBS observation so validateEvidenceObject passes (matching limitations
    // in makeBaseEvidence), and the Heat guard fires before any other check.
    const gibs = makeGibsObs();
    const ev = makeBaseEvidence([gibs], { hazardId: "fire_smoke" });
    expect(() => separateHeatEvidence(ev)).toThrow(
      /extreme_heat/
    );
  });

  it("null input throws (invalid EvidenceObject)", () => {
    expect(() => separateHeatEvidence(null as unknown as EvidenceObject)).toThrow();
  });

  it("plain object missing required fields throws", () => {
    expect(() =>
      separateHeatEvidence({ hazardId: "extreme_heat" } as unknown as EvidenceObject)
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Acceptance group 4: malformed matching observations fail closed even under
// suppressed parent state/mode
// ---------------------------------------------------------------------------

describe("Acceptance group 4 — malformed matching obs fail closed under suppressed state", () => {
  const suppressedStates = [
    "no_observation",
    "source_failure",
    "unsupported_coverage",
    "stale_data",
    "inconclusive_evidence",
  ] as const;

  for (const state of suppressedStates) {
    it(`state ${state}: malformed GIBS obs still throws`, () => {
      // Validation of matching observations happens before suppression check.
      // A numeric GIBS observation (has value) violates the source contract.
      const badGibs = makeGibsObs({ value: 50 });
      const ev = makeBaseEvidence([badGibs], { evidenceState: state });
      expect(() => separateHeatEvidence(ev)).toThrow();
    });
  }

  for (const mode of ["failed", "unavailable"] as const) {
    it(`dataMode ${mode}: malformed GIBS obs still throws`, () => {
      const badGibs = makeGibsObs({ value: 50 });
      const ev = makeBaseEvidence([badGibs], { dataMode: mode });
      expect(() => separateHeatEvidence(ev)).toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// Acceptance group 5: valid no-data and source-failure yield no source-backed
// evidence and never become a safe conclusion
// ---------------------------------------------------------------------------

describe("Acceptance group 5 — no-data/source-failure yield not_provided, never safe", () => {
  const suppressedKeys = [
    "no_observation",
    "source_failure",
    "unsupported_coverage",
    "stale_data",
    "inconclusive_evidence",
    "failed_mode",
    "unavailable_mode",
  ] as const;

  for (const key of suppressedKeys) {
    it(`${key}: three source-backed categories are not_provided`, () => {
      const ev = makeSuppressedEvidence(key);
      const result = separateHeatEvidence(ev);
      const sourceBacked = result.slice(0, 3);
      for (const a of sourceBacked) {
        expect(a.status).toBe("not_provided");
        expect(a.observationIds).toEqual([]);
        expect(a.sourceIds).toEqual([]);
      }
    });

    it(`${key}: does not produce a safe conclusion`, () => {
      const ev = makeSuppressedEvidence(key);
      const result = separateHeatEvidence(ev);
      for (const a of result) {
        expect(a.status).not.toBe("evidence_present");
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Acceptance group 5b: legal non-returned evidence states (valid_observation_no_anomaly,
// no_active_official_alert) yield not_provided for all source-backed categories
// ---------------------------------------------------------------------------

describe("Acceptance group 5b — valid non-returned states yield not_provided", () => {
  for (const state of ["valid_observation_no_anomaly", "no_active_official_alert"] as const) {
    it(`${state}: three source-backed categories are not_provided with empty IDs`, () => {
      // Both states require at least one validated observation (contract rule).
      const gibs = makeGibsObs();
      const ev = makeBaseEvidence([gibs], { evidenceState: state });
      const result = separateHeatEvidence(ev);
      const sourceBacked = result.slice(0, 3);
      for (const a of sourceBacked) {
        expect(a.status).toBe("not_provided");
        expect(a.observationIds).toEqual([]);
        expect(a.sourceIds).toEqual([]);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Acceptance group 6: missing GIBS or either USCRN role yields not_provided
// only for the missing source-backed category
// ---------------------------------------------------------------------------

describe("Acceptance group 6 — missing individual categories yield not_provided only for that category", () => {
  it("missing GIBS → satellite category not_provided, others unaffected", () => {
    const airTemp = makeUscrnAirTempObs();
    const heatIndex = makeUscrnHeatIndexObs();
    const ev = makeBaseEvidence([airTemp, heatIndex]);
    const result = separateHeatEvidence(ev);

    expect(result[0].status).toBe("not_provided"); // satellite
    expect(result[1].status).toBe("evidence_present"); // air temp
    expect(result[2].status).toBe("evidence_present"); // heat index
  });

  it("missing USCRN air-temperature → ground_air_temperature not_provided", () => {
    const gibs = makeGibsObs();
    const heatIndex = makeUscrnHeatIndexObs();
    const ev = makeBaseEvidence([gibs, heatIndex]);
    const result = separateHeatEvidence(ev);

    expect(result[0].status).toBe("evidence_present"); // satellite
    expect(result[1].status).toBe("not_provided"); // air temp
    expect(result[2].status).toBe("evidence_present"); // heat index
  });

  it("missing USCRN heat-index → derived_heat_index not_provided", () => {
    const gibs = makeGibsObs();
    const airTemp = makeUscrnAirTempObs();
    const ev = makeBaseEvidence([gibs, airTemp]);
    const result = separateHeatEvidence(ev);

    expect(result[0].status).toBe("evidence_present"); // satellite
    expect(result[1].status).toBe("evidence_present"); // air temp
    expect(result[2].status).toBe("not_provided"); // heat index
  });

  it("only GIBS → only satellite category is evidence_present", () => {
    const gibs = makeGibsObs();
    const ev = makeBaseEvidence([gibs]);
    const result = separateHeatEvidence(ev);

    expect(result[0].status).toBe("evidence_present");
    expect(result[1].status).toBe("not_provided");
    expect(result[2].status).toBe("not_provided");
  });

  it("no heat-source observations (inconclusive state) → all source-backed categories not_provided", () => {
    // Use inconclusive_evidence which does not require at least one observation
    const ev = makeSuppressedEvidence("inconclusive_evidence");
    const result = separateHeatEvidence(ev);
    expect(result[0].status).toBe("not_provided");
    expect(result[1].status).toBe("not_provided");
    expect(result[2].status).toBe("not_provided");
  });
});

// ---------------------------------------------------------------------------
// Acceptance group 7: unrelated/reordered observations cannot change output order
// ---------------------------------------------------------------------------

describe("Acceptance group 7 — unrelated observations and reordering", () => {
  it("unrelated observations do not affect output", () => {
    const gibs = makeGibsObs();
    const airTemp = makeUscrnAirTempObs();
    const heatIndex = makeUscrnHeatIndexObs();
    const unrelated1 = makeUnrelatedObs();
    const unrelated2 = makeUnrelatedObs();
    const unrelated3 = makeUnrelatedObs();
    // EvidenceObject requires a required limitation for every source in observations.
    // Add the fire-points required limitation alongside the heat source ones.
    const ev = makeBaseEvidence([unrelated1, heatIndex, unrelated2, gibs, airTemp, unrelated3], {
      limitations: [
        {
          limitationId: "lim-gibs-visualization-only",
          source: "nasa_gibs_modis_lst_day",
          description:
            "GIBS imagery is visualization only; no numeric temperature is derived from colors.",
          required: true,
        },
        {
          limitationId: "lim-uscrn-tucson-only",
          source: "noaa_uscrn_heat_exposure",
          description:
            "Evidence is from a single Tucson station and cannot establish indoor, household, or personal conditions.",
          required: true,
        },
        {
          limitationId: "lim-hms-fire-points",
          source: "noaa_hms_fire_points",
          description:
            "HMS fire data is near-real-time and may not reflect all active fire events.",
          required: true,
        },
      ],
    });
    const result = separateHeatEvidence(ev);

    // Output order must be HEAT_EVIDENCE_CODES order
    expect(result.map((a) => a.code)).toEqual([...HEAT_EVIDENCE_CODES]);
    // Unrelated obs must not appear in any result IDs
    const unrelatedIds = [unrelated1.observationId, unrelated2.observationId, unrelated3.observationId];
    for (const a of result) {
      for (const uid of unrelatedIds) {
        expect(a.observationIds).not.toContain(uid);
      }
    }
    // All three source-backed categories present despite random order
    expect(result[0].status).toBe("evidence_present");
    expect(result[1].status).toBe("evidence_present");
    expect(result[2].status).toBe("evidence_present");
  });

  it("output order is always HEAT_EVIDENCE_CODES order regardless of observation order", () => {
    const gibs = makeGibsObs();
    const airTemp = makeUscrnAirTempObs();
    const heatIndex = makeUscrnHeatIndexObs();
    // Reversed order
    const ev = makeBaseEvidence([heatIndex, airTemp, gibs]);
    const result = separateHeatEvidence(ev);
    expect(result.map((a) => a.code)).toEqual([...HEAT_EVIDENCE_CODES]);
    expect(result[0].status).toBe("evidence_present"); // satellite
    expect(result[1].status).toBe("evidence_present"); // air temp
    expect(result[2].status).toBe("evidence_present"); // heat index
  });
});

// ---------------------------------------------------------------------------
// Acceptance group 8: returned IDs are role-correct, unique, and sorted
// ---------------------------------------------------------------------------

describe("Acceptance group 8 — IDs are role-correct, unique, and sorted", () => {
  it("each assessment contains only IDs for its own role", () => {
    const gibs = makeGibsObs();
    const airTemp = makeUscrnAirTempObs();
    const heatIndex = makeUscrnHeatIndexObs();
    const ev = makeBaseEvidence([gibs, airTemp, heatIndex]);
    const result = separateHeatEvidence(ev);

    expect(result[0].observationIds).toEqual([gibs.observationId]);
    expect(result[1].observationIds).toEqual([airTemp.observationId]);
    expect(result[2].observationIds).toEqual([heatIndex.observationId]);

    // Ids from one role must not leak into another
    expect(result[0].observationIds).not.toContain(airTemp.observationId);
    expect(result[1].observationIds).not.toContain(gibs.observationId);
    expect(result[2].observationIds).not.toContain(gibs.observationId);
  });

  it("two unique GIBS observations supplied in reverse lexical ID order yield sorted IDs", () => {
    // Provide two valid unique observations with IDs in reverse lexical order to prove sorting.
    const obsZ = makeGibsObs({ observationId: "gibs-z-999" });
    const obsA = makeGibsObs({ observationId: "gibs-a-001" });
    // Input order: Z before A (reverse lexical).
    const ev = makeBaseEvidence([obsZ, obsA]);
    const result = separateHeatEvidence(ev);

    const ids = result[0].observationIds;
    // Must equal the exact sorted order.
    expect(ids).toEqual(["gibs-a-001", "gibs-z-999"]);
    // Uniqueness check.
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("sourceIds are unique and sorted", () => {
    // Two GIBS obs from same source → sourceIds should dedup
    const gibs1 = makeGibsObs();
    const gibs2 = makeGibsObs();
    const ev = makeBaseEvidence([gibs1, gibs2]);
    const result = separateHeatEvidence(ev);

    const sources = result[0].sourceIds;
    expect(sources.length).toBe(new Set(sources).size);
    const sorted = [...sources].sort();
    expect(sources).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// Acceptance group 9: input immutability and deterministic repeated output
// ---------------------------------------------------------------------------

describe("Acceptance group 9 — input immutability and determinism", () => {
  it("does not mutate the input EvidenceObject", () => {
    const gibs = makeGibsObs();
    const airTemp = makeUscrnAirTempObs();
    const heatIndex = makeUscrnHeatIndexObs();
    const ev = makeBaseEvidence([gibs, airTemp, heatIndex]);
    const evClone = JSON.parse(JSON.stringify(ev));

    separateHeatEvidence(ev);

    expect(ev).toEqual(evClone);
  });

  it("does not mutate returned arrays on second call", () => {
    const gibs = makeGibsObs();
    const ev = makeBaseEvidence([gibs]);
    const r1 = separateHeatEvidence(ev);
    r1[0].observationIds.push("tampered");
    const r2 = separateHeatEvidence(ev);
    expect(r2[0].observationIds).not.toContain("tampered");
  });

  it("produces identical output for repeated calls with the same input", () => {
    const gibs = makeGibsObs();
    const airTemp = makeUscrnAirTempObs();
    const heatIndex = makeUscrnHeatIndexObs();
    const ev = makeBaseEvidence([gibs, airTemp, heatIndex]);

    const r1 = separateHeatEvidence(ev);
    const r2 = separateHeatEvidence(ev);
    expect(r1).toEqual(r2);
  });
});

// ---------------------------------------------------------------------------
// Acceptance group 10: zero network, environment, filesystem, provider,
// timer, or random calls
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Acceptance group 10: zero network, environment, filesystem, provider,
// timer, or random calls
// ---------------------------------------------------------------------------

describe("Acceptance group 10 — zero side effects: implementation source and imports", () => {
  it("imports only deterministic contracts and contains no forbidden access or calls", () => {
    const importSpecifiers = [...claimSeparationSource.matchAll(/\bfrom\s+["']([^"']+)["']/g)]
      .map((match) => match[1]);

    expect(importSpecifiers).toEqual([
      "@/contracts/evidence",
      "@/contracts/dataset-registry",
      "./source-contracts",
    ]);
    expect(claimSeparationSource).not.toMatch(/\b(?:process\.env|import\.meta\.env|Deno\.env)\b/);
    expect(claimSeparationSource).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
    expect(claimSeparationSource).not.toMatch(/\b(?:setTimeout|setInterval|Math\.random)\s*\(/);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Acceptance group 10 — zero side effects: runtime spies", () => {
  it("does not call fetch, timers, or randomness", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const randomSpy = vi.spyOn(Math, "random");

    const ev = makeBaseEvidence([makeGibsObs(), makeUscrnAirTempObs(), makeUscrnHeatIndexObs()]);
    separateHeatEvidence(ev);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(randomSpy).not.toHaveBeenCalled();
  });
});
