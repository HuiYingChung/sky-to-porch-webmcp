import { describe, expect, it, vi } from "vitest";
import { validateObservation } from "@/contracts/evidence";
import {
  NWS_LSR_RETENTION_DAYS,
  queryNwsLocalStormReports,
} from "@/lib/storm/nws-lsr-live-adapter";

const NOW = new Date("2026-08-29T18:00:00.000Z");
const HOUSTON_AREA = {
  west: -95.8851,
  south: 29.3097,
  east: -94.8503,
  north: 30.2081,
};
const PRODUCT_ID = "0db5fc44-5569-4343-9774-9a371bc1593e";

function response(value: unknown, contentType = "application/ld+json", status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": contentType },
  });
}

function productText(): string {
  return [
    "PRELIMINARY LOCAL STORM REPORT",
    "NATIONAL WEATHER SERVICE HOUSTON/GALVESTON TX",
    "0600 PM     FLASH FLOOD      8 N JERSEY VILLAGE     30.00N 95.54W",
    "08/28/2026  HARRIS             TX   LAW ENFORCEMENT",
    "",
    "MULTIPLE VEHICLES STRANDED.",
    "",
    "&&",
  ].join("\n");
}

function mockFetch(options: { status?: number; productText?: string } = {}): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (options.status) return response({ status: options.status }, "application/ld+json", options.status);
    if (url.pathname.startsWith("/points/")) {
      return response({ properties: { gridId: "HGX" } }, "application/geo+json");
    }
    if (url.pathname === "/products/types/LSR/locations/HGX") {
      return response({
        "@graph": [{
          id: PRODUCT_ID,
          productCode: "LSR",
          issuanceTime: "2026-08-28T19:58:00-05:00",
          issuingOffice: "KHGX",
        }],
      });
    }
    if (url.pathname === `/products/${PRODUCT_ID}`) {
      return response({
        id: PRODUCT_ID,
        productCode: "LSR",
        issuanceTime: "2026-08-28T19:58:00-05:00",
        productText: options.productText ?? productText(),
      });
    }
    throw new Error(`Unexpected URL: ${url.toString()}`);
  }) as unknown as typeof fetch;
}

describe("NWS Preliminary Local Storm Report adapter", () => {
  it("returns the official Houston flash-flood report for the Flood chain", async () => {
    const fetchImpl = mockFetch();
    const result = await queryNwsLocalStormReports(
      HOUSTON_AREA,
      "2026-08-28",
      "2026-08-28",
      "flood_storm",
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    expect(result.officeIds).toEqual(["HGX"]);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      variableName: "NWS Local Storm Report: Flash flood",
      textValue: expect.stringContaining("MULTIPLE VEHICLES STRANDED"),
      provenance: {
        sourceId: "nws_local_storm_reports",
        observedAt: "2026-08-28T23:00:00.000Z",
        product: "NWS HGX Preliminary Local Storm Report",
      },
      metadata: {
        eventType: "Flash flood",
        county: "HARRIS",
        state: "TX",
        reportSource: "LAW ENFORCEMENT",
        latitude: 30,
        longitude: -95.54,
        preliminary: true,
      },
    });
    expect(() => validateObservation(result.observations[0])).not.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(7);
  });

  it("keeps water reports out of the Wind chain", async () => {
    await expect(queryNwsLocalStormReports(
      HOUSTON_AREA,
      "2026-08-28",
      "2026-08-28",
      "wind_storm",
      { fetchImpl: mockFetch(), now: () => NOW }
    )).resolves.toMatchObject({ kind: "no_observation", officeIds: ["HGX"] });
  });

  it("never imports a report whose coordinate is outside the selected geometry", async () => {
    const smallArea = { west: -95.4, south: 29.6, east: -95.2, north: 29.8 };
    await expect(queryNwsLocalStormReports(
      smallArea,
      "2026-08-28",
      "2026-08-28",
      "flood_storm",
      { fetchImpl: mockFetch(), now: () => NOW }
    )).resolves.toMatchObject({ kind: "no_observation" });
  });

  it("does not contact the recent-only index for older dates", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(queryNwsLocalStormReports(
      HOUSTON_AREA,
      "2026-08-01",
      "2026-08-01",
      "flood_storm",
      { fetchImpl, now: () => NOW }
    )).resolves.toEqual({ kind: "not_applicable", reason: "outside_recent_index" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(NWS_LSR_RETENTION_DAYS).toBe(7);
  });

  it("distinguishes provider failure from no observation", async () => {
    await expect(queryNwsLocalStormReports(
      HOUSTON_AREA,
      "2026-08-28",
      "2026-08-28",
      "flood_storm",
      { fetchImpl: mockFetch({ status: 503 }), now: () => NOW }
    )).resolves.toEqual({
      kind: "source_failure",
      reason: "provider_failure",
      stage: "office_lookup",
    });
  });
});
