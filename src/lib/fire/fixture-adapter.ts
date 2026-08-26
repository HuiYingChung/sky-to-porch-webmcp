/**
 * src/lib/fire/fixture-adapter.ts
 *
 * WP-05 Fire & Smoke fixture adapter.
 *
 * This is the sole entry point for fire evidence in WP-05. It is
 * deterministic and network-free. No live HTTP requests are made.
 *
 * Accepted inputs:
 *   - placeId "demo-los-angeles" + date "2025-01-08"
 *     → observations_returned (fire-success fixture)
 *   - placeId "demo-lake-michigan" + date "2025-01-08"
 *     → no_observation (fire-no-observation fixture)
 *   - placeId "demo-source-failure" + date "2025-01-08"
 *     → source_failure (fire-source-failure fixture)
 *   - any other placeId or date → unsupported_place / unsupported_date rejection
 *
 * Every returned EvidenceObject passes validateEvidenceObject before return.
 * No result is returned without validation. No fallback substitutes a failure.
 *
 * Safety invariants:
 *   - source_failure carries zero observations and insufficient confidence.
 *   - no_observation carries a required "no data ≠ no danger" limitation.
 *   - No provider detail or credentials appear in any rejection.
 *   - dataMode is "fixture" (or "failed" for source_failure).
 */

import { validateEvidenceObject } from "@/contracts/evidence";
import type { EvidenceObject } from "@/contracts/evidence";
import type { FireQueryResult } from "./types";
import { PINNED_FIXTURE_DATE } from "./types";

type FixtureFireQueryInput = {
  placeId: string;
  date: string;
  mode?: "fixture";
};

// ---------------------------------------------------------------------------
// Fixture imports (static JSON — no network calls)
// ---------------------------------------------------------------------------

// These are imported as modules; they never load from a live URL.
import fireSuccessRaw from "@/data/fixtures/wp02/fire-success.json";
import fireNoObsRaw from "@/data/fixtures/wp02/fire-no-observation.json";
import fireSourceFailureRaw from "@/data/fixtures/wp05/fire-source-failure.json";

// ---------------------------------------------------------------------------
// Strip fixture metadata fields (_fixtureId, _fixtureDescription, etc.)
// These are not part of the EvidenceObject schema.
// ---------------------------------------------------------------------------

function stripFixtureMeta(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (!key.startsWith("_")) {
      out[key] = val;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Accepted place IDs and their fixture key mappings
// ---------------------------------------------------------------------------

/** Accepted placeId values and their corresponding fixture. */
const ACCEPTED_PLACES = new Set([
  "demo-los-angeles",
  "demo-lake-michigan",
  "demo-source-failure",
]);

/** Returns true when the given date string is exactly the pinned date. */
function matchesPinnedDate(date: string): boolean {
  return date === PINNED_FIXTURE_DATE;
}

// ---------------------------------------------------------------------------
// Main adapter function
// ---------------------------------------------------------------------------

/**
 * Retrieves a validated fire evidence object for the given input.
 *
 * This function is deterministic and network-free. It does not call any
 * live source and does not fall back to a stale result on failure.
 *
 * @returns FireQueryResult with kind and validated evidence (when applicable).
 */
export function queryFireEvidence(input: FixtureFireQueryInput): FireQueryResult {
  const { placeId, date } = input;

  // 1. Reject unknown places
  if (!ACCEPTED_PLACES.has(placeId)) {
    return {
      kind: "unsupported_place",
      rejectionReason:
        `Place "${placeId}" is not supported for historical fire evidence. ` +
        `Accepted demo places: Los Angeles (demo-los-angeles) and Lake Michigan (demo-lake-michigan). ` +
        `Los Angeles data must not be substituted for other locations.`,
    };
  }

  // 2. Reject every non-pinned date before selecting any fixture. Failure
  // simulation must not bypass the query contract or silently substitute the
  // pinned historical date.
  if (!matchesPinnedDate(date)) {
    return {
      kind: "unsupported_date",
      rejectionReason:
        `Date "${date}" is not supported. Only the pinned historical date ` +
        `${PINNED_FIXTURE_DATE} is available for fixture-mode fire evidence. ` +
        `Los Angeles data must not be substituted for other dates.`,
    };
  }

  // 3. Source-failure is a fixture selection, not an exception to the date gate.
  if (placeId === "demo-source-failure") {
    const raw = stripFixtureMeta(fireSourceFailureRaw as unknown as Record<string, unknown>);
    validateEvidenceObject(raw);
    return { kind: "source_failure", evidence: raw as unknown as EvidenceObject };
  }

  // 4. Return the fixture for the accepted place.
  if (placeId === "demo-los-angeles") {
    const raw = stripFixtureMeta(fireSuccessRaw as unknown as Record<string, unknown>);
    validateEvidenceObject(raw);
    return { kind: "success", evidence: raw as unknown as EvidenceObject };
  }

  // placeId === "demo-lake-michigan"
  const raw = stripFixtureMeta(fireNoObsRaw as unknown as Record<string, unknown>);
  validateEvidenceObject(raw);
  return { kind: "no_observation", evidence: raw as unknown as EvidenceObject };
}
