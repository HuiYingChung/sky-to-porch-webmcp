/**
 * src/lib/evidence/evaluator.ts
 *
 * WP-07 deterministic evidence evaluator.
 *
 * Recomputes an already-validated EvidenceObject's freshness, comparable-source
 * conflicts, confidence, required registry limitations, and inference eligibility
 * without mutating the caller's input.
 *
 * Safety invariants (enforced, never asserted away):
 *   - No data is never converted to "no danger".
 *   - Missing registry entry → fail closed.
 *   - Future observation times → fail closed.
 *   - Invalid thresholds or evaluatedAt → fail closed.
 *   - No "high" confidence, no predictions, no property-level conclusions.
 */

import {
  type EvidenceObject,
  type Freshness,
  type Confidence,
  type Limitation,
  validateEvidenceObject,
} from "../../contracts/evidence.js";
import { getRegistryEntry } from "../../data/dataset-registry.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EvidenceEvaluationPolicy = {
  evaluatedAt: string;
  freshness:
    | {
        basis: "age_thresholds";
        currentAgeLimitSeconds: number;
        recentAgeLimitSeconds: number;
      }
    | { basis: "historical_context" }
    | { basis: "no_observation_time" };
};

export type EvidenceConflict = {
  code: "source_disagreement" | "required_source_gap";
  observationIds: string[];
};

export type EvidenceEvaluationResult = {
  evidence: EvidenceObject;
  conflicts: EvidenceConflict[];
  inferenceAllowed: boolean;
};

// ---------------------------------------------------------------------------
// Locked rationale strings (rule order from §9 of the prompt)
// ---------------------------------------------------------------------------

const RATIONALE_CONFLICT =
  "Evidence has a source disagreement or required source gap.";
const RATIONALE_UNAVAILABLE =
  "Evidence is unavailable, missing, or unsupported.";
const RATIONALE_UNKNOWN_FRESHNESS =
  "Observation freshness is unknown.";
const RATIONALE_STALE =
  "Validated evidence is stale.";
const RATIONALE_NON_LIVE =
  "Validated evidence is cached, fixture, historical, or simulated.";
const RATIONALE_MODERATE =
  "Current or recent live evidence from multiple registered sources is consistent.";
const RATIONALE_LIMITED =
  "Validated evidence is limited and does not support inference.";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Deterministic ISO timestamp → epoch ms, or null on invalid input. */
function parseMs(ts: string): number | null {
  if (typeof ts !== "string" || ts.trim() === "") return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Compute freshness from policy + observation timestamps without mutating
 * the input Freshness object. Returns a new Freshness value on success or
 * throws (fail-closed) on inconsistent/invalid inputs.
 */
function computeFreshness(
  input: EvidenceObject,
  policy: EvidenceEvaluationPolicy
): Freshness {
  const evaluatedAtMs = parseMs(policy.evaluatedAt);
  if (evaluatedAtMs === null) {
    throw new Error(
      `evaluateEvidence: policy.evaluatedAt is not a valid ISO-8601 timestamp: "${policy.evaluatedAt}"`
    );
  }

  const fp = policy.freshness;

  // Collect usable observation times (not "unknown", not in the future)
  const usableTimes: number[] = [];
  for (const obs of input.observations) {
    const oat = obs.provenance.observedAt;
    if (oat === "unknown") continue;
    const ms = parseMs(oat);
    if (ms === null) continue;
    if (ms > evaluatedAtMs) {
      // Future observation → fail closed
      throw new Error(
        `evaluateEvidence: observation ${obs.observationId} has a future observedAt; failing closed`
      );
    }
    usableTimes.push(ms);
  }

  if (fp.basis === "no_observation_time") {
    // Valid only when there is no usable time
    if (usableTimes.length > 0) {
      throw new Error(
        "evaluateEvidence: policy.freshness.basis=no_observation_time but usable observation times exist; failing closed"
      );
    }
    return {
      status: "unknown",
      classificationBasis: "no_observation_time",
      evaluatedAt: policy.evaluatedAt,
      note: "No usable observation time is available.",
    };
  }

  if (usableTimes.length === 0) {
    throw new Error(
      `evaluateEvidence: policy.freshness.basis=${fp.basis} requires at least one usable observation time; failing closed`
    );
  }

  const latestMs = Math.max(...usableTimes);
  const mostRecentObservationAt = new Date(latestMs).toISOString();
  const ageSeconds = Math.floor((evaluatedAtMs - latestMs) / 1000);

  if (fp.basis === "historical_context") {
    return {
      status: "historical",
      classificationBasis: "historical_context",
      mostRecentObservationAt,
      evaluatedAt: policy.evaluatedAt,
      ageSeconds,
      note: "Evidence is classified as historical context.",
    };
  }

  // age_thresholds
  const { currentAgeLimitSeconds, recentAgeLimitSeconds } = fp;
  if (
    !Number.isFinite(currentAgeLimitSeconds) ||
    currentAgeLimitSeconds < 0 ||
    !Number.isFinite(recentAgeLimitSeconds) ||
    recentAgeLimitSeconds <= currentAgeLimitSeconds
  ) {
    throw new Error(
      "evaluateEvidence: age_thresholds freshness requires 0 <= currentAgeLimitSeconds < recentAgeLimitSeconds; failing closed"
    );
  }

  const status =
    ageSeconds <= currentAgeLimitSeconds
      ? "current"
      : ageSeconds <= recentAgeLimitSeconds
        ? "recent"
        : "stale";

  return {
    status,
    classificationBasis: "age_thresholds",
    mostRecentObservationAt,
    evaluatedAt: policy.evaluatedAt,
    ageSeconds,
    currentAgeLimitSeconds,
    recentAgeLimitSeconds,
    note: `Age ${ageSeconds}s against thresholds current≤${currentAgeLimitSeconds}s recent≤${recentAgeLimitSeconds}s.`,
  };
}

/**
 * Detect source disagreements: two+ distinct registered source IDs with the
 * same trimmed/case-folded variableName+unit and the same exact period but
 * different validated numeric or text values.
 */
function detectSourceDisagreements(input: EvidenceObject): EvidenceConflict[] {
  const conflicts: EvidenceConflict[] = [];

  // Group by (variableName.trimmed.lower, unit.trimmed.lower, periodStart, periodEnd)
  type GroupKey = string;
  const groups = new Map<
    GroupKey,
    Array<{ sourceId: string; obsId: string; numVal: number | undefined; textVal: string | undefined }>
  >();

  for (const obs of input.observations) {
    const varKey = obs.variableName.trim().toLowerCase();
    const unitKey = (obs.unit ?? "").trim().toLowerCase();
    const pStart = obs.periodStart ?? "";
    const pEnd = obs.periodEnd ?? "";
    const key: GroupKey = JSON.stringify([varKey, unitKey, pStart, pEnd]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({
      sourceId: obs.provenance.sourceId,
      obsId: obs.observationId,
      numVal: obs.value,
      textVal: obs.textValue,
    });
  }

  for (const entries of groups.values()) {
    if (entries.length < 2) continue;

    // Collect disagreement pairs across distinct source IDs
    const conflictIds = new Set<string>();
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        if (a.sourceId === b.sourceId) continue; // same source → not a conflict
        // Different values?
        const numericDisagreement =
          a.numVal !== undefined &&
          b.numVal !== undefined &&
          a.numVal !== b.numVal;
        const textDisagreement =
          a.textVal !== undefined &&
          b.textVal !== undefined &&
          a.textVal !== b.textVal;
        if (numericDisagreement || textDisagreement) {
          conflictIds.add(a.obsId);
          conflictIds.add(b.obsId);
        }
      }
    }

    if (conflictIds.size > 0) {
      conflicts.push({
        code: "source_disagreement",
        observationIds: Array.from(conflictIds).sort(),
      });
    }
  }

  return conflicts;
}

/**
 * Detect required source gaps: any partial/no_observation/failed/not_attempted mission
 * attribution alongside returned observations produces one gap.
 *
 * For partial attributions the contributed observation IDs are known.
 * For no_observation/failed/not_attempted, no contributed IDs are available; the gap
 * record lists all observation IDs as the affected set.
 */
function detectSourceGaps(input: EvidenceObject): EvidenceConflict[] {
  const hasObservations = input.observations.length > 0;
  if (!hasObservations) return [];

  const gapIds = new Set<string>();
  for (const ma of input.missionAttributions) {
    if (ma.retrievalStatus === "partial") {
      for (const id of ma.contributedObservationIds) {
        gapIds.add(id);
      }
    } else if (
      ma.retrievalStatus === "failed" ||
      ma.retrievalStatus === "no_observation" ||
      ma.retrievalStatus === "not_attempted"
    ) {
      // No contributed IDs exist; mark all observations as affected
      for (const obs of input.observations) {
        gapIds.add(obs.observationId);
      }
    }
  }

  if (gapIds.size === 0) return [];
  return [
    {
      code: "required_source_gap",
      observationIds: Array.from(gapIds).sort(),
    },
  ];
}

/**
 * Inject required limitations from the registry for every observation source.
 * Preserves existing limitations. Deduplicates only exact source+description.
 * Fails closed on missing registry entry or limitationId collision with
 * different content.
 */
function injectRegistryLimitations(input: EvidenceObject): Limitation[] {
  const result: Limitation[] = JSON.parse(JSON.stringify(input.limitations)) as Limitation[];

  // Index existing by id for collision detection
  const byId = new Map<string, Limitation>(result.map((l) => [l.limitationId, l]));

  // Fix 2: iterate source IDs in stable sorted order so output is independent
  // of observation ordering (not Map/Set insertion order).
  const uniqueSourceIds = Array.from(
    new Set(input.observations.map((o) => o.provenance.sourceId))
  ).sort();

  for (const sourceId of uniqueSourceIds) {
    const entry = getRegistryEntry(sourceId);
    if (!entry) {
      throw new Error(
        `evaluateEvidence: no registry entry for source "${sourceId}"; failing closed`
      );
    }

    for (const description of entry.requiredLimitations) {
      const limitationId = `registry:${sourceId}:${description}`;

      // Fix 1: if an exact source+description match exists but is required:false,
      // promote the cloned record to required:true rather than skipping it.
      const existingIdx = result.findIndex(
        (l) => l.source === sourceId && l.description === description
      );
      if (existingIdx !== -1) {
        if (!result[existingIdx].required) {
          result[existingIdx] = { ...result[existingIdx], required: true };
          byId.set(result[existingIdx].limitationId, result[existingIdx]);
        }
        continue; // already present (now required:true)
      }

      // Collision check: same id but different content
      if (byId.has(limitationId)) {
        const existing = byId.get(limitationId)!;
        if (existing.source !== sourceId || existing.description !== description) {
          throw new Error(
            `evaluateEvidence: limitationId collision for "${limitationId}"; failing closed`
          );
        }
        continue; // same content, already added
      }

      const lim: Limitation = {
        limitationId,
        source: sourceId,
        description,
        required: true,
      };
      result.push(lim);
      byId.set(limitationId, lim);
    }
  }

  return result;
}

/**
 * Determine deterministic confidence and inference eligibility.
 * Rule order is applied strictly as specified in §8–9 of the prompt.
 */
function computeConfidence(
  input: EvidenceObject,
  freshness: Freshness,
  hasConflict: boolean
): { confidence: Confidence; inferenceAllowed: boolean; evidenceState: typeof input.evidenceState } {
  type State = typeof input.evidenceState;
  const state = input.evidenceState as State;
  const mode = input.dataMode;

  // Rule 1: conflict/gap → inconclusive
  if (hasConflict) {
    return {
      confidence: { level: "insufficient", rationale: RATIONALE_CONFLICT },
      inferenceAllowed: false,
      evidenceState: "inconclusive_evidence",
    };
  }

  // Rule 2: no_observation / source_failure / unsupported_coverage / unavailable or failed mode
  if (
    state === "no_observation" ||
    state === "source_failure" ||
    state === "unsupported_coverage" ||
    mode === "unavailable" ||
    mode === "failed"
  ) {
    return {
      confidence: { level: "insufficient", rationale: RATIONALE_UNAVAILABLE },
      inferenceAllowed: false,
      evidenceState: state,
    };
  }

  // Rule 3: inconclusive_evidence (already-set state, no new conflict from above)
  if (state === "inconclusive_evidence") {
    return {
      confidence: { level: "insufficient", rationale: RATIONALE_CONFLICT },
      inferenceAllowed: false,
      evidenceState: state,
    };
  }

  // Rule 4: unknown freshness → insufficient
  if (freshness.status === "unknown") {
    return {
      confidence: { level: "insufficient", rationale: RATIONALE_UNKNOWN_FRESHNESS },
      inferenceAllowed: false,
      evidenceState: state,
    };
  }

  // Rule 5: stale → stale_data, low, no inference
  if (freshness.status === "stale") {
    return {
      confidence: { level: "low", rationale: RATIONALE_STALE },
      inferenceAllowed: false,
      evidenceState: "stale_data",
    };
  }

  // Rule 6: non-live mode → at most low, no inference
  if (
    mode === "cached" ||
    mode === "fixture" ||
    mode === "historical" ||
    mode === "simulated"
  ) {
    return {
      confidence: { level: "low", rationale: RATIONALE_NON_LIVE },
      inferenceAllowed: false,
      evidenceState: state,
    };
  }

  // Rule 7: observations_returned + live + current/recent + ≥2 distinct sources +
  //         ≥1 mission attribution + all attributions successful → moderate
  if (
    state === "observations_returned" &&
    mode === "live" &&
    (freshness.status === "current" || freshness.status === "recent") &&
    input.observations.length >= 2
  ) {
    const distinctSources = new Set(
      input.observations.map((o) => o.provenance.sourceId)
    );
    const hasAtLeastTwoSources = distinctSources.size >= 2;
    const hasAtLeastOneMission = input.missionAttributions.length >= 1;
    const allMissionsSuccessful = input.missionAttributions.every(
      (ma) => ma.retrievalStatus === "success"
    );

    if (hasAtLeastTwoSources && hasAtLeastOneMission && allMissionsSuccessful) {
      return {
        confidence: { level: "moderate", rationale: RATIONALE_MODERATE },
        inferenceAllowed: true,
        evidenceState: state,
      };
    }
  }

  // Rule 8: everything else → low, no inference
  return {
    confidence: { level: "low", rationale: RATIONALE_LIMITED },
    inferenceAllowed: false,
    evidenceState: state,
  };
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

export function evaluateEvidence(
  input: EvidenceObject,
  policy: EvidenceEvaluationPolicy
): EvidenceEvaluationResult {
  // Step 1: validate input
  validateEvidenceObject(input);

  // Step 2: deep-clone — never mutate caller data
  const clone = JSON.parse(JSON.stringify(input)) as EvidenceObject;

  // Step 3: compute freshness (fails closed on bad inputs)
  const freshness = computeFreshness(clone, policy);

  // Step 4: detect conflicts and gaps
  const disagreements = detectSourceDisagreements(clone);
  const gaps = detectSourceGaps(clone);
  // Sort by code first, then by an unambiguous serialization of the already
  // sorted observation IDs. Observation IDs are validated as non-empty strings
  // but may contain delimiter characters, so a joined key is not collision-free.
  const conflicts: EvidenceConflict[] = [...disagreements, ...gaps].sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const aKey = JSON.stringify(a.observationIds);
    const bKey = JSON.stringify(b.observationIds);
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
  const hasConflict = conflicts.length > 0;

  // Step 5: inject registry limitations
  const limitations = injectRegistryLimitations(clone);

  // Step 6: compute confidence + inference eligibility
  const { confidence, inferenceAllowed, evidenceState } = computeConfidence(
    clone,
    freshness,
    hasConflict
  );

  // Step 7: assemble output EvidenceObject
  const evaluated: EvidenceObject = {
    ...clone,
    freshness,
    confidence,
    limitations,
    evidenceState,
  };

  // Step 8: validate the evaluated output before returning
  validateEvidenceObject(evaluated);

  return { evidence: evaluated, conflicts, inferenceAllowed };
}
