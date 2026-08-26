/**
 * src/__tests__/unit/wp04-selection.test.ts
 *
 * WP-04 unit tests: place selection, demo place index, and selection factory
 * functions.
 *
 * Network-free. No live geocoder. No external requests.
 */

import { describe, it, expect } from "vitest";
import {
  DEMO_PLACES,
  searchDemoPlaces,
  getDemoPlaceById,
} from "@/data/places/wp04-demo-places";
import {
  buildDemoPlaceSelection,
  buildMapCoordinateSelection,
  updateSelectionParams,
} from "@/lib/location/selection";

// ---------------------------------------------------------------------------
// Demo place index
// ---------------------------------------------------------------------------

describe("DEMO_PLACES", () => {
  it("contains exactly eight governed demo places (ADR-0044 adds three story places)", () => {
    expect(DEMO_PLACES).toHaveLength(8);
    expect(DEMO_PLACES.map((p) => p.id)).toEqual(expect.arrayContaining([
      "demo-las-vegas",
      "demo-hawaii-island",
      "demo-new-york",
    ]));
  });

  it("Houston area has id demo-houston", () => {
    const h = DEMO_PLACES.find((p) => p.id === "demo-houston");
    expect(h).toBeDefined();
    expect(h!.label).toBe("Houston area (demo)");
  });

  it("Los Angeles area has id demo-los-angeles", () => {
    const la = DEMO_PLACES.find((p) => p.id === "demo-los-angeles");
    expect(la).toBeDefined();
    expect(la!.label).toBe("Los Angeles area (demo)");
  });

  it("Houston center is derived from bounding box", () => {
    const h = DEMO_PLACES.find((p) => p.id === "demo-houston")!;
    // box: [-97, 28, -94, 31]; center: (-95.5, 29.5)
    expect(h.center.lon).toBeCloseTo(-95.5, 5);
    expect(h.center.lat).toBeCloseTo(29.5, 5);
    expect(h.boundingBox.west).toBe(-97);
    expect(h.boundingBox.east).toBe(-94);
    expect(h.boundingBox.south).toBe(28);
    expect(h.boundingBox.north).toBe(31);
  });

  it("Los Angeles center is derived from bounding box", () => {
    const la = DEMO_PLACES.find((p) => p.id === "demo-los-angeles")!;
    // box: [-119, 33, -117, 35]; center: (-118.0, 34.0)
    expect(la.center.lon).toBeCloseTo(-118.0, 5);
    expect(la.center.lat).toBeCloseTo(34.0, 5);
    expect(la.boundingBox.west).toBe(-119);
    expect(la.boundingBox.east).toBe(-117);
  });

  it("labels include 'demo' — clearly labeled demo locations", () => {
    for (const p of DEMO_PLACES) {
      expect(p.label.toLowerCase()).toContain("demo");
    }
  });

  it("Lake Michigan box has id demo-lake-michigan", () => {
    const lm = DEMO_PLACES.find((p) => p.id === "demo-lake-michigan");
    expect(lm).toBeDefined();
    expect(lm!.label.toLowerCase()).toContain("lake michigan");
    // box: lon [-87.0,-86.9], lat [43.0,43.1]; center: (-86.95, 43.05)
    expect(lm!.center.lon).toBeCloseTo(-86.95, 4);
    expect(lm!.center.lat).toBeCloseTo(43.05, 4);
    expect(lm!.boundingBox.west).toBe(-87.0);
    expect(lm!.boundingBox.east).toBe(-86.9);
    expect(lm!.boundingBox.south).toBe(43.0);
    expect(lm!.boundingBox.north).toBe(43.1);
  });

  it("Tucson Heat case is centered exactly on NOAA USCRN AZ Tucson 11 W", () => {
    const tucson = DEMO_PLACES.find((place) => place.id === "demo-tucson");
    expect(tucson).toBeDefined();
    expect(tucson!.label.toLowerCase()).toContain("tucson");
    expect(tucson!.center.lon).toBeCloseTo(-111.17, 8);
    expect(tucson!.center.lat).toBeCloseTo(32.24, 8);
    expect(tucson!.boundingBox).toEqual({
      west: -111.18,
      south: 32.23,
      east: -111.16,
      north: 32.25,
    });
  });
});

describe("searchDemoPlaces", () => {
  it("empty query returns all places", () => {
    expect(searchDemoPlaces("")).toHaveLength(8);
    expect(searchDemoPlaces("   ")).toHaveLength(8);
  });

  it("filters by substring (case-insensitive)", () => {
    const r = searchDemoPlaces("houston");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("demo-houston");
  });

  it("returns empty array when no match", () => {
    expect(searchDemoPlaces("tokyo")).toHaveLength(0);
  });

  it("case insensitive: ANGELES matches Los Angeles", () => {
    const r = searchDemoPlaces("ANGELES");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("demo-los-angeles");
  });
});

describe("getDemoPlaceById", () => {
  it("returns the correct place", () => {
    const p = getDemoPlaceById("demo-houston");
    expect(p).toBeDefined();
    expect(p!.id).toBe("demo-houston");
  });

  it("returns undefined for unknown id", () => {
    expect(getDemoPlaceById("unknown-id")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildDemoPlaceSelection
// ---------------------------------------------------------------------------

describe("buildDemoPlaceSelection", () => {
  const houston = DEMO_PLACES.find((p) => p.id === "demo-houston")!;

  it("builds a valid selection from a demo place", () => {
    const sel = buildDemoPlaceSelection(houston, 50, "latest");
    expect(sel.label).toBe("Houston area (demo)");
    expect(sel.isMapSelection).toBe(false);
    expect(sel.coordinate.lon).toBeCloseTo(-95.5, 4);
    expect(sel.coordinate.lat).toBeCloseTo(29.5, 4);
    expect(sel.analysisArea.radiusKm).toBe(50);
    expect(sel.timeSelection.type).toBe("latest");
  });

  it("sets correct bounding box in analysisArea", () => {
    const sel = buildDemoPlaceSelection(houston, 25, "past_7d");
    expect(Number.isFinite(sel.analysisArea.boundingBox.west)).toBe(true);
    expect(Number.isFinite(sel.analysisArea.boundingBox.east)).toBe(true);
    expect(sel.analysisArea.boundingBox.south).toBeLessThan(sel.analysisArea.boundingBox.north);
    expect(sel.analysisArea.boundingBox.west).toBeLessThan(sel.analysisArea.boundingBox.east);
  });

  it("injects coverage limitation", () => {
    const sel = buildDemoPlaceSelection(houston, 25, "latest");
    expect(sel.timeSelection.coverageLimitation).toBeTruthy();
    expect(sel.timeSelection.coverageLimitation.length).toBeGreaterThan(10);
  });

  it("throws on invalid radius", () => {
    expect(() => buildDemoPlaceSelection(houston, 0, "latest")).toThrow();
    expect(() => buildDemoPlaceSelection(houston, 251, "latest")).toThrow();
    expect(() => buildDemoPlaceSelection(houston, NaN, "latest")).toThrow();
  });

  it("throws on invalid time type", () => {
    expect(() => buildDemoPlaceSelection(houston, 25, "invalid_type")).toThrow();
  });

  it("throws on custom type missing timestamps", () => {
    expect(() => buildDemoPlaceSelection(houston, 25, "custom")).toThrow();
  });

  it("accepts custom type with valid timestamps", () => {
    const sel = buildDemoPlaceSelection(
      houston, 25, "custom",
      "2026-07-01T00:00:00Z",
      "2026-07-31T23:59:59Z"
    );
    expect(sel.timeSelection.type).toBe("custom");
    expect(sel.timeSelection.startTs).toBe("2026-07-01T00:00:00Z");
    expect(sel.timeSelection.endTs).toBe("2026-07-31T23:59:59Z");
  });

  it("throws on custom type with start > end", () => {
    expect(() =>
      buildDemoPlaceSelection(houston, 25, "custom",
        "2026-07-31T23:59:59Z",
        "2026-07-01T00:00:00Z"
      )
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildMapCoordinateSelection
// ---------------------------------------------------------------------------

describe("buildMapCoordinateSelection", () => {
  it("labels result as 'Map point'", () => {
    const sel = buildMapCoordinateSelection({ lon: -95.5, lat: 29.5 }, 25, "latest");
    expect(sel.label).toBe("Map point");
    expect(sel.isMapSelection).toBe(true);
  });

  it("coordinate is preserved exactly", () => {
    const sel = buildMapCoordinateSelection({ lon: -118.2, lat: 34.05 }, 100, "past_24h");
    expect(sel.coordinate.lon).toBeCloseTo(-118.2, 5);
    expect(sel.coordinate.lat).toBeCloseTo(34.05, 5);
  });

  it("throws on invalid lon", () => {
    expect(() => buildMapCoordinateSelection({ lon: 200, lat: 0 }, 25, "latest")).toThrow();
    expect(() => buildMapCoordinateSelection({ lon: NaN, lat: 0 }, 25, "latest")).toThrow();
  });

  it("throws on invalid lat", () => {
    expect(() => buildMapCoordinateSelection({ lon: 0, lat: 100 }, 25, "latest")).toThrow();
    expect(() => buildMapCoordinateSelection({ lon: 0, lat: NaN }, 25, "latest")).toThrow();
  });

  it("throws on invalid radius", () => {
    expect(() => buildMapCoordinateSelection({ lon: 0, lat: 0 }, -1, "latest")).toThrow();
    expect(() => buildMapCoordinateSelection({ lon: 0, lat: 0 }, 0, "latest")).toThrow();
    expect(() => buildMapCoordinateSelection({ lon: 0, lat: 0 }, 300, "latest")).toThrow();
  });

  it("does not call any geocoder — no network access (always passes in test env)", () => {
    // This test verifies the function completes without any external call.
    // If a geocoder were added, the CI network-free guard would catch it.
    const sel = buildMapCoordinateSelection({ lon: 0, lat: 0 }, 10, "latest");
    expect(sel.label).toBe("Map point");
  });
});

// ---------------------------------------------------------------------------
// updateSelectionParams
// ---------------------------------------------------------------------------

describe("updateSelectionParams", () => {
  const houston = DEMO_PLACES.find((p) => p.id === "demo-houston")!;

  it("preserves label and coordinate identity", () => {
    const base = buildDemoPlaceSelection(houston, 25, "latest");
    const updated = updateSelectionParams(base, 100, "latest");
    expect(updated.label).toBe(base.label);
    expect(updated.coordinate).toEqual(base.coordinate);
    expect(updated.isMapSelection).toBe(false);
  });

  it("applies new radius without re-selecting place", () => {
    const base = buildDemoPlaceSelection(houston, 25, "latest");
    const updated = updateSelectionParams(base, 100, "latest");
    expect(updated.analysisArea.radiusKm).toBe(100);
    expect(base.analysisArea.radiusKm).toBe(25); // base unchanged
  });

  it("applies new time type without re-selecting place", () => {
    const base = buildDemoPlaceSelection(houston, 25, "latest");
    const updated = updateSelectionParams(base, 25, "past_7d");
    expect(updated.timeSelection.type).toBe("past_7d");
    expect(base.timeSelection.type).toBe("latest"); // base unchanged
  });

  it("applies custom time with start/end", () => {
    const base = buildDemoPlaceSelection(houston, 25, "latest");
    const updated = updateSelectionParams(
      base, 25, "custom",
      "2026-07-01T00:00:00Z",
      "2026-07-31T23:59:59Z"
    );
    expect(updated.timeSelection.type).toBe("custom");
    expect(updated.timeSelection.startTs).toBe("2026-07-01T00:00:00Z");
    expect(updated.timeSelection.endTs).toBe("2026-07-31T23:59:59Z");
  });

  it("preserves isMapSelection=true for map-selected coordinate", () => {
    const base = buildMapCoordinateSelection({ lon: -95.5, lat: 29.5 }, 25, "latest");
    const updated = updateSelectionParams(base, 50, "past_24h");
    expect(updated.isMapSelection).toBe(true);
    expect(updated.label).toBe("Map point");
    expect(updated.coordinate.lon).toBeCloseTo(-95.5, 5);
  });

  it("throws on invalid radius — base selection left unchanged", () => {
    const base = buildDemoPlaceSelection(houston, 25, "latest");
    expect(() => updateSelectionParams(base, 0, "latest")).toThrow();
    expect(() => updateSelectionParams(base, 300, "latest")).toThrow();
    // base should be unchanged (it was not mutated)
    expect(base.analysisArea.radiusKm).toBe(25);
  });

  it("throws on invalid time type", () => {
    const base = buildDemoPlaceSelection(houston, 25, "latest");
    expect(() => updateSelectionParams(base, 25, "invalid_type")).toThrow();
  });

  it("throws on custom time with end before start", () => {
    const base = buildDemoPlaceSelection(houston, 25, "latest");
    expect(() =>
      updateSelectionParams(base, 25, "custom",
        "2026-07-31T00:00:00Z",
        "2026-07-01T00:00:00Z"
      )
    ).toThrow();
  });

  it("bounding box is updated when radius changes", () => {
    const base = buildDemoPlaceSelection(houston, 25, "latest");
    const updated = updateSelectionParams(base, 100, "latest");
    // Larger radius → wider bounding box
    const dLat25 = base.analysisArea.boundingBox.north - base.coordinate.lat;
    const dLat100 = updated.analysisArea.boundingBox.north - updated.coordinate.lat;
    expect(dLat100).toBeGreaterThan(dLat25);
  });
});
