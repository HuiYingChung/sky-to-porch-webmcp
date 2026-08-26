/**
 * src/__tests__/unit/wp05-fire-lib.test.ts
 *
 * WP-05 unit tests: fire & smoke fixture adapter and explainer.
 *
 * All tests are network-free and deterministic. No live sources are called.
 * The no-network guard at module level verifies no external calls are made.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { queryFireEvidence } from "@/lib/fire/fixture-adapter";
import { buildFireExplanation } from "@/lib/fire/explainer";
import { validateEvidenceObject } from "@/contracts/evidence";
import { PINNED_FIXTURE_DATE } from "@/lib/fire/types";

// ---------------------------------------------------------------------------
// No-network guard: any real fetch/http must fail this test
// ---------------------------------------------------------------------------

beforeAll(() => {
  // If globalThis.fetch is available (jsdom provides it), wrap it to catch any call
  if (typeof globalThis.fetch === "function") {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => {
      const url = typeof args[0] === "string" ? args[0] : String(args[0]);
      if (!url.startsWith("http://localhost")) {
        throw new Error(`WP-05 fire-lib test: uncontrolled network call to ${url}`);
      }
      return originalFetch(...args);
    };
  }
});

// ---------------------------------------------------------------------------
// Fixture adapter — Los Angeles (success)
// ---------------------------------------------------------------------------

describe("queryFireEvidence — Los Angeles success", () => {
  const result = queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_FIXTURE_DATE });

  it("returns kind=success", () => {
    expect(result.kind).toBe("success");
  });

  it("returns a validated EvidenceObject", () => {
    expect(() => validateEvidenceObject(result.evidence)).not.toThrow();
  });

  it("evidenceState is observations_returned", () => {
    expect(result.evidence!.evidenceState).toBe("observations_returned");
  });

  it("hazardId is fire_smoke", () => {
    expect(result.evidence!.hazardId).toBe("fire_smoke");
  });

  it("dataMode is fixture", () => {
    expect(result.evidence!.dataMode).toBe("fixture");
  });

  it("has at least one observation", () => {
    expect(result.evidence!.observations.length).toBeGreaterThanOrEqual(1);
  });

  it("freshness is historical", () => {
    expect(result.evidence!.freshness.status).toBe("historical");
  });

  it("has at least one required limitation", () => {
    const required = result.evidence!.limitations.filter((l) => l.required);
    expect(required.length).toBeGreaterThan(0);
  });

  it("confidence is not high (fixture result)", () => {
    expect(result.evidence!.confidence.level).not.toBe("high");
  });
});

// ---------------------------------------------------------------------------
// Fixture adapter — Lake Michigan (no_observation)
// ---------------------------------------------------------------------------

describe("queryFireEvidence — Lake Michigan no_observation", () => {
  const result = queryFireEvidence({ placeId: "demo-lake-michigan", date: PINNED_FIXTURE_DATE });

  it("returns kind=no_observation", () => {
    expect(result.kind).toBe("no_observation");
  });

  it("returns a validated EvidenceObject", () => {
    expect(() => validateEvidenceObject(result.evidence)).not.toThrow();
  });

  it("evidenceState is no_observation", () => {
    expect(result.evidence!.evidenceState).toBe("no_observation");
  });

  it("confidence is insufficient", () => {
    expect(result.evidence!.confidence.level).toBe("insufficient");
  });

  it("has at least one required no-data-not-safety limitation", () => {
    const required = result.evidence!.limitations.filter((l) => l.required);
    expect(required.length).toBeGreaterThan(0);
    const noDataLim = required.some(
      (l) => l.description.toLowerCase().includes("not proof") ||
             l.description.toLowerCase().includes("no danger") ||
             l.description.toLowerCase().includes("does not mean")
    );
    expect(noDataLim).toBe(true);
  });

  it("observation coordinate count is 0", () => {
    const obs = result.evidence!.observations;
    expect(obs.length).toBeGreaterThan(0);
    const meta = obs[0].metadata as Record<string, unknown>;
    expect(meta.coordinatePairsInBox).toBe(0);
  });

  it("dataMode is fixture", () => {
    expect(result.evidence!.dataMode).toBe("fixture");
  });
});

// ---------------------------------------------------------------------------
// Fixture adapter — source failure
// ---------------------------------------------------------------------------

describe("queryFireEvidence — source failure", () => {
  const result = queryFireEvidence({ placeId: "demo-source-failure", date: PINNED_FIXTURE_DATE });

  it("returns kind=source_failure", () => {
    expect(result.kind).toBe("source_failure");
  });

  it("returns a validated EvidenceObject", () => {
    expect(() => validateEvidenceObject(result.evidence)).not.toThrow();
  });

  it("evidenceState is source_failure", () => {
    expect(result.evidence!.evidenceState).toBe("source_failure");
  });

  it("dataMode is failed", () => {
    expect(result.evidence!.dataMode).toBe("failed");
  });

  it("has zero observations", () => {
    expect(result.evidence!.observations).toHaveLength(0);
  });

  it("confidence is insufficient", () => {
    expect(result.evidence!.confidence.level).toBe("insufficient");
  });

  it("has at least one required limitation noting source failure", () => {
    const required = result.evidence!.limitations.filter((l) => l.required);
    expect(required.length).toBeGreaterThan(0);
    const failureLim = required.some(
      (l) => l.description.toLowerCase().includes("source failure") ||
             l.description.toLowerCase().includes("not proof") ||
             l.description.toLowerCase().includes("no stale")
    );
    expect(failureLim).toBe(true);
  });

  it("has no stale result — missionAttribution is failed", () => {
    const ma = result.evidence!.missionAttributions;
    expect(ma.length).toBeGreaterThan(0);
    expect(ma[0].retrievalStatus).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// Fixture adapter — unsupported place rejection
// ---------------------------------------------------------------------------

describe("queryFireEvidence — unsupported place", () => {
  it("returns kind=unsupported_place for unknown placeId", () => {
    const result = queryFireEvidence({ placeId: "demo-houston", date: PINNED_FIXTURE_DATE });
    expect(result.kind).toBe("unsupported_place");
    expect(result.evidence).toBeUndefined();
    expect(result.rejectionReason).toBeDefined();
    expect(result.rejectionReason).not.toContain("secret");
    expect(result.rejectionReason).not.toContain("password");
  });

  it("rejection message does not contain Los Angeles data for other places", () => {
    const result = queryFireEvidence({ placeId: "demo-houston", date: PINNED_FIXTURE_DATE });
    // No stale/fixture data is substituted
    expect(result.evidence).toBeUndefined();
  });

  it("returns unsupported_place for a map selection", () => {
    const result = queryFireEvidence({ placeId: "__map_selection__", date: PINNED_FIXTURE_DATE });
    expect(result.kind).toBe("unsupported_place");
  });
});

// ---------------------------------------------------------------------------
// Fixture adapter — unsupported date rejection
// ---------------------------------------------------------------------------

describe("queryFireEvidence — unsupported date", () => {
  it("returns kind=unsupported_date for a different date", () => {
    const result = queryFireEvidence({ placeId: "demo-los-angeles", date: "2024-06-01" });
    expect(result.kind).toBe("unsupported_date");
    expect(result.evidence).toBeUndefined();
    expect(result.rejectionReason).toBeDefined();
  });

  it("accepts the pinned date for LA", () => {
    const result = queryFireEvidence({ placeId: "demo-los-angeles", date: "2025-01-08" });
    expect(result.kind).toBe("success");
  });

  it("accepts the pinned date for Lake Michigan", () => {
    const result = queryFireEvidence({ placeId: "demo-lake-michigan", date: "2025-01-08" });
    expect(result.kind).toBe("no_observation");
  });

  it("source-failure also requires the pinned date", () => {
    const result = queryFireEvidence({ placeId: "demo-source-failure", date: "2020-01-01" });
    expect(result.kind).toBe("unsupported_date");
    expect(result.evidence).toBeUndefined();
  });

  // C01 regression: date prefix matching is not allowed; only exact equality.
  it("rejects a date that is a prefix of the pinned date (e.g. '2025-01-0')", () => {
    const result = queryFireEvidence({ placeId: "demo-los-angeles", date: "2025-01-0" });
    expect(result.kind).toBe("unsupported_date");
    expect(result.evidence).toBeUndefined();
  });

  it("rejects a timestamp that starts with the pinned date (no startsWith)", () => {
    // e.g. "2025-01-08T12:00:00Z" — must NOT be accepted
    const result = queryFireEvidence({ placeId: "demo-los-angeles", date: "2025-01-08T12:00:00Z" });
    expect(result.kind).toBe("unsupported_date");
    expect(result.evidence).toBeUndefined();
  });

  it("rejects 'latest' mode date substitution — no pinned date injected by adapter", () => {
    // The adapter must not silently substitute the pinned date; date must be supplied exactly.
    const result = queryFireEvidence({ placeId: "demo-los-angeles", date: "latest" });
    expect(result.kind).toBe("unsupported_date");
    expect(result.evidence).toBeUndefined();
  });

  it("C01: source-failure with a wrong date is rejected before fixture selection", () => {
    const r1 = queryFireEvidence({ placeId: "demo-source-failure", date: "2020-01-01" });
    const r2 = queryFireEvidence({ placeId: "demo-source-failure", date: "latest" });
    expect(r1.kind).toBe("unsupported_date");
    expect(r2.kind).toBe("unsupported_date");
    expect(r1.evidence).toBeUndefined();
    expect(r2.evidence).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fixture adapter — fixture/live separation
// ---------------------------------------------------------------------------

describe("queryFireEvidence — fixture/live separation", () => {
  it("all returned evidence objects have dataMode=fixture or dataMode=failed", () => {
    const cases = [
      queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_FIXTURE_DATE }),
      queryFireEvidence({ placeId: "demo-lake-michigan", date: PINNED_FIXTURE_DATE }),
      queryFireEvidence({ placeId: "demo-source-failure", date: PINNED_FIXTURE_DATE }),
    ];
    for (const r of cases) {
      if (r.evidence) {
        expect(["fixture", "failed"]).toContain(r.evidence.dataMode);
      }
    }
  });

  it("no evidence object claims dataMode=live", () => {
    const r = queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_FIXTURE_DATE });
    expect(r.evidence!.dataMode).not.toBe("live");
  });
});

// ---------------------------------------------------------------------------
// Explainer — deterministic, aiGenerated=false
// ---------------------------------------------------------------------------

describe("buildFireExplanation", () => {
  it("produces aiGenerated=false for success case", () => {
    const r = queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_FIXTURE_DATE });
    const exp = buildFireExplanation(r.evidence!);
    expect(exp.aiGenerated).toBe(false);
  });

  it("produces aiGenerated=false for no_observation case", () => {
    const r = queryFireEvidence({ placeId: "demo-lake-michigan", date: PINNED_FIXTURE_DATE });
    const exp = buildFireExplanation(r.evidence!);
    expect(exp.aiGenerated).toBe(false);
  });

  it("produces aiGenerated=false for source_failure case", () => {
    const r = queryFireEvidence({ placeId: "demo-source-failure", date: PINNED_FIXTURE_DATE });
    const exp = buildFireExplanation(r.evidence!);
    expect(exp.aiGenerated).toBe(false);
  });

  it("notSupported includes perimeter claim for all cases", () => {
    const cases = [
      queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_FIXTURE_DATE }),
      queryFireEvidence({ placeId: "demo-lake-michigan", date: PINNED_FIXTURE_DATE }),
      queryFireEvidence({ placeId: "demo-source-failure", date: PINNED_FIXTURE_DATE }),
    ];
    for (const r of cases) {
      const exp = buildFireExplanation(r.evidence!);
      const hasPerimeterClaim = exp.notSupported.some(
        (s) => s.toLowerCase().includes("perimeter") || s.toLowerCase().includes("boundary")
      );
      expect(hasPerimeterClaim).toBe(true);
    }
  });

  it("source_failure: no inferred claim and has gap note", () => {
    const r = queryFireEvidence({ placeId: "demo-source-failure", date: PINNED_FIXTURE_DATE });
    const exp = buildFireExplanation(r.evidence!);
    expect(exp.inferred).toBeUndefined();
    expect(exp.conflictsOrGaps).toBeDefined();
    expect(exp.conflictsOrGaps!.toLowerCase()).toContain("source failure");
  });

  it("no_observation: notSupported includes no-proof-of-no-danger", () => {
    const r = queryFireEvidence({ placeId: "demo-lake-michigan", date: PINNED_FIXTURE_DATE });
    const exp = buildFireExplanation(r.evidence!);
    const hasNoDanger = exp.notSupported.some(
      (s) => s.toLowerCase().includes("proof") || s.toLowerCase().includes("no-observation")
    );
    expect(hasNoDanger).toBe(true);
  });

  it("observed references source ID and data mode for success", () => {
    const r = queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_FIXTURE_DATE });
    const exp = buildFireExplanation(r.evidence!);
    expect(exp.observed.toLowerCase()).toContain("noaa hms");
    expect(exp.observed.toLowerCase()).toContain("fixture");
  });

  it("explanation sourceEvidenceIds matches evidence ID", () => {
    const r = queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_FIXTURE_DATE });
    const exp = buildFireExplanation(r.evidence!);
    expect(exp.sourceEvidenceIds).toContain(r.evidence!.evidenceId);
  });
});

// ---------------------------------------------------------------------------
// Provenance integrity
// ---------------------------------------------------------------------------

describe("fire fixture provenance integrity", () => {
  it("success: observations have valid ISO-8601 retrievedAt", () => {
    const r = queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_FIXTURE_DATE });
    for (const obs of r.evidence!.observations) {
      expect(typeof obs.provenance.retrievedAt).toBe("string");
      expect(new Date(obs.provenance.retrievedAt).getTime()).not.toBeNaN();
    }
  });

  it("success: observations have SHA-256 payload hashes", () => {
    const r = queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_FIXTURE_DATE });
    for (const obs of r.evidence!.observations) {
      expect(obs.provenance.payloadHash).toMatch(/^[0-9A-F]{64}$/);
    }
  });

  it("success: observations reference NOAA HMS sources", () => {
    const r = queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_FIXTURE_DATE });
    const sources = r.evidence!.observations.map((o) => o.provenance.sourceId);
    expect(sources).toContain("noaa_hms_fire_points");
  });
});
