/**
 * src/__tests__/unit/wp04-area-time.test.ts
 *
 * WP-04 unit tests: analysis-area derivation, edge-case validation,
 * and time-selection normalization.
 *
 * WP-04 C01 update: deriveBoundingBox and validateAndBuildArea now fail
 * closed (throw ValidationError) for pole and antimeridian crossings.
 * Tests updated to verify rejection, not clamping.
 *
 * Network-free. Tests deterministic computation only.
 */

import { describe, it, expect } from "vitest";
import {
  deriveBoundingBox,
  validateAndBuildArea,
  AREA_RADIUS_MIN_KM,
  AREA_RADIUS_MAX_KM,
} from "@/lib/location/area";
import {
  validateAndBuildTimeSelection,
  TIME_COVERAGE_LIMITATION,
} from "@/lib/location/time";

// ---------------------------------------------------------------------------
// deriveBoundingBox
// ---------------------------------------------------------------------------

describe("deriveBoundingBox", () => {
  it("returns a box wider than the radius in all directions", () => {
    const box = deriveBoundingBox({ lon: 0, lat: 0 }, 100);
    expect(box.south).toBeLessThan(0);
    expect(box.north).toBeGreaterThan(0);
    expect(box.west).toBeLessThan(0);
    expect(box.east).toBeGreaterThan(0);
  });

  it("larger radius produces larger box", () => {
    const small = deriveBoundingBox({ lon: 0, lat: 0 }, 25);
    const large = deriveBoundingBox({ lon: 0, lat: 0 }, 100);
    expect(large.north - large.south).toBeGreaterThan(small.north - small.south);
    expect(large.east - large.west).toBeGreaterThan(small.east - small.west);
  });

  it("fail closed: pole crossing throws ValidationError (north pole)", () => {
    // Near north pole, lat 89 + large radius → north > 90 → must throw
    expect(() => deriveBoundingBox({ lon: 0, lat: 89 }, 250)).toThrow();
  });

  it("fail closed: pole crossing throws ValidationError (south pole)", () => {
    // Near south pole
    expect(() => deriveBoundingBox({ lon: 0, lat: -89 }, 250)).toThrow();
  });

  it("fail closed: antimeridian crossing throws ValidationError (west)", () => {
    // Near western antimeridian, large radius
    expect(() => deriveBoundingBox({ lon: -179, lat: 0 }, 250)).toThrow();
  });

  it("fail closed: antimeridian crossing throws ValidationError (east)", () => {
    // Near eastern antimeridian, large radius
    expect(() => deriveBoundingBox({ lon: 179, lat: 0 }, 250)).toThrow();
  });

  it("does not throw for valid mid-range coordinates", () => {
    // Valid: Houston area, 25 km — must succeed without throwing
    expect(() => deriveBoundingBox({ lon: -95.5, lat: 29.5 }, 25)).not.toThrow();
  });

  it("Houston: roughly correct box for 50km radius", () => {
    const box = deriveBoundingBox({ lon: -95.5, lat: 29.5 }, 50);
    // 50 km ≈ 0.449° lat, less than 0.52° lon at lat 29.5
    expect(box.north - box.south).toBeCloseTo(0.449 * 2, 1);
    expect(box.south).toBeGreaterThan(28);
    expect(box.north).toBeLessThan(31);
  });

  it("south < north for safe mid-range latitudes", () => {
    // Only test latitudes/radii that don't cross poles or antimeridian
    for (const lat of [-45, 0, 45]) {
      for (const r of [1, 25, 100]) {
        const box = deriveBoundingBox({ lon: 0, lat }, r);
        expect(box.south).toBeLessThan(box.north);
      }
    }
  });

  it("west < east for valid mid-range coords", () => {
    for (const lon of [-90, 0, 90]) {
      for (const lat of [-45, 0, 45]) {
        const box = deriveBoundingBox({ lon, lat }, 100);
        expect(box.west).toBeLessThan(box.east);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// validateAndBuildArea
// ---------------------------------------------------------------------------

describe("validateAndBuildArea", () => {
  it("builds a valid area", () => {
    const a = validateAndBuildArea({ lon: -95.5, lat: 29.5 }, 50);
    expect(a.radiusKm).toBe(50);
    expect(a.center.lon).toBeCloseTo(-95.5, 5);
    expect(a.center.lat).toBeCloseTo(29.5, 5);
    expect(a.boundingBox.south).toBeLessThan(a.boundingBox.north);
  });

  it("accepts minimum radius", () => {
    const a = validateAndBuildArea({ lon: 0, lat: 0 }, AREA_RADIUS_MIN_KM);
    expect(a.radiusKm).toBe(AREA_RADIUS_MIN_KM);
  });

  it("accepts maximum radius", () => {
    const a = validateAndBuildArea({ lon: 0, lat: 0 }, AREA_RADIUS_MAX_KM);
    expect(a.radiusKm).toBe(AREA_RADIUS_MAX_KM);
  });

  it("throws on radius below minimum", () => {
    expect(() => validateAndBuildArea({ lon: 0, lat: 0 }, 0)).toThrow();
    expect(() => validateAndBuildArea({ lon: 0, lat: 0 }, -1)).toThrow();
    expect(() => validateAndBuildArea({ lon: 0, lat: 0 }, 0.5)).toThrow();
  });

  it("throws on radius above maximum", () => {
    expect(() => validateAndBuildArea({ lon: 0, lat: 0 }, 251)).toThrow();
    expect(() => validateAndBuildArea({ lon: 0, lat: 0 }, 1000)).toThrow();
  });

  it("throws on NaN radius", () => {
    expect(() => validateAndBuildArea({ lon: 0, lat: 0 }, NaN)).toThrow();
  });

  it("throws on Infinity radius", () => {
    expect(() => validateAndBuildArea({ lon: 0, lat: 0 }, Infinity)).toThrow();
  });

  it("throws on invalid longitude", () => {
    expect(() => validateAndBuildArea({ lon: 200, lat: 0 }, 25)).toThrow();
    expect(() => validateAndBuildArea({ lon: -200, lat: 0 }, 25)).toThrow();
    expect(() => validateAndBuildArea({ lon: NaN, lat: 0 }, 25)).toThrow();
  });

  it("throws on invalid latitude", () => {
    expect(() => validateAndBuildArea({ lon: 0, lat: 100 }, 25)).toThrow();
    expect(() => validateAndBuildArea({ lon: 0, lat: -100 }, 25)).toThrow();
    expect(() => validateAndBuildArea({ lon: 0, lat: NaN }, 25)).toThrow();
  });

  it("throws on non-plain-object coordinate", () => {
    expect(() => validateAndBuildArea(null, 25)).toThrow();
    expect(() => validateAndBuildArea("lon=-95.5,lat=29.5", 25)).toThrow();
    expect(() => validateAndBuildArea([0, 0], 25)).toThrow();
  });

  it("invalid inputs never enter presentable state", () => {
    // Verify that all invalid-input combinations throw rather than returning
    const invalids = [
      [{ lon: 999, lat: 0 }, 25],
      [{ lon: 0, lat: 999 }, 25],
      [{ lon: 0, lat: 0 }, 0],
      [{ lon: 0, lat: 0 }, 999],
      [null, 25],
    ];
    for (const [coord, r] of invalids) {
      expect(() => validateAndBuildArea(coord, r)).toThrow();
    }
  });

  it("fail closed: pole crossing rejects with ValidationError (not clamp)", () => {
    // Near north pole + large radius → box crosses 90°N → must throw, never clamp
    expect(() => validateAndBuildArea({ lon: 0, lat: 89 }, 250)).toThrow();
    expect(() => validateAndBuildArea({ lon: 0, lat: -89 }, 250)).toThrow();
  });

  it("fail closed: antimeridian crossing rejects with ValidationError (not clamp)", () => {
    // Near ±180° longitude + large radius → must throw, never clamp
    expect(() => validateAndBuildArea({ lon: -179, lat: 0 }, 250)).toThrow();
    expect(() => validateAndBuildArea({ lon: 179, lat: 0 }, 250)).toThrow();
  });

  it("accepted area preserves exact requested radius", () => {
    // A valid area must NOT shrink the radius; radius matches exactly
    const a = validateAndBuildArea({ lon: -95.5, lat: 29.5 }, 50);
    expect(a.radiusKm).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// validateAndBuildTimeSelection
// ---------------------------------------------------------------------------

describe("validateAndBuildTimeSelection", () => {
  it("builds latest selection", () => {
    const t = validateAndBuildTimeSelection("latest");
    expect(t.type).toBe("latest");
    expect(t.startTs).toBeUndefined();
    expect(t.endTs).toBeUndefined();
  });

  it("builds past_24h selection", () => {
    const t = validateAndBuildTimeSelection("past_24h");
    expect(t.type).toBe("past_24h");
  });

  it("builds past_7d selection", () => {
    const t = validateAndBuildTimeSelection("past_7d");
    expect(t.type).toBe("past_7d");
  });

  it("builds past_30d selection", () => {
    const t = validateAndBuildTimeSelection("past_30d");
    expect(t.type).toBe("past_30d");
  });

  it("builds custom selection with valid timestamps", () => {
    const t = validateAndBuildTimeSelection(
      "custom",
      "2026-07-01T00:00:00Z",
      "2026-07-31T23:59:59Z"
    );
    expect(t.type).toBe("custom");
    expect(t.startTs).toBe("2026-07-01T00:00:00Z");
    expect(t.endTs).toBe("2026-07-31T23:59:59Z");
  });

  it("accepts start === end for custom", () => {
    const t = validateAndBuildTimeSelection(
      "custom",
      "2026-07-01T00:00:00Z",
      "2026-07-01T00:00:00Z"
    );
    expect(t.startTs).toBe(t.endTs);
  });

  it("injects coverage limitation for every type", () => {
    for (const type of ["latest", "past_24h", "past_7d", "past_30d"] as const) {
      const t = validateAndBuildTimeSelection(type);
      expect(t.coverageLimitation).toBe(TIME_COVERAGE_LIMITATION);
    }
    const ct = validateAndBuildTimeSelection(
      "custom",
      "2026-07-01T00:00:00Z",
      "2026-07-31T00:00:00Z"
    );
    expect(ct.coverageLimitation).toBe(TIME_COVERAGE_LIMITATION);
  });

  it("throws on invalid type", () => {
    expect(() => validateAndBuildTimeSelection("weekly")).toThrow();
    expect(() => validateAndBuildTimeSelection("")).toThrow();
    expect(() => validateAndBuildTimeSelection(null)).toThrow();
    expect(() => validateAndBuildTimeSelection(42)).toThrow();
  });

  it("throws on custom type missing startTs", () => {
    expect(() => validateAndBuildTimeSelection("custom")).toThrow();
    expect(() => validateAndBuildTimeSelection("custom", undefined, "2026-07-31T00:00:00Z")).toThrow();
  });

  it("throws on custom type with start > end", () => {
    expect(() =>
      validateAndBuildTimeSelection(
        "custom",
        "2026-07-31T23:59:59Z",
        "2026-07-01T00:00:00Z"
      )
    ).toThrow();
  });

  it("throws on custom type with invalid ISO-8601 timestamps", () => {
    expect(() =>
      validateAndBuildTimeSelection("custom", "not-a-date", "2026-07-01T00:00:00Z")
    ).toThrow();
    expect(() =>
      validateAndBuildTimeSelection("custom", "2026-07-01T00:00:00Z", "not-a-date")
    ).toThrow();
  });

  it("throws when startTs provided for non-custom type", () => {
    expect(() =>
      validateAndBuildTimeSelection("latest", "2026-07-01T00:00:00Z")
    ).toThrow();
  });
});
