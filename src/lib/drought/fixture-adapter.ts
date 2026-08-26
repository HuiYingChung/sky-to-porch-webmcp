import { validateEvidenceObject, type EvidenceObject } from "@/contracts/evidence";
import droughtSuccessRaw from "@/data/fixtures/wp10/drought-success.json";
import droughtNoObservationRaw from "@/data/fixtures/wp10/drought-no-observation.json";
import droughtSourceFailureRaw from "@/data/fixtures/wp10/drought-source-failure.json";
import {
  DROUGHT_PINNED_FIXTURE_DATE,
  type DroughtFixtureQueryInput,
  type DroughtQueryResult,
} from "./types";

const FIXTURE_NO_OBSERVATION_DATE = "2024-06-11";
const FIXTURE_UNSUPPORTED_DATE = "1990-01-01";

function loadFixture(raw: Record<string, unknown>): EvidenceObject {
  const clone = structuredClone(raw) as Record<string, unknown>;
  for (const key of Object.keys(clone)) {
    if (key.startsWith("_")) delete clone[key];
  }
  validateEvidenceObject(clone);
  return clone as EvidenceObject;
}

export function queryDroughtFixture(
  input: DroughtFixtureQueryInput
): DroughtQueryResult {
  // Reject any non-demo-tucson place
  if (input.placeId !== "demo-tucson") {
    return {
      kind: "unsupported_place",
      sourceOutcomes: { gibs: "not_attempted", usdm: "not_attempted" },
      rejectionReason:
        "Fixture-mode Drought evidence is available only for the labelled Tucson demonstration. Tucson evidence is never substituted for another place.",
    };
  }

  // Pinned success date
  if (input.date === DROUGHT_PINNED_FIXTURE_DATE) {
    return {
      kind: "success",
      sourceOutcomes: { gibs: "success", usdm: "success" },
      evidence: loadFixture(droughtSuccessRaw as unknown as Record<string, unknown>),
    };
  }

  // No-observation date
  if (input.date === FIXTURE_NO_OBSERVATION_DATE) {
    return {
      kind: "no_observation",
      sourceOutcomes: { gibs: "not_attempted", usdm: "no_observation" },
      evidence: loadFixture(droughtNoObservationRaw as unknown as Record<string, unknown>),
    };
  }

  // Unsupported date
  if (input.date === FIXTURE_UNSUPPORTED_DATE) {
    return {
      kind: "unsupported_date",
      sourceOutcomes: { gibs: "not_attempted", usdm: "not_attempted" },
      rejectionReason: `Drought fixture date ${FIXTURE_UNSUPPORTED_DATE} is explicitly unsupported.`,
    };
  }

  // Any other date: source-failure fixture
  return {
    kind: "source_failure",
    sourceOutcomes: { gibs: "failed", usdm: "failed" },
    evidence: loadFixture(droughtSourceFailureRaw as unknown as Record<string, unknown>),
  };
}
