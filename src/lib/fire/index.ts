/**
 * src/lib/fire/index.ts
 *
 * WP-05 fire & smoke lib — public API.
 *
 * Re-exports the fixture adapter, explainer, and types for use by components.
 * This is the only import path components should use for fire evidence.
 */

export { queryFireEvidence } from "./fixture-adapter";
export { buildFireExplanation } from "./explainer";
export type { FireQueryInput, FireQueryResult, FireQueryResultKind, FireFixtureKey } from "./types";
export { PINNED_FIXTURE_DATE, LA_FIRE_BOX, LAKE_MICHIGAN_FIRE_BOX } from "./types";
