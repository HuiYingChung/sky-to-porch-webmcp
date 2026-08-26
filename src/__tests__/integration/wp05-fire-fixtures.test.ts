/**
 * src/__tests__/integration/wp05-fire-fixtures.test.ts
 *
 * WP-05 integration tests: fire & smoke fixtures and source-fixture separation.
 *
 * - Validates the WP-05 source-failure fixture on disk
 * - Validates the fire fixture adapter end-to-end (all three cases)
 * - Validates fixture/live separation (no live calls)
 * - Validates provenance integrity (hashes, source IDs, timestamps)
 * - Validates no fallback on source failure
 *
 * All tests are deterministic and network-free.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { validateEvidenceObject } from "@/contracts/evidence";
import { queryFireEvidence } from "@/lib/fire/fixture-adapter";
import { PINNED_FIXTURE_DATE } from "@/lib/fire/types";
import { QUERYABLE_SOURCE_IDS } from "@/contracts/dataset-registry";

const WP05_FIXTURE_DIR = resolve(process.cwd(), "src/data/fixtures/wp05");

// ---------------------------------------------------------------------------
// Helper: load and strip fixture metadata
// ---------------------------------------------------------------------------

function loadWp05Fixture(filename: string): unknown {
  const content = readFileSync(resolve(WP05_FIXTURE_DIR, filename), "utf-8");
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const fixtureMetadataKeys = [
    "_fixtureId",
    "_fixtureDescription",
    "_capturedBy",
    "_fixtureWarning",
  ];
  const observedMetadataKeys = Object.keys(parsed).filter((key) => key.startsWith("_"));
  expect(observedMetadataKeys.sort()).toEqual([...fixtureMetadataKeys].sort());
  for (const key of fixtureMetadataKeys) {
    expect(typeof parsed[key]).toBe("string");
    expect((parsed[key] as string).length).toBeGreaterThan(0);
    delete parsed[key];
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// WP-05 source-failure fixture on disk
// ---------------------------------------------------------------------------

describe("wp05 source-failure fixture", () => {
  const fixture = loadWp05Fixture("fire-source-failure.json");

  it("passes full EvidenceObject validation", () => {
    expect(() => validateEvidenceObject(fixture)).not.toThrow();
  });

  it("has evidenceState=source_failure", () => {
    expect((fixture as Record<string, unknown>).evidenceState).toBe("source_failure");
  });

  it("has dataMode=failed", () => {
    expect((fixture as Record<string, unknown>).dataMode).toBe("failed");
  });

  it("has zero observations", () => {
    const obs = (fixture as Record<string, unknown>).observations as unknown[];
    expect(obs).toHaveLength(0);
  });

  it("confidence level is insufficient", () => {
    const conf = (fixture as Record<string, unknown>).confidence as Record<string, unknown>;
    expect(conf.level).toBe("insufficient");
  });

  it("has at least two required limitations", () => {
    const lims = (fixture as Record<string, unknown>).limitations as Record<string, unknown>[];
    const required = lims.filter((l) => l.required === true);
    expect(required.length).toBeGreaterThanOrEqual(2);
  });

  it("mission attribution has retrievalStatus=failed", () => {
    const ma = (fixture as Record<string, unknown>).missionAttributions as Record<string, unknown>[];
    expect(ma.length).toBeGreaterThan(0);
    expect(ma[0].retrievalStatus).toBe("failed");
  });

  it("hazardId is fire_smoke", () => {
    expect((fixture as Record<string, unknown>).hazardId).toBe("fire_smoke");
  });
});

// ---------------------------------------------------------------------------
// Adapter: all three cases — end-to-end validation
// ---------------------------------------------------------------------------

describe("fire adapter — end-to-end all three cases", () => {
  it("LA returns observations_returned with valid EvidenceObject", () => {
    const r = queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_FIXTURE_DATE });
    expect(r.kind).toBe("success");
    expect(() => validateEvidenceObject(r.evidence)).not.toThrow();
    expect(r.evidence!.evidenceState).toBe("observations_returned");
  });

  it("Lake Michigan returns no_observation with valid EvidenceObject", () => {
    const r = queryFireEvidence({ placeId: "demo-lake-michigan", date: PINNED_FIXTURE_DATE });
    expect(r.kind).toBe("no_observation");
    expect(() => validateEvidenceObject(r.evidence)).not.toThrow();
    expect(r.evidence!.evidenceState).toBe("no_observation");
    expect(r.evidence!.confidence.level).toBe("insufficient");
  });

  it("source-failure returns source_failure with valid EvidenceObject", () => {
    const r = queryFireEvidence({ placeId: "demo-source-failure", date: PINNED_FIXTURE_DATE });
    expect(r.kind).toBe("source_failure");
    expect(() => validateEvidenceObject(r.evidence)).not.toThrow();
    expect(r.evidence!.evidenceState).toBe("source_failure");
    expect(r.evidence!.observations).toHaveLength(0);
    expect(r.evidence!.dataMode).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// Fixture/live separation
// ---------------------------------------------------------------------------

describe("fixture/live separation", () => {
  it("all results have dataMode=fixture or dataMode=failed — never live", () => {
    const cases = [
      queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_FIXTURE_DATE }),
      queryFireEvidence({ placeId: "demo-lake-michigan", date: PINNED_FIXTURE_DATE }),
      queryFireEvidence({ placeId: "demo-source-failure", date: PINNED_FIXTURE_DATE }),
    ];
    for (const r of cases) {
      if (r.evidence) {
        expect(["fixture", "failed"]).toContain(r.evidence.dataMode);
        expect(r.evidence.dataMode).not.toBe("live");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Source/time/place mismatch rejection
// ---------------------------------------------------------------------------

describe("source/time/place mismatch rejection", () => {
  it("unknown place returns unsupported_place with no evidence", () => {
    const r = queryFireEvidence({ placeId: "demo-houston", date: PINNED_FIXTURE_DATE });
    expect(r.kind).toBe("unsupported_place");
    expect(r.evidence).toBeUndefined();
  });

  it("wrong date returns unsupported_date with no evidence", () => {
    const r = queryFireEvidence({ placeId: "demo-los-angeles", date: "2022-06-15" });
    expect(r.kind).toBe("unsupported_date");
    expect(r.evidence).toBeUndefined();
  });

  it("rejection reason contains no secrets or provider internals", () => {
    const r1 = queryFireEvidence({ placeId: "demo-houston", date: PINNED_FIXTURE_DATE });
    const r2 = queryFireEvidence({ placeId: "demo-los-angeles", date: "2022-06-15" });
    for (const r of [r1, r2]) {
      const reason = r.rejectionReason ?? "";
      expect(reason.toLowerCase()).not.toContain("password");
      expect(reason.toLowerCase()).not.toContain("secret");
      expect(reason.toLowerCase()).not.toContain("api_key");
      expect(reason.toLowerCase()).not.toContain("token");
    }
  });

  it("LA data is not substituted for Houston", () => {
    const r = queryFireEvidence({ placeId: "demo-houston", date: PINNED_FIXTURE_DATE });
    // No evidence means no substitution
    expect(r.evidence).toBeUndefined();
    expect(r.kind).toBe("unsupported_place");
  });

  // C01 regression: exact date equality only — no startsWith matching.
  it("C01: timestamp that begins with pinned date is rejected (no startsWith)", () => {
    const r = queryFireEvidence({ placeId: "demo-los-angeles", date: "2025-01-08T00:00:00Z" });
    expect(r.kind).toBe("unsupported_date");
    expect(r.evidence).toBeUndefined();
  });

  it("C01: date prefix of pinned date is rejected", () => {
    const r = queryFireEvidence({ placeId: "demo-los-angeles", date: "2025-01-0" });
    expect(r.kind).toBe("unsupported_date");
    expect(r.evidence).toBeUndefined();
  });

  it("C01: 'latest' string is rejected as a date", () => {
    const r = queryFireEvidence({ placeId: "demo-los-angeles", date: "latest" });
    expect(r.kind).toBe("unsupported_date");
    expect(r.evidence).toBeUndefined();
  });

  it("C01: source-failure cannot bypass the exact-date gate", () => {
    const r = queryFireEvidence({ placeId: "demo-source-failure", date: "latest" });
    expect(r.kind).toBe("unsupported_date");
    expect(r.evidence).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// No-fallback on source failure
// ---------------------------------------------------------------------------

describe("no fallback on source failure", () => {
  it("source_failure returns no observations — no stale data", () => {
    const r = queryFireEvidence({ placeId: "demo-source-failure", date: PINNED_FIXTURE_DATE });
    expect(r.evidence!.observations).toHaveLength(0);
  });

  it("source_failure returns dataMode=failed — not fixture", () => {
    const r = queryFireEvidence({ placeId: "demo-source-failure", date: PINNED_FIXTURE_DATE });
    expect(r.evidence!.dataMode).toBe("failed");
  });

  it("source_failure does not return observations_returned state", () => {
    const r = queryFireEvidence({ placeId: "demo-source-failure", date: PINNED_FIXTURE_DATE });
    expect(r.evidence!.evidenceState).not.toBe("observations_returned");
  });
});

// ---------------------------------------------------------------------------
// Provenance integrity
// ---------------------------------------------------------------------------

describe("fire fixture provenance integrity", () => {
  const fixtureFiles = [
    { file: "fire-success.json", dir: "wp02" },
    { file: "fire-no-observation.json", dir: "wp02" },
  ];

  for (const { file, dir } of fixtureFiles) {
    describe(file, () => {
      const raw = JSON.parse(
        readFileSync(resolve(process.cwd(), `src/data/fixtures/${dir}/${file}`), "utf-8")
      ) as Record<string, unknown>;
      const stripped = Object.fromEntries(
        Object.entries(raw).filter(([k]) => !k.startsWith("_"))
      );

      it("all observations have valid ISO-8601 retrievedAt", () => {
        const obs = stripped.observations as Record<string, unknown>[];
        for (const o of obs) {
          const prov = o.provenance as Record<string, unknown>;
          expect(typeof prov.retrievedAt).toBe("string");
          expect(new Date(prov.retrievedAt as string).getTime()).not.toBeNaN();
        }
      });

      it("all source IDs are in QUERYABLE_SOURCE_IDS", () => {
        const obs = stripped.observations as Record<string, unknown>[];
        for (const o of obs) {
          const prov = o.provenance as Record<string, unknown>;
          expect(QUERYABLE_SOURCE_IDS).toContain(prov.sourceId);
        }
      });

      it("all observations have SHA-256 payload hashes", () => {
        const obs = stripped.observations as Record<string, unknown>[];
        for (const o of obs) {
          const prov = o.provenance as Record<string, unknown>;
          expect(prov.payloadHash).toMatch(/^[0-9A-F]{64}$/);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Validation-before-render: queryFireEvidence always validates before returning
// ---------------------------------------------------------------------------

describe("validation-before-render", () => {
  it("success result has passed validateEvidenceObject", () => {
    const r = queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_FIXTURE_DATE });
    // If validate throws, the adapter would have thrown — so receiving the result proves it passed
    expect(() => validateEvidenceObject(r.evidence)).not.toThrow();
  });

  it("no_observation result has passed validateEvidenceObject", () => {
    const r = queryFireEvidence({ placeId: "demo-lake-michigan", date: PINNED_FIXTURE_DATE });
    expect(() => validateEvidenceObject(r.evidence)).not.toThrow();
  });

  it("source_failure result has passed validateEvidenceObject", () => {
    const r = queryFireEvidence({ placeId: "demo-source-failure", date: PINNED_FIXTURE_DATE });
    expect(() => validateEvidenceObject(r.evidence)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Required limitations presence
// ---------------------------------------------------------------------------

describe("required limitations", () => {
  it("LA result has required limitations", () => {
    const r = queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_FIXTURE_DATE });
    const required = r.evidence!.limitations.filter((l) => l.required);
    expect(required.length).toBeGreaterThan(0);
  });

  it("Lake Michigan result has no-data-not-safety required limitation", () => {
    const r = queryFireEvidence({ placeId: "demo-lake-michigan", date: PINNED_FIXTURE_DATE });
    const required = r.evidence!.limitations.filter((l) => l.required);
    const hasNoDataLim = required.some(
      (l) =>
        l.description.toLowerCase().includes("not proof") ||
        l.description.toLowerCase().includes("no danger") ||
        l.description.toLowerCase().includes("does not mean")
    );
    expect(hasNoDataLim).toBe(true);
  });

  it("source_failure result has required limitations", () => {
    const r = queryFireEvidence({ placeId: "demo-source-failure", date: PINNED_FIXTURE_DATE });
    const required = r.evidence!.limitations.filter((l) => l.required);
    expect(required.length).toBeGreaterThanOrEqual(2);
  });
});
