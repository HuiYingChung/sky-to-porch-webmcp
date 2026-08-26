import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

import { validateEvidenceObject, type EvidenceObject } from "@/contracts/evidence";
import { validateDroughtSourceObservation } from "@/lib/drought/source-contracts";

function loadFixture(file: string): EvidenceObject {
  const raw = JSON.parse(
    readFileSync(resolve(process.cwd(), `src/data/fixtures/wp10/${file}`), "utf8")
  ) as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key.startsWith("_")) delete raw[key];
  }
  validateEvidenceObject(raw);
  for (const observation of raw.observations) {
    validateDroughtSourceObservation(observation);
  }
  return raw;
}

describe("WP-10 fixture-only Drought & Land preparation", () => {
  it.each([
    ["drought-success.json", "observations_returned", "fixture", 2],
    ["drought-no-observation.json", "no_observation", "fixture", 1],
    ["drought-stale.json", "stale_data", "fixture", 2],
    ["drought-source-failure.json", "source_failure", "failed", 0],
  ])(
    "validates %s without any source access",
    (file, evidenceState, dataMode, observationCount) => {
      const evidence = loadFixture(file);
      expect(evidence).toMatchObject({
        hazardId: "drought_land",
        evidenceState,
        dataMode,
      });
      expect(evidence.observations).toHaveLength(observationCount);
    }
  );

  it("keeps synthetic positive values visibly distinct from source payloads", () => {
    const evidence = loadFixture("drought-success.json");
    expect(evidence.observations.every((observation) =>
      observation.metadata?.fixtureKind === "synthetic_contract_fixture_no_source_payload"
    )).toBe(true);
    expect(evidence.observations.find((observation) =>
      observation.provenance.sourceId === "nasa_gibs_modis_ndvi_16day"
    )?.metadata).toMatchObject({
      byteLength: 0,
      opaqueSampleCount: 0,
      distinctColorCount: 0,
    });
  });

  it("does not turn no row, stale data, or failure into zero drought", () => {
    const noObservation = loadFixture("drought-no-observation.json");
    const stale = loadFixture("drought-stale.json");
    const failure = loadFixture("drought-source-failure.json");

    expect(noObservation.observations[0].metadata).not.toHaveProperty("d0Pct");
    expect(noObservation.confidence.level).toBe("insufficient");
    expect(stale.freshness.status).toBe("stale");
    expect(failure.observations).toEqual([]);
    expect(noObservation.limitations.map((item) => item.description).join(" "))
      .toMatch(/must not be converted|not equivalent/i);
    expect(stale.limitations.map((item) => item.description).join(" "))
      .toMatch(/not current|cannot establish/i);
    expect(failure.limitations.map((item) => item.description).join(" "))
      .toMatch(/not evidence|missing evidence/i);
  });
});
