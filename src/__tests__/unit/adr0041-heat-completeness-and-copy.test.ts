/**
 * ADR-0041: unified 18-distinct-hour ground-confirmation rule for USCRN
 * (aligned with the ADR-0038 NWS and ADR-0039 GHCNh rules) and honest
 * unsupported-coverage wording for recent transparent GIBS dates. Every
 * transport is mocked; no network request is made.
 */

import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { validateEvidenceObject } from "@/contracts/evidence";
import { deterministicPlainSummary } from "@/lib/ai/evidence-explainer";
import type { EvidenceEvaluationResult } from "@/lib/evidence/evaluator";
import {
  GIBS_RECENT_PUBLICATION_WINDOW_DAYS,
  USCRN_MIN_DISTINCT_HOURS,
  queryLiveHeatEvidence,
} from "@/lib/heat/live-adapter";
import { HEAT_GIBS_UNPUBLISHED_LIMITATION_ID } from "@/lib/heat/types";
import { CUSTOM_AREA_PLACE_ID } from "@/lib/location/query-area";

const NOW = new Date("2026-08-12T05:00:00Z");
// Contains the Tucson USCRN station coordinate (lon -111.17, lat 32.24).
const AREA_WITH_STATION = { west: -111.27, south: 32.14, east: -111.07, north: 32.34 };
const DISTANT_DATE = "2024-07-11";
// 2.2 days before NOW — inside the recent GIBS publication window.
const RECENT_DATE = "2026-08-10";

const PARTIAL_DAY_LIMITATION_ID = "lim-adr0041-uscrn-partial-day";

async function tile(alpha = 255): Promise<Buffer> {
  return sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 180, g: 90, b: 30, alpha: alpha / 255 },
    },
  }).png().toBuffer();
}

function csv(date: string, rows: number): string {
  const compact = date.replaceAll("-", "");
  const header = [
    "WBANNO",
    "DATE_TIME",
    "LONGITUDE",
    "LATITUDE",
    "RELATIVE_HUMIDITY",
    "DRY_BULB_TEMPERATURE_C",
    "HEAT_INDEX_C",
  ].join(",");
  const lines = Array.from({ length: rows }, (_, hour) =>
    [
      "53131",
      `${compact}${String(hour).padStart(2, "0")}`,
      "-111.17",
      "32.24",
      11 + hour,
      30 + hour / 10,
      25 + hour / 10,
    ].join(",")
  );
  return [header, ...lines].join("\n");
}

function mockFetch(png: Buffer, csvBody: string): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === "gibs.earthdata.nasa.gov") {
      return new Response(new Uint8Array(png), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    if (url.hostname === "www.ncei.noaa.gov") {
      return new Response(csvBody, {
        status: 200,
        headers: { "content-type": "text/csv" },
      });
    }
    throw new Error(`Unexpected URL: ${url.toString()}`);
  }) as unknown as typeof fetch;
}

async function query(date: string, png: Buffer, csvBody: string) {
  return queryLiveHeatEvidence(
    { placeId: CUSTOM_AREA_PLACE_ID, date, mode: "live", area: AREA_WITH_STATION },
    { fetchImpl: mockFetch(png, csvBody), now: () => NOW }
  );
}

function limitationIds(result: Awaited<ReturnType<typeof queryLiveHeatEvidence>>): string[] {
  return (result.evidence?.limitations ?? []).map((limitation) => limitation.limitationId);
}

describe("ADR-0041 USCRN 18-distinct-hour ground confirmation", () => {
  it("shares the NWS/GHCNh threshold value", () => {
    expect(USCRN_MIN_DISTINCT_HOURS).toBe(18);
  });

  it("keeps a complete 24-hour day confirmed with no partial-day limitation", async () => {
    const result = await query(DISTANT_DATE, await tile(), csv(DISTANT_DATE, 24));
    expect(result.kind).toBe("success");
    expect(result.evidence?.evidenceState).toBe("observations_returned");
    expect(limitationIds(result)).not.toContain(PARTIAL_DAY_LIMITATION_ID);
    validateEvidenceObject(result.evidence);
  });

  it("confirms a 20-hour day but states the shortfall as a required limitation", async () => {
    const result = await query(DISTANT_DATE, await tile(), csv(DISTANT_DATE, 20));
    expect(result.kind).toBe("success");
    expect(result.evidence?.evidenceState).toBe("observations_returned");
    const partial = result.evidence?.limitations.find(
      (limitation) => limitation.limitationId === PARTIAL_DAY_LIMITATION_ID
    );
    expect(partial).toBeDefined();
    expect(partial?.required).toBe(true);
    expect(partial?.description).toContain("20 of 24");
    expect(partial?.description).toMatch(/missing evidence/i);
    validateEvidenceObject(result.evidence);
  });

  it("confirms exactly at the 18-hour boundary", async () => {
    const result = await query(
      DISTANT_DATE,
      await tile(),
      csv(DISTANT_DATE, USCRN_MIN_DISTINCT_HOURS)
    );
    expect(result.kind).toBe("success");
    expect(limitationIds(result)).toContain(PARTIAL_DAY_LIMITATION_ID);
  });

  it("stays inconclusive below 18 hours and still states the shortfall", async () => {
    const result = await query(DISTANT_DATE, await tile(), csv(DISTANT_DATE, 17));
    expect(result.kind).toBe("inconclusive_evidence");
    expect(result.evidence?.evidenceState).toBe("inconclusive_evidence");
    const partial = result.evidence?.limitations.find(
      (limitation) => limitation.limitationId === PARTIAL_DAY_LIMITATION_ID
    );
    expect(partial?.description).toContain("17 of 24");
    validateEvidenceObject(result.evidence);
  });
});

describe("ADR-0041 transparent-tile wording split by date recency", () => {
  it("marks a recent transparent date as possibly-unpublished imagery", async () => {
    expect(GIBS_RECENT_PUBLICATION_WINDOW_DAYS).toBe(3);
    const result = await query(RECENT_DATE, await tile(0), csv(RECENT_DATE, 24));
    expect(result.kind).toBe("unsupported_coverage");
    const unpublished = result.evidence?.limitations.find(
      (limitation) => limitation.limitationId === HEAT_GIBS_UNPUBLISHED_LIMITATION_ID
    );
    expect(unpublished).toBeDefined();
    expect(unpublished?.description).toMatch(/previous completed UTC day/i);
    expect(unpublished?.description).toMatch(/not evidence of no heat hazard/i);
    validateEvidenceObject(result.evidence);
  });

  it("keeps out-of-coverage semantics for a distant transparent date", async () => {
    const result = await query(DISTANT_DATE, await tile(0), csv(DISTANT_DATE, 24));
    expect(result.kind).toBe("unsupported_coverage");
    expect(limitationIds(result)).not.toContain(HEAT_GIBS_UNPUBLISHED_LIMITATION_ID);
  });
});

describe("ADR-0041 deterministic unsupported-coverage copy", () => {
  function unsupportedEvaluation(withUnpublishedMark: boolean): EvidenceEvaluationResult {
    return {
      evidence: {
        hazardId: "extreme_heat",
        evidenceState: "unsupported_coverage",
        observations: [],
        limitations: withUnpublishedMark
          ? [{
              limitationId: HEAT_GIBS_UNPUBLISHED_LIMITATION_ID,
              source: "nasa_gibs_modis_lst_day",
              description: "marker",
              required: true,
            }]
          : [],
      },
      conflicts: [],
      inferenceAllowed: false,
    } as unknown as EvidenceEvaluationResult;
  }

  it("suggests the previous day for a likely-unpublished recent date", () => {
    const summary = deterministicPlainSummary(unsupportedEvaluation(true), "travel");
    expect(summary).toMatch(/not be available yet|not published/i);
    expect(summary).toMatch(/previous completed day/i);
    expect(summary).toMatch(/not evidence of no hazard/i);
    expect(summary).not.toMatch(/do not cover this place or time/i);
    expect(summary.length).toBeLessThanOrEqual(700);
  });

  it("keeps the coverage-gap wording when no unpublished mark exists", () => {
    const summary = deterministicPlainSummary(unsupportedEvaluation(false), "travel");
    expect(summary).toMatch(/do not cover this place or time/i);
    expect(summary).toMatch(/coverage gap/i);
  });
});
