import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/storm/query/route";
import { validateEvidenceObject } from "@/contracts/evidence";
import type { StormQueryResult } from "@/lib/storm/types";

const AREA = { west: -96, south: 29, east: -95, north: 30 };
const STATION_ID = "USW00012960";
const STATION_LIST = [
  "GHCN_ID,LATITUDE,LONGITUDE,ELEVATION,STATE,NAME,ISO_CODE",
  `${STATION_ID},29.9844,-95.3608,27.4,TX,HOUSTON INTERCONTINENTAL AP,US`,
].join("\n");
const WIND_PSV = [
  "STATION|DATE|wind_direction|wind_direction_Quality_Code|wind_speed|wind_speed_Quality_Code|wind_gust|wind_gust_Quality_Code",
  `${STATION_ID}|2024-07-08T00:00:00|170|1|20.0|1|30.0|1`,
  `${STATION_ID}|2024-07-08T01:00:00|180|1|18.0|1|35.0|1`,
].join("\n");

function request(body: unknown): Request {
  return new Request("http://localhost/api/storm/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    return url.includes("ghcnh-station-list.csv")
      ? new Response(STATION_LIST, { status: 200, headers: { "Content-Type": "text/csv" } })
      : new Response(WIND_PSV, { status: 200, headers: { "Content-Type": "text/plain" } });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/storm/query", () => {
  it("returns a validated wind-only Beryl evidence chain and Home claim guide", async () => {
    const response = await POST(request({
      placeId: "custom-area",
      area: AREA,
      date: "2024-07-08",
      mode: "live",
      concern: "home",
      optionalQuestion: "Could this storm have damaged my roof?",
    }));
    const body = await response.json() as { ok: true; result: StormQueryResult };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result.kind).toBe("success");
    expect(body.result.evidence?.hazardId).toBe("wind_storm");
    expect(body.result.evidence?.observations.every((item) =>
      !/rain|precipitation|flood|gage/iu.test(item.variableName)
    )).toBe(true);
    expect(body.result.claimDiscussion).toBeDefined();
    expect(() => validateEvidenceObject(body.result.evidence)).not.toThrow();
  });

  it("does not create the insurer workflow for a non-Home concern", async () => {
    const response = await POST(request({
      placeId: "custom-area",
      area: AREA,
      date: "2024-07-08",
      mode: "live",
      concern: "travel",
    }));
    const body = await response.json() as { ok: true; result: StormQueryResult };

    expect(response.status).toBe(200);
    expect(body.result.claimDiscussion).toBeUndefined();
  });

  it("keeps a Houston 2026-08-28 station-date miss distinct from unsupported coverage", async () => {
    const recentPsv = [
      "STATION|DATE|wind_direction|wind_direction_Quality_Code|wind_speed|wind_speed_Quality_Code|wind_gust|wind_gust_Quality_Code",
      `${STATION_ID}|2026-08-27T23:30:00|170|1|8.0|1|12.0|1`,
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes("ghcnh-station-list.csv")
        ? new Response(STATION_LIST, { status: 200, headers: { "Content-Type": "text/csv" } })
        : new Response(recentPsv, { status: 200, headers: { "Content-Type": "text/plain" } });
    }));

    const response = await POST(request({
      placeId: "custom-area",
      area: AREA,
      date: "2026-08-28",
      mode: "live",
      concern: "general",
      optionalQuestion: "Was there a storm around Houston on August 28, 2026?",
    }));
    const body = await response.json() as { ok: true; result: StormQueryResult };

    expect(response.status).toBe(200);
    expect(body.result.kind).toBe("no_observation");
    expect(body.result.evidence?.evidenceState).toBe("no_observation");
    expect(body.result.explanation?.observed).not.toMatch(/outside validated source coverage/iu);
    expect(() => validateEvidenceObject(body.result.evidence)).not.toThrow();
  });

  it("rejects alternate modes and unknown fields before retrieval", async () => {
    const response = await POST(request({
      placeId: "custom-area",
      area: AREA,
      date: "2024-07-08",
      mode: "fixture",
      concern: "home",
      floodEvidence: true,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
