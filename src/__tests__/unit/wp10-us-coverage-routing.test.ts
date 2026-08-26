import { describe, expect, it } from "vitest";
import { CONCERN_TYPES } from "@/contracts/common";
import { DEMO_PLACES } from "@/data/places/wp04-demo-places";
import { US_COVERAGE_AREA_CASES } from "@/data/us-coverage-matrix";
import { selectFireAreaPrimarySource } from "@/lib/fire/live-adapter";
import {
  CUSTOM_AREA_PLACE_ID,
  areaContainsCoordinate,
  canonicalAreaQuery,
  canonicalAreaQueryForSelection,
  validateCanonicalAreaQuery,
  validateQueryArea,
} from "@/lib/location/query-area";
import {
  buildDemoPlaceSelection,
  buildGeocodedPlaceSelection,
  buildMapCoordinateSelection,
} from "@/lib/location/selection";

const START = "2024-07-08T00:00:00.000Z";
const END = "2024-07-08T23:59:59.999Z";

describe("deterministic U.S. area coverage routing", () => {
  it.each(US_COVERAGE_AREA_CASES)(
    "$region / $label validates and selects the geographically applicable fire primary",
    (coverageCase) => {
      expect(validateQueryArea(coverageCase.area)).toEqual(coverageCase.area);
      expect(canonicalAreaQuery(coverageCase.area)).toEqual({
        placeId: CUSTOM_AREA_PLACE_ID,
        area: coverageCase.area,
      });
      expect(selectFireAreaPrimarySource(coverageCase.area)).toBe(
        coverageCase.expectedFirePrimary
      );
    }
  );

  it("keeps source selection independent of all six concern meanings", () => {
    const area = US_COVERAGE_AREA_CASES.find((item) => item.id === "alaska-anchorage")!.area;
    const selected = CONCERN_TYPES.map(() => selectFireAreaPrimarySource(area));
    expect(new Set(selected)).toEqual(new Set(["noaa_hms"]));
  });

  it("uses the same atomic area for map-click and search selections", () => {
    const center = { lon: -104.99, lat: 39.74 };
    const mapSelection = buildMapCoordinateSelection(center, 25, "custom", START, END);
    const searchSelection = buildGeocodedPlaceSelection(
      "Denver, Colorado, United States",
      center,
      25,
      "custom",
      START,
      END
    );
    expect(canonicalAreaQueryForSelection(mapSelection)).toEqual(
      canonicalAreaQueryForSelection(searchSelection)
    );
  });

  it("converts a non-map demo selection to canonical area identity for live retrieval", () => {
    const demo = DEMO_PLACES.find((item) => item.id === "demo-houston")!;
    const selection = buildDemoPlaceSelection(demo, 25, "custom", START, END);
    const query = canonicalAreaQueryForSelection(selection);
    expect(query.placeId).toBe(CUSTOM_AREA_PLACE_ID);
    expect(query.area).toEqual(selection.analysisArea.boundingBox);
  });

  it("keeps the real selected location geometry authoritative for Tucson station coverage", () => {
    const station = { lon: -111.17, lat: 32.24 };
    const tucson = DEMO_PLACES.find((item) => item.id === "demo-tucson")!;
    const tucsonSelection = buildDemoPlaceSelection(tucson, 25, "custom", START, END);
    const tucsonQuery = canonicalAreaQueryForSelection(tucsonSelection);
    expect(tucsonQuery.area).toEqual(tucsonSelection.analysisArea.boundingBox);
    expect(areaContainsCoordinate(tucsonQuery.area, station)).toBe(true);

    const phoenixSelection = buildGeocodedPlaceSelection(
      "Phoenix, Arizona, United States",
      { lon: -112.074, lat: 33.4484 },
      25,
      "custom",
      START,
      END
    );
    const phoenixQuery = canonicalAreaQueryForSelection(phoenixSelection);
    expect(phoenixQuery.area).toEqual(phoenixSelection.analysisArea.boundingBox);
    expect(areaContainsCoordinate(phoenixQuery.area, station)).toBe(false);
  });

  it("rejects city/demo identities at the live route contract boundary", () => {
    const area = US_COVERAGE_AREA_CASES[0].area;
    expect(() => validateCanonicalAreaQuery("demo-houston", area)).toThrow(
      "canonical area identity"
    );
  });
});
