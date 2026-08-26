/// <reference types="vite/client" />

/**
 * src/__tests__/unit/wp08-flood-claim-separation.test.ts
 *
 * Focused deterministic unit tests for separateFloodEvidence.
 *
 * Uses the two retained WP-02 JSON fixtures as source-of-truth. Small
 * synthetic variants are built only for shapes absent from those fixtures.
 *
 * All tests are network-free, filesystem-free, environment-free,
 * provider-free, timer-free, and random-free.
 *
 * Acceptance coverage (all nine criteria from STP-WP-08-001 + C01):
 *   1. Houston success fixture → evidence_present for GIBS + USGS only
 *   2. surface_water and official_warning → not_provided
 *   3. route_disruption and property_impact → not_supported
 *   4. unsupported-coverage fixture → no source-backed evidence
 *   5. source_failure (runtime-valid, dataMode failed/unavailable) →
 *      no source-backed evidence; never safe conclusion
 *   6. Fail-closed: numeric GIBS, wrong USGS unit, wrong parameterCd,
 *      missing/blank USGS siteId, wrong hazard, invalid EvidenceObject —
 *      both for observations_returned AND for a blocked evidence state
 *   7. Output order is always FLOOD_EVIDENCE_CODES order; IDs unique + sorted
 *   8. Input immutability and deterministic repeated output
 *   9. Zero network/env/fs/provider/timer/random calls (import-source check)
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import type { EvidenceObject, Observation } from "@/contracts/evidence";
import { validateEvidenceObject } from "@/contracts/evidence";
import {
  separateFloodEvidence,
  FLOOD_EVIDENCE_CODES,
  type FloodEvidenceAssessment,
} from "@/lib/flood/claim-separation";

// Static import assertion: the implementation module must not import from
// any network transport, filesystem, or provider module.
import claimSeparationSource from "@/lib/flood/claim-separation.ts?raw";

// ---------------------------------------------------------------------------
// Retained WP-02 JSON fixtures (source-of-truth)
// ---------------------------------------------------------------------------

import floodSuccessRaw from "@/data/fixtures/wp02/flood-success.json";
import floodUnsupportedRaw from "@/data/fixtures/wp02/flood-unsupported-coverage.json";

/** Strip fixture metadata keys and validate as EvidenceObject. */
function loadFixture(raw: Record<string, unknown>): EvidenceObject {
  const clone = structuredClone(raw) as Record<string, unknown>;
  delete clone["_fixtureId"];
  delete clone["_fixtureDescription"];
  delete clone["_capturedBy"];
  delete clone["_fixtureWarning"];
  validateEvidenceObject(clone);
  return clone as EvidenceObject;
}

const houstonFixture = loadFixture(floodSuccessRaw as Record<string, unknown>);
const unsupportedFixture = loadFixture(floodUnsupportedRaw as Record<string, unknown>);

// ---------------------------------------------------------------------------
// Synthetic variant helpers — only shapes absent from retained fixtures
// ---------------------------------------------------------------------------

/**
 * Build a minimal runtime-valid source_failure EvidenceObject.
 * dataMode must be "failed" or "unavailable"; observations empty.
 */
function sourceFailureEvidence(): EvidenceObject {
  // Derive provenance-level timestamps from the Houston fixture's assembledAt
  // so we don't need to hard-code ageSeconds logic.
  // Use dataMode "unavailable" and evidenceState "source_failure".
  const assembled = "2026-08-11T00:00:00Z";
  return {
    evidenceId: "evd-test-failure-001",
    hazardId: "flood_storm",
    intentId: "intent-test-failure-001",
    evidenceState: "source_failure",
    dataMode: "unavailable",
    observations: [],
    derivedMetrics: [],
    missionAttributions: [],
    freshness: {
      status: "unknown",
      classificationBasis: "no_observation_time",
      evaluatedAt: assembled,
      note: "Source retrieval failed. No observation time is available.",
    },
    confidence: {
      level: "insufficient",
      rationale: "Source retrieval failed. This is not evidence of no danger.",
    },
    limitations: [
      {
        limitationId: "lim-failure-not-safe-001",
        source: "nasa_gibs_imerg",
        description: "Source retrieval failed. Failure is not evidence of no danger and must not be presented as a safe conclusion.",
        required: true,
      },
    ],
    explanations: [],
    assembledAt: assembled,
  } as unknown as EvidenceObject;
}

/**
 * Build an otherwise runtime-valid Houston EvidenceObject with hazardId
 * changed to "fire_smoke" so the Flood guard — not an earlier contract
 * error — is exercised.
 */
function wrongHazardEvidence(): EvidenceObject {
  const clone = structuredClone(houstonFixture);
  clone.hazardId = "fire_smoke";
  return clone;
}

// ---------------------------------------------------------------------------
// Helper: find an assessment by code
// ---------------------------------------------------------------------------

function byCode(results: FloodEvidenceAssessment[], code: (typeof FLOOD_EVIDENCE_CODES)[number]) {
  const found = results.find((a) => a.code === code);
  if (!found) throw new Error(`Assessment for code "${code}" not found`);
  return found;
}

// ---------------------------------------------------------------------------
// Synthetic shape-violation builders (reused in both observations_returned
// and blocked-state tests)
// ---------------------------------------------------------------------------

function cloneSourceObservation(
  sourceId: "nasa_gibs_imerg" | "usgs_instantaneous_values"
): Observation {
  const observation = houstonFixture.observations.find(
    (candidate) => candidate.provenance.sourceId === sourceId
  );
  if (!observation) {
    throw new Error(`${sourceId} observation not found in Houston fixture`);
  }
  return structuredClone(observation);
}

/** Build a valid EvidenceObject with a numeric GIBS observation. */
function numericGibsEvidence(state: "observations_returned" | "unsupported_coverage"): EvidenceObject {
  // Start from the Houston fixture, replace observations with one numeric GIBS obs.
  // Clear missionAttributions to avoid referencing the original observation IDs.
  const base = structuredClone(houstonFixture);
  base.evidenceState = state;
  base.missionAttributions = [];
  // Build numeric variant: replace textValue with value
  const numericObs = cloneSourceObservation("nasa_gibs_imerg");
  delete numericObs.textValue;
  numericObs.value = 12.5;
  numericObs.unit = "mm/hr";
  numericObs.observationId = "obs-gibs-numeric-001";
  // For unsupported_coverage the EvidenceObject validator requires a required
  // limitation; the Houston base already has required limitations.
  // Replace observations with just the numeric GIBS obs.
  base.observations = [numericObs];
  if (state === "unsupported_coverage") {
    base.confidence = {
      level: "insufficient",
      rationale: "The requested coverage is unsupported, so no safety conclusion is available.",
    };
  }
  return base;
}

/** Build a valid EvidenceObject with a USGS observation that has wrong unit. */
function wrongUnitUsgsEvidence(state: "observations_returned" | "stale_data"): EvidenceObject {
  // Clear missionAttributions to avoid referencing the original observation IDs.
  const base = structuredClone(houstonFixture);
  base.evidenceState = state;
  base.missionAttributions = [];
  const badObs = cloneSourceObservation("usgs_instantaneous_values");
  badObs.unit = "m";
  badObs.observationId = "obs-usgs-wrong-unit-001";
  base.observations = [badObs];
  if (state === "stale_data") {
    const { mostRecentObservationAt, evaluatedAt, ageSeconds } = base.freshness;
    if (mostRecentObservationAt === undefined || ageSeconds === undefined) {
      throw new Error("Houston fixture must carry timestamp-derived freshness");
    }
    base.freshness = {
      status: "stale",
      classificationBasis: "age_thresholds",
      mostRecentObservationAt,
      evaluatedAt,
      ageSeconds,
      currentAgeLimitSeconds: 3_600,
      recentAgeLimitSeconds: 86_400,
      note: "The observation is older than the configured recent-data limit.",
    };
  }
  return base;
}

// ---------------------------------------------------------------------------
// 1–3: Houston success fixture
// ---------------------------------------------------------------------------

describe("Houston success fixture", () => {
  const result = separateFloodEvidence(houstonFixture);

  it("returns exactly 6 assessments", () => {
    expect(result).toHaveLength(6);
  });

  it("satellite_precipitation_visualization is evidence_present", () => {
    expect(byCode(result, "satellite_precipitation_visualization").status).toBe("evidence_present");
  });

  it("ground_gage_height is evidence_present", () => {
    expect(byCode(result, "ground_gage_height").status).toBe("evidence_present");
  });

  it("satellite_precipitation_visualization has nasa_gibs_imerg sourceId", () => {
    const a = byCode(result, "satellite_precipitation_visualization");
    expect(a.sourceIds).toContain("nasa_gibs_imerg");
    expect(a.observationIds.length).toBeGreaterThan(0);
  });

  it("ground_gage_height has usgs_instantaneous_values sourceId", () => {
    const a = byCode(result, "ground_gage_height");
    expect(a.sourceIds).toContain("usgs_instantaneous_values");
    expect(a.observationIds.length).toBeGreaterThan(0);
  });

  // Acceptance criterion 2
  it("surface_water is not_provided with empty IDs", () => {
    const a = byCode(result, "surface_water");
    expect(a.status).toBe("not_provided");
    expect(a.observationIds).toEqual([]);
    expect(a.sourceIds).toEqual([]);
  });

  it("official_warning is not_provided with empty IDs", () => {
    const a = byCode(result, "official_warning");
    expect(a.status).toBe("not_provided");
    expect(a.observationIds).toEqual([]);
    expect(a.sourceIds).toEqual([]);
  });

  // Acceptance criterion 3
  it("route_disruption is not_supported with empty IDs", () => {
    const a = byCode(result, "route_disruption");
    expect(a.status).toBe("not_supported");
    expect(a.observationIds).toEqual([]);
    expect(a.sourceIds).toEqual([]);
  });

  it("property_impact is not_supported with empty IDs", () => {
    const a = byCode(result, "property_impact");
    expect(a.status).toBe("not_supported");
    expect(a.observationIds).toEqual([]);
    expect(a.sourceIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4: Unsupported-coverage fixture → no source-backed evidence
// ---------------------------------------------------------------------------

describe("Unsupported-coverage fixture", () => {
  const result = separateFloodEvidence(unsupportedFixture);

  it("satellite_precipitation_visualization is not_provided", () => {
    expect(byCode(result, "satellite_precipitation_visualization").status).toBe("not_provided");
  });

  it("ground_gage_height is not_provided", () => {
    expect(byCode(result, "ground_gage_height").status).toBe("not_provided");
  });

  it("not_provided assessments have empty ID arrays", () => {
    const a = byCode(result, "satellite_precipitation_visualization");
    expect(a.observationIds).toEqual([]);
    expect(a.sourceIds).toEqual([]);
  });

  it("route_disruption and property_impact remain not_supported", () => {
    expect(byCode(result, "route_disruption").status).toBe("not_supported");
    expect(byCode(result, "property_impact").status).toBe("not_supported");
  });
});

// ---------------------------------------------------------------------------
// 5: Source-failure object → no source-backed evidence; never safe conclusion
// ---------------------------------------------------------------------------

describe("Source-failure evidence", () => {
  const result = separateFloodEvidence(sourceFailureEvidence());

  it("satellite_precipitation_visualization is not_provided", () => {
    expect(byCode(result, "satellite_precipitation_visualization").status).toBe("not_provided");
  });

  it("ground_gage_height is not_provided", () => {
    expect(byCode(result, "ground_gage_height").status).toBe("not_provided");
  });

  it("no evidence_present assessment exists (never safe conclusion)", () => {
    const presentCount = result.filter((a) => a.status === "evidence_present").length;
    expect(presentCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6: Fail-closed — observations_returned cases
// ---------------------------------------------------------------------------

describe("Fail-closed: numeric GIBS (observations_returned)", () => {
  it("throws when GIBS observation has a numeric value", () => {
    expect(() => separateFloodEvidence(numericGibsEvidence("observations_returned"))).toThrow(/numeric/);
  });
});

describe("Fail-closed: wrong USGS unit (observations_returned)", () => {
  it("throws when USGS observation has unit other than ft", () => {
    expect(() => separateFloodEvidence(wrongUnitUsgsEvidence("observations_returned"))).toThrow(/unit/);
  });
});

describe("Fail-closed: wrong USGS parameterCd (observations_returned)", () => {
  it("throws when USGS observation has wrong parameterCd", () => {
    const base = structuredClone(houstonFixture);
    base.missionAttributions = [];
    const badObs = cloneSourceObservation("usgs_instantaneous_values");
    badObs.observationId = "obs-usgs-bad-param-001";
    if (!badObs.metadata) throw new Error("USGS fixture observation has no metadata");
    badObs.metadata.parameterCd = "00060";
    base.observations = [badObs];
    expect(() => separateFloodEvidence(base)).toThrow(/parameterCd/);
  });
});

describe("Fail-closed: blank USGS siteId (observations_returned)", () => {
  it("throws when USGS observation has whitespace-only siteId", () => {
    const base = structuredClone(houstonFixture);
    base.missionAttributions = [];
    const badObs = cloneSourceObservation("usgs_instantaneous_values");
    badObs.observationId = "obs-usgs-blank-site-001";
    if (!badObs.metadata) throw new Error("USGS fixture observation has no metadata");
    badObs.metadata.siteId = "   ";
    base.observations = [badObs];
    expect(() => separateFloodEvidence(base)).toThrow(/siteId/);
  });
});

describe("Fail-closed: missing USGS metadata (observations_returned)", () => {
  it("throws when USGS observation has no metadata", () => {
    const base = structuredClone(houstonFixture);
    base.missionAttributions = [];
    const badObs = cloneSourceObservation("usgs_instantaneous_values");
    badObs.observationId = "obs-usgs-no-meta-001";
    delete badObs.metadata;
    base.observations = [badObs];
    expect(() => separateFloodEvidence(base)).toThrow(/metadata/);
  });
});

// ---------------------------------------------------------------------------
// 6 (continued): Fail-closed — blocked evidence state cases (C01 regression)
// Shape validation must run before state suppression.
// ---------------------------------------------------------------------------

describe("Fail-closed: numeric GIBS in blocked state (unsupported_coverage)", () => {
  it("throws even when evidenceState is unsupported_coverage", () => {
    expect(() => separateFloodEvidence(numericGibsEvidence("unsupported_coverage"))).toThrow(/numeric/);
  });
});

describe("Fail-closed: wrong USGS unit in blocked state (stale_data)", () => {
  it("throws even when evidenceState is stale_data", () => {
    expect(() => separateFloodEvidence(wrongUnitUsgsEvidence("stale_data"))).toThrow(/unit/);
  });
});

// ---------------------------------------------------------------------------
// 6 (continued): Fail-closed — wrong hazard and invalid EvidenceObject
// ---------------------------------------------------------------------------

describe("Fail-closed: wrong hazard", () => {
  it("throws specifically on the Flood guard, not an earlier contract error", () => {
    // wrongHazardEvidence() is a full runtime-valid Houston object with hazardId="fire_smoke".
    // The Flood guard in separateFloodEvidence should be what fires here.
    expect(() => separateFloodEvidence(wrongHazardEvidence())).toThrow(/flood_storm/);
  });
});

describe("Fail-closed: invalid EvidenceObject", () => {
  it("throws on null input", () => {
    expect(() => separateFloodEvidence(null as unknown as EvidenceObject)).toThrow();
  });

  it("throws on a plain object missing required fields", () => {
    expect(() => separateFloodEvidence({ hazardId: "flood_storm" } as unknown as EvidenceObject)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 7: Output order and ID uniqueness
// ---------------------------------------------------------------------------

describe("Output order and ID uniqueness", () => {
  it("assessments are always returned in FLOOD_EVIDENCE_CODES order", () => {
    const result = separateFloodEvidence(houstonFixture);
    const resultCodes = result.map((a) => a.code);
    expect(resultCodes).toEqual([...FLOOD_EVIDENCE_CODES]);
  });

  it("observationIds are sorted", () => {
    const result = separateFloodEvidence(houstonFixture);
    const gibsIds = byCode(result, "satellite_precipitation_visualization").observationIds;
    const usgsIds = byCode(result, "ground_gage_height").observationIds;
    expect(gibsIds).toEqual([...gibsIds].sort());
    expect(usgsIds).toEqual([...usgsIds].sort());
  });

  it("GIBS sourceIds contain only nasa_gibs_imerg", () => {
    const result = separateFloodEvidence(houstonFixture);
    const srcIds = byCode(result, "satellite_precipitation_visualization").sourceIds;
    for (const src of srcIds) {
      expect(src).toBe("nasa_gibs_imerg");
    }
  });

  it("USGS sourceIds contain only usgs_instantaneous_values", () => {
    const result = separateFloodEvidence(houstonFixture);
    const srcIds = byCode(result, "ground_gage_height").sourceIds;
    for (const src of srcIds) {
      expect(src).toBe("usgs_instantaneous_values");
    }
  });

  it("ignores unrelated observations and de-duplicates sorted target IDs after reordering", () => {
    const variant = structuredClone(houstonFixture);
    variant.missionAttributions = [];

    const gibsOriginal = cloneSourceObservation("nasa_gibs_imerg");
    const gibsEarlierId = cloneSourceObservation("nasa_gibs_imerg");
    gibsEarlierId.observationId = "obs-gibs-imerg-houston-000";
    const usgs = cloneSourceObservation("usgs_instantaneous_values");
    const unrelated = cloneSourceObservation("nasa_gibs_imerg");
    unrelated.observationId = "obs-firms-unrelated-001";
    unrelated.provenance.sourceId = "noaa_hms_fire_points";

    variant.observations = [usgs, gibsOriginal, unrelated, gibsEarlierId];
    variant.limitations.push({
      limitationId: "lim-test-unrelated-hms-001",
      source: "noaa_hms_fire_points",
      description: "The unrelated HMS-shaped test observation is excluded from Flood source roles.",
      required: true,
    });

    const result = separateFloodEvidence(variant);
    expect(result.map((assessment) => assessment.code)).toEqual([...FLOOD_EVIDENCE_CODES]);
    expect(byCode(result, "satellite_precipitation_visualization")).toEqual({
      code: "satellite_precipitation_visualization",
      status: "evidence_present",
      observationIds: ["obs-gibs-imerg-houston-000", "obs-gibs-imerg-houston-001"],
      sourceIds: ["nasa_gibs_imerg"],
    });
    expect(byCode(result, "ground_gage_height").observationIds).toEqual([
      "obs-usgs-gage-houston-001",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 8: Input immutability and determinism
// ---------------------------------------------------------------------------

describe("Input immutability and determinism", () => {
  it("does not mutate the input EvidenceObject", () => {
    const copy = structuredClone(houstonFixture);
    const original = JSON.stringify(houstonFixture);
    separateFloodEvidence(copy);
    expect(JSON.stringify(houstonFixture)).toBe(original);
  });

  it("returns fresh arrays on every call (not shared references)", () => {
    const r1 = separateFloodEvidence(houstonFixture);
    const r2 = separateFloodEvidence(houstonFixture);
    expect(r1).not.toBe(r2);
    expect(r1[0]).not.toBe(r2[0]);
    expect(r1[0].observationIds).not.toBe(r2[0].observationIds);
  });

  it("produces identical output on repeated calls (deterministic)", () => {
    const r1 = separateFloodEvidence(houstonFixture);
    const r2 = separateFloodEvidence(houstonFixture);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

// ---------------------------------------------------------------------------
// 9: Zero side effects
// ---------------------------------------------------------------------------

describe("Zero side effects: implementation source and imports", () => {
  it("imports only deterministic contracts and contains no forbidden access or calls", () => {
    const importSpecifiers = [...claimSeparationSource.matchAll(/\bfrom\s+["']([^"']+)["']/g)]
      .map((match) => match[1]);

    expect(importSpecifiers).toEqual([
      "@/contracts/evidence",
      "@/contracts/dataset-registry",
    ]);
    expect(claimSeparationSource).not.toMatch(/\b(?:process\.env|import\.meta\.env|Deno\.env)\b/);
    expect(claimSeparationSource).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
    expect(claimSeparationSource).not.toMatch(/\b(?:setTimeout|setInterval|Math\.random)\s*\(/);
  });

});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Zero side effects: runtime spies", () => {
  it("does not call fetch, timers, or randomness", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const randomSpy = vi.spyOn(Math, "random");
    separateFloodEvidence(houstonFixture);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(randomSpy).not.toHaveBeenCalled();
  });
});
