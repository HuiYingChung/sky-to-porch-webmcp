import { describe, it, expect } from "vitest";
import { CURRENT_STAGE } from "@/lib/foundation";

/**
 * Integration test: health-check API route response contract.
 *
 * Uses the exported handler directly — no server is started.
 * This confirms the contract shape for WP-05-004.
 *
 * WP-05-004: liveData=true because the optional server-side historical NOAA
 * HMS live-retrieval capability is now implemented. This means the capability
 * exists, not that NOAA is currently available or that the observation is
 * current.
 */
describe("GET /api/health", () => {
  it("returns expected shape with liveData=true and ai=false", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const body = await response.json();

    expect(body.status).toBe("ok");
    expect(body.service).toBe("sky-to-porch");
    // WP-05-004: liveData=true — optional HMS live-retrieval capability present.
    // This means the capability exists, not that NOAA is currently available.
    expect(body.liveData).toBe(true);
    expect(body.ai).toBe(false);
    // The stage is emitted from the single CURRENT_STAGE constant so the
    // health response can never drift from the declared product stage.
    expect(body.stage).toBe(CURRENT_STAGE);
    expect(body.stage.length).toBeGreaterThan(0);
    // liveDataNote must be present and truthful about the historical nature.
    expect(typeof body.liveDataNote).toBe("string");
    expect(body.liveDataNote.toLowerCase()).toContain("historical");
    expect(body.liveTimeOptions).toEqual([
      "latest_completed_day",
      "past_7d",
      "custom_1_to_7_utc_days",
    ]);
    expect(body.liveCommonStartDate).toBe("2005-08-05");
    expect(body.liveMaxRangeDays).toBe(7);
    expect(body.liveDataNote).toContain("1–7 UTC dates");
  });
});
