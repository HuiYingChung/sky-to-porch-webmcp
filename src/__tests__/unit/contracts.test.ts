/**
 * src/__tests__/unit/contracts.test.ts
 *
 * Unit tests for all WP-02 contract validators.
 *
 * Coverage:
 * - Valid objects pass validation
 * - Invalid inputs throw ValidationError with clear messages
 * - Empty/failure/unsupported states require at least one required limitation
 * - No-data states do not mean no-danger (invariant tested explicitly)
 * - Allowlist enforcement for hazardId, sourceId, evidenceState, dataMode
 * - Timestamp ordering, coordinate and bounding-box range checks
 * - Derived metrics reference source observations
 * - Explanations reference evidence IDs
 *
 * All tests are network-free and deterministic.
 */

import { describe, it, expect } from "vitest";
import {
  ValidationError,
  validateHazardId,
  validateEvidenceState,
  validateDataMode,
  validateCoordinate,
  validateBoundingBox,
  validateTimestamp,
  validateTimestampRange,
  HAZARD_IDS,
  EVIDENCE_STATES,
  DATA_MODES,
} from "@/contracts/common";
import { validateIntent } from "@/contracts/intent";
import {
  validateSourceId,
  validateQueryableSourceId,
  validateDatasetRegistryEntry,
} from "@/contracts/dataset-registry";
import {
  validateProvenance,
  validateObservation,
  validateDerivedMetric,
  validateFreshness,
  validateConfidence,
  validateLimitation,
  validateMissionAttribution,
  validateExplanation,
  validateEvidenceObject,
} from "@/contracts/evidence";
import {
  DATASET_REGISTRY,
  getEntriesForHazard,
  getCandidateEntriesForHazard,
  getActiveEntries,
} from "@/data/dataset-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvenance(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: "noaa_hms_fire_points",
    sourceUrl: "https://example.com/test",
    retrievedAt: "2025-01-08T12:00:00Z",
    observedAt: "2025-01-08T00:00:00Z",
    product: "HMS test",
    payloadHash: "A".repeat(64),
    ...overrides,
  };
}

function makeObservation(overrides: Record<string, unknown> = {}) {
  return {
    observationId: "obs-001",
    provenance: makeProvenance(),
    variableName: "Test variable",
    textValue: "Test observation",
    dataMode: "fixture",
    ...overrides,
  };
}

function makeFreshness(overrides: Record<string, unknown> = {}) {
  return {
    status: "historical",
    classificationBasis: "historical_context",
    mostRecentObservationAt: "2025-01-08T00:00:00Z",
    evaluatedAt: "2025-01-08T12:00:00Z",
    ageSeconds: 43200,
    note: "test freshness note",
    ...overrides,
  };
}

function makeConfidence(overrides: Record<string, unknown> = {}) {
  return {
    level: "low",
    rationale: "test rationale",
    ...overrides,
  };
}

function makeLimitation(overrides: Record<string, unknown> = {}) {
  return {
    limitationId: "lim-001",
    source: "noaa_hms_fire_points",
    description: "Test limitation",
    required: true,
    ...overrides,
  };
}

function makeMinimalEvidenceObject(overrides: Record<string, unknown> = {}) {
  return {
    evidenceId: "evd-001",
    hazardId: "fire_smoke",
    intentId: "intent-001",
    evidenceState: "observations_returned",
    dataMode: "fixture",
    observations: [makeObservation()],
    derivedMetrics: [],
    missionAttributions: [],
    freshness: makeFreshness(),
    confidence: makeConfidence(),
    limitations: [makeLimitation()],
    explanations: [],
    assembledAt: "2025-01-08T12:00:00Z",
    ...overrides,
  };
}

function makeEvidenceForState(
  state: "no_observation" | "source_failure" | "unsupported_coverage" | "stale_data" | "inconclusive_evidence",
  requiredLimitation = true
) {
  const shared = {
    evidenceState: state,
    limitations: [makeLimitation({ required: requiredLimitation })],
  };
  if (state === "source_failure") {
    return makeMinimalEvidenceObject({
      ...shared,
      dataMode: "failed",
      observations: [],
      confidence: makeConfidence({ level: "insufficient" }),
      freshness: {
        status: "unknown",
        classificationBasis: "no_observation_time",
        evaluatedAt: "2025-01-08T12:00:00Z",
        note: "Source failed before an observation timestamp was available.",
      },
    });
  }
  if (state === "stale_data") {
    return makeMinimalEvidenceObject({
      ...shared,
      freshness: {
        status: "stale",
        classificationBasis: "age_thresholds",
        mostRecentObservationAt: "2025-01-08T00:00:00Z",
        evaluatedAt: "2025-01-08T12:00:00Z",
        ageSeconds: 43200,
        currentAgeLimitSeconds: 3600,
        recentAgeLimitSeconds: 21600,
        note: "Age exceeds the source policy's recent-data window.",
      },
    });
  }
  if (state === "no_observation" || state === "unsupported_coverage") {
    return makeMinimalEvidenceObject({
      ...shared,
      observations: [
        makeObservation({ textValue: undefined, value: 0, unit: "query_result_count" }),
      ],
      confidence: makeConfidence({ level: "insufficient" }),
    });
  }
  return makeMinimalEvidenceObject(shared);
}

// ---------------------------------------------------------------------------
// Common validators
// ---------------------------------------------------------------------------

describe("validateHazardId", () => {
  it("accepts all locked hazard IDs", () => {
    for (const id of HAZARD_IDS) {
      expect(() => validateHazardId(id)).not.toThrow();
    }
  });

  it("rejects an unknown hazard ID", () => {
    expect(() => validateHazardId("tsunami")).toThrow(ValidationError);
  });

  it("rejects a non-string", () => {
    expect(() => validateHazardId(42)).toThrow(ValidationError);
  });

  it("rejects null", () => {
    expect(() => validateHazardId(null)).toThrow(ValidationError);
  });
});

describe("validateEvidenceState", () => {
  it("accepts all locked evidence states", () => {
    for (const s of EVIDENCE_STATES) {
      expect(() => validateEvidenceState(s)).not.toThrow();
    }
  });

  it("rejects an unknown state", () => {
    expect(() => validateEvidenceState("unknown_state")).toThrow(ValidationError);
  });
});

describe("validateDataMode", () => {
  it("accepts all locked data modes", () => {
    for (const m of DATA_MODES) {
      expect(() => validateDataMode(m)).not.toThrow();
    }
  });

  it("rejects an unknown mode", () => {
    expect(() => validateDataMode("demo")).toThrow(ValidationError);
  });
});

describe("validateCoordinate", () => {
  it("accepts valid coordinate", () => {
    expect(() => validateCoordinate({ lon: -118.24, lat: 34.05 })).not.toThrow();
  });

  it("rejects lon > 180", () => {
    expect(() => validateCoordinate({ lon: 200, lat: 34 })).toThrow(ValidationError);
  });

  it("rejects lat > 90", () => {
    expect(() => validateCoordinate({ lon: -100, lat: 95 })).toThrow(ValidationError);
  });

  it("rejects missing fields", () => {
    expect(() => validateCoordinate({ lon: 0 })).toThrow(ValidationError);
  });
});

describe("validateBoundingBox", () => {
  it("accepts valid bounding box", () => {
    expect(() => validateBoundingBox({ west: -119, south: 33, east: -117, north: 35 })).not.toThrow();
  });

  it("rejects west >= east", () => {
    expect(() => validateBoundingBox({ west: -117, south: 33, east: -119, north: 35 })).toThrow(ValidationError);
  });

  it("rejects south >= north", () => {
    expect(() => validateBoundingBox({ west: -119, south: 35, east: -117, north: 33 })).toThrow(ValidationError);
  });
});

describe("validateTimestamp", () => {
  it("accepts ISO-8601 string", () => {
    expect(() => validateTimestamp("2025-01-08T00:00:00Z")).not.toThrow();
  });

  it("rejects invalid date string", () => {
    expect(() => validateTimestamp("not-a-date")).toThrow(ValidationError);
  });

  it("rejects non-string", () => {
    expect(() => validateTimestamp(12345)).toThrow(ValidationError);
  });

  it("rejects date-only and timezone-free strings", () => {
    expect(() => validateTimestamp("2025-01-08")).toThrow(ValidationError);
    expect(() => validateTimestamp("2025-01-08T12:00:00")).toThrow(ValidationError);
  });

  it("rejects an impossible calendar date", () => {
    expect(() => validateTimestamp("2025-02-30T12:00:00Z")).toThrow(ValidationError);
  });
});

describe("validateTimestampRange", () => {
  it("accepts valid range", () => {
    expect(() => validateTimestampRange("2024-07-08T00:00:00Z", "2024-07-10T23:45:00Z")).not.toThrow();
  });

  it("rejects start after end", () => {
    expect(() => validateTimestampRange("2024-07-10T00:00:00Z", "2024-07-08T00:00:00Z")).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Dataset registry contract
// ---------------------------------------------------------------------------

describe("validateSourceId", () => {
  it("accepts registered source IDs", () => {
    expect(() => validateSourceId("noaa_hms_fire_points")).not.toThrow();
    expect(() => validateSourceId("nasa_gibs_imerg")).not.toThrow();
  });

  it("rejects an unregistered source ID", () => {
    expect(() => validateSourceId("unknown_source")).toThrow(ValidationError);
  });

  it("registers deferred sources but does not allow them to be queried", () => {
    // UXFIX-02 (ADR-0022): nasa_firms is activated as a key-gated live source.
    expect(() => validateSourceId("nasa_firms")).not.toThrow();
    expect(() => validateQueryableSourceId("nasa_firms")).not.toThrow();
    // ECOSTRESS remains a registered-but-not-queryable example.
    expect(() => validateSourceId("nasa_ecostress")).not.toThrow();
    expect(() => validateQueryableSourceId("nasa_ecostress")).toThrow(ValidationError);
  });
});

describe("DATASET_REGISTRY", () => {
  it("contains all registered source entries", () => {
    expect(DATASET_REGISTRY).toHaveLength(35);
  });

  it("allows the live-gated credential-free AirNow daily file as supporting evidence", () => {
    const air = getCandidateEntriesForHazard("air_quality");
    expect(air.map((entry) => [entry.sourceId, entry.decision, entry.supportedDataModes])).toEqual(
      expect.arrayContaining([
        ["airnow", "defer", ["unavailable"]],
        ["airnow_daily_data", "go_supporting", ["live", "historical"]],
      ])
    );
    expect(() => validateSourceId("airnow_daily_data")).not.toThrow();
    expect(() => validateQueryableSourceId("airnow_daily_data")).not.toThrow();
  });

  it("allowlists the two governed Extreme Heat sources and keeps ECOSTRESS deferred", () => {
    expect(() => validateQueryableSourceId("nasa_gibs_modis_lst_day")).not.toThrow();
    expect(() => validateQueryableSourceId("noaa_uscrn_heat_exposure")).not.toThrow();
    expect(() => validateQueryableSourceId("nasa_ecostress")).toThrow(ValidationError);

    const heat = getCandidateEntriesForHazard("extreme_heat");
    expect(heat.map((entry) => [entry.sourceId, entry.decision])).toEqual(
      expect.arrayContaining([
        ["nasa_gibs_modis_lst_day", "go"],
        ["noaa_uscrn_heat_exposure", "go_supporting"],
        ["nasa_ecostress", "defer"],
      ])
    );
  });

  it("WP-10 separates global satellite imagery from nationwide regional confirmation", () => {
    expect(() => validateQueryableSourceId("nasa_gibs_modis_ndvi_16day")).not.toThrow();
    expect(() => validateQueryableSourceId("us_drought_monitor_rest")).not.toThrow();

    const drought = getEntriesForHazard("drought_land");
    expect(drought.map((entry) => [entry.sourceId, entry.supportedDataModes])).toEqual(
      expect.arrayContaining([
        ["nasa_gibs_modis_ndvi_16day", ["live", "fixture"]],
        ["us_drought_monitor_rest", ["live", "fixture"]],
      ])
    );

    const usdm = drought.find((entry) => entry.sourceId === "us_drought_monitor_rest");
    expect(usdm?.endpointTemplate).toContain("https://usdmdataservices.unl.edu/api/");
    expect(usdm?.endpointTemplate).toContain("GetDroughtSeverityStatisticsByAreaPercent");
    expect(usdm?.endpointTemplate).not.toContain("usdm.climate.unl.edu");
    expect(usdm?.role).toMatch(/state or territory.*canonical area/i);
    expect(usdm?.role).toMatch(/never property evidence/i);
    expect(usdm?.authNote).toMatch(/non-Arizona territory request passed/i);
    expect(usdm?.authNote).not.toMatch(/not yet approved or enabled/i);

    const gibs = drought.find((entry) => entry.sourceId === "nasa_gibs_modis_ndvi_16day");
    expect(gibs?.role).toMatch(/custom areas.*global satellite visualization/i);
    expect(gibs?.authNote).toMatch(/validated custom-area bounding boxes/i);
    expect(gibs?.authNote).toMatch(/separate authorized live smoke/i);
    expect(gibs?.authNote).not.toMatch(/not yet approved or enabled/i);
  });

  it("all entries pass validateDatasetRegistryEntry", () => {
    for (const entry of DATASET_REGISTRY) {
      expect(() => validateDatasetRegistryEntry(entry)).not.toThrow();
    }
  });

  it("all entries have non-empty requiredLimitations arrays", () => {
    for (const entry of DATASET_REGISTRY) {
      expect(entry.requiredLimitations.length).toBeGreaterThan(0);
    }
  });

  it("getEntriesForHazard returns fire sources for fire_smoke", () => {
    const fire = getEntriesForHazard("fire_smoke");
    expect(fire.length).toBeGreaterThanOrEqual(2);
    for (const e of fire) {
      expect(e.hazardIds).toContain("fire_smoke");
    }
  });

  it("getEntriesForHazard returns flood sources for flood_storm", () => {
    const flood = getEntriesForHazard("flood_storm");
    expect(flood.length).toBeGreaterThanOrEqual(2);
    for (const e of flood) {
      expect(e.hazardIds).toContain("flood_storm");
    }
  });

  it("getActiveEntries returns only go* decisions", () => {
    const active = getActiveEntries();
    for (const e of active) {
      expect(e.decision).toMatch(/^go/);
    }
  });

  it("active entries are credential-free except the governed FIRMS exception", () => {
    // UXFIX-02 (ADR-0022): nasa_firms is the single allowed credentialed
    // source. Its key lives only in the FIRMS_MAP_KEY env var, is required
    // to be absent from evidence/logs/client output, and the adapter fails
    // closed when unconfigured.
    for (const e of getActiveEntries()) {
      if (e.sourceId === "nasa_firms") {
        expect(e.requiresCredential).toBe(true);
        expect(e.authNote).toContain("FIRMS_MAP_KEY");
        continue;
      }
      expect(e.requiresCredential).toBe(false);
    }
  });

  it("keeps deferred and rejected candidates visible but inactive", () => {
    const fireCandidates = getCandidateEntriesForHazard("fire_smoke");
    // UXFIX-02 (ADR-0022): nasa_firms moved from defer to go.
    expect(
      fireCandidates.some((entry) => entry.sourceId === "nasa_firms" && entry.decision === "go")
    ).toBe(true);
    expect(
      fireCandidates.some((entry) => entry.sourceId === "airnow" && entry.decision === "defer")
    ).toBe(true);
    expect(
      getActiveEntries().some((entry) => entry.decision === "defer" || entry.decision === "reject")
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Provenance validator
// ---------------------------------------------------------------------------

describe("validateProvenance", () => {
  it("accepts valid provenance with a payload hash", () => {
    expect(() => validateProvenance(makeProvenance())).not.toThrow();
  });

  it("accepts observedAt=unknown", () => {
    expect(() => validateProvenance(makeProvenance({ observedAt: "unknown" }))).not.toThrow();
  });

  it("rejects missing retrievedAt", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { retrievedAt: _unused, ...rest } = makeProvenance();
    expect(() => validateProvenance(rest)).toThrow(ValidationError);
  });

  it("rejects invalid payloadHash (wrong length)", () => {
    expect(() => validateProvenance(makeProvenance({ payloadHash: "abc123" }))).toThrow(ValidationError);
  });

  it("accepts valid 64-char hex payloadHash", () => {
    const validHash = "A".repeat(64);
    expect(() => validateProvenance(makeProvenance({ payloadHash: validHash }))).not.toThrow();
  });

  it("rejects missing payloadHash for a received observation payload", () => {
    expect(() => validateProvenance(makeProvenance({ payloadHash: undefined }))).toThrow(
      ValidationError
    );
  });

  it("rejects deferred sourceId for observation provenance", () => {
    // UXFIX-02 (ADR-0022): nasa_firms is queryable; ECOSTRESS remains the
    // deferred example that must be rejected.
    expect(() => validateProvenance(makeProvenance({ sourceId: "nasa_firms" }))).not.toThrow();
    expect(() => validateProvenance(makeProvenance({ sourceId: "nasa_ecostress" }))).toThrow(ValidationError);
  });

  it("rejects unexpected provenance fields", () => {
    expect(() => validateProvenance(makeProvenance({ unexpected: true }))).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Observation validator
// ---------------------------------------------------------------------------

describe("validateObservation", () => {
  it("accepts a valid text observation", () => {
    expect(() => validateObservation(makeObservation())).not.toThrow();
  });

  it("accepts valid observation with numeric value and unit", () => {
    expect(() =>
      validateObservation(makeObservation({ textValue: undefined, value: 38.72, unit: "ft" }))
    ).not.toThrow();
  });

  it("rejects numeric value without unit", () => {
    expect(() =>
      validateObservation(makeObservation({ textValue: undefined, value: 38.72 }))
    ).toThrow(ValidationError);
  });

  it("rejects non-finite value", () => {
    expect(() =>
      validateObservation(makeObservation({ textValue: undefined, value: NaN, unit: "ft" }))
    ).toThrow(ValidationError);
  });

  it("rejects observations with neither or both value forms", () => {
    expect(() => validateObservation(makeObservation({ textValue: undefined }))).toThrow(ValidationError);
    expect(() => validateObservation(makeObservation({ value: 1, unit: "count" }))).toThrow(ValidationError);
  });

  it("rejects invalid period range (start after end)", () => {
    expect(() =>
      validateObservation(
        makeObservation({
          periodStart: "2024-07-10T00:00:00Z",
          periodEnd: "2024-07-08T00:00:00Z",
        })
      )
    ).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// DerivedMetric validator
// ---------------------------------------------------------------------------

describe("validateDerivedMetric", () => {
  it("accepts valid derived metric", () => {
    expect(() =>
      validateDerivedMetric({
        metricId: "dm-001",
        sourceObservationIds: ["obs-001"],
        metricName: "Coordinate count in box",
        value: 4942,
        unit: "coordinate_pairs",
        derivationMethod: "Count coordinate pairs within bounding box using XML parser",
        dataMode: "fixture",
      })
    ).not.toThrow();
  });

  it("rejects empty sourceObservationIds", () => {
    expect(() =>
      validateDerivedMetric({
        metricId: "dm-001",
        sourceObservationIds: [],
        metricName: "test",
        value: 1,
        unit: "count",
        derivationMethod: "test method",
        dataMode: "fixture",
      })
    ).toThrow(ValidationError);
  });

  it("rejects missing unit", () => {
    expect(() =>
      validateDerivedMetric({
        metricId: "dm-001",
        sourceObservationIds: ["obs-001"],
        metricName: "test",
        value: 1,
        derivationMethod: "test method",
        dataMode: "fixture",
      })
    ).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Freshness validator
// ---------------------------------------------------------------------------

describe("validateFreshness", () => {
  it("accepts valid freshness", () => {
    expect(() => validateFreshness(makeFreshness())).not.toThrow();
  });

  it("rejects invalid status", () => {
    expect(() => validateFreshness(makeFreshness({ status: "outdated" }))).toThrow(ValidationError);
  });

  it("rejects negative ageSeconds", () => {
    expect(() => validateFreshness(makeFreshness({ ageSeconds: -1 }))).toThrow(ValidationError);
  });

  it("rejects ageSeconds that does not match its timestamps", () => {
    expect(() => validateFreshness(makeFreshness({ ageSeconds: 1 }))).toThrow(ValidationError);
  });

  it("derives age-threshold status deterministically", () => {
    const freshness = {
      status: "recent",
      classificationBasis: "age_thresholds",
      mostRecentObservationAt: "2025-01-08T10:00:00Z",
      evaluatedAt: "2025-01-08T12:00:00Z",
      ageSeconds: 7200,
      currentAgeLimitSeconds: 3600,
      recentAgeLimitSeconds: 21600,
      note: "Within the recent-data window.",
    };
    expect(() => validateFreshness(freshness)).not.toThrow();
    expect(() => validateFreshness({ ...freshness, status: "current" })).toThrow(ValidationError);
  });

  it("requires unknown freshness to omit invented observation time and age", () => {
    const unknown = {
      status: "unknown",
      classificationBasis: "no_observation_time",
      evaluatedAt: "2025-01-08T12:00:00Z",
      note: "No observation timestamp was available.",
    };
    expect(() => validateFreshness(unknown)).not.toThrow();
    expect(() =>
      validateFreshness({ ...unknown, mostRecentObservationAt: "2025-01-08T00:00:00Z" })
    ).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Confidence validator
// ---------------------------------------------------------------------------

describe("validateConfidence", () => {
  it("accepts all valid levels", () => {
    for (const level of ["high", "moderate", "low", "insufficient"]) {
      expect(() => validateConfidence({ level, rationale: "test" })).not.toThrow();
    }
  });

  it("rejects empty rationale", () => {
    expect(() => validateConfidence({ level: "low", rationale: "" })).toThrow(ValidationError);
  });

  it("rejects fabricated percentage level", () => {
    expect(() => validateConfidence({ level: "85%", rationale: "test" })).toThrow(ValidationError);
  });
});

describe("validateMissionAttribution", () => {
  it("accepts a completed retrieval with no matching observation", () => {
    expect(() => validateMissionAttribution({
      missionName: "NOAA NCEI GHCNh",
      agency: "NOAA / NCEI",
      purpose: "Retrieve in-area station wind observations.",
      selectionReason: "The station-year file was retrieved for the requested date.",
      contributedObservationIds: [],
      retrievalStatus: "no_observation",
      keyLimitation: "Publication or reporting gaps may apply.",
      datasetId: "NOAA NCEI GHCNh v1",
    })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Explanation validator
// ---------------------------------------------------------------------------

describe("validateExplanation", () => {
  it("accepts valid explanation", () => {
    expect(() =>
      validateExplanation({
        explanationId: "exp-001",
        sourceEvidenceIds: ["evd-001"],
        observed: "Satellite detections present in the area",
        notSupported: ["Property-level fire certainty"],
        aiGenerated: false,
      })
    ).not.toThrow();
  });

  it("rejects empty sourceEvidenceIds", () => {
    expect(() =>
      validateExplanation({
        explanationId: "exp-001",
        sourceEvidenceIds: [],
        observed: "test",
        notSupported: [],
        aiGenerated: false,
      })
    ).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Limitation validator (direct coverage)
// ---------------------------------------------------------------------------

describe("validateLimitation", () => {
  it("accepts a valid limitation", () => {
    expect(() =>
      validateLimitation({
        limitationId: "lim-001",
        source: "noaa_hms_fire_points",
        description: "Test limitation",
        required: true,
      })
    ).not.toThrow();
  });

  it("rejects missing limitationId", () => {
    expect(() =>
      validateLimitation({
        source: "noaa_hms_fire_points",
        description: "Test limitation",
        required: true,
      })
    ).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// EvidenceObject — no-data != no-danger invariant
// ---------------------------------------------------------------------------

describe("validateEvidenceObject — no-data invariant", () => {
  const dangerStates = [
    "no_observation",
    "source_failure",
    "unsupported_coverage",
    "stale_data",
    "inconclusive_evidence",
  ] as const;

  for (const state of dangerStates) {
    it(`rejects ${state} without a required limitation (no data != no danger)`, () => {
      const obj = makeEvidenceForState(state);
      obj.limitations = [];
      expect(() => validateEvidenceObject(obj)).toThrow(ValidationError);
    });

    it(`accepts ${state} with at least one required limitation`, () => {
      const obj = makeEvidenceForState(state);
      expect(() => validateEvidenceObject(obj)).not.toThrow();
    });

    it(`rejects ${state} with only non-required limitations`, () => {
      const obj = makeEvidenceForState(state, false);
      expect(() => validateEvidenceObject(obj)).toThrow(ValidationError);
    });
  }

  it("rejects observations_returned without the observed source's required limitation", () => {
    const obj = makeMinimalEvidenceObject({
      evidenceState: "observations_returned",
      limitations: [],
    });
    expect(() => validateEvidenceObject(obj)).toThrow(ValidationError);
  });
});

describe("validateEvidenceObject — field validation", () => {
  it("accepts a minimal valid evidence object", () => {
    expect(() => validateEvidenceObject(makeMinimalEvidenceObject())).not.toThrow();
  });

  it("rejects invalid hazardId", () => {
    expect(() =>
      validateEvidenceObject(makeMinimalEvidenceObject({ hazardId: "nuclear" }))
    ).toThrow(ValidationError);
  });

  it("rejects invalid evidenceState", () => {
    expect(() =>
      validateEvidenceObject(makeMinimalEvidenceObject({ evidenceState: "unknown_custom" }))
    ).toThrow(ValidationError);
  });

  it("rejects invalid dataMode", () => {
    expect(() =>
      validateEvidenceObject(makeMinimalEvidenceObject({ dataMode: "demo" }))
    ).toThrow(ValidationError);
  });

  it("rejects non-array observations", () => {
    expect(() =>
      validateEvidenceObject(makeMinimalEvidenceObject({ observations: "bad" }))
    ).toThrow(ValidationError);
  });

  it("rejects unexpected evidence fields", () => {
    expect(() =>
      validateEvidenceObject(makeMinimalEvidenceObject({ unexpected: "schema drift" }))
    ).toThrow(ValidationError);
  });

  it("rejects derived metrics that reference a missing observation", () => {
    expect(() =>
      validateEvidenceObject(
        makeMinimalEvidenceObject({
          derivedMetrics: [
            {
              metricId: "metric-001",
              sourceObservationIds: ["missing-observation"],
              metricName: "Invalid metric",
              value: 1,
              unit: "count",
              derivationMethod: "Test only",
              dataMode: "fixture",
            },
          ],
        })
      )
    ).toThrow(ValidationError);
  });

  it("rejects explanations that reference unavailable evidence", () => {
    expect(() =>
      validateEvidenceObject(
        makeMinimalEvidenceObject({
          explanations: [
            {
              explanationId: "exp-001",
              sourceEvidenceIds: ["missing-evidence"],
              observed: "Test observation",
              notSupported: ["Any safety conclusion"],
              aiGenerated: false,
            },
          ],
        })
      )
    ).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Intent validator
// ---------------------------------------------------------------------------

describe("validateIntent", () => {
  it("accepts a valid intent", () => {
    expect(() =>
      validateIntent({
        intentId: "intent-001",
        hazardId: "fire_smoke",
        place: {
          label: "Los Angeles, CA",
          coordinate: { lon: -118.24, lat: 34.05 },
        },
        timeRange: { type: "past_7d" },
        concern: "home",
        createdAt: "2025-01-08T12:00:00Z",
      })
    ).not.toThrow();
  });

  it("accepts intent with custom time range", () => {
    expect(() =>
      validateIntent({
        intentId: "intent-002",
        hazardId: "flood_storm",
        place: {
          label: "Houston, TX",
          coordinate: { lon: -95.37, lat: 29.76 },
          boundingBox: { west: -97, south: 28, east: -94, north: 31 },
        },
        timeRange: {
          type: "custom",
          startTs: "2024-07-08T00:00:00Z",
          endTs: "2024-07-10T23:45:00Z",
        },
        concern: "community",
        createdAt: "2025-01-08T12:00:00Z",
      })
    ).not.toThrow();
  });

  it("rejects custom time range without startTs", () => {
    expect(() =>
      validateIntent({
        intentId: "intent-003",
        hazardId: "fire_smoke",
        place: { label: "Test", coordinate: { lon: 0, lat: 0 } },
        timeRange: { type: "custom", endTs: "2024-07-10T00:00:00Z" },
        concern: "home",
        createdAt: "2025-01-08T12:00:00Z",
      })
    ).toThrow(ValidationError);
  });

  it("rejects invalid hazardId", () => {
    expect(() =>
      validateIntent({
        intentId: "intent-004",
        hazardId: "tsunami",
        place: { label: "Test", coordinate: { lon: 0, lat: 0 } },
        timeRange: { type: "latest" },
        concern: "home",
        createdAt: "2025-01-08T12:00:00Z",
      })
    ).toThrow(ValidationError);
  });
});
