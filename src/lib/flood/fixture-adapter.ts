import { validateEvidenceObject, type EvidenceObject } from "@/contracts/evidence";
import floodSuccessRaw from "@/data/fixtures/wp02/flood-success.json";
import floodUnsupportedRaw from "@/data/fixtures/wp02/flood-unsupported-coverage.json";
import floodSourceFailureRaw from "@/data/fixtures/wp08/flood-source-failure.json";
import {
  FLOOD_PINNED_FIXTURE_DATE,
  FLOOD_UNSUPPORTED_FIXTURE_DATE,
  type FloodFixtureQueryInput,
  type FloodQueryResult,
} from "./types";

function loadFixture(raw: Record<string, unknown>): EvidenceObject {
  const clone = structuredClone(raw);
  for (const key of Object.keys(clone)) {
    if (key.startsWith("_")) delete clone[key];
  }
  validateEvidenceObject(clone);
  return clone;
}

export function queryFloodFixture(input: FloodFixtureQueryInput): FloodQueryResult {
  if (input.placeId !== "demo-houston" && input.placeId !== "demo-source-failure") {
    return {
      kind: "unsupported_place",
      rejectionReason:
        "Fixture-mode Flood evidence is available only for the labelled Houston demonstration. " +
        "Houston evidence is never substituted for another place.",
    };
  }

  if (input.placeId === "demo-source-failure") {
    if (input.date !== FLOOD_PINNED_FIXTURE_DATE) {
      return {
        kind: "unsupported_date",
        rejectionReason:
          `The Flood source-failure fixture is pinned to ${FLOOD_PINNED_FIXTURE_DATE}.`,
      };
    }
    return {
      kind: "source_failure",
      evidence: loadFixture(floodSourceFailureRaw as unknown as Record<string, unknown>),
    };
  }

  if (input.date === FLOOD_PINNED_FIXTURE_DATE) {
    return {
      kind: "success",
      evidence: loadFixture(floodSuccessRaw as unknown as Record<string, unknown>),
    };
  }

  if (input.date === FLOOD_UNSUPPORTED_FIXTURE_DATE) {
    return {
      kind: "unsupported_coverage",
      evidence: loadFixture(floodUnsupportedRaw as unknown as Record<string, unknown>),
    };
  }

  return {
    kind: "unsupported_date",
    rejectionReason:
      `Flood fixture mode accepts only ${FLOOD_PINNED_FIXTURE_DATE} for the Houston positive case ` +
      `or ${FLOOD_UNSUPPORTED_FIXTURE_DATE} for the labelled unsupported-coverage case.`,
  };
}

