/**
 * src/contracts/evidence.ts
 *
 * Evidence contracts — runtime schemas and validators for all WP-02
 * evidence types:
 *   Observation, DerivedMetric, EvidenceObject, MissionAttribution,
 *   Freshness, Confidence, Limitation, Explanation
 *
 * Core invariants enforced at runtime:
 *   - Provenance: source URL or ID, retrievedAt, observedAt or explicit
 *     unknown state, product/version or explicit unknown, payload hash
 *     where a payload exists.
 *   - Units: explicit for every numeric observation and metric.
 *   - Freshness: deterministically computed from timestamps, never asserted.
 *   - Confidence: categorical with rationale; no fabricated percentages.
 *   - No-data ≠ no-danger: all empty/failure/unsupported states carry
 *     an explicit required limitation.
 *   - Derived metrics reference observation IDs.
 *   - Interpretations (Explanation) reference evidence IDs.
 */

import {
  type HazardId,
  type EvidenceState,
  type DataMode,
  validateHazardId,
  validateEvidenceState,
  validateDataMode,
  validateTimestamp,
  validateTimestampRange,
  isFiniteNumber,
  assert,
  assertPlainObject,
  assertExactKeys,
  assertNonEmptyString,
  assertStringArray,
} from "./common.js";
import {
  type QueryableSourceId,
  validateQueryableSourceId,
} from "./dataset-registry.js";
import {
  validateAdaptiveMeaning,
  type AdaptiveMeaning,
} from "./meaning.js";

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export interface Provenance {
  /** Registered source ID. */
  sourceId: QueryableSourceId;
  /**
   * Source URL or source-assigned identifier for the specific payload.
   * Required unless the source does not produce a stable URL.
   */
  sourceUrl?: string;
  /** Stable source-assigned identifier when no stable payload URL exists. */
  sourceRecordId?: string;
  /** ISO-8601 timestamp when the payload was retrieved. Required. */
  retrievedAt: string;
  /**
   * ISO-8601 timestamp when the observation was made/measured.
   * Required for time-specific observations; "unknown" is permitted and
   * explicit — it is not omission.
   */
  observedAt: string | "unknown";
  /**
   * Product name and version, e.g. "GPM_3IMERGHH_v07".
   * "unknown" is permitted and explicit.
   */
  product: string | "unknown";
  /**
   * SHA-256 hex hash of the raw response payload, when a payload was
   * received. Must be omitted only when no payload was received.
   */
  payloadHash: string;
  /** Request parameters that produced this response, as a plain record. */
  requestParameters?: Record<string, string>;
}

export function validateProvenance(v: unknown): asserts v is Provenance {
  assertPlainObject(v, "provenance");
  const obj = v as Record<string, unknown>;
  assertExactKeys(
    obj,
    [
      "sourceId",
      "sourceUrl",
      "sourceRecordId",
      "retrievedAt",
      "observedAt",
      "product",
      "payloadHash",
      "requestParameters",
    ],
    "provenance"
  );
  assert("sourceId" in obj, "provenance.sourceId is required");
  validateQueryableSourceId(obj.sourceId);
  if (obj.sourceUrl !== undefined) {
    assertNonEmptyString(obj.sourceUrl, "provenance.sourceUrl");
    assert(obj.sourceUrl.startsWith("https://"), "provenance.sourceUrl must use HTTPS");
  }
  if (obj.sourceRecordId !== undefined) {
    assertNonEmptyString(obj.sourceRecordId, "provenance.sourceRecordId");
  }
  assert(
    obj.sourceUrl !== undefined || obj.sourceRecordId !== undefined,
    "provenance requires sourceUrl or sourceRecordId"
  );
  assert("retrievedAt" in obj, "provenance.retrievedAt is required");
  validateTimestamp(obj.retrievedAt, "provenance.retrievedAt");
  assert("observedAt" in obj, "provenance.observedAt is required");
  if (obj.observedAt !== "unknown") {
    validateTimestamp(obj.observedAt, "provenance.observedAt");
  }
  assert("product" in obj, "provenance.product is required");
  assertNonEmptyString(obj.product, "provenance.product");
  assert(
    typeof obj.payloadHash === "string" && /^[0-9a-fA-F]{64}$/.test(obj.payloadHash),
    "provenance.payloadHash must be a 64-character hex string"
  );
  if (obj.requestParameters !== undefined) {
    assertPlainObject(obj.requestParameters, "provenance.requestParameters");
    for (const [key, value] of Object.entries(obj.requestParameters)) {
      assertNonEmptyString(key, "provenance.requestParameters key");
      assert(typeof value === "string", `provenance.requestParameters.${key} must be a string`);
    }
  }
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

export interface Observation {
  observationId: string;
  provenance: Provenance;
  /** Human-readable name of the measured variable. */
  variableName: string;
  /** Numeric value, if the observation is numeric. */
  value?: number;
  /** Unit string — required for any numeric value. */
  unit?: string;
  /** String-valued observation for non-numeric values. */
  textValue?: string;
  dataMode: DataMode;
  /** Qualifier codes from the source (e.g. USGS "P" for provisional). */
  qualifiers?: string[];
  /** ISO-8601 start of observation period. */
  periodStart?: string;
  /** ISO-8601 end of observation period. */
  periodEnd?: string;
  /** Arbitrary key/value pairs from the source. */
  metadata?: Record<string, string | number | boolean>;
}

export function validateObservation(v: unknown): asserts v is Observation {
  assertPlainObject(v, "observation");
  const obj = v as Record<string, unknown>;
  assertExactKeys(
    obj,
    [
      "observationId",
      "provenance",
      "variableName",
      "value",
      "unit",
      "textValue",
      "dataMode",
      "qualifiers",
      "periodStart",
      "periodEnd",
      "metadata",
    ],
    "observation"
  );
  assertNonEmptyString(obj.observationId, "observationId");
  assert("provenance" in obj, "observation.provenance is required");
  validateProvenance(obj.provenance);
  assertNonEmptyString(obj.variableName, "variableName");
  assert("dataMode" in obj, "observation.dataMode is required");
  validateDataMode(obj.dataMode);
  const hasNumericValue = obj.value !== undefined;
  const hasTextValue = obj.textValue !== undefined;
  assert(
    hasNumericValue !== hasTextValue,
    "observation must contain exactly one of value or textValue"
  );
  if (obj.value !== undefined) {
    assert(isFiniteNumber(obj.value), "observation.value must be a finite number");
    assertNonEmptyString(obj.unit, "observation.unit");
  } else if (obj.unit !== undefined) {
    assertNonEmptyString(obj.unit, "observation.unit");
  }
  if (obj.textValue !== undefined) {
    assertNonEmptyString(obj.textValue, "observation.textValue");
  }
  assert(
    (obj.periodStart === undefined) === (obj.periodEnd === undefined),
    "observation.periodStart and periodEnd must be provided together"
  );
  if (obj.periodStart !== undefined) {
    validateTimestampRange(obj.periodStart, obj.periodEnd, "observation period");
  }
  if (obj.qualifiers !== undefined) {
    assertStringArray(obj.qualifiers, "observation.qualifiers", { unique: true });
  }
  if (obj.metadata !== undefined) {
    assertPlainObject(obj.metadata, "observation.metadata");
    for (const [key, value] of Object.entries(obj.metadata)) {
      assertNonEmptyString(key, "observation.metadata key");
      assert(
        typeof value === "string" || typeof value === "number" || typeof value === "boolean",
        `observation.metadata.${key} must be a string, number, or boolean`
      );
      if (typeof value === "number") {
        assert(isFiniteNumber(value), `observation.metadata.${key} must be finite`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// DerivedMetric
// ---------------------------------------------------------------------------

export interface DerivedMetric {
  metricId: string;
  /** IDs of the observations this metric was derived from. */
  sourceObservationIds: string[];
  /** Name of the derived quantity. */
  metricName: string;
  value: number;
  unit: string;
  /** Plain-language description of the derivation method. */
  derivationMethod: string;
  dataMode: DataMode;
}

export function validateDerivedMetric(v: unknown): asserts v is DerivedMetric {
  assertPlainObject(v, "derivedMetric");
  const obj = v as Record<string, unknown>;
  assertExactKeys(
    obj,
    ["metricId", "sourceObservationIds", "metricName", "value", "unit", "derivationMethod", "dataMode"],
    "derivedMetric"
  );
  assertNonEmptyString(obj.metricId, "metricId");
  assertStringArray(obj.sourceObservationIds, "sourceObservationIds", {
    nonEmpty: true,
    unique: true,
  });
  assertNonEmptyString(obj.metricName, "metricName");
  assert(isFiniteNumber(obj.value), "derivedMetric.value must be a finite number");
  assertNonEmptyString(obj.unit, "unit");
  assertNonEmptyString(obj.derivationMethod, "derivationMethod");
  assert("dataMode" in obj, "derivedMetric.dataMode is required");
  validateDataMode(obj.dataMode);
}

// ---------------------------------------------------------------------------
// MissionAttribution
// ---------------------------------------------------------------------------

export interface MissionAttribution {
  /** Mission name, e.g. "GPM (Global Precipitation Measurement)". */
  missionName: string;
  agency: string;
  /** Plain-language purpose of this mission. */
  purpose: string;
  /** Why this mission was selected for the current evidence chain. */
  selectionReason: string;
  /** IDs of the observations contributed by this mission. */
  contributedObservationIds: string[];
  /** Retrieval success or failure for this mission. */
  retrievalStatus: "success" | "partial" | "failed" | "not_attempted";
  /** Key limitation relevant to this mission's evidence. */
  keyLimitation: string;
  /** Dataset or product ID, e.g. "GPM_3IMERGHH_v07". */
  datasetId?: string;
}

export function validateMissionAttribution(v: unknown): asserts v is MissionAttribution {
  assertPlainObject(v, "missionAttribution");
  const obj = v as Record<string, unknown>;
  assertExactKeys(
    obj,
    [
      "missionName",
      "agency",
      "purpose",
      "selectionReason",
      "contributedObservationIds",
      "retrievalStatus",
      "keyLimitation",
      "datasetId",
    ],
    "missionAttribution"
  );
  assertNonEmptyString(obj.missionName, "missionName");
  assertNonEmptyString(obj.agency, "agency");
  assertNonEmptyString(obj.purpose, "purpose");
  assertNonEmptyString(obj.selectionReason, "selectionReason");
  assertStringArray(obj.contributedObservationIds, "contributedObservationIds", {
    unique: true,
  });
  const validStatuses = ["success", "partial", "failed", "not_attempted"];
  assert(
    typeof obj.retrievalStatus === "string" && validStatuses.includes(obj.retrievalStatus),
    `retrievalStatus must be one of [${validStatuses.join(", ")}], got "${obj.retrievalStatus}"`
  );
  assertNonEmptyString(obj.keyLimitation, "keyLimitation");
  if (obj.datasetId !== undefined) {
    assertNonEmptyString(obj.datasetId, "datasetId");
  }
  if (obj.retrievalStatus === "success" || obj.retrievalStatus === "partial") {
    assert(
      (obj.contributedObservationIds as string[]).length > 0,
      `${obj.retrievalStatus} missionAttribution must reference an observation`
    );
  } else {
    assert(
      (obj.contributedObservationIds as string[]).length === 0,
      `${obj.retrievalStatus} missionAttribution must not claim contributed observations`
    );
  }
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

export const FRESHNESS_STATUSES = ["current", "recent", "stale", "historical", "unknown"] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const FRESHNESS_CLASSIFICATION_BASES = [
  "age_thresholds",
  "historical_context",
  "no_observation_time",
] as const;
export type FreshnessClassificationBasis =
  (typeof FRESHNESS_CLASSIFICATION_BASES)[number];

export interface Freshness {
  status: FreshnessStatus;
  /** Deterministic rule used to produce status. */
  classificationBasis: FreshnessClassificationBasis;
  /** ISO-8601 timestamp of the most recent relevant observation. */
  mostRecentObservationAt?: string;
  /** ISO-8601 timestamp when freshness was evaluated. */
  evaluatedAt: string;
  /**
   * Age of the most recent observation in seconds at evaluation time.
   * Must be a non-negative finite number when available.
   */
  ageSeconds?: number;
  /** Inclusive maximum age for `current`, when age thresholds are used. */
  currentAgeLimitSeconds?: number;
  /** Inclusive maximum age for `recent`; older evidence is `stale`. */
  recentAgeLimitSeconds?: number;
  /** Plain-language freshness note. */
  note: string;
}

export function validateFreshness(v: unknown): asserts v is Freshness {
  assertPlainObject(v, "freshness");
  const obj = v as Record<string, unknown>;
  assertExactKeys(
    obj,
    [
      "status",
      "classificationBasis",
      "mostRecentObservationAt",
      "evaluatedAt",
      "ageSeconds",
      "currentAgeLimitSeconds",
      "recentAgeLimitSeconds",
      "note",
    ],
    "freshness"
  );
  assert(
    typeof obj.status === "string" && (FRESHNESS_STATUSES as readonly string[]).includes(obj.status),
    `freshness.status must be one of [${FRESHNESS_STATUSES.join(", ")}], got "${obj.status}"`
  );
  assert(
    typeof obj.classificationBasis === "string" &&
      (FRESHNESS_CLASSIFICATION_BASES as readonly string[]).includes(obj.classificationBasis),
    `freshness.classificationBasis must be one of [${FRESHNESS_CLASSIFICATION_BASES.join(", ")}]`
  );
  if (obj.mostRecentObservationAt !== undefined) {
    validateTimestamp(obj.mostRecentObservationAt, "freshness.mostRecentObservationAt");
  }
  assert("evaluatedAt" in obj, "freshness.evaluatedAt is required");
  validateTimestamp(obj.evaluatedAt, "freshness.evaluatedAt");
  if (obj.ageSeconds !== undefined) {
    assert(isFiniteNumber(obj.ageSeconds) && (obj.ageSeconds as number) >= 0, "freshness.ageSeconds must be a non-negative finite number");
  }
  assertNonEmptyString(obj.note, "freshness.note");

  const basis = obj.classificationBasis as FreshnessClassificationBasis;
  if (basis === "no_observation_time") {
    assert(obj.status === "unknown", 'no_observation_time basis requires status="unknown"');
    assert(
      obj.mostRecentObservationAt === undefined && obj.ageSeconds === undefined,
      "unknown freshness must not invent an observation timestamp or age"
    );
    assert(
      obj.currentAgeLimitSeconds === undefined && obj.recentAgeLimitSeconds === undefined,
      "unknown freshness must not carry unused age thresholds"
    );
    return;
  }

  assert(
    obj.mostRecentObservationAt !== undefined && obj.ageSeconds !== undefined,
    `${basis} freshness requires mostRecentObservationAt and ageSeconds`
  );
  const observedMs = Date.parse(obj.mostRecentObservationAt as string);
  const evaluatedMs = Date.parse(obj.evaluatedAt as string);
  assert(evaluatedMs >= observedMs, "freshness.evaluatedAt must not precede the observation");
  const computedAgeSeconds = Math.floor((evaluatedMs - observedMs) / 1000);
  assert(
    obj.ageSeconds === computedAgeSeconds,
    `freshness.ageSeconds must equal the timestamp-derived age ${computedAgeSeconds}, got ${obj.ageSeconds}`
  );

  if (basis === "historical_context") {
    assert(obj.status === "historical", 'historical_context basis requires status="historical"');
    assert(
      obj.currentAgeLimitSeconds === undefined && obj.recentAgeLimitSeconds === undefined,
      "historical_context must not carry unused age thresholds"
    );
    return;
  }

  assert(
    isFiniteNumber(obj.currentAgeLimitSeconds) && (obj.currentAgeLimitSeconds as number) >= 0,
    "age_thresholds requires a non-negative currentAgeLimitSeconds"
  );
  assert(
    isFiniteNumber(obj.recentAgeLimitSeconds) &&
      (obj.recentAgeLimitSeconds as number) > (obj.currentAgeLimitSeconds as number),
    "recentAgeLimitSeconds must be greater than currentAgeLimitSeconds"
  );
  const expectedStatus: FreshnessStatus =
    computedAgeSeconds <= (obj.currentAgeLimitSeconds as number)
      ? "current"
      : computedAgeSeconds <= (obj.recentAgeLimitSeconds as number)
        ? "recent"
        : "stale";
  assert(
    obj.status === expectedStatus,
    `freshness.status must be deterministically derived as ${expectedStatus}, got ${obj.status}`
  );
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export const CONFIDENCE_LEVELS = ["high", "moderate", "low", "insufficient"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export interface Confidence {
  level: ConfidenceLevel;
  /** Deterministic rationale string — must be non-empty. */
  rationale: string;
}

export function validateConfidence(v: unknown): asserts v is Confidence {
  assertPlainObject(v, "confidence");
  const obj = v as Record<string, unknown>;
  assertExactKeys(obj, ["level", "rationale"], "confidence");
  assert(
    typeof obj.level === "string" && (CONFIDENCE_LEVELS as readonly string[]).includes(obj.level),
    `confidence.level must be one of [${CONFIDENCE_LEVELS.join(", ")}], got "${obj.level}"`
  );
  assertNonEmptyString(obj.rationale, "confidence.rationale");
}

// ---------------------------------------------------------------------------
// Limitation
// ---------------------------------------------------------------------------

export interface Limitation {
  limitationId: string;
  /** The data source or process that carries this limitation. */
  source: string;
  /** Human-readable description of the limitation. */
  description: string;
  /**
   * Whether this limitation is required to accompany the evidence object.
   * Required limitations must always be present; they may not be omitted
   * to make evidence look more complete.
   */
  required: boolean;
}

export function validateLimitation(v: unknown): asserts v is Limitation {
  assertPlainObject(v, "limitation");
  const obj = v as Record<string, unknown>;
  assertExactKeys(obj, ["limitationId", "source", "description", "required"], "limitation");
  assertNonEmptyString(obj.limitationId, "limitationId");
  assertNonEmptyString(obj.source, "limitation.source");
  assertNonEmptyString(obj.description, "limitation.description");
  assert(typeof obj.required === "boolean", "limitation.required must be a boolean");
}

// ---------------------------------------------------------------------------
// Explanation
// ---------------------------------------------------------------------------

export interface Explanation {
  explanationId: string;
  /**
   * IDs of the EvidenceObjects this explanation is based on.
   * Must be non-empty; AI may not explain without traceable evidence.
   */
  sourceEvidenceIds: string[];
  /** What was directly observed from the evidence. */
  observed: string;
  /** What the evidence may mean in the context of the user's concern. */
  inferred?: string;
  /** Claims the evidence explicitly cannot support. */
  notSupported: string[];
  /** Gaps, conflicts, or stale-data notes. */
  conflictsOrGaps?: string;
  /**
   * UXFIX-02 (ADR-0022): A short plain-language summary for non-experts.
   * Deterministically validated: bounded length, and every numeric token must
   * already appear in the validated evidence context. Optional so historical
   * fixtures without one remain valid.
   */
  plainSummary?: string;
  /** Adaptive, question-aware Meaning content. URLs remain deterministic catalog entries. */
  meaning?: AdaptiveMeaning;
  /**
   * Whether the explanation was AI-generated. If true, it must be based
   * only on the referenced validated evidence.
   */
  aiGenerated: boolean;
}

export function validateExplanation(v: unknown): asserts v is Explanation {
  assertPlainObject(v, "explanation");
  const obj = v as Record<string, unknown>;
  assertExactKeys(
    obj,
    [
      "explanationId",
      "sourceEvidenceIds",
      "observed",
      "inferred",
      "notSupported",
      "conflictsOrGaps",
      "plainSummary",
      "meaning",
      "aiGenerated",
    ],
    "explanation"
  );
  assertNonEmptyString(obj.explanationId, "explanationId");
  assertStringArray(obj.sourceEvidenceIds, "sourceEvidenceIds", {
    nonEmpty: true,
    unique: true,
  });
  assertNonEmptyString(obj.observed, "explanation.observed");
  if (obj.inferred !== undefined) {
    assertNonEmptyString(obj.inferred, "explanation.inferred");
  }
  assertStringArray(obj.notSupported, "notSupported", { unique: true });
  if (obj.conflictsOrGaps !== undefined) {
    assertNonEmptyString(obj.conflictsOrGaps, "explanation.conflictsOrGaps");
  }
  if (obj.plainSummary !== undefined) {
    assertNonEmptyString(obj.plainSummary, "explanation.plainSummary");
    assert(
      (obj.plainSummary as string).length <= 700,
      "explanation.plainSummary must be at most 700 characters"
    );
  }
  if (obj.meaning !== undefined) {
    validateAdaptiveMeaning(obj.meaning);
  }
  assert(typeof obj.aiGenerated === "boolean", "aiGenerated must be a boolean");
}

// ---------------------------------------------------------------------------
// EvidenceObject
// ---------------------------------------------------------------------------

export interface EvidenceObject {
  evidenceId: string;
  hazardId: HazardId;
  intentId: string;
  evidenceState: EvidenceState;
  dataMode: DataMode;
  observations: Observation[];
  derivedMetrics: DerivedMetric[];
  missionAttributions: MissionAttribution[];
  freshness: Freshness;
  confidence: Confidence;
  limitations: Limitation[];
  explanations: Explanation[];
  /** ISO-8601 timestamp when this EvidenceObject was assembled. */
  assembledAt: string;
}

export function validateEvidenceObject(v: unknown): asserts v is EvidenceObject {
  assertPlainObject(v, "evidenceObject");
  const obj = v as Record<string, unknown>;
  assertExactKeys(
    obj,
    [
      "evidenceId",
      "hazardId",
      "intentId",
      "evidenceState",
      "dataMode",
      "observations",
      "derivedMetrics",
      "missionAttributions",
      "freshness",
      "confidence",
      "limitations",
      "explanations",
      "assembledAt",
    ],
    "evidenceObject"
  );

  assertNonEmptyString(obj.evidenceId, "evidenceId");
  assert("hazardId" in obj, "hazardId is required");
  validateHazardId(obj.hazardId);
  assertNonEmptyString(obj.intentId, "intentId");
  assert("evidenceState" in obj, "evidenceState is required");
  validateEvidenceState(obj.evidenceState);
  assert("dataMode" in obj, "dataMode is required");
  validateDataMode(obj.dataMode);

  assert(Array.isArray(obj.observations), "observations must be an array");
  for (const obs of obj.observations as unknown[]) {
    validateObservation(obs);
  }
  const observations = obj.observations as Observation[];
  const observationIds = observations.map((observation) => observation.observationId);
  assert(
    new Set(observationIds).size === observationIds.length,
    "observationId values must be unique within an EvidenceObject"
  );
  for (const observation of observations) {
    assert(
      observation.dataMode === obj.dataMode,
      `observation ${observation.observationId} dataMode must match EvidenceObject dataMode`
    );
  }

  assert(Array.isArray(obj.derivedMetrics), "derivedMetrics must be an array");
  for (const dm of obj.derivedMetrics as unknown[]) {
    validateDerivedMetric(dm);
  }
  const derivedMetrics = obj.derivedMetrics as DerivedMetric[];
  const metricIds = derivedMetrics.map((metric) => metric.metricId);
  assert(
    new Set(metricIds).size === metricIds.length,
    "metricId values must be unique within an EvidenceObject"
  );
  const observationIdSet = new Set(observationIds);
  for (const metric of derivedMetrics) {
    assert(
      metric.dataMode === obj.dataMode,
      `derived metric ${metric.metricId} dataMode must match EvidenceObject dataMode`
    );
    for (const sourceObservationId of metric.sourceObservationIds) {
      assert(
        observationIdSet.has(sourceObservationId),
        `derived metric ${metric.metricId} references missing observation ${sourceObservationId}`
      );
    }
  }

  assert(Array.isArray(obj.missionAttributions), "missionAttributions must be an array");
  for (const ma of obj.missionAttributions as unknown[]) {
    validateMissionAttribution(ma);
  }
  for (const attribution of obj.missionAttributions as MissionAttribution[]) {
    for (const contributedObservationId of attribution.contributedObservationIds) {
      assert(
        observationIdSet.has(contributedObservationId),
        `mission ${attribution.missionName} references missing observation ${contributedObservationId}`
      );
    }
  }

  assert("freshness" in obj, "freshness is required");
  validateFreshness(obj.freshness);
  assert("confidence" in obj, "confidence is required");
  validateConfidence(obj.confidence);

  assert(Array.isArray(obj.limitations), "limitations must be an array");
  for (const lim of obj.limitations as unknown[]) {
    validateLimitation(lim);
  }
  const limitations = obj.limitations as Limitation[];
  const limitationIds = limitations.map((limitation) => limitation.limitationId);
  assert(
    new Set(limitationIds).size === limitationIds.length,
    "limitationId values must be unique within an EvidenceObject"
  );

  // Enforce: states that indicate no data, failure, or unsupported coverage
  // must carry at least one required limitation.
  const requiresLimitation: EvidenceState[] = [
    "no_observation",
    "source_failure",
    "unsupported_coverage",
    "stale_data",
    "inconclusive_evidence",
  ];
  if (requiresLimitation.includes(obj.evidenceState as EvidenceState)) {
    const requiredLims = limitations.filter((l) => l.required);
    assert(
      requiredLims.length > 0,
      `evidenceState "${obj.evidenceState}" must carry at least one required limitation (no data != no danger)`
    );
  }

  const requiredLimitationSources = new Set(
    limitations.filter((limitation) => limitation.required).map((limitation) => limitation.source)
  );
  for (const sourceId of new Set(observations.map((observation) => observation.provenance.sourceId))) {
    assert(
      requiredLimitationSources.has(sourceId),
      `evidence from ${sourceId} must carry a required source limitation`
    );
  }

  assert(Array.isArray(obj.explanations), "explanations must be an array");
  for (const exp of obj.explanations as unknown[]) {
    validateExplanation(exp);
  }
  const explanations = obj.explanations as Explanation[];
  const explanationIds = explanations.map((explanation) => explanation.explanationId);
  assert(
    new Set(explanationIds).size === explanationIds.length,
    "explanationId values must be unique within an EvidenceObject"
  );
  for (const explanation of explanations) {
    for (const sourceEvidenceId of explanation.sourceEvidenceIds) {
      assert(
        sourceEvidenceId === obj.evidenceId,
        `explanation ${explanation.explanationId} references unavailable evidence ${sourceEvidenceId}`
      );
    }
  }

  assert("assembledAt" in obj, "assembledAt is required");
  validateTimestamp(obj.assembledAt, "evidenceObject.assembledAt");
  const assembledMs = Date.parse(obj.assembledAt as string);
  assert(
    assembledMs >= Date.parse((obj.freshness as Freshness).evaluatedAt),
    "evidenceObject.assembledAt must not precede freshness evaluation"
  );
  for (const observation of observations) {
    assert(
      assembledMs >= Date.parse(observation.provenance.retrievedAt),
      `evidenceObject.assembledAt must not precede retrieval of ${observation.observationId}`
    );
  }

  const state = obj.evidenceState as EvidenceState;
  if (
    state === "observations_returned" ||
    state === "valid_observation_no_anomaly" ||
    state === "no_active_official_alert"
  ) {
    assert(observations.length > 0, `${state} requires at least one validated observation`);
  }
  if (state === "source_failure") {
    assert(observations.length === 0, "source_failure must not claim observations");
    assert(
      obj.dataMode === "failed" || obj.dataMode === "unavailable",
      "source_failure requires failed or unavailable dataMode"
    );
  }
  if (state === "stale_data") {
    assert(
      (obj.freshness as Freshness).status === "stale",
      'stale_data requires freshness.status="stale"'
    );
  }
  if (["no_observation", "source_failure", "unsupported_coverage"].includes(state)) {
    assert(
      (obj.confidence as Confidence).level === "insufficient",
      `${state} requires confidence.level="insufficient"`
    );
    assert(derivedMetrics.length === 0, `${state} must not claim derived metrics`);
  }
}
