/**
 * src/__tests__/unit/wp03-query-state.test.ts
 *
 * Deterministic unit tests for query-draft state transitions.
 * Covers: emptyDraft, queryDraftReducer, isDraftSubmittable, labels.
 *
 * WP-04 update: placeLabel and timeRangeType removed from QueryDraft.
 * isDraftSubmittable now requires a validated PlaceSelection (not a string label).
 */

import { describe, it, expect } from "vitest";
import {
  emptyDraft,
  queryDraftReducer,
  isDraftSubmittable,
  HAZARD_LABELS,
  CONCERN_LABELS,
  TIME_RANGE_LABELS,
  type QueryDraft,
} from "@/lib/ui/query-draft";
import { HAZARD_IDS, CONCERN_TYPES, TIME_RANGE_TYPES } from "@/contracts/common";
import type { PlaceSelection } from "@/lib/location/selection";

// Minimal valid PlaceSelection for isDraftSubmittable tests
const MOCK_SELECTION: PlaceSelection = {
  label: "Houston area (demo)",
  isMapSelection: false,
  selectionMethod: "demo_place",
  coordinate: { lon: -95.5, lat: 29.5 },
  analysisArea: {
    center: { lon: -95.5, lat: 29.5 },
    radiusKm: 25,
    boundingBox: { west: -95.7, south: 29.3, east: -95.3, north: 29.7 },
  },
  timeSelection: {
    type: "latest",
    coverageLimitation: "Time range is a request. Source coverage not yet verified.",
  },
};

describe("emptyDraft", () => {
  it("returns a neutral general lens with empty hazard and question", () => {
    const d = emptyDraft();
    expect(d.hazardId).toBeNull();
    expect(d.concern).toBe("general");
    expect(d.optionalQuestion).toBe("");
  });

  it("does not contain placeLabel or timeRangeType (WP-04 superseded)", () => {
    const d = emptyDraft();
    // These fields must not be in the QueryDraft type after WP-04
    expect("placeLabel" in d).toBe(false);
    expect("timeRangeType" in d).toBe(false);
  });
});

describe("queryDraftReducer", () => {
  const base: QueryDraft = emptyDraft();

  it("SET_HAZARD accepts all valid HAZARD_IDS", () => {
    for (const id of HAZARD_IDS) {
      const next = queryDraftReducer(base, { type: "SET_HAZARD", value: id });
      expect(next.hazardId).toBe(id);
    }
  });

  it("SET_HAZARD ignores unknown hazard", () => {
    // @ts-expect-error -- intentional invalid value for test
    const next = queryDraftReducer(base, { type: "SET_HAZARD", value: "unknown_hazard" });
    expect(next.hazardId).toBeNull();
  });

  it("SET_HAZARD accepts null", () => {
    const withHazard = queryDraftReducer(base, { type: "SET_HAZARD", value: "fire_smoke" });
    const cleared = queryDraftReducer(withHazard, { type: "SET_HAZARD", value: null });
    expect(cleared.hazardId).toBeNull();
  });

  it("SET_CONCERN accepts all valid CONCERN_TYPES", () => {
    for (const c of CONCERN_TYPES) {
      const next = queryDraftReducer(base, { type: "SET_CONCERN", value: c });
      expect(next.concern).toBe(c);
    }
  });

  it("SET_CONCERN ignores unknown concern", () => {
    // @ts-expect-error -- intentional invalid value for test
    const next = queryDraftReducer(base, { type: "SET_CONCERN", value: "work" });
    expect(next.concern).toBe("general");
  });

  it("SET_OPTIONAL_QUESTION updates optionalQuestion", () => {
    const next = queryDraftReducer(base, {
      type: "SET_OPTIONAL_QUESTION",
      value: "Is it safe to walk my dog?",
    });
    expect(next.optionalQuestion).toBe("Is it safe to walk my dog?");
  });

  it("RESET returns an empty draft", () => {
    const filled: QueryDraft = {
      hazardId: "fire_smoke",
      concern: "health",
      optionalQuestion: "Any smoke?",
    };
    const next = queryDraftReducer(filled, { type: "RESET" });
    expect(next).toEqual(emptyDraft());
  });

  it("does not mutate the original state", () => {
    const state = emptyDraft();
    const orig = { ...state };
    queryDraftReducer(state, { type: "SET_HAZARD", value: "fire_smoke" });
    expect(state).toEqual(orig);
  });
});

describe("isDraftSubmittable", () => {
  it("returns false when all fields are empty and no selection", () => {
    expect(isDraftSubmittable(emptyDraft(), null)).toBe(false);
  });

  it("returns false when placeSelection is null (even with hazard and concern filled)", () => {
    const d: QueryDraft = { ...emptyDraft(), hazardId: "fire_smoke", concern: "home" };
    expect(isDraftSubmittable(d, null)).toBe(false);
  });

  it("returns false when hazardId is null", () => {
    const d = { ...emptyDraft(), concern: "home" as const };
    expect(isDraftSubmittable(d, MOCK_SELECTION)).toBe(false);
  });

  it("returns false when concern is null", () => {
    const d = { ...emptyDraft(), hazardId: "fire_smoke" as const, concern: null };
    expect(isDraftSubmittable(d, MOCK_SELECTION)).toBe(false);
  });

  it("returns true with the default general lens", () => {
    const d = { ...emptyDraft(), hazardId: "fire_smoke" as const };
    expect(isDraftSubmittable(d, MOCK_SELECTION)).toBe(true);
  });

  it("returns true when placeSelection is set and hazard and concern are filled", () => {
    const d: QueryDraft = { ...emptyDraft(), hazardId: "fire_smoke", concern: "home" };
    expect(isDraftSubmittable(d, MOCK_SELECTION)).toBe(true);
  });

  it("returns true even when optionalQuestion is empty", () => {
    const d: QueryDraft = { ...emptyDraft(), hazardId: "flood_storm", concern: "community" };
    expect(isDraftSubmittable(d, MOCK_SELECTION)).toBe(true);
  });
});

describe("label maps", () => {
  it("HAZARD_LABELS covers all HAZARD_IDS", () => {
    for (const id of HAZARD_IDS) {
      expect(HAZARD_LABELS[id]).toBeTruthy();
    }
  });

  it("TIME_RANGE_LABELS covers all TIME_RANGE_TYPES", () => {
    for (const t of TIME_RANGE_TYPES) {
      expect(TIME_RANGE_LABELS[t]).toBeTruthy();
    }
  });

  it("CONCERN_LABELS covers all CONCERN_TYPES", () => {
    for (const c of CONCERN_TYPES) {
      expect(CONCERN_LABELS[c]).toBeTruthy();
    }
  });
});
