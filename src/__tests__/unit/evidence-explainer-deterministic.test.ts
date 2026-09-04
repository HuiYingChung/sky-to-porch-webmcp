import { describe, expect, it } from "vitest";
import { validateExplanation } from "@/contracts/evidence";
import {
  explainEvaluatedEvidence,
  requiredSafetyStatements,
} from "@/lib/ai/evidence-explainer";
import { evaluateEvidence, type EvidenceEvaluationResult } from "@/lib/evidence/evaluator";
import { queryFireEvidence } from "@/lib/fire/fixture-adapter";
import { PINNED_FIXTURE_DATE } from "@/lib/fire/types";

function evaluatedFire(): EvidenceEvaluationResult {
  const result = queryFireEvidence({
    placeId: "demo-los-angeles",
    date: PINNED_FIXTURE_DATE,
    mode: "fixture",
  });
  if (!result.evidence) throw new Error("Expected the governed fire fixture.");
  return evaluateEvidence(result.evidence, {
    evaluatedAt: result.evidence.assembledAt,
    freshness: { basis: "historical_context" },
  });
}

describe("deterministic evidence explanation", () => {
  it("produces the same validated answer without any internal model provider", async () => {
    const evaluation = evaluatedFire();
    const first = await explainEvaluatedEvidence(evaluation, "home");
    const second = await explainEvaluatedEvidence(evaluation, "home");

    expect(first).toEqual(second);
    expect(first.status).toEqual({
      mode: "deterministic",
      reason: "validated_evidence",
    });
    expect(first.explanation.aiGenerated).toBe(false);
    expect(() => validateExplanation(first.explanation)).not.toThrow();
  });

  it("answers an outage question by naming the missing official source", async () => {
    const result = await explainEvaluatedEvidence(
      evaluatedFire(),
      "power_internet",
      "Is there a power outage?"
    );

    expect(result.explanation.plainSummary).toMatch(/cannot confirm.*power outage/iu);
    expect(result.explanation.notSupported.join(" ")).toMatch(/official utility outage/iu);
  });

  it("keeps no-data and prediction safety boundaries in deterministic code", () => {
    expect(requiredSafetyStatements("fire_smoke", "no_observation").join(" "))
      .toMatch(/no danger/iu);
    expect(requiredSafetyStatements("earth_volcanoes", "observations_returned").join(" "))
      .toMatch(/prediction/iu);
  });

  it("keeps internal source and observation identifiers out of explanation prose", async () => {
    const evaluation = evaluatedFire();
    const internalObservationId = evaluation.evidence.observations[0].observationId;
    const conflicted: EvidenceEvaluationResult = {
      evidence: {
        ...evaluation.evidence,
        evidenceState: "inconclusive_evidence",
        confidence: {
          level: "insufficient",
          rationale: "The available sources disagree.",
        },
      },
      conflicts: [{
        code: "source_disagreement",
        observationIds: [internalObservationId, "obs-private-record"],
      }],
      inferenceAllowed: false,
    };

    const result = await explainEvaluatedEvidence(conflicted, "home");
    const visibleText = [
      result.explanation.observed,
      result.explanation.conflictsOrGaps,
      result.explanation.meaning?.sections.map((section) => section.body).join(" "),
    ].join(" ");

    expect(visibleText).toContain("sources disagree about 2 records");
    expect(visibleText).not.toContain(internalObservationId);
    expect(visibleText).not.toContain("obs-private-record");
    expect(visibleText).not.toContain("noaa_hms_fire_points");
  });
});
