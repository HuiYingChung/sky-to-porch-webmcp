import { describe, expect, it } from "vitest";
import {
  applyEnvironmentalMapDesiredState,
  createInitialEnvironmentalMapState,
  isFirmsNrtMapDateSupported,
  isStrictUtcMapDate,
  latestCompletedUtcDate,
  loadingStatusForLayer,
  sameMapSelection,
  singleMapDateFromSelection,
} from "@/lib/map/environmental-map-state";
import {
  buildGeocodedPlaceSelection,
  updateSelectionParams,
} from "@/lib/location/selection";

const NOW = new Date("2026-08-26T18:00:00.000Z");

function selection(
  start = "2026-08-25T00:00:00Z",
  end = "2026-08-25T23:59:59Z"
) {
  return buildGeocodedPlaceSelection(
    "Houston, Texas",
    { lon: -95.36, lat: 29.76 },
    25,
    "custom",
    start,
    end,
    { west: -95.9, south: 29.5, east: -95, north: 30.1 }
  );
}

describe("environmental map state helpers", () => {
  it("creates a completely hidden, dateless, revision-zero state", () => {
    expect(createInitialEnvironmentalMapState()).toEqual({
      date: null,
      layers: {
        rain_satellite: { visible: false, status: "hidden" },
        surface_heat_satellite: { visible: false, status: "hidden" },
        thermal_anomalies_firms: { visible: false, status: "hidden" },
        flood_extent: { visible: false, status: "hidden" },
      },
      revision: 0,
      contextRevision: 0,
      agentFocusRevision: 0,
    });
  });

  it.each([
    ["2026-08-25", true],
    ["2024-02-29", true],
    ["2026-02-29", false],
    ["2026-2-09", false],
    ["2026-08-25T00:00:00Z", false],
  ])("validates strict UTC map date %s", (value, expected) => {
    expect(isStrictUtcMapDate(value)).toBe(expected);
  });

  it("uses only the last completed UTC day for defaults", () => {
    expect(latestCompletedUtcDate(NOW)).toBe("2026-08-25");
    expect(latestCompletedUtcDate(new Date("2026-01-01T00:01:00Z"))).toBe(
      "2025-12-31"
    );
  });

  it("returns a map date only for a genuinely single-day custom selection", () => {
    expect(singleMapDateFromSelection(selection(), NOW)).toBe("2026-08-25");
    expect(singleMapDateFromSelection(selection(
      "2026-08-24T00:00:00Z",
      "2026-08-25T23:59:59Z"
    ), NOW)).toBeNull();
    expect(singleMapDateFromSelection(null, NOW)).toBeNull();
    const latest = updateSelectionParams(selection(), 25, "latest");
    expect(singleMapDateFromSelection(latest, NOW)).toBe("2026-08-25");
  });

  it("permits FIRMS NRT only for today and the prior UTC day", () => {
    expect(isFirmsNrtMapDateSupported("2026-08-26", NOW)).toBe(true);
    expect(isFirmsNrtMapDateSupported("2026-08-25", NOW)).toBe(true);
    expect(isFirmsNrtMapDateSupported("2026-08-24", NOW)).toBe(false);
    expect(isFirmsNrtMapDateSupported("not-a-date", NOW)).toBe(false);
    expect(loadingStatusForLayer("thermal_anomalies_firms", "2026-08-24", NOW))
      .toBe("unsupported_date");
    expect(loadingStatusForLayer("thermal_anomalies_firms", "2026-08-25", NOW))
      .toBe("loading");
    expect(loadingStatusForLayer("rain_satellite", "2020-01-01", NOW))
      .toBe("loading");
    expect(loadingStatusForLayer("flood_extent", null, NOW)).toBe("source_failure");
  });

  it("applies a partial desired-state patch without changing omitted layers", () => {
    const current = createInitialEnvironmentalMapState();
    const next = applyEnvironmentalMapDesiredState(current, {
      rain_satellite: true,
    }, {
      date: "2026-08-25",
      contextChanged: false,
      origin: "human",
      now: NOW,
    });

    expect(next).toMatchObject({
      date: "2026-08-25",
      revision: 1,
      agentFocusRevision: 0,
      layers: {
        rain_satellite: { visible: true, status: "loading" },
        surface_heat_satellite: { visible: false, status: "hidden" },
        thermal_anomalies_firms: { visible: false, status: "hidden" },
        flood_extent: { visible: false, status: "hidden" },
      },
    });
  });

  it("keeps desired-state retries idempotent while still recording agent focus", () => {
    const first = applyEnvironmentalMapDesiredState(
      createInitialEnvironmentalMapState(),
      { rain_satellite: true },
      {
        date: "2026-08-25",
        contextChanged: false,
        origin: "agent",
        now: NOW,
      }
    );
    const retry = applyEnvironmentalMapDesiredState(first, {
      rain_satellite: true,
    }, {
      date: "2026-08-25",
      contextChanged: false,
      origin: "agent",
      now: NOW,
    });

    expect(retry.revision).toBe(first.revision);
    expect(retry.contextRevision).toBe(first.contextRevision);
    expect(retry.layers).toEqual(first.layers);
    expect(retry.agentFocusRevision).toBe(first.agentFocusRevision + 1);
  });

  it("resets every visible layer on a changed place/date context", () => {
    const visible = applyEnvironmentalMapDesiredState(
      createInitialEnvironmentalMapState(),
      { rain_satellite: true, thermal_anomalies_firms: true },
      {
        date: "2026-08-25",
        contextChanged: false,
        origin: "human",
        now: NOW,
      }
    );
    const changed = applyEnvironmentalMapDesiredState(visible, {}, {
      date: "2026-08-24",
      contextChanged: true,
      origin: "human",
      now: NOW,
    });

    expect(changed.revision).toBe(visible.revision + 1);
    expect(changed.contextRevision).toBe(visible.contextRevision + 1);
    expect(changed.layers.rain_satellite).toEqual({
      visible: true,
      status: "loading",
    });
    expect(changed.layers.thermal_anomalies_firms).toEqual({
      visible: true,
      status: "unsupported_date",
    });
  });

  it("keeps the source context generation stable for visibility-only changes", () => {
    const initial = createInitialEnvironmentalMapState();
    const visible = applyEnvironmentalMapDesiredState(initial, {
      rain_satellite: true,
    }, {
      date: "2026-08-25",
      contextChanged: false,
      origin: "human",
      now: NOW,
    });
    const hidden = applyEnvironmentalMapDesiredState(visible, {
      rain_satellite: false,
    }, {
      date: "2026-08-25",
      contextChanged: false,
      origin: "human",
      now: NOW,
    });

    expect(visible.contextRevision).toBe(1);
    expect(hidden.contextRevision).toBe(visible.contextRevision);
    expect(hidden.revision).toBe(visible.revision + 1);
  });

  it("compares the complete map context, including bounds, radius, and time", () => {
    const base = selection();
    expect(sameMapSelection(base, base)).toBe(true);
    expect(sameMapSelection(base, selection())).toBe(true);
    expect(sameMapSelection(base, updateSelectionParams(base, 50, "custom",
      "2026-08-25T00:00:00Z", "2026-08-25T23:59:59Z"))).toBe(false);
    const differentBounds = {
      ...base,
      placeBoundingBox: { ...base.placeBoundingBox!, east: -94.9 },
    };
    expect(sameMapSelection(base, differentBounds)).toBe(false);
    expect(sameMapSelection(base, null)).toBe(false);
  });
});
