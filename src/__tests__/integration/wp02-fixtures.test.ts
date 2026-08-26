/**
 * src/__tests__/integration/wp02-fixtures.test.ts
 *
 * Integration tests for WP-02 deterministic fixtures.
 *
 * Validates that every WP-02 fixture:
 *   - Loads from disk without error
 *   - Passes the EvidenceObject schema validator
 *   - Carries the correct evidenceState
 *   - Carries the expected dataMode="fixture"
 *   - Empty/failure/unsupported states carry required limitations
 *   - No-observation and unsupported-coverage states have adequate limitations
 *   - Success fixtures have at least one observation
 *
 * All tests are network-free and deterministic.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { validateEvidenceObject } from "@/contracts/evidence";
import { QUERYABLE_SOURCE_IDS } from "@/contracts/dataset-registry";

const FIXTURE_DIR = resolve(process.cwd(), "src/data/fixtures/wp02");

function loadFixture(filename: string): unknown {
  const content = readFileSync(resolve(FIXTURE_DIR, filename), "utf-8");
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
// Fire success fixture
// ---------------------------------------------------------------------------

describe("fire-success fixture", () => {
  const fixture = loadFixture("fire-success.json");

  it("passes full EvidenceObject validation", () => {
    expect(() => validateEvidenceObject(fixture)).not.toThrow();
  });

  it("has hazardId=fire_smoke", () => {
    expect((fixture as Record<string, unknown>).hazardId).toBe("fire_smoke");
  });

  it("has evidenceState=observations_returned", () => {
    expect((fixture as Record<string, unknown>).evidenceState).toBe("observations_returned");
  });

  it("has dataMode=fixture", () => {
    expect((fixture as Record<string, unknown>).dataMode).toBe("fixture");
  });

  it("has at least one observation", () => {
    const obs = (fixture as Record<string, unknown>).observations;
    expect(Array.isArray(obs)).toBe(true);
    expect((obs as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it("observations reference noaa_hms_fire_points", () => {
    const obs = (fixture as Record<string, unknown>).observations as Record<string, unknown>[];
    const sources = obs.map((o) => (o.provenance as Record<string, unknown>).sourceId);
    expect(sources).toContain("noaa_hms_fire_points");
  });

  it("has at least one required limitation", () => {
    const lims = (fixture as Record<string, unknown>).limitations as Record<string, unknown>[];
    const required = lims.filter((l) => l.required === true);
    expect(required.length).toBeGreaterThan(0);
  });

  it("has at least one missionAttribution", () => {
    const ma = (fixture as Record<string, unknown>).missionAttributions as unknown[];
    expect(ma.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Fire no-observation fixture
// ---------------------------------------------------------------------------

describe("fire-no-observation fixture", () => {
  const fixture = loadFixture("fire-no-observation.json");

  it("passes full EvidenceObject validation", () => {
    expect(() => validateEvidenceObject(fixture)).not.toThrow();
  });

  it("has evidenceState=no_observation", () => {
    expect((fixture as Record<string, unknown>).evidenceState).toBe("no_observation");
  });

  it("has dataMode=fixture", () => {
    expect((fixture as Record<string, unknown>).dataMode).toBe("fixture");
  });

  it("has at least one required limitation expressing no-data != no-danger", () => {
    const lims = (fixture as Record<string, unknown>).limitations as Record<string, unknown>[];
    const required = lims.filter((l) => l.required === true);
    expect(required.length).toBeGreaterThan(0);
  });

  it("confidence level is insufficient", () => {
    const conf = (fixture as Record<string, unknown>).confidence as Record<string, unknown>;
    expect(conf.level).toBe("insufficient");
  });

  it("the observation coordinate count in box is 0", () => {
    const obs = (fixture as Record<string, unknown>).observations as Record<string, unknown>[];
    expect(obs.length).toBeGreaterThan(0);
    const meta = obs[0].metadata as Record<string, unknown>;
    expect(meta.coordinatePairsInBox).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Flood success fixture
// ---------------------------------------------------------------------------

describe("flood-success fixture", () => {
  const fixture = loadFixture("flood-success.json");

  it("passes full EvidenceObject validation", () => {
    expect(() => validateEvidenceObject(fixture)).not.toThrow();
  });

  it("has hazardId=flood_storm", () => {
    expect((fixture as Record<string, unknown>).hazardId).toBe("flood_storm");
  });

  it("has evidenceState=observations_returned", () => {
    expect((fixture as Record<string, unknown>).evidenceState).toBe("observations_returned");
  });

  it("has at least two observations (GIBS + USGS)", () => {
    const obs = (fixture as Record<string, unknown>).observations as unknown[];
    expect(obs.length).toBeGreaterThanOrEqual(2);
  });

  it("observations reference nasa_gibs_imerg and usgs_instantaneous_values", () => {
    const obs = (fixture as Record<string, unknown>).observations as Record<string, unknown>[];
    const sources = obs.map((o) => (o.provenance as Record<string, unknown>).sourceId);
    expect(sources).toContain("nasa_gibs_imerg");
    expect(sources).toContain("usgs_instantaneous_values");
  });

  it("has required limitation noting GIBS is visual evidence only", () => {
    const lims = (fixture as Record<string, unknown>).limitations as Record<string, unknown>[];
    const visualLim = lims.find(
      (l) =>
        l.required === true &&
        typeof l.description === "string" &&
        l.description.toLowerCase().includes("visual evidence only")
    );
    expect(visualLim).toBeDefined();
  });

  it("has required limitation noting USGS values are provisional", () => {
    const lims = (fixture as Record<string, unknown>).limitations as Record<string, unknown>[];
    const provisionalLim = lims.find(
      (l) =>
        l.required === true &&
        typeof l.description === "string" &&
        l.description.toLowerCase().includes("provisional")
    );
    expect(provisionalLim).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Flood unsupported-coverage fixture
// ---------------------------------------------------------------------------

describe("flood-unsupported-coverage fixture", () => {
  const fixture = loadFixture("flood-unsupported-coverage.json");

  it("passes full EvidenceObject validation", () => {
    expect(() => validateEvidenceObject(fixture)).not.toThrow();
  });

  it("has evidenceState=unsupported_coverage", () => {
    expect((fixture as Record<string, unknown>).evidenceState).toBe("unsupported_coverage");
  });

  it("has dataMode=fixture", () => {
    expect((fixture as Record<string, unknown>).dataMode).toBe("fixture");
  });

  it("has at least one required limitation", () => {
    const lims = (fixture as Record<string, unknown>).limitations as Record<string, unknown>[];
    const required = lims.filter((l) => l.required === true);
    expect(required.length).toBeGreaterThan(0);
  });

  it("confidence level is insufficient", () => {
    const conf = (fixture as Record<string, unknown>).confidence as Record<string, unknown>;
    expect(conf.level).toBe("insufficient");
  });

  it("does NOT have evidenceState=observations_returned", () => {
    expect((fixture as Record<string, unknown>).evidenceState).not.toBe("observations_returned");
  });

  it("the observation payload hash matches the preflight record", () => {
    const obs = (fixture as Record<string, unknown>).observations as Record<string, unknown>[];
    expect(obs.length).toBeGreaterThan(0);
    const prov = obs[0].provenance as Record<string, unknown>;
    // SHA-256 from the Codex source-preflight record
    expect(prov.payloadHash).toBe("074065F07E35265D9695CCED0F42844DBB02E5766C4ED185D0A372B2D033B093");
  });
});

// ---------------------------------------------------------------------------
// Cross-fixture provenance integrity
// ---------------------------------------------------------------------------

describe("fixture provenance integrity", () => {
  const files = [
    "fire-success.json",
    "fire-no-observation.json",
    "flood-success.json",
    "flood-unsupported-coverage.json",
  ];

  for (const file of files) {
    it(`${file}: all observations have valid ISO-8601 retrievedAt`, () => {
      const obj = loadFixture(file) as Record<string, unknown>;
      const obs = obj.observations as Record<string, unknown>[];
      for (const o of obs) {
        const prov = o.provenance as Record<string, unknown>;
        expect(typeof prov.retrievedAt).toBe("string");
        expect(() => {
          const d = new Date(prov.retrievedAt as string);
          if (isNaN(d.getTime())) throw new Error(`Invalid timestamp: ${prov.retrievedAt}`);
        }).not.toThrow();
      }
    });

    it(`${file}: all source IDs are registered`, () => {
      const obj = loadFixture(file) as Record<string, unknown>;
      const obs = obj.observations as Record<string, unknown>[];
      for (const o of obs) {
        const prov = o.provenance as Record<string, unknown>;
        expect(QUERYABLE_SOURCE_IDS).toContain(prov.sourceId);
      }
    });

    it(`${file}: every received observation has a payload hash`, () => {
      const obj = loadFixture(file) as Record<string, unknown>;
      const obs = obj.observations as Record<string, unknown>[];
      for (const o of obs) {
        const prov = o.provenance as Record<string, unknown>;
        expect(prov.payloadHash).toMatch(/^[0-9A-F]{64}$/);
      }
    });

    it(`${file}: dataMode is fixture`, () => {
      const obj = loadFixture(file) as Record<string, unknown>;
      expect(obj.dataMode).toBe("fixture");
    });
  }
});
