/**
 * src/__tests__/unit/wp06-intent-parser.test.ts
 *
 * WP-06 targeted unit tests for intent-parser.ts.
 *
 * Proves:
 * 1. valid IBM/OpenAI candidate becomes a validated Intent with deterministic
 *    place, time, ID, source allowlist, and no model-supplied coordinate/URL;
 * 2. unregistered/wrong-hazard sources, extra keys, unsupported routes,
 *    invalid custom dates, future/incomplete dates, and prompt-injection-shaped
 *    unsafe output fail closed.
 *
 * No network requests are made. No real credentials are used.
 */

import { describe, expect, it } from "vitest";
import {
  validateModelCandidate,
  parseModelOutput,
  assembleIntent,
} from "@/lib/ai/intent-parser";
import type { ModelCandidate } from "@/lib/ai/intent-parser";
import { ValidationError } from "@/contracts/common";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validParsedCandidate(overrides: Partial<ModelCandidate> = {}): ModelCandidate {
  return {
    status: "parsed",
    placeId: "demo-los-angeles",
    hazardId: "fire_smoke",
    timeRange: { type: "latest" },
    concern: "home",
    sourceIds: ["noaa_hms_fire_points", "noaa_hms_smoke_polygons"],
    reasonCode: null,
    ...overrides,
  };
}

function validUnsupportedCandidate(overrides: Partial<ModelCandidate> = {}): ModelCandidate {
  return {
    status: "unsupported",
    placeId: null,
    hazardId: null,
    timeRange: null,
    concern: null,
    sourceIds: [],
    reasonCode: "unsupported_place",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateModelCandidate — parsed success paths
// ---------------------------------------------------------------------------

describe("validateModelCandidate — parsed success", () => {
  it("accepts a fully valid parsed candidate (latest)", () => {
    expect(() => validateModelCandidate(validParsedCandidate())).not.toThrow();
  });

  it("accepts past_7d time range", () => {
    expect(() =>
      validateModelCandidate(validParsedCandidate({ timeRange: { type: "past_7d" } }))
    ).not.toThrow();
  });

  it("accepts a valid custom time range", () => {
    expect(() =>
      validateModelCandidate(
        validParsedCandidate({
          timeRange: {
            type: "custom",
            startTs: "2025-01-01T00:00:00Z",
            endTs: "2025-01-07T00:00:00Z",
          },
        })
      )
    ).not.toThrow();
  });

  it("accepts Lake Michigan place", () => {
    expect(() =>
      validateModelCandidate(validParsedCandidate({ placeId: "demo-lake-michigan" }))
    ).not.toThrow();
  });

  it("accepts all concern types", () => {
    for (const concern of ["home", "health", "pets", "travel", "power_internet", "community"] as const) {
      expect(() => validateModelCandidate(validParsedCandidate({ concern }))).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// validateModelCandidate — parsed failure paths
// ---------------------------------------------------------------------------

describe("validateModelCandidate — parsed failures", () => {
  it("rejects extra keys in parsed candidate", () => {
    const c = { ...validParsedCandidate(), extraField: "evil" };
    expect(() => validateModelCandidate(c)).toThrow(ValidationError);
  });

  it("rejects missing key in parsed candidate", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { sourceIds: _omit, ...c } = validParsedCandidate() as unknown as Record<
      string,
      unknown
    >;
    expect(() => validateModelCandidate(c)).toThrow(ValidationError);
  });

  it("rejects null placeId in parsed status", () => {
    expect(() => validateModelCandidate(validParsedCandidate({ placeId: null }))).toThrow(ValidationError);
  });

  it("rejects null hazardId in parsed status", () => {
    expect(() =>
      validateModelCandidate(validParsedCandidate({ hazardId: null as unknown as "fire_smoke" }))
    ).toThrow(ValidationError);
  });

  it("rejects null timeRange in parsed status", () => {
    expect(() => validateModelCandidate(validParsedCandidate({ timeRange: null }))).toThrow(ValidationError);
  });

  it("rejects null concern in parsed status", () => {
    expect(() =>
      validateModelCandidate(validParsedCandidate({ concern: null as unknown as "home" }))
    ).toThrow(ValidationError);
  });

  it("rejects empty sourceIds in parsed status", () => {
    expect(() => validateModelCandidate(validParsedCandidate({ sourceIds: [] }))).toThrow(ValidationError);
  });

  it("rejects non-null reasonCode in parsed status", () => {
    expect(() =>
      validateModelCandidate(
        validParsedCandidate({ reasonCode: "unsupported_request" as unknown as null })
      )
    ).toThrow(ValidationError);
  });

  it("rejects unregistered source ID", () => {
    expect(() =>
      validateModelCandidate(
        validParsedCandidate({ sourceIds: ["evil_unregistered_source" as never] })
      )
    ).toThrow(ValidationError);
  });

  it("rejects source wrong hazard (usgs_earthquake_geojson for fire_smoke)", () => {
    expect(() =>
      validateModelCandidate(
        validParsedCandidate({ sourceIds: ["usgs_earthquake_geojson" as never] })
      )
    ).toThrow(ValidationError);
  });

  it("rejects source that is registered but not queryable (nasa_firms)", () => {
    expect(() =>
      validateModelCandidate(
        validParsedCandidate({ sourceIds: ["nasa_firms" as never] })
      )
    ).toThrow(ValidationError);
  });

  it("rejects unknown status value", () => {
    const c = { ...validParsedCandidate(), status: "maybe" as never };
    expect(() => validateModelCandidate(c)).toThrow(ValidationError);
  });

  it("rejects array input (not a plain object)", () => {
    expect(() => validateModelCandidate([])).toThrow(ValidationError);
  });

  it("rejects null input", () => {
    expect(() => validateModelCandidate(null)).toThrow(ValidationError);
  });

  it("rejects string input", () => {
    expect(() => validateModelCandidate("parsed")).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// validateModelCandidate — unsupported paths
// ---------------------------------------------------------------------------

describe("validateModelCandidate — unsupported", () => {
  it("accepts valid unsupported candidate", () => {
    expect(() => validateModelCandidate(validUnsupportedCandidate())).not.toThrow();
  });

  it("accepts all valid reasonCodes", () => {
    for (const reasonCode of [
      "unsupported_place",
      "unsupported_hazard",
      "unsupported_time",
      "unsupported_request",
      "unsafe_request",
    ] as const) {
      expect(() => validateModelCandidate(validUnsupportedCandidate({ reasonCode }))).not.toThrow();
    }
  });

  it("rejects non-null placeId in unsupported status", () => {
    expect(() =>
      validateModelCandidate(validUnsupportedCandidate({ placeId: "demo-los-angeles" }))
    ).toThrow(ValidationError);
  });

  it("rejects non-empty sourceIds in unsupported status", () => {
    expect(() =>
      validateModelCandidate(
        validUnsupportedCandidate({
          sourceIds: ["noaa_hms_fire_points" as never],
        })
      )
    ).toThrow(ValidationError);
  });

  it("rejects null reasonCode in unsupported status", () => {
    expect(() =>
      validateModelCandidate(validUnsupportedCandidate({ reasonCode: null }))
    ).toThrow(ValidationError);
  });

  it("rejects invalid reasonCode string", () => {
    expect(() =>
      validateModelCandidate(validUnsupportedCandidate({ reasonCode: "invalid_reason" as never }))
    ).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// parseModelOutput
// ---------------------------------------------------------------------------

describe("parseModelOutput", () => {
  it("parses valid JSON into a ModelCandidate", () => {
    const raw = JSON.stringify(validParsedCandidate());
    const result = parseModelOutput(raw);
    expect(result.status).toBe("parsed");
    expect(result.placeId).toBe("demo-los-angeles");
  });

  it("throws ValidationError on non-JSON", () => {
    expect(() => parseModelOutput("not json at all")).toThrow(ValidationError);
  });

  it("throws ValidationError on valid JSON but invalid candidate", () => {
    expect(() => parseModelOutput('{"status":"hacked"}')).toThrow(ValidationError);
  });

  it("throws ValidationError on prompt-injection-shaped output with extra url key", () => {
    const injected = {
      ...validParsedCandidate(),
      url: "https://evil.example/exfiltrate",
    };
    expect(() => parseModelOutput(JSON.stringify(injected))).toThrow(ValidationError);
  });

  it("throws ValidationError on prompt-injection with coordinate injection attempt", () => {
    const injected = {
      ...validParsedCandidate(),
      coordinate: { lon: 0, lat: 0 },
    };
    expect(() => parseModelOutput(JSON.stringify(injected))).toThrow(ValidationError);
  });

  it("throws ValidationError on unsafe_request reasonCode while status=parsed", () => {
    const c = {
      ...validParsedCandidate(),
      reasonCode: "unsafe_request",
    };
    expect(() => parseModelOutput(JSON.stringify(c))).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// assembleIntent — success paths
// ---------------------------------------------------------------------------

describe("assembleIntent — success", () => {
  it("produces an Intent with deterministic place data from the registry (not model)", () => {
    const candidate = validParsedCandidate() as ModelCandidate & { status: "parsed" };
    const intent = assembleIntent(candidate, "Are there fires near LA?");
    expect(intent.place.label).toBe("Los Angeles area (demo)");
    // Coordinates come from DEMO_PLACES, not the model
    expect(intent.place.coordinate.lon).toBe(-118); // (-119 + -117) / 2
    expect(intent.place.coordinate.lat).toBe(34);   // (33 + 35) / 2
    expect(intent.place.boundingBox).toEqual({ west: -119, south: 33, east: -117, north: 35 });
  });

  it("assigns a non-empty UUID as intentId (not from model)", () => {
    const candidate = validParsedCandidate() as ModelCandidate & { status: "parsed" };
    const intent = assembleIntent(candidate, "fire near LA");
    expect(intent.intentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("assigns a fresh ISO-8601 createdAt (not from model)", () => {
    const candidate = validParsedCandidate() as ModelCandidate & { status: "parsed" };
    const intent = assembleIntent(candidate, "fire near LA");
    const ts = Date.parse(intent.createdAt);
    expect(Number.isFinite(ts)).toBe(true);
  });

  it("copies rawQuestion into optionalQuestion", () => {
    const candidate = validParsedCandidate() as ModelCandidate & { status: "parsed" };
    const intent = assembleIntent(candidate, "Are there active fires near Los Angeles?");
    expect(intent.optionalQuestion).toBe("Are there active fires near Los Angeles?");
  });

  it("produces Lake Michigan intent correctly", () => {
    const candidate = validParsedCandidate({
      placeId: "demo-lake-michigan",
    }) as ModelCandidate & { status: "parsed" };
    const intent = assembleIntent(candidate, "smoke over lake michigan");
    expect(intent.place.label).toBe("Lake Michigan box (demo — fire no-observation)");
    expect(intent.place.coordinate.lon).toBeCloseTo(-86.95);
    expect(intent.place.coordinate.lat).toBeCloseTo(43.05);
  });

  it("produces intent with past_7d timeRange", () => {
    const candidate = validParsedCandidate({
      timeRange: { type: "past_7d" },
    }) as ModelCandidate & { status: "parsed" };
    const intent = assembleIntent(candidate, "week of fire");
    expect(intent.timeRange.type).toBe("past_7d");
  });

  it("produces intent with valid 5-day custom time range", () => {
    const candidate = validParsedCandidate({
      timeRange: {
        type: "custom",
        startTs: "2025-01-01T00:00:00Z",
        endTs: "2025-01-05T23:59:59Z",
      },
    }) as ModelCandidate & { status: "parsed" };
    const intent = assembleIntent(candidate, "custom range fire query");
    expect(intent.timeRange.type).toBe("custom");
  });

  it("produces intent with exact 1-day custom range (pass)", () => {
    const candidate = validParsedCandidate({
      timeRange: {
        type: "custom",
        startTs: "2025-06-01T00:00:00Z",
        endTs: "2025-06-01T23:59:59Z",
      },
    }) as ModelCandidate & { status: "parsed" };
    const intent = assembleIntent(candidate, "one day fire query");
    expect(intent.timeRange.type).toBe("custom");
  });

  it("produces intent with exact 7-day custom range (pass)", () => {
    const candidate = validParsedCandidate({
      timeRange: {
        type: "custom",
        startTs: "2025-06-01T00:00:00Z",
        endTs: "2025-06-07T23:59:59Z",
      },
    }) as ModelCandidate & { status: "parsed" };
    const intent = assembleIntent(candidate, "seven day fire query");
    expect(intent.timeRange.type).toBe("custom");
  });
});

// ---------------------------------------------------------------------------
// assembleIntent — failure paths
// ---------------------------------------------------------------------------

describe("assembleIntent — failures", () => {
  it("rejects Houston place (not in parsed-capable allowlist this round)", () => {
    const candidate = validParsedCandidate({
      placeId: "demo-houston",
    }) as ModelCandidate & { status: "parsed" };
    expect(() => assembleIntent(candidate, "fire near houston")).toThrow(ValidationError);
  });

  it("rejects demo-source-failure test fixture", () => {
    const candidate = validParsedCandidate({
      placeId: "demo-source-failure",
    }) as ModelCandidate & { status: "parsed" };
    expect(() => assembleIntent(candidate, "fire test")).toThrow(ValidationError);
  });

  it("rejects custom startTs before 2005-08-05", () => {
    const candidate = validParsedCandidate({
      timeRange: {
        type: "custom",
        startTs: "2005-08-04T00:00:00Z",
        endTs: "2005-08-05T23:59:59Z",
      },
    }) as ModelCandidate & { status: "parsed" };
    expect(() => assembleIntent(candidate, "old fires")).toThrow(ValidationError);
  });

  it("rejects custom range > 7 days", () => {
    const candidate = validParsedCandidate({
      timeRange: {
        type: "custom",
        startTs: "2025-01-01T00:00:00Z",
        endTs: "2025-01-10T23:59:59Z",
      },
    }) as ModelCandidate & { status: "parsed" };
    expect(() => assembleIntent(candidate, "long range fires")).toThrow(ValidationError);
  });

  it("rejects an exact 8-day custom range", () => {
    const candidate = validParsedCandidate({
      timeRange: {
        type: "custom",
        startTs: "2025-06-01T00:00:00Z",
        endTs: "2025-06-08T23:59:59Z",
      },
    }) as ModelCandidate & { status: "parsed" };
    expect(() => assembleIntent(candidate, "eight day fires")).toThrow(ValidationError);
  });

  it("rejects a reversed custom range", () => {
    const candidate = validParsedCandidate({
      timeRange: {
        type: "custom",
        startTs: "2025-06-07T00:00:00Z",
        endTs: "2025-06-01T23:59:59Z",
      },
    }) as ModelCandidate & { status: "parsed" };
    expect(() => assembleIntent(candidate, "reversed range")).toThrow(ValidationError);
  });

  it("rejects partial-day custom timestamps", () => {
    const partialStart = validParsedCandidate({
      timeRange: {
        type: "custom",
        startTs: "2025-06-01T00:00:01Z",
        endTs: "2025-06-02T23:59:59Z",
      },
    }) as ModelCandidate & { status: "parsed" };
    const partialEnd = validParsedCandidate({
      timeRange: {
        type: "custom",
        startTs: "2025-06-01T00:00:00Z",
        endTs: "2025-06-02T23:59:58Z",
      },
    }) as ModelCandidate & { status: "parsed" };

    expect(() => assembleIntent(partialStart, "partial start")).toThrow(ValidationError);
    expect(() => assembleIntent(partialEnd, "partial end")).toThrow(ValidationError);
  });

  it("rejects impossible calendar dates instead of Date.UTC normalization", () => {
    const candidate = validParsedCandidate({
      timeRange: {
        type: "custom",
        startTs: "2025-02-30T00:00:00Z",
        endTs: "2025-03-01T23:59:59Z",
      },
    }) as ModelCandidate & { status: "parsed" };
    expect(() => assembleIntent(candidate, "invalid date")).toThrow(ValidationError);
  });

  it("rejects custom endTs that is today or in the future", () => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const candidate = validParsedCandidate({
      timeRange: {
        type: "custom",
        startTs: `${todayStr}T00:00:00Z`,
        endTs: `${todayStr}T23:59:59Z`,
      },
    }) as ModelCandidate & { status: "parsed" };
    expect(() => assembleIntent(candidate, "today fires")).toThrow(ValidationError);
  });

  it("rejects a custom range ending on a future UTC day", () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const candidate = validParsedCandidate({
      timeRange: {
        type: "custom",
        startTs: `${tomorrow}T00:00:00Z`,
        endTs: `${tomorrow}T23:59:59Z`,
      },
    }) as ModelCandidate & { status: "parsed" };
    expect(() => assembleIntent(candidate, "future fires")).toThrow(ValidationError);
  });

  it("does not include model-supplied intentId (re-assigns)", () => {
    const candidate = validParsedCandidate() as ModelCandidate & { status: "parsed" };
    // If model somehow injected an intentId it would be stripped
    // assembleIntent always calls randomUUID()
    const intent1 = assembleIntent(candidate, "q1");
    const intent2 = assembleIntent(candidate, "q2");
    expect(intent1.intentId).not.toBe(intent2.intentId);
  });
});
