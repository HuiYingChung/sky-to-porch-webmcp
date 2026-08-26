import { validateEvidenceObject, type EvidenceObject } from "@/contracts/evidence";
import heatSuccessRaw from "@/data/fixtures/wp09/heat-success.json";
import heatFailureRaw from "@/data/fixtures/wp09/heat-source-failure.json";
import heatUnsupportedRaw from "@/data/fixtures/wp09/heat-unsupported-coverage.json";
import {
  HEAT_PINNED_FIXTURE_DATE,
  HEAT_UNSUPPORTED_FIXTURE_DATE,
  type HeatFixtureQueryInput,
  type HeatQueryResult,
} from "./types";

function loadFixture(raw: Record<string, unknown>): EvidenceObject {
  const clone = structuredClone(raw);
  for (const key of Object.keys(clone)) {
    if (key.startsWith("_")) delete clone[key];
  }
  validateEvidenceObject(clone);
  return clone;
}

export function queryHeatFixture(input: HeatFixtureQueryInput): HeatQueryResult {
  if (input.placeId === "demo-source-failure") {
    if (input.date !== HEAT_PINNED_FIXTURE_DATE) {
      return {
        kind: "unsupported_date",
        rejectionReason: `The Heat source-failure fixture is pinned to ${HEAT_PINNED_FIXTURE_DATE}.`,
      };
    }
    return { kind: "source_failure", evidence: loadFixture(heatFailureRaw) };
  }

  if (input.placeId !== "demo-tucson") {
    return {
      kind: "unsupported_place",
      rejectionReason:
        "Fixture-mode Extreme Heat evidence is available only for the labelled Tucson demonstration. Tucson evidence is never substituted for another place.",
    };
  }
  if (input.date === HEAT_PINNED_FIXTURE_DATE) {
    return { kind: "success", evidence: loadFixture(heatSuccessRaw) };
  }
  if (input.date === HEAT_UNSUPPORTED_FIXTURE_DATE) {
    return { kind: "unsupported_coverage", evidence: loadFixture(heatUnsupportedRaw) };
  }
  return {
    kind: "unsupported_date",
    rejectionReason:
      `Heat fixture mode accepts only ${HEAT_PINNED_FIXTURE_DATE} for the fixed Tucson case ` +
      `or ${HEAT_UNSUPPORTED_FIXTURE_DATE} for the labelled unsupported-coverage case.`,
  };
}
