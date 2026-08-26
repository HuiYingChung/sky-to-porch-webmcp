/**
 * src/lib/fire/client-adapter.ts
 *
 * WP-05 client-safe fire fixture adapter.
 *
 * This module is webpack-safe for use in Next.js client components.
 * It does NOT import from src/contracts/evidence (which uses .js relative imports
 * incompatible with webpack's module resolver).
 *
 * Validation: TypeScript's static type system enforces the EvidenceObject
 * shape at compile time. Runtime schema validation (validateEvidenceObject)
 * is called by the server/node fixture-adapter.ts (used in tests only).
 *
 * No live network calls are made. All data is loaded from static JSON fixtures.
 */

import type { EvidenceObject } from "@/contracts/evidence";
import type { FireQueryResult } from "./types";
import { PINNED_FIXTURE_DATE } from "./types";

// ---------------------------------------------------------------------------
// Static fixture imports — these are JSON, no .js-import chain
// ---------------------------------------------------------------------------

import fireSuccessRaw from "@/data/fixtures/wp02/fire-success.json";
import fireNoObsRaw from "@/data/fixtures/wp02/fire-no-observation.json";
import fireSourceFailureRaw from "@/data/fixtures/wp05/fire-source-failure.json";

// ---------------------------------------------------------------------------
// Strip fixture metadata
// ---------------------------------------------------------------------------

function stripFixtureMeta(raw: Record<string, unknown>): EvidenceObject {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (!key.startsWith("_")) {
      out[key] = val;
    }
  }
  return out as unknown as EvidenceObject;
}

// ---------------------------------------------------------------------------
// Accepted place IDs
// ---------------------------------------------------------------------------

const ACCEPTED_PLACES = new Set([
  "demo-los-angeles",
  "demo-lake-michigan",
  "demo-source-failure",
]);

function matchesPinnedDate(date: string): boolean {
  return date === PINNED_FIXTURE_DATE;
}

// ---------------------------------------------------------------------------
// Client-safe query function
// ---------------------------------------------------------------------------

/**
 * Client-safe fire evidence query. Returns a FireQueryResult backed by
 * static JSON fixtures. TypeScript enforces the EvidenceObject shape.
 * Use fixture-adapter.ts (which calls validateEvidenceObject) in tests.
 */
export function queryFireEvidenceClient(input: {
  placeId: string;
  date: string;
  mode?: "fixture";
}): FireQueryResult {
  const { placeId, date } = input;

  if (!ACCEPTED_PLACES.has(placeId)) {
    return {
      kind: "unsupported_place",
      rejectionReason:
        `Place "${placeId}" is not supported for historical fire evidence. ` +
        `Accepted demo places: Los Angeles (demo-los-angeles) and Lake Michigan (demo-lake-michigan). ` +
        `Los Angeles data must not be substituted for other locations.`,
    };
  }

  if (!matchesPinnedDate(date)) {
    return {
      kind: "unsupported_date",
      rejectionReason:
        `Date "${date}" is not supported. Only the pinned historical date ` +
        `${PINNED_FIXTURE_DATE} is available for fixture-mode fire evidence. ` +
        `Los Angeles data must not be substituted for other dates.`,
    };
  }

  if (placeId === "demo-source-failure") {
    return {
      kind: "source_failure",
      evidence: stripFixtureMeta(fireSourceFailureRaw as unknown as Record<string, unknown>),
    };
  }

  if (placeId === "demo-los-angeles") {
    return {
      kind: "success",
      evidence: stripFixtureMeta(fireSuccessRaw as unknown as Record<string, unknown>),
    };
  }

  return {
    kind: "no_observation",
    evidence: stripFixtureMeta(fireNoObsRaw as unknown as Record<string, unknown>),
  };
}
