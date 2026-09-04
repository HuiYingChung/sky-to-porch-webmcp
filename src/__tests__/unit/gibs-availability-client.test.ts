import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoundingBox } from "@/contracts/common";
import {
  GIBS_AVAILABILITY_CLIENT_CACHE_TTL_MS,
  clearGibsAvailabilityClientStateForTests,
  loadGibsAvailability,
} from "@/lib/map/gibs-availability-client";

const AREA: BoundingBox = {
  west: -96,
  south: 29,
  east: -95,
  north: 30,
};

function availabilityResponse(visiblePixelsDetected: boolean): Response {
  return new Response(JSON.stringify({
    ok: true,
    result: { visiblePixelsDetected },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  clearGibsAvailabilityClientStateForTests();
});

describe("GIBS availability browser client cache", () => {
  it("reuses a successful check only within the bounded client TTL", async () => {
    let clock = 1_000;
    const fetchImpl = vi.fn(async () => availabilityResponse(false));

    await expect(loadGibsAvailability(
      "rain",
      "2026-08-25",
      AREA,
      fetchImpl as typeof fetch,
      () => clock
    )).resolves.toEqual({ ok: true, visiblePixelsDetected: false });

    clock += GIBS_AVAILABILITY_CLIENT_CACHE_TTL_MS;
    await expect(loadGibsAvailability(
      "rain",
      "2026-08-25",
      AREA,
      fetchImpl as typeof fetch,
      () => clock
    )).resolves.toEqual({ ok: true, visiblePixelsDetected: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("expires a no-visible-pixels result and refetches current availability", async () => {
    let clock = 10_000;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(availabilityResponse(false))
      .mockResolvedValueOnce(availabilityResponse(true));

    const first = await loadGibsAvailability(
      "rain",
      "2026-08-25",
      AREA,
      fetchImpl as typeof fetch,
      () => clock
    );
    clock += GIBS_AVAILABILITY_CLIENT_CACHE_TTL_MS + 1;
    const refreshed = await loadGibsAvailability(
      "rain",
      "2026-08-25",
      AREA,
      fetchImpl as typeof fetch,
      () => clock
    );

    expect(first).toEqual({ ok: true, visiblePixelsDetected: false });
    expect(refreshed).toEqual({ ok: true, visiblePixelsDetected: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
