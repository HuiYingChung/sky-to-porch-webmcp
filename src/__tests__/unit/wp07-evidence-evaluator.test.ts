/**
 * src/__tests__/unit/wp07-evidence-evaluator.test.ts
 *
 * WP-07 focused unit tests for the deterministic evidence evaluator.
 *
 * Tests are network-free and deterministic. No live sources are called.
 * No external state is read.
 *
 * Coverage (acceptance criteria):
 *  1. Input immutability and runtime-valid output
 *  2. Exact freshness boundaries, invalid/future/historical/unknown cases
 *  3. Comparable distinct-source disagreement and non-conflict cases
 *  4. Partial/failed/not_attempted source gaps
 *  5. Full registry-limitation injection, deduplication, and collision rejection
 *  6. Every confidence cap and the only moderate/inference-eligible case
 *  7. Deterministic ordering and zero network requests
 */

import { describe, it, expect, beforeAll } from "vitest";
import { evaluateEvidence } from "@/lib/evidence/evaluator";
import type {
  EvidenceEvaluationPolicy,
} from "@/lib/evidence/evaluator";
import type { EvidenceObject, Observation, MissionAttribution, Limitation } from "@/contracts/evidence";
import { validateEvidenceObject } from "@/contracts/evidence";
import type { QueryableSourceId } from "@/contracts/dataset-registry";

// ---------------------------------------------------------------------------
// Zero-network guard
// ---------------------------------------------------------------------------

beforeAll(() => {
  if (typeof globalThis.fetch === "function") {
    const original = globalThis.fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => {
      const url = typeof args[0] === "string" ? args[0] : String(args[0]);
      if (!url.startsWith("http://localhost")) {
        throw new Error(`wp07-evidence-evaluator test: unexpected network call to ${url}`);
      }
      return original(...args);
    };
  }
});

// ---------------------------------------------------------------------------
// Minimal valid fixture builders
// ---------------------------------------------------------------------------

const HASH = "a".repeat(64);
const EVALUATED_AT = "2025-06-01T12:00:00Z";
const OBSERVED_AT = "2025-06-01T10:00:00Z"; // 7200 s before evaluatedAt
const RECENT_AT = "2025-06-01T11:30:00Z";   // 1800 s before evaluatedAt
const STALE_AT = "2025-05-31T12:00:00Z";    // 86400 s before evaluatedAt
const FUTURE_AT = "2025-06-01T13:00:00Z";   // 1 hour in the future relative to evaluatedAt

function makeObs(
  overrides: Partial<Observation> & {
    sourceId?: string;
    observedAt?: string;
    value?: number;
    textValue?: string;
    variableName?: string;
    unit?: string;
    periodStart?: string;
    periodEnd?: string;
  } = {}
): Observation {
  const {
    sourceId = "noaa_hms_fire_points",
    observedAt = OBSERVED_AT,
    value,
    textValue,
    variableName = "fire_detections",
    unit = "count",
    periodStart,
    periodEnd,
    ...rest
  } = overrides;

  const base = {
    observationId: rest.observationId ?? "obs-1",
    provenance: {
      sourceId: sourceId as QueryableSourceId,
      sourceRecordId: "rec-1",
      retrievedAt: OBSERVED_AT,
      observedAt,
      product: "HMS v1",
      payloadHash: HASH,
    },
    variableName,
    dataMode: "live" as const,
    ...(periodStart !== undefined ? { periodStart, periodEnd } : {}),
  };

  // Build with exactly one of value or textValue (contract requirement)
  if (textValue !== undefined) {
    return { ...base, textValue } as Observation;
  }
  return { ...base, value: value ?? 5, unit } as Observation;
}

function makeMission(
  status: MissionAttribution["retrievalStatus"] = "success",
  obsIds: string[] = ["obs-1"]
): MissionAttribution {
  const contributedObservationIds =
    status === "success" || status === "partial" ? obsIds : [];
  return {
    missionName: "HMS Mission",
    agency: "NOAA",
    purpose: "Fire detection",
    selectionReason: "Primary fire source",
    contributedObservationIds,
    retrievalStatus: status,
    keyLimitation: "HMS satellite limitations apply",
  };
}

/** Minimal required limitation for noaa_hms_fire_points */
const HMS_REQUIRED_LIM: Limitation = {
  limitationId: "lim-hms-1",
  source: "noaa_hms_fire_points",
  description: "HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply.",
  required: true,
};

function makeBaseEvidence(
  overrides: Partial<EvidenceObject> & {
    observations?: Observation[];
    missionAttributions?: MissionAttribution[];
    limitations?: Limitation[];
  } = {}
): EvidenceObject {
  const observations = overrides.observations ?? [makeObs()];
  const missionAttributions = overrides.missionAttributions ?? [makeMission()];
  const limitations = overrides.limitations ?? [HMS_REQUIRED_LIM];

  const obj: EvidenceObject = {
    evidenceId: "ev-1",
    hazardId: "fire_smoke",
    intentId: "intent-1",
    evidenceState: overrides.evidenceState ?? "observations_returned",
    dataMode: overrides.dataMode ?? "live",
    observations,
    derivedMetrics: overrides.derivedMetrics ?? [],
    missionAttributions,
    freshness: overrides.freshness ?? {
      status: "current",
      classificationBasis: "age_thresholds",
      mostRecentObservationAt: OBSERVED_AT,
      evaluatedAt: OBSERVED_AT,
      ageSeconds: 0,
      currentAgeLimitSeconds: 3600,
      recentAgeLimitSeconds: 7200,
      note: "Within current threshold.",
    },
    confidence: overrides.confidence ?? {
      level: "low",
      rationale: "Validated evidence is limited and does not support inference.",
    },
    limitations,
    explanations: overrides.explanations ?? [],
    assembledAt: overrides.assembledAt ?? EVALUATED_AT,
  };
  return obj;
}

function makeAgeThresholdsPolicy(
  currentAgeLimitSeconds = 3600,
  recentAgeLimitSeconds = 7200,
  evaluatedAt = EVALUATED_AT
): EvidenceEvaluationPolicy {
  return {
    evaluatedAt,
    freshness: { basis: "age_thresholds", currentAgeLimitSeconds, recentAgeLimitSeconds },
  };
}

// ---------------------------------------------------------------------------
// 1. Input immutability and runtime-valid output
// ---------------------------------------------------------------------------

describe("1. Input immutability and runtime-valid output", () => {
  it("does not mutate the input EvidenceObject", () => {
    const input = makeBaseEvidence();
    const originalJson = JSON.stringify(input);
    const policy = makeAgeThresholdsPolicy();
    evaluateEvidence(input, policy);
    expect(JSON.stringify(input)).toBe(originalJson);
  });

  it("returns a runtime-validated EvidenceObject", () => {
    const input = makeBaseEvidence();
    const policy = makeAgeThresholdsPolicy();
    const { evidence } = evaluateEvidence(input, policy);
    expect(() => validateEvidenceObject(evidence)).not.toThrow();
  });

  it("returns a new object, not the same reference", () => {
    const input = makeBaseEvidence();
    const policy = makeAgeThresholdsPolicy();
    const { evidence } = evaluateEvidence(input, policy);
    expect(evidence).not.toBe(input);
  });
});

// ---------------------------------------------------------------------------
// 2. Freshness boundaries — age_thresholds
// ---------------------------------------------------------------------------

describe("2a. age_thresholds freshness", () => {
  // OBSERVED_AT is 7200 s before EVALUATED_AT
  // current <= 3600, recent <= 7200

  it("classifies age=7200 as recent (at recentAgeLimitSeconds boundary)", () => {
    const obs = makeObs({ observedAt: OBSERVED_AT }); // 7200 s ago
    const input = makeBaseEvidence({ observations: [obs] });
    const policy = makeAgeThresholdsPolicy(3600, 7200);
    const { evidence } = evaluateEvidence(input, policy);
    expect(evidence.freshness.status).toBe("recent");
    expect(evidence.freshness.ageSeconds).toBe(7200);
  });

  it("classifies age=1800 as current (at/below currentAgeLimitSeconds)", () => {
    const obs = makeObs({ observedAt: RECENT_AT }); // 1800 s ago
    const input = makeBaseEvidence({ observations: [obs] });
    const policy = makeAgeThresholdsPolicy(3600, 7200);
    const { evidence } = evaluateEvidence(input, policy);
    expect(evidence.freshness.status).toBe("current");
    expect(evidence.freshness.ageSeconds).toBe(1800);
  });

  it("classifies age=86400 as stale (exceeds recentAgeLimitSeconds)", () => {
    const obs = makeObs({ observedAt: STALE_AT }); // 86400 s ago
    // stale evidenceObject needs stale state + correct confidence/limitation
    // Build a valid stale EvidenceObject (the evaluator will set stale)
    const input = makeBaseEvidence({
      observations: [obs],
      evidenceState: "observations_returned",
    });
    const policy = makeAgeThresholdsPolicy(3600, 7200);
    const { evidence } = evaluateEvidence(input, policy);
    expect(evidence.freshness.status).toBe("stale");
    expect(evidence.evidenceState).toBe("stale_data");
  });

  it("picks the latest observation time when multiple observations differ", () => {
    const obs1 = makeObs({ observationId: "obs-1", observedAt: STALE_AT, value: 3, unit: "count" });
    const obs2 = makeObs({
      observationId: "obs-2",
      observedAt: RECENT_AT,
      value: 4,
      unit: "count",
      sourceId: "noaa_hms_smoke_polygons",
    });
    const lim2: Limitation = {
      limitationId: "lim-smoke-1",
      source: "noaa_hms_smoke_polygons",
      description:
        "HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply.",
      required: true,
    };
    const input = makeBaseEvidence({
      observations: [obs1, obs2],
      limitations: [HMS_REQUIRED_LIM, lim2],
      missionAttributions: [makeMission("success", ["obs-1", "obs-2"])],
    });
    const policy = makeAgeThresholdsPolicy(3600, 7200);
    const { evidence } = evaluateEvidence(input, policy);
    // Latest is RECENT_AT (1800 s) → current
    expect(evidence.freshness.status).toBe("current");
    expect(evidence.freshness.ageSeconds).toBe(1800);
    expect(evidence.freshness.mostRecentObservationAt).toBe(
      new Date(Date.parse(RECENT_AT)).toISOString()
    );
  });

  it("fails closed when currentAgeLimitSeconds >= recentAgeLimitSeconds", () => {
    const input = makeBaseEvidence();
    const policy: EvidenceEvaluationPolicy = {
      evaluatedAt: EVALUATED_AT,
      freshness: { basis: "age_thresholds", currentAgeLimitSeconds: 7200, recentAgeLimitSeconds: 3600 },
    };
    expect(() => evaluateEvidence(input, policy)).toThrow();
  });

  it("fails closed on invalid evaluatedAt", () => {
    const input = makeBaseEvidence();
    const policy: EvidenceEvaluationPolicy = {
      evaluatedAt: "not-a-timestamp",
      freshness: { basis: "age_thresholds", currentAgeLimitSeconds: 3600, recentAgeLimitSeconds: 7200 },
    };
    expect(() => evaluateEvidence(input, policy)).toThrow();
  });
});

describe("2b. Future observation time — fail closed", () => {
  it("throws when an observation has a future observedAt", () => {
    const obs = makeObs({ observedAt: FUTURE_AT });
    const input = makeBaseEvidence({ observations: [obs] });
    const policy = makeAgeThresholdsPolicy();
    expect(() => evaluateEvidence(input, policy)).toThrow(/future/i);
  });
});

describe("2c. historical_context freshness", () => {
  it("produces status=historical with no thresholds", () => {
    const input = makeBaseEvidence();
    const policy: EvidenceEvaluationPolicy = {
      evaluatedAt: EVALUATED_AT,
      freshness: { basis: "historical_context" },
    };
    const { evidence } = evaluateEvidence(input, policy);
    expect(evidence.freshness.status).toBe("historical");
    expect(evidence.freshness.classificationBasis).toBe("historical_context");
    expect(evidence.freshness.currentAgeLimitSeconds).toBeUndefined();
    expect(evidence.freshness.recentAgeLimitSeconds).toBeUndefined();
  });
});

describe("2d. no_observation_time freshness", () => {
  it("produces status=unknown when no usable observation time exists", () => {
    const obs = makeObs({ observedAt: "unknown" });
    const input = makeBaseEvidence({
      observations: [obs],
      evidenceState: "observations_returned",
    });
    const policy: EvidenceEvaluationPolicy = {
      evaluatedAt: EVALUATED_AT,
      freshness: { basis: "no_observation_time" },
    };
    const { evidence } = evaluateEvidence(input, policy);
    expect(evidence.freshness.status).toBe("unknown");
    expect(evidence.freshness.mostRecentObservationAt).toBeUndefined();
    expect(evidence.freshness.ageSeconds).toBeUndefined();
  });

  it("fails closed when no_observation_time is used but usable times exist", () => {
    const input = makeBaseEvidence(); // has a normal observedAt
    const policy: EvidenceEvaluationPolicy = {
      evaluatedAt: EVALUATED_AT,
      freshness: { basis: "no_observation_time" },
    };
    expect(() => evaluateEvidence(input, policy)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. Source disagreement conflicts and non-conflict cases
// ---------------------------------------------------------------------------

describe("3. Source disagreement", () => {
  function makeTwoSourceObs(valueA: number, valueB: number): Observation[] {
    return [
      makeObs({
        observationId: "obs-a",
        sourceId: "noaa_hms_fire_points",
        variableName: "Fire Detections",
        unit: "Count",
        value: valueA,
        periodStart: "2025-06-01T09:00:00Z",
        periodEnd: "2025-06-01T10:00:00Z",
      }),
      makeObs({
        observationId: "obs-b",
        sourceId: "noaa_hms_smoke_polygons",
        variableName: "fire detections", // case differs — should fold
        unit: "count",                   // case differs — should fold
        value: valueB,
        periodStart: "2025-06-01T09:00:00Z",
        periodEnd: "2025-06-01T10:00:00Z",
      }),
    ];
  }

  const smokeSourceLim: Limitation = {
    limitationId: "lim-smoke-sd",
    source: "noaa_hms_smoke_polygons",
    description:
      "HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply.",
    required: true,
  };

  it("detects a conflict when two distinct sources disagree on value for same var+unit+period", () => {
    const obs = makeTwoSourceObs(5, 10);
    const input = makeBaseEvidence({
      observations: obs,
      limitations: [HMS_REQUIRED_LIM, smokeSourceLim],
      missionAttributions: [makeMission("success", ["obs-a", "obs-b"])],
    });
    const policy = makeAgeThresholdsPolicy();
    const { conflicts } = evaluateEvidence(input, policy);
    expect(conflicts.some((c) => c.code === "source_disagreement")).toBe(true);
    const c = conflicts.find((c) => c.code === "source_disagreement")!;
    expect(c.observationIds).toContain("obs-a");
    expect(c.observationIds).toContain("obs-b");
  });

  it("does NOT flag a conflict when same source has two different values", () => {
    const obs: Observation[] = [
      makeObs({ observationId: "obs-1", value: 5 }),
      makeObs({ observationId: "obs-2", value: 10 }), // same sourceId
    ];
    const input = makeBaseEvidence({ observations: obs, missionAttributions: [makeMission("success", ["obs-1", "obs-2"])] });
    const policy = makeAgeThresholdsPolicy();
    const { conflicts } = evaluateEvidence(input, policy);
    expect(conflicts.filter((c) => c.code === "source_disagreement")).toHaveLength(0);
  });

  it("does NOT flag a conflict when two sources agree on value", () => {
    const obs = makeTwoSourceObs(5, 5); // same value
    const input = makeBaseEvidence({
      observations: obs,
      limitations: [HMS_REQUIRED_LIM, smokeSourceLim],
      missionAttributions: [makeMission("success", ["obs-a", "obs-b"])],
    });
    const policy = makeAgeThresholdsPolicy();
    const { conflicts } = evaluateEvidence(input, policy);
    expect(conflicts.filter((c) => c.code === "source_disagreement")).toHaveLength(0);
  });

  it("does NOT flag a conflict when variables differ across sources", () => {
    const obs: Observation[] = [
      makeObs({
        observationId: "obs-a",
        sourceId: "noaa_hms_fire_points",
        variableName: "fire_detections",
        value: 5,
        unit: "count",
        periodStart: "2025-06-01T09:00:00Z",
        periodEnd: "2025-06-01T10:00:00Z",
      }),
      makeObs({
        observationId: "obs-b",
        sourceId: "noaa_hms_smoke_polygons",
        variableName: "smoke_area",
        value: 100,
        unit: "km2",
        periodStart: "2025-06-01T09:00:00Z",
        periodEnd: "2025-06-01T10:00:00Z",
      }),
    ];
    const input = makeBaseEvidence({
      observations: obs,
      limitations: [HMS_REQUIRED_LIM, smokeSourceLim],
      missionAttributions: [makeMission("success", ["obs-a", "obs-b"])],
    });
    const policy = makeAgeThresholdsPolicy();
    const { conflicts } = evaluateEvidence(input, policy);
    expect(conflicts.filter((c) => c.code === "source_disagreement")).toHaveLength(0);
  });

  it("does NOT flag a conflict when periods differ", () => {
    const obs: Observation[] = [
      makeObs({
        observationId: "obs-a",
        sourceId: "noaa_hms_fire_points",
        variableName: "fire_detections",
        value: 5,
        unit: "count",
        periodStart: "2025-06-01T09:00:00Z",
        periodEnd: "2025-06-01T10:00:00Z",
      }),
      makeObs({
        observationId: "obs-b",
        sourceId: "noaa_hms_smoke_polygons",
        variableName: "fire_detections",
        value: 10,
        unit: "count",
        periodStart: "2025-06-01T08:00:00Z", // different period
        periodEnd: "2025-06-01T09:00:00Z",
      }),
    ];
    const input = makeBaseEvidence({
      observations: obs,
      limitations: [HMS_REQUIRED_LIM, smokeSourceLim],
      missionAttributions: [makeMission("success", ["obs-a", "obs-b"])],
    });
    const policy = makeAgeThresholdsPolicy();
    const { conflicts } = evaluateEvidence(input, policy);
    expect(conflicts.filter((c) => c.code === "source_disagreement")).toHaveLength(0);
  });

  it("conflict sets evidenceState=inconclusive_evidence and confidence=insufficient", () => {
    const obs = makeTwoSourceObs(5, 10);
    const input = makeBaseEvidence({
      observations: obs,
      limitations: [HMS_REQUIRED_LIM, smokeSourceLim],
      missionAttributions: [makeMission("success", ["obs-a", "obs-b"])],
    });
    const policy = makeAgeThresholdsPolicy();
    const { evidence, inferenceAllowed } = evaluateEvidence(input, policy);
    expect(evidence.evidenceState).toBe("inconclusive_evidence");
    expect(evidence.confidence.level).toBe("insufficient");
    expect(inferenceAllowed).toBe(false);
  });

  it("conflict observationIds are unique and sorted", () => {
    const obs = makeTwoSourceObs(5, 10);
    const input = makeBaseEvidence({
      observations: obs,
      limitations: [HMS_REQUIRED_LIM, smokeSourceLim],
      missionAttributions: [makeMission("success", ["obs-a", "obs-b"])],
    });
    const policy = makeAgeThresholdsPolicy();
    const { conflicts } = evaluateEvidence(input, policy);
    const c = conflicts.find((x) => x.code === "source_disagreement")!;
    const sorted = [...c.observationIds].sort();
    expect(c.observationIds).toEqual(sorted);
    expect(new Set(c.observationIds).size).toBe(c.observationIds.length);
  });
});

// ---------------------------------------------------------------------------
// 4. Required source gaps
// ---------------------------------------------------------------------------

describe("4. Required source gaps", () => {
  function makeGapInput(status: MissionAttribution["retrievalStatus"]): EvidenceObject {
    const obs = makeObs();
    return makeBaseEvidence({
      observations: [obs],
      missionAttributions: [
        makeMission("success", ["obs-1"]),
        { // second mission with the tested status
          missionName: "Deferred Mission",
          agency: "Test",
          purpose: "Testing",
          selectionReason: "Testing",
          contributedObservationIds: status === "partial" ? ["obs-1"] : [],
          retrievalStatus: status,
          keyLimitation: "Test limitation",
        },
      ],
    });
  }

  it("produces required_source_gap for partial mission", () => {
    const input = makeGapInput("partial");
    const { conflicts } = evaluateEvidence(input, makeAgeThresholdsPolicy());
    expect(conflicts.some((c) => c.code === "required_source_gap")).toBe(true);
  });

  it("produces required_source_gap for a mission that returned no matching observation", () => {
    const input = makeGapInput("no_observation");
    const { conflicts } = evaluateEvidence(input, makeAgeThresholdsPolicy());
    expect(conflicts.some((conflict) => conflict.code === "required_source_gap")).toBe(true);
  });

  it("produces required_source_gap for failed mission (with obs)", () => {
    const obs = makeObs();
    const input = makeBaseEvidence({
      observations: [obs],
      missionAttributions: [
        makeMission("success", ["obs-1"]),
        {
          missionName: "Failed Mission",
          agency: "Test",
          purpose: "Testing",
          selectionReason: "Test",
          contributedObservationIds: [],
          retrievalStatus: "failed",
          keyLimitation: "Test limitation",
        },
      ],
    });
    const { conflicts } = evaluateEvidence(input, makeAgeThresholdsPolicy());
    expect(conflicts.some((c) => c.code === "required_source_gap")).toBe(true);
  });

  it("produces required_source_gap for not_attempted mission (with obs)", () => {
    const obs = makeObs();
    const input = makeBaseEvidence({
      observations: [obs],
      missionAttributions: [
        makeMission("success", ["obs-1"]),
        {
          missionName: "Not Attempted Mission",
          agency: "Test",
          purpose: "Testing",
          selectionReason: "Test",
          contributedObservationIds: [],
          retrievalStatus: "not_attempted",
          keyLimitation: "Test limitation",
        },
      ],
    });
    const { conflicts } = evaluateEvidence(input, makeAgeThresholdsPolicy());
    expect(conflicts.some((c) => c.code === "required_source_gap")).toBe(true);
  });

  it("does NOT produce a source gap when all missions are successful", () => {
    const input = makeBaseEvidence();
    const { conflicts } = evaluateEvidence(input, makeAgeThresholdsPolicy());
    expect(conflicts.filter((c) => c.code === "required_source_gap")).toHaveLength(0);
  });

  it("gap sets evidenceState=inconclusive_evidence and confidence=insufficient", () => {
    const input = makeGapInput("partial");
    const { evidence, inferenceAllowed } = evaluateEvidence(input, makeAgeThresholdsPolicy());
    expect(evidence.evidenceState).toBe("inconclusive_evidence");
    expect(evidence.confidence.level).toBe("insufficient");
    expect(inferenceAllowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Registry limitation injection, deduplication, and collision rejection
// ---------------------------------------------------------------------------

describe("5. Registry limitation injection", () => {
  it("injects all requiredLimitations for each observation source", () => {
    // Input needs at least one required limitation per source to be valid;
    // seed exactly the first registry limitation so the evaluator can inject the rest.
    const seedLim: Limitation = {
      limitationId:
        "registry:noaa_hms_fire_points:HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply.",
      source: "noaa_hms_fire_points",
      description:
        "HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply.",
      required: true,
    };
    const input = makeBaseEvidence({ limitations: [seedLim] });
    // noaa_hms_fire_points has 4 required limitations; evaluator injects the remaining 3
    const { evidence } = evaluateEvidence(input, makeAgeThresholdsPolicy());
    const injected = evidence.limitations.filter((l) => l.source === "noaa_hms_fire_points");
    expect(injected.length).toBeGreaterThanOrEqual(4);
    for (const l of injected) {
      expect(l.required).toBe(true);
    }
  });

  it("preserves existing limitations that are not registry duplicates", () => {
    const extra: Limitation = {
      limitationId: "custom-extra",
      source: "noaa_hms_fire_points",
      description: "A custom non-registry limitation.",
      required: false,
    };
    // Also seed a required limitation so input is valid
    const input = makeBaseEvidence({ limitations: [HMS_REQUIRED_LIM, extra] });
    const { evidence } = evaluateEvidence(input, makeAgeThresholdsPolicy());
    const ids = evidence.limitations.map((l) => l.limitationId);
    expect(ids).toContain("custom-extra");
  });

  it("deduplicates exact source+description without adding a second copy", () => {
    // Pre-populate with one of the registry limitations
    const registryLim: Limitation = {
      limitationId: "registry:noaa_hms_fire_points:HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply.",
      source: "noaa_hms_fire_points",
      description:
        "HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply.",
      required: true,
    };
    const input = makeBaseEvidence({ limitations: [registryLim] });
    const { evidence } = evaluateEvidence(input, makeAgeThresholdsPolicy());
    const dupes = evidence.limitations.filter(
      (l) =>
        l.source === "noaa_hms_fire_points" &&
        l.description === registryLim.description
    );
    expect(dupes).toHaveLength(1);
  });

  it("does not let two different sources sharing an identical description text hide each other", () => {
    const obs1 = makeObs({ observationId: "obs-1", sourceId: "noaa_hms_fire_points" });
    const obs2 = makeObs({ observationId: "obs-2", sourceId: "noaa_hms_smoke_polygons", value: 3, unit: "count" });
    const lims: Limitation[] = [
      HMS_REQUIRED_LIM,
      {
        limitationId: "lim-smoke-sd-shared",
        source: "noaa_hms_smoke_polygons",
        description:
          "HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply.",
        required: true,
      },
    ];
    const input = makeBaseEvidence({
      observations: [obs1, obs2],
      limitations: lims,
      missionAttributions: [makeMission("success", ["obs-1", "obs-2"])],
    });
    const { evidence } = evaluateEvidence(input, makeAgeThresholdsPolicy());
    // Both sources' limitations should be present (different sources, same description text)
    const fromFire = evidence.limitations.filter((l) => l.source === "noaa_hms_fire_points");
    const fromSmoke = evidence.limitations.filter((l) => l.source === "noaa_hms_smoke_polygons");
    expect(fromFire.length).toBeGreaterThanOrEqual(1);
    expect(fromSmoke.length).toBeGreaterThanOrEqual(1);
  });

  it("fails closed when a limitationId collision has different content", () => {
    // Manually create a limitation whose id matches what the evaluator would produce but with different content
    const colliding: Limitation = {
      limitationId:
        "registry:noaa_hms_fire_points:HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply.",
      source: "noaa_hms_fire_points",
      description: "DIFFERENT DESCRIPTION — collision test",
      required: true,
    };
    const input = makeBaseEvidence({ limitations: [colliding] });
    expect(() => evaluateEvidence(input, makeAgeThresholdsPolicy())).toThrow(/collision/i);
  });
});

// ---------------------------------------------------------------------------
// 6. Confidence caps and the moderate/inference-eligible case
// ---------------------------------------------------------------------------

describe("6. Confidence caps and inference eligibility", () => {
  function makeModerateInput(): EvidenceObject {
    // Use distinct variable names per source so they never compare as a conflict
    const obs1 = makeObs({
      observationId: "obs-a",
      sourceId: "noaa_hms_fire_points",
      observedAt: RECENT_AT,
      variableName: "fire_detections",
      value: 5,
      unit: "count",
    });
    const obs2 = makeObs({
      observationId: "obs-b",
      sourceId: "noaa_hms_smoke_polygons",
      observedAt: RECENT_AT,
      variableName: "smoke_density",
      value: 2,
      unit: "category",
    });
    const lims: Limitation[] = [
      HMS_REQUIRED_LIM,
      {
        limitationId: "lim-smoke-mod",
        source: "noaa_hms_smoke_polygons",
        description:
          "HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply.",
        required: true,
      },
    ];
    return makeBaseEvidence({
      observations: [obs1, obs2],
      missionAttributions: [makeMission("success", ["obs-a", "obs-b"])],
      limitations: lims,
    });
  }

  it("moderate + inferenceAllowed=true for live current/recent ≥2 sources, ≥1 mission, all successful", () => {
    const input = makeModerateInput();
    // Policy: current threshold > 1800 so RECENT_AT (1800s) is current
    const policy = makeAgeThresholdsPolicy(3600, 7200);
    const { evidence, inferenceAllowed } = evaluateEvidence(input, policy);
    expect(evidence.confidence.level).toBe("moderate");
    expect(inferenceAllowed).toBe(true);
  });

  it("never emits high confidence", () => {
    const input = makeModerateInput();
    const { evidence } = evaluateEvidence(input, makeAgeThresholdsPolicy());
    expect(evidence.confidence.level).not.toBe("high");
  });

  it("low confidence when only one contributing source (not enough for moderate)", () => {
    // Single source observation
    const input = makeBaseEvidence();
    const { evidence, inferenceAllowed } = evaluateEvidence(input, makeAgeThresholdsPolicy());
    expect(evidence.confidence.level).toBe("low");
    expect(inferenceAllowed).toBe(false);
  });

  it("insufficient confidence for no_observation state", () => {
    const input: EvidenceObject = {
      ...makeBaseEvidence({
        evidenceState: "no_observation",
        observations: [],
        missionAttributions: [],
        dataMode: "live",
        freshness: {
          status: "unknown",
          classificationBasis: "no_observation_time",
          evaluatedAt: OBSERVED_AT,
          note: "No observation.",
        },
        confidence: { level: "insufficient", rationale: "No observation." },
        limitations: [HMS_REQUIRED_LIM],
        derivedMetrics: [],
      }),
    };
    const policy: EvidenceEvaluationPolicy = {
      evaluatedAt: EVALUATED_AT,
      freshness: { basis: "no_observation_time" },
    };
    const { evidence, inferenceAllowed } = evaluateEvidence(input, policy);
    expect(evidence.confidence.level).toBe("insufficient");
    expect(inferenceAllowed).toBe(false);
  });

  it("insufficient confidence for source_failure state", () => {
    const input: EvidenceObject = {
      ...makeBaseEvidence({
        evidenceState: "source_failure",
        observations: [],
        missionAttributions: [],
        dataMode: "failed",
        freshness: {
          status: "unknown",
          classificationBasis: "no_observation_time",
          evaluatedAt: OBSERVED_AT,
          note: "Source failed.",
        },
        confidence: { level: "insufficient", rationale: "Source failed." },
        limitations: [HMS_REQUIRED_LIM],
        derivedMetrics: [],
      }),
    };
    const policy: EvidenceEvaluationPolicy = {
      evaluatedAt: EVALUATED_AT,
      freshness: { basis: "no_observation_time" },
    };
    const { evidence, inferenceAllowed } = evaluateEvidence(input, policy);
    expect(evidence.confidence.level).toBe("insufficient");
    expect(inferenceAllowed).toBe(false);
  });

  it("low confidence for stale freshness, evidenceState becomes stale_data", () => {
    const obs = makeObs({ observedAt: STALE_AT });
    const input = makeBaseEvidence({ observations: [obs] });
    const policy = makeAgeThresholdsPolicy(3600, 7200);
    const { evidence, inferenceAllowed } = evaluateEvidence(input, policy);
    expect(evidence.freshness.status).toBe("stale");
    expect(evidence.confidence.level).toBe("low");
    expect(evidence.evidenceState).toBe("stale_data");
    expect(inferenceAllowed).toBe(false);
  });

  it("low confidence for fixture mode even with current freshness", () => {
    // EVALUATED_AT = "2025-06-01T12:00:00Z"; RECENT_AT = "2025-06-01T11:30:00Z" → 1800 s ago
    const fixtureObs: Observation = {
      observationId: "obs-1",
      provenance: {
        sourceId: "noaa_hms_fire_points",
        sourceRecordId: "rec-1",
        retrievedAt: RECENT_AT,
        observedAt: RECENT_AT,
        product: "HMS v1",
        payloadHash: HASH,
      },
      variableName: "fire_detections",
      value: 5,
      unit: "count",
      dataMode: "fixture",
    };
    // Build a valid fixture-mode EvidenceObject with correct freshness
    const fixtureInput: EvidenceObject = {
      evidenceId: "ev-fixture",
      hazardId: "fire_smoke",
      intentId: "intent-1",
      evidenceState: "observations_returned",
      dataMode: "fixture",
      observations: [fixtureObs],
      derivedMetrics: [],
      missionAttributions: [makeMission("success", ["obs-1"])],
      freshness: {
        status: "current",
        classificationBasis: "age_thresholds",
        mostRecentObservationAt: RECENT_AT,
        evaluatedAt: EVALUATED_AT,     // evaluatedAt > mostRecentObservationAt ✓
        ageSeconds: 1800,
        currentAgeLimitSeconds: 3600,
        recentAgeLimitSeconds: 7200,
        note: "Fixture current.",
      },
      confidence: { level: "low", rationale: "Fixture." },
      limitations: [HMS_REQUIRED_LIM],
      explanations: [],
      assembledAt: EVALUATED_AT,
    };
    const policy = makeAgeThresholdsPolicy(3600, 7200);
    const { evidence, inferenceAllowed } = evaluateEvidence(fixtureInput, policy);
    expect(evidence.confidence.level).toBe("low");
    expect(inferenceAllowed).toBe(false);
  });

  it("unknown freshness → insufficient confidence, no inference", () => {
    const obs = makeObs({ observedAt: "unknown" });
    const input = makeBaseEvidence({
      observations: [obs],
      evidenceState: "observations_returned",
    });
    const policy: EvidenceEvaluationPolicy = {
      evaluatedAt: EVALUATED_AT,
      freshness: { basis: "no_observation_time" },
    };
    const { evidence, inferenceAllowed } = evaluateEvidence(input, policy);
    expect(evidence.freshness.status).toBe("unknown");
    expect(evidence.confidence.level).toBe("insufficient");
    expect(inferenceAllowed).toBe(false);
  });

  it("insufficient confidence for unavailable dataMode", () => {
    // Build a valid no_observation evidence object with unavailable mode
    const input: EvidenceObject = {
      evidenceId: "ev-unavail",
      hazardId: "fire_smoke",
      intentId: "intent-1",
      evidenceState: "no_observation",
      dataMode: "unavailable",
      observations: [],
      derivedMetrics: [],
      missionAttributions: [],
      freshness: {
        status: "unknown",
        classificationBasis: "no_observation_time",
        evaluatedAt: OBSERVED_AT,
        note: "No data.",
      },
      confidence: { level: "insufficient", rationale: "Unavailable." },
      limitations: [HMS_REQUIRED_LIM],
      explanations: [],
      assembledAt: EVALUATED_AT,
    };
    const policy: EvidenceEvaluationPolicy = {
      evaluatedAt: EVALUATED_AT,
      freshness: { basis: "no_observation_time" },
    };
    const { evidence, inferenceAllowed } = evaluateEvidence(input, policy);
    expect(evidence.confidence.level).toBe("insufficient");
    expect(inferenceAllowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Deterministic ordering and zero network requests
// ---------------------------------------------------------------------------

describe("7. Deterministic ordering", () => {
  it("conflict codes are sorted in the result", () => {
    // Create both a source disagreement and a gap in the same call
    const obs1 = makeObs({
      observationId: "obs-a",
      sourceId: "noaa_hms_fire_points",
      variableName: "fire_detections",
      value: 5,
      unit: "count",
      periodStart: "2025-06-01T09:00:00Z",
      periodEnd: "2025-06-01T10:00:00Z",
    });
    const obs2 = makeObs({
      observationId: "obs-b",
      sourceId: "noaa_hms_smoke_polygons",
      variableName: "fire_detections",
      value: 10,
      unit: "count",
      periodStart: "2025-06-01T09:00:00Z",
      periodEnd: "2025-06-01T10:00:00Z",
    });
    const lims: Limitation[] = [
      HMS_REQUIRED_LIM,
      {
        limitationId: "lim-smoke-ord",
        source: "noaa_hms_smoke_polygons",
        description:
          "HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply.",
        required: true,
      },
    ];
    const input = makeBaseEvidence({
      observations: [obs1, obs2],
      missionAttributions: [
        makeMission("success", ["obs-a", "obs-b"]),
        {
          missionName: "Gap Mission",
          agency: "Test",
          purpose: "Test",
          selectionReason: "Test",
          contributedObservationIds: [],
          retrievalStatus: "not_attempted",
          keyLimitation: "Test",
        },
      ],
      limitations: lims,
    });
    const policy = makeAgeThresholdsPolicy();
    const { conflicts } = evaluateEvidence(input, policy);
    // Codes should be sorted
    const codes = conflicts.map((c) => c.code);
    expect(codes).toEqual([...codes].sort());
  });

  it("produces identical results on repeated calls with identical input", () => {
    const input = makeBaseEvidence();
    const policy = makeAgeThresholdsPolicy();
    const result1 = evaluateEvidence(input, policy);
    const result2 = evaluateEvidence(input, policy);
    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
  });

  it("conflict observationIds are sorted", () => {
    const obs1 = makeObs({
      observationId: "z-obs",
      sourceId: "noaa_hms_fire_points",
      variableName: "fire_detections",
      value: 5,
      unit: "count",
      periodStart: "2025-06-01T09:00:00Z",
      periodEnd: "2025-06-01T10:00:00Z",
    });
    const obs2 = makeObs({
      observationId: "a-obs",
      sourceId: "noaa_hms_smoke_polygons",
      variableName: "fire_detections",
      value: 10,
      unit: "count",
      periodStart: "2025-06-01T09:00:00Z",
      periodEnd: "2025-06-01T10:00:00Z",
    });
    const lims: Limitation[] = [
      HMS_REQUIRED_LIM,
      {
        limitationId: "lim-smoke-sort",
        source: "noaa_hms_smoke_polygons",
        description:
          "HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply.",
        required: true,
      },
    ];
    const input = makeBaseEvidence({
      observations: [obs1, obs2],
      limitations: lims,
      missionAttributions: [makeMission("success", ["z-obs", "a-obs"])],
    });
    const policy = makeAgeThresholdsPolicy();
    const { conflicts } = evaluateEvidence(input, policy);
    const c = conflicts.find((x) => x.code === "source_disagreement")!;
    expect(c.observationIds).toEqual([...c.observationIds].sort());
  });
});

// ---------------------------------------------------------------------------
// C01 focused regressions
// ---------------------------------------------------------------------------

describe("C01-1. required:false limitation promoted to required:true", () => {
  it("promotes a matching registry description from required:false to required:true in the output", () => {
    // The registry description for noaa_hms_fire_points matches the input lim
    // but the input marks it required:false — the evaluator must produce exactly
    // one record for that description and it must be required:true.
    const downgraded: Limitation = {
      limitationId: "lim-downgraded",
      source: "noaa_hms_fire_points",
      description:
        "HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply.",
      required: false,
    };
    // Input is valid because another required source limitation remains.
    const seedRequired: Limitation = {
      limitationId: "registry:noaa_hms_fire_points:Processing and analyst-review delay may be several hours.",
      source: "noaa_hms_fire_points",
      description: "Processing and analyst-review delay may be several hours.",
      required: true,
    };
    const input = makeBaseEvidence({ limitations: [downgraded, seedRequired] });

    // Verify input is runtime-valid before the call
    expect(() => validateEvidenceObject(input)).not.toThrow();

    const inputJson = JSON.stringify(input);
    const { evidence } = evaluateEvidence(input, makeAgeThresholdsPolicy());

    // Input must be unchanged (immutability)
    expect(JSON.stringify(input)).toBe(inputJson);
    expect(input.limitations[0].required).toBe(false);

    // Output must contain exactly one record with that description for that source
    const matching = evidence.limitations.filter(
      (l) =>
        l.source === "noaa_hms_fire_points" &&
        l.description ===
          "HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply."
    );
    expect(matching).toHaveLength(1);
    expect(matching[0].required).toBe(true);
  });
});

describe("C01-2. Output independent of observation ordering", () => {
  function makeTwoGroupTwoSourceInput(obsOrder: [string, string, string, string]): EvidenceObject {
    // Two disagreement groups across two sources:
    //   group A: var=fire_detections, period P1 — sources fire+smoke disagree
    //   group B: var=wind_speed,       period P2 — sources fire+smoke disagree
    // Four observations whose order is controlled by the caller.
    const allObs: Record<string, Observation> = {
      "obs-fa": makeObs({
        observationId: "obs-fa",
        sourceId: "noaa_hms_fire_points",
        variableName: "fire_detections",
        unit: "count",
        value: 5,
        periodStart: "2025-06-01T09:00:00Z",
        periodEnd: "2025-06-01T10:00:00Z",
      }),
      "obs-sa": makeObs({
        observationId: "obs-sa",
        sourceId: "noaa_hms_smoke_polygons",
        variableName: "fire_detections",
        unit: "count",
        value: 10,
        periodStart: "2025-06-01T09:00:00Z",
        periodEnd: "2025-06-01T10:00:00Z",
      }),
      "obs-fb": makeObs({
        observationId: "obs-fb",
        sourceId: "noaa_hms_fire_points",
        variableName: "wind_speed",
        unit: "km/h",
        value: 20,
        periodStart: "2025-06-01T09:00:00Z",
        periodEnd: "2025-06-01T10:00:00Z",
      }),
      "obs-sb": makeObs({
        observationId: "obs-sb",
        sourceId: "noaa_hms_smoke_polygons",
        variableName: "wind_speed",
        unit: "km/h",
        value: 25,
        periodStart: "2025-06-01T09:00:00Z",
        periodEnd: "2025-06-01T10:00:00Z",
      }),
    };
    const observations = obsOrder.map((id) => allObs[id]);
    const smokeLim: Limitation = {
      limitationId: "lim-smoke-c01",
      source: "noaa_hms_smoke_polygons",
      description:
        "HMS detection resolution and cloud, smoke, canopy, terrain, and false-positive limitations apply.",
      required: true,
    };
    return makeBaseEvidence({
      observations,
      limitations: [HMS_REQUIRED_LIM, smokeLim],
      missionAttributions: [makeMission("success", ["obs-fa", "obs-sa", "obs-fb", "obs-sb"])],
    });
  }

  it("produces identical conflicts regardless of observation order", () => {
    const orderA = makeTwoGroupTwoSourceInput(["obs-fa", "obs-sa", "obs-fb", "obs-sb"]);
    const orderB = makeTwoGroupTwoSourceInput(["obs-sb", "obs-fb", "obs-sa", "obs-fa"]);
    const policy = makeAgeThresholdsPolicy();
    const resultA = evaluateEvidence(orderA, policy);
    const resultB = evaluateEvidence(orderB, policy);
    expect(resultA.conflicts).toEqual(resultB.conflicts);
  });

  it("produces identical injected limitations regardless of observation order", () => {
    const orderA = makeTwoGroupTwoSourceInput(["obs-fa", "obs-sa", "obs-fb", "obs-sb"]);
    const orderB = makeTwoGroupTwoSourceInput(["obs-sb", "obs-fb", "obs-sa", "obs-fa"]);
    const policy = makeAgeThresholdsPolicy();
    const resultA = evaluateEvidence(orderA, policy);
    const resultB = evaluateEvidence(orderB, policy);
    expect(resultA.evidence.limitations).toEqual(resultB.evidence.limitations);
  });
});
