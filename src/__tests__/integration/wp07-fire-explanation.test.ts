/**
 * WP-07 route integration through the immutable Fire fixture adapter,
 * deterministic evaluator, server-side explainer, and response contract.
 * Provider and external-source network access are prohibited in this suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/fire/query/route";
import { validateEvidenceObject, validateExplanation } from "@/contracts/evidence";
import { PINNED_FIXTURE_DATE, type FireQueryResult } from "@/lib/fire/types";

function fireRequest(body: unknown): Request {
  return new Request("http://localhost/api/fire/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("AI_PRIMARY_PROVIDER", "ibm");
  vi.stubEnv("AI_FALLBACK_PROVIDER", "openai");
  vi.stubEnv("IBM_WATSONX_URL", "");
  vi.stubEnv("IBM_WATSONX_API_KEY", "");
  vi.stubEnv("IBM_WATSONX_PROJECT_ID", "");
  vi.stubEnv("IBM_WATSONX_MODEL_ID", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("OPENAI_MODEL", "");
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("WP-07 integration tests must not access the network");
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/fire/query WP-07 explanation integration", () => {
  it("returns evaluated fixture evidence and one validated deterministic explanation", async () => {
    const response = await POST(fireRequest({
      placeId: "demo-los-angeles",
      date: PINNED_FIXTURE_DATE,
      mode: "fixture",
      concern: "home",
    }));
    const body = await response.json() as { ok: true; result: FireQueryResult };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result.kind).toBe("success");
    expect(body.result.evidence?.freshness.status).toBe("historical");
    expect(body.result.evidence?.confidence.level).toBe("low");
    expect(body.result.explanationStatus).toEqual({
      mode: "deterministic",
      reason: "ai_unavailable",
    });
    expect(body.result.explanation?.aiGenerated).toBe(false);
    expect(body.result.explanation?.notSupported).toContain(
      "Property-level safety, damage, or exposure certainty"
    );
    expect(body.result.evidence?.explanations).toEqual([body.result.explanation]);
    expect(() => validateEvidenceObject(body.result.evidence)).not.toThrow();
    expect(() => validateExplanation(body.result.explanation)).not.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns source failure as insufficient evidence without a no-danger claim", async () => {
    const response = await POST(fireRequest({
      placeId: "demo-source-failure",
      date: PINNED_FIXTURE_DATE,
      mode: "fixture",
      concern: "pets",
    }));
    const body = await response.json() as { ok: true; result: FireQueryResult };

    expect(response.status).toBe(200);
    expect(body.result.kind).toBe("source_failure");
    expect(body.result.explanationStatus).toEqual({
      mode: "deterministic",
      reason: "insufficient_evidence",
    });
    expect(body.result.explanation?.observed).toContain("no validated observation");
    expect(body.result.explanation?.notSupported).toContain(
      "A claim of no danger based on missing or failed data"
    );
    expect(body.result.explanation?.aiGenerated).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an unallowlisted concern before evaluating or routing", async () => {
    const response = await POST(fireRequest({
      placeId: "demo-los-angeles",
      date: PINNED_FIXTURE_DATE,
      mode: "fixture",
      concern: "buy_insurance",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails to deterministic explanation when the provider mode pair is invalid", async () => {
    vi.stubEnv("AI_PRIMARY_PROVIDER", "ibm");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "none");

    const response = await POST(fireRequest({
      placeId: "demo-los-angeles",
      date: PINNED_FIXTURE_DATE,
      mode: "fixture",
      concern: "community",
    }));
    const body = await response.json() as { ok: true; result: FireQueryResult };

    expect(response.status).toBe(200);
    expect(body.result.explanationStatus).toEqual({
      mode: "deterministic",
      reason: "ai_unavailable",
    });
    expect(body.result.explanation?.aiGenerated).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
