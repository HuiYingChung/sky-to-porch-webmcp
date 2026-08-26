/**
 * WP-07 Fire route orchestration tests.
 *
 * Adapters, evaluator, explainer, and provider configuration are isolated so
 * this suite verifies the server boundary without any external call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceEvaluationResult } from "@/lib/evidence/evaluator";
import type { ProviderConfig } from "@/lib/ai/provider-router";
import { PINNED_FIXTURE_DATE, type FireQueryResult } from "@/lib/fire/types";

const queryFireEvidenceMock = vi.hoisted(() => vi.fn());
const queryLiveFireEvidenceMock = vi.hoisted(() => vi.fn());
const evaluateEvidenceMock = vi.hoisted(() => vi.fn());
const explainEvaluatedEvidenceMock = vi.hoisted(() => vi.fn());
const loadProviderConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/fire/fixture-adapter", () => ({
  queryFireEvidence: queryFireEvidenceMock,
}));

vi.mock("@/lib/fire/live-adapter", () => ({
  queryLiveFireEvidence: queryLiveFireEvidenceMock,
}));

vi.mock("@/lib/evidence/evaluator", () => ({
  evaluateEvidence: evaluateEvidenceMock,
}));

vi.mock("@/lib/ai/evidence-explainer", () => ({
  explainEvaluatedEvidence: explainEvaluatedEvidenceMock,
}));

vi.mock("@/lib/ai/provider-router", () => ({
  loadProviderConfig: loadProviderConfigMock,
}));

import { POST } from "@/app/api/fire/query/route";

function fireRequest(body: unknown): Request {
  return new Request("http://localhost/api/fire/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      "User-Agent": "wp07-route-test",
    },
    body: JSON.stringify(body),
  });
}

async function actualFixtureAndExplanation() {
  const fixtureModule = await vi.importActual<typeof import("@/lib/fire/fixture-adapter")>(
    "@/lib/fire/fixture-adapter"
  );
  const explainerModule = await vi.importActual<typeof import("@/lib/fire/explainer")>(
    "@/lib/fire/explainer"
  );
  const adapterResult = fixtureModule.queryFireEvidence({
    placeId: "demo-los-angeles",
    date: PINNED_FIXTURE_DATE,
    mode: "fixture",
  });
  if (!adapterResult.evidence) throw new Error("test fixture did not return evidence");
  return {
    adapterResult,
    explanation: explainerModule.buildFireExplanation(adapterResult.evidence),
  };
}

beforeEach(() => {
  queryFireEvidenceMock.mockReset();
  queryLiveFireEvidenceMock.mockReset();
  evaluateEvidenceMock.mockReset();
  explainEvaluatedEvidenceMock.mockReset();
  loadProviderConfigMock.mockReset();
  vi.stubEnv("AI_PAID_API_ENABLED", "true");
  vi.stubEnv("AI_ABUSE_HMAC_SECRET", "test-only-hmac-secret-at-least-32-characters");
  vi.stubEnv("AI_ALLOWED_ORIGIN", "http://localhost");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/fire/query WP-07 orchestration", () => {
  it("returns truthful AI provenance with the exact evaluated evidence and selected concern", async () => {
    const { adapterResult, explanation } = await actualFixtureAndExplanation();
    const evaluation: EvidenceEvaluationResult = {
      evidence: adapterResult.evidence!,
      conflicts: [],
      inferenceAllowed: false,
    };
    const providerConfig: ProviderConfig = {
      primaryProvider: "openai",
      fallbackProvider: "none",
      openAiApiKey: "test-only",
      openAiModel: "gpt-test",
    };
    queryLiveFireEvidenceMock.mockResolvedValue(adapterResult);
    evaluateEvidenceMock.mockReturnValue(evaluation);
    loadProviderConfigMock.mockReturnValue(providerConfig);
    explainEvaluatedEvidenceMock.mockResolvedValue({
      explanation: { ...explanation, aiGenerated: true },
      status: {
        mode: "ai_assisted",
        provider: "openai",
        modelId: "gpt-test",
        fallbackUsed: false,
      },
    });

    const response = await POST(fireRequest({
      placeId: "demo-los-angeles",
      date: PINNED_FIXTURE_DATE,
      mode: "live",
      concern: "health",
      optionalQuestion: "  What does the evidence mean for my health?  ",
    }));
    const body = await response.json() as { ok: true; result: FireQueryResult };

    expect(response.status).toBe(200);
    expect(evaluateEvidenceMock).toHaveBeenCalledOnce();
    expect(explainEvaluatedEvidenceMock).toHaveBeenCalledWith(
      evaluation,
      "health",
      providerConfig,
      "What does the evidence mean for my health?",
      undefined,
      expect.any(Function)
    );
    expect(body.result.explanationStatus).toEqual({
      mode: "ai_assisted",
      provider: "openai",
      modelId: "gpt-test",
      fallbackUsed: false,
    });
    expect(body.result.explanation?.aiGenerated).toBe(true);
    expect(body.result.evidence?.explanations).toEqual([body.result.explanation]);
  });

  it("fails closed when the final explanation is not runtime-valid", async () => {
    const { adapterResult, explanation } = await actualFixtureAndExplanation();
    const evaluation: EvidenceEvaluationResult = {
      evidence: adapterResult.evidence!,
      conflicts: [],
      inferenceAllowed: false,
    };
    queryLiveFireEvidenceMock.mockResolvedValue(adapterResult);
    evaluateEvidenceMock.mockReturnValue(evaluation);
    loadProviderConfigMock.mockReturnValue(null);
    explainEvaluatedEvidenceMock.mockResolvedValue({
      explanation: {
        ...explanation,
        notSupported: ["duplicate unsafe output", "duplicate unsafe output"],
      },
      status: { mode: "deterministic", reason: "ai_output_rejected" },
    });

    const response = await POST(fireRequest({
      placeId: "demo-los-angeles",
      date: PINNED_FIXTURE_DATE,
      mode: "live",
      concern: "home",
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "validation_failed" });
  });

  it("returns only bounded unavailable provider provenance to the client", async () => {
    const { adapterResult, explanation } = await actualFixtureAndExplanation();
    const evaluation: EvidenceEvaluationResult = {
      evidence: adapterResult.evidence!,
      conflicts: [],
      inferenceAllowed: false,
    };
    const providerConfig: ProviderConfig = {
      primaryProvider: "openai",
      fallbackProvider: "none",
      openAiApiKey: "test-only-secret",
      openAiModel: "gpt-test",
    };
    queryLiveFireEvidenceMock.mockResolvedValue(adapterResult);
    evaluateEvidenceMock.mockReturnValue(evaluation);
    loadProviderConfigMock.mockReturnValue(providerConfig);
    explainEvaluatedEvidenceMock.mockResolvedValue({
      explanation,
      status: {
        mode: "deterministic",
        reason: "ai_unavailable",
        provider: "openai",
        modelId: "gpt-test",
        fallbackUsed: false,
        providerFailureReason: "auth_failure",
      },
    });

    const response = await POST(fireRequest({
      placeId: "demo-los-angeles",
      date: PINNED_FIXTURE_DATE,
      mode: "live",
      concern: "home",
    }));
    const body = await response.json() as { ok: true; result: FireQueryResult };

    expect(response.status).toBe(200);
    expect(body.result.explanationStatus).toEqual({
      mode: "deterministic",
      reason: "ai_unavailable",
      provider: "openai",
      modelId: "gpt-test",
      fallbackUsed: false,
      providerFailureReason: "auth_failure",
    });
    expect(JSON.stringify(body)).not.toContain("test-only-secret");
  });

  it("does not invoke the explainer after deterministic evaluation fails", async () => {
    const { adapterResult } = await actualFixtureAndExplanation();
    queryFireEvidenceMock.mockReturnValue(adapterResult);
    evaluateEvidenceMock.mockImplementation(() => {
      throw new Error("internal evaluator detail");
    });

    const response = await POST(fireRequest({
      placeId: "demo-los-angeles",
      date: PINNED_FIXTURE_DATE,
      mode: "fixture",
      concern: "home",
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "validation_failed" });
    expect(explainEvaluatedEvidenceMock).not.toHaveBeenCalled();
  });
});
