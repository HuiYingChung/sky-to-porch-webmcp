import { describe, expect, it, vi } from "vitest";
import { executeAnalysisRequest } from "@/lib/analysis/client";
import { buildGeocodedPlaceSelection } from "@/lib/location/selection";

const placeSelection = buildGeocodedPlaceSelection(
  "Hawaiʻi Volcanoes National Park",
  { lon: -155.2885, lat: 19.4194 },
  100,
  "custom",
  "2024-12-23T00:00:00.000Z",
  "2024-12-23T23:59:59.999Z"
);

describe("coverage-gap analysis client failure state", () => {
  it.each(["air_quality", "earth_volcanoes"] as const)(
    "records that the %s route was attempted when it fails",
    async (hazardId) => {
      const fetchImpl = vi.fn(async () => Response.json(
        { ok: false, error: "validation_failed" },
        { status: 500 }
      )) as unknown as typeof fetch;

      const outcome = await executeAnalysisRequest(
        {
          hazardId,
          concern: "general",
          placeSelection,
        },
        { fetchImpl }
      );

      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(outcome.result).toMatchObject({
        kind: "source_failure",
        retrievalAttempted: true,
        meaning: {
          summary: "The check failed. No older or unrelated information was substituted.",
        },
      });
    }
  );
});
