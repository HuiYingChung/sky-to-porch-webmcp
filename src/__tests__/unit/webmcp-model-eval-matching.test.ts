import { describe, expect, it } from "vitest";
import {
  exactEvalCallMatch,
  exactEvalValueMatch,
} from "../../../scripts/webmcp-model-eval-matching";

describe("WebMCP model-eval exact matching", () => {
  it("rejects extra keys nested inside map-layer arguments", () => {
    const expected = {
      layers: { rain_satellite: true },
      place: "Houston",
      date: "2024-07-08",
      radius_km: 50,
    };
    const actual = {
      ...expected,
      layers: {
        rain_satellite: true,
        surface_heat_satellite: true,
      },
    };

    expect(exactEvalValueMatch(actual, expected)).toBe(false);
    expect(exactEvalValueMatch(expected, expected)).toBe(true);

    expect(exactEvalCallMatch(
      { functionName: "set_environmental_map_layers", arguments: actual },
      { functionName: "set_environmental_map_layers", arguments: expected }
    )).toBe(false);
  });
});
