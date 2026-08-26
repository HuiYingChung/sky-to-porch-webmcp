/**
 * src/__tests__/integration/wp05-fire-modes.test.ts
 *
 * WP-05-004: Integration tests for live/fixture mode dispatch.
 *
 * These tests exercise the full mode path end-to-end through
 * queryLiveFireEvidence and queryFireEvidence, using injected mocked
 * network dependencies (no real NOAA requests).
 */

import { describe, it, expect } from "vitest";
import { queryLiveFireEvidence } from "@/lib/fire/live-adapter";
import { queryFireEvidence } from "@/lib/fire/fixture-adapter";
import { validateEvidenceObject, validateExplanation } from "@/contracts/evidence";
import { buildFireExplanation } from "@/lib/fire/explainer";
import { PINNED_FIXTURE_DATE } from "@/lib/fire/types";
import type { HmsLiveDependencies } from "@/lib/fire/live-adapter";

const PINNED_DATE = PINNED_FIXTURE_DATE;

function textEncoder(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

const LA_FIRE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark><Point><coordinates>-118.5,34.1,0</coordinates></Point></Placemark>
    <Placemark><Point><coordinates>-118.2,34.3,0</coordinates></Point></Placemark>
  </Document>
</kml>`;

const SMOKE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>-118.5,34.1,0 -118.4,34.2,0 -118.3,34.1,0 -118.5,34.1,0</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;

const EMPTY_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document></Document></kml>`;

function mockFetchSuccess(firePayload: string, smokePayload: string): HmsLiveDependencies["fetch"] {
  return (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
    const payload = urlStr.includes("Fire_Points") ? firePayload : smokePayload;
    const bytes = textEncoder(payload);
    const blob = new Blob([new Uint8Array(bytes) as unknown as BlobPart]);
    return Promise.resolve(new Response(blob, {
      status: 200,
      headers: { "Content-Type": "application/vnd.google-earth.kml+xml" },
    }));
  };
}

const FIXED_NOW = "2026-08-07T10:00:00.000Z";
function fixedNow() { return FIXED_NOW; }

// ---------------------------------------------------------------------------
// Mode separation: live vs fixture produce different dataMode values
// ---------------------------------------------------------------------------

describe("mode separation — live vs fixture produce distinct dataModes", () => {
  it("live mode returns dataMode=live", async () => {
    const deps: HmsLiveDependencies = {
      fetch: mockFetchSuccess(LA_FIRE_KML, SMOKE_KML),
      nowIso: fixedNow,
    };
    const result = await queryLiveFireEvidence(
      { placeId: "demo-los-angeles", date: PINNED_DATE, mode: "live" },
      deps,
    );
    expect(result.evidence?.dataMode).toBe("live");
  });

  it("fixture mode returns dataMode=fixture", () => {
    const result = queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_DATE, mode: "fixture" });
    expect(result.evidence?.dataMode).toBe("fixture");
  });

  it("live and fixture results are not confusable by dataMode", async () => {
    const deps: HmsLiveDependencies = {
      fetch: mockFetchSuccess(LA_FIRE_KML, SMOKE_KML),
      nowIso: fixedNow,
    };
    const liveResult = await queryLiveFireEvidence(
      { placeId: "demo-los-angeles", date: PINNED_DATE, mode: "live" },
      deps,
    );
    const fixtureResult = queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_DATE, mode: "fixture" });
    expect(liveResult.evidence?.dataMode).toBe("live");
    expect(fixtureResult.evidence?.dataMode).toBe("fixture");
    expect(liveResult.evidence?.dataMode).not.toBe(fixtureResult.evidence?.dataMode);
  });
});

// ---------------------------------------------------------------------------
// Validation: both paths produce schema-valid EvidenceObjects
// ---------------------------------------------------------------------------

describe("both modes produce validated EvidenceObjects", () => {
  it("live LA result passes validateEvidenceObject", async () => {
    const deps: HmsLiveDependencies = {
      fetch: mockFetchSuccess(LA_FIRE_KML, SMOKE_KML),
      nowIso: fixedNow,
    };
    const result = await queryLiveFireEvidence(
      { placeId: "demo-los-angeles", date: PINNED_DATE, mode: "live" },
      deps,
    );
    expect(() => validateEvidenceObject(result.evidence!)).not.toThrow();
  });

  it("live LA result produces a valid explanation", async () => {
    const deps: HmsLiveDependencies = {
      fetch: mockFetchSuccess(LA_FIRE_KML, SMOKE_KML),
      nowIso: fixedNow,
    };
    const result = await queryLiveFireEvidence(
      { placeId: "demo-los-angeles", date: PINNED_DATE, mode: "live" },
      deps,
    );
    const explanation = buildFireExplanation(result.evidence!);
    expect(() => validateExplanation(explanation)).not.toThrow();
  });

  it("fixture LA result passes validateEvidenceObject", () => {
    const result = queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_DATE, mode: "fixture" });
    expect(() => validateEvidenceObject(result.evidence!)).not.toThrow();
  });

  it("fixture LA result produces a valid explanation", () => {
    const result = queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_DATE, mode: "fixture" });
    const explanation = buildFireExplanation(result.evidence!);
    expect(() => validateExplanation(explanation)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Explainer: mode label in observed text
// ---------------------------------------------------------------------------

describe("explainer — mode-derived labels", () => {
  it("live result observed text contains LIVE RETRIEVAL", async () => {
    const deps: HmsLiveDependencies = {
      fetch: mockFetchSuccess(LA_FIRE_KML, SMOKE_KML),
      nowIso: fixedNow,
    };
    const result = await queryLiveFireEvidence(
      { placeId: "demo-los-angeles", date: PINNED_DATE, mode: "live" },
      deps,
    );
    const explanation = buildFireExplanation(result.evidence!);
    expect(explanation.observed.toUpperCase()).toContain("LIVE RETRIEVAL");
    expect(explanation.observed.toUpperCase()).toContain("HISTORICAL OBSERVATION");
  });

  it("fixture result observed text contains FIXTURE", () => {
    const result = queryFireEvidence({ placeId: "demo-los-angeles", date: PINNED_DATE, mode: "fixture" });
    const explanation = buildFireExplanation(result.evidence!);
    expect(explanation.observed.toUpperCase()).toContain("FIXTURE");
  });
});

// ---------------------------------------------------------------------------
// Freshness: live results are historical, not current
// ---------------------------------------------------------------------------

describe("live results are always historical", () => {
  it("live LA result freshness.status=historical", async () => {
    const deps: HmsLiveDependencies = {
      fetch: mockFetchSuccess(LA_FIRE_KML, SMOKE_KML),
      nowIso: fixedNow,
    };
    const result = await queryLiveFireEvidence(
      { placeId: "demo-los-angeles", date: PINNED_DATE, mode: "live" },
      deps,
    );
    expect(result.evidence!.freshness.status).toBe("historical");
  });

  it("live Lake Michigan no_obs result freshness.status=historical", async () => {
    const deps: HmsLiveDependencies = {
      fetch: mockFetchSuccess(EMPTY_KML, EMPTY_KML),
      nowIso: fixedNow,
    };
    const result = await queryLiveFireEvidence(
      { placeId: "demo-lake-michigan", date: PINNED_DATE, mode: "live" },
      deps,
    );
    expect(result.evidence!.freshness.status).toBe("historical");
  });
});

// ---------------------------------------------------------------------------
// No-fallback: live failure produces no fixture data
// ---------------------------------------------------------------------------

describe("live failure — no fixture fallback", () => {
  it("live network error does not return fixture evidence", async () => {
    const deps: HmsLiveDependencies = {
      fetch: () => Promise.reject(new Error("network")),
      nowIso: fixedNow,
    };
    const result = await queryLiveFireEvidence(
      { placeId: "demo-los-angeles", date: PINNED_DATE, mode: "live" },
      deps,
    );
    expect(result.evidence?.dataMode).not.toBe("fixture");
    expect(result.evidence?.dataMode).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// demo-source-failure: fixture only, rejected in live mode
// ---------------------------------------------------------------------------

describe("demo-source-failure — fixture only", () => {
  it("fixture mode accepts demo-source-failure", () => {
    const result = queryFireEvidence({ placeId: "demo-source-failure", date: PINNED_DATE, mode: "fixture" });
    expect(result.kind).toBe("source_failure");
    expect(result.evidence?.dataMode).toBe("failed");
  });

  it("live mode rejects demo-source-failure without an external request", async () => {
    let fetchCalled = false;
    const deps: HmsLiveDependencies = {
      fetch: () => { fetchCalled = true; return Promise.reject(new Error("should not call")); },
      nowIso: fixedNow,
    };
    const result = await queryLiveFireEvidence(
      { placeId: "demo-source-failure", date: PINNED_DATE, mode: "live" },
      deps,
    );
    expect(result.kind).toBe("unsupported_place");
    expect(result.evidence).toBeUndefined();
    expect(fetchCalled).toBe(false);
  });
});
