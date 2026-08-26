/**
 * WP-12 HANS JSON decoder core — mock-only focused tests.
 * STP-WP-12-002
 *
 * Covers the decoder contract added in this slice:
 *  - JSON with charset and application/*+json
 *  - valid raw JSON with wrong or missing Content-Type
 *  - wrong-type HTML/JSONP → media_type
 *  - JSON-labelled malformed content → malformed
 *  - schema-invalid inventory and notice data → schema_validation
 *  - success preserving qualifiers and raw-byte hash
 *  - no in-area volcano → no_observation (geographic_applicability)
 */

import { createHash } from "node:crypto";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  HANS_TIMEOUT_MS,
  queryHansVolcanoActivity,
} from "@/lib/coverage-gap/hans-live-adapter";

const DATE = "2024-07-08";
const AREA = { north: 63, south: 59, west: -152, east: -147 };
const NOW = new Date("2024-07-08T22:00:00Z");

/** Minimal valid inventory record for Great Sitkin (inside AREA). */
const VALID_VOLCANO = {
  volcano_cd: "ak111",
  volcano_name: "Great Sitkin",
  latitude: 61.08,
  longitude: -149.8,
  obs_abbr: "avo",
};

/** Minimal valid notice record for Great Sitkin on DATE. */
const VALID_NOTICE = {
  sentUtc: "2024-07-08 21:47:40",
  sentUnixtime: 1_720_475_260,
  noticeTypeCd: "DU",
  volcCds: "ak111",
  noticeHtml: "<p>Official deterministic notice body</p>",
  obsAbbr: "avo",
  noticeIdentifier: "DOI-USGS-AVO-MOCK-2024-07-08",
  permLink: "https://volcanoes.usgs.gov/hans-public/notice/DOI-USGS-AVO-MOCK-2024-07-08",
};

const VALID_VONA = {
  ...VALID_NOTICE,
  noticeTypeCd: "VONA",
  noticeHtml: "<p>Official deterministic aviation variant</p>",
  permLink: "https://volcanoes.usgs.gov/hans-public/vona/DOI-USGS-AVO-MOCK-2024-07-08",
};

function noticeSearchResult(notices: unknown[]) {
  return { noticeTotal: notices.length, noticeData: notices };
}

/** Build a two-leg fetchImpl that returns pre-canned inventory and notice responses. */
function makeFetch(
  inventoryResponse: Response,
  noticeResponse: Response
): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname.endsWith("getUSVolcanoes")) return inventoryResponse;
    return noticeResponse;
  }) as unknown as typeof fetch;
}

/** A fetchImpl whose inventory leg always returns a valid JSON inventory. */
function makeInventoryOkFetch(noticeResponse: Response): typeof fetch {
  return makeFetch(
    new Response(JSON.stringify([VALID_VOLCANO]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    noticeResponse
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("WP-12 HANS JSON decoder core", () => {
  // ── 1. JSON-labelled types ────────────────────────────────────────────────

  it("accepts application/json with charset parameter", async () => {
    const fetchImpl = makeInventoryOkFetch(
      new Response(JSON.stringify(noticeSearchResult([VALID_NOTICE])), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      })
    );
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result.kind).toBe("observations");
  });

  it("accepts application/vnd.api+json (application/*+json variant)", async () => {
    const fetchImpl = makeInventoryOkFetch(
      new Response(JSON.stringify(noticeSearchResult([VALID_NOTICE])), {
        status: 200,
        headers: { "Content-Type": "application/vnd.api+json" },
      })
    );
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result.kind).toBe("observations");
  });

  it("classifies malformed application/vnd.api+json as malformed", async () => {
    const fetchImpl = makeInventoryOkFetch(
      new Response("{not valid json{{", {
        status: 200,
        headers: { "Content-Type": "Application/Vnd.Api+Json; Charset=UTF-8" },
      })
    );
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result).toEqual({ kind: "source_failure", reason: "malformed", stage: "notice_search" });
  });

  // ── 2. Raw JSON with wrong or missing Content-Type ────────────────────────

  it("accepts valid raw JSON array with wrong Content-Type (text/plain)", async () => {
    // Inventory leg uses the wrong type too — still a valid JSON array.
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("getUSVolcanoes")) {
        return new Response(JSON.stringify([VALID_VOLCANO]), {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }
      return new Response(JSON.stringify(noticeSearchResult([VALID_NOTICE])), {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }) as unknown as typeof fetch;
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result.kind).toBe("observations");
  });

  it("accepts valid raw JSON object with missing Content-Type header", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("getUSVolcanoes")) {
        return new Response(JSON.stringify([VALID_VOLCANO]), { status: 200 });
      }
      return new Response(JSON.stringify(noticeSearchResult([VALID_NOTICE])), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result.kind).toBe("observations");
  });

  // ── 3. Wrong-type non-JSON body → media_type ──────────────────────────────

  it("returns media_type when wrong Content-Type and body is HTML", async () => {
    const fetchImpl = makeInventoryOkFetch(
      new Response("<!DOCTYPE html><html><body>Error</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    );
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result).toEqual({ kind: "source_failure", reason: "media_type", stage: "notice_search" });
  });

  it("returns media_type when wrong Content-Type and body is a JSONP callback", async () => {
    const fetchImpl = makeInventoryOkFetch(
      new Response('callback({"results":[]});', {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      })
    );
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result).toEqual({ kind: "source_failure", reason: "media_type", stage: "notice_search" });
  });

  it("returns media_type when missing Content-Type and body is not raw JSON (assignment)", async () => {
    const fetchImpl = makeInventoryOkFetch(
      new Response('var data = {"results":[]};', { status: 200 })
    );
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result).toEqual({ kind: "source_failure", reason: "media_type", stage: "notice_search" });
  });

  it("returns media_type when a wrong-type body is not valid UTF-8", async () => {
    const fetchImpl = makeInventoryOkFetch(
      new Response(new Uint8Array([0x7b, 0xc3, 0x28, 0x7d]), {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      })
    );
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result).toEqual({ kind: "source_failure", reason: "media_type", stage: "notice_search" });
  });

  // ── 4. JSON-labelled malformed content → malformed ────────────────────────

  it("returns malformed when application/json body is not valid JSON", async () => {
    const fetchImpl = makeInventoryOkFetch(
      new Response("{not valid json{{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result).toEqual({ kind: "source_failure", reason: "malformed", stage: "notice_search" });
  });

  it("returns malformed when a JSON-labelled body is not valid UTF-8", async () => {
    const fetchImpl = makeInventoryOkFetch(
      new Response(new Uint8Array([0x7b, 0xc3, 0x28, 0x7d]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result).toEqual({ kind: "source_failure", reason: "malformed", stage: "notice_search" });
  });

  it("keeps the timeout active while reading the response body", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), {
            once: true,
          });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const pending = queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    await vi.advanceTimersByTimeAsync(HANS_TIMEOUT_MS + 1);
    await expect(pending).resolves.toEqual({
      kind: "source_failure",
      reason: "timeout",
      stage: "volcano_inventory",
    });
  });

  // ── 5. Schema-invalid data → schema_validation ────────────────────────────

  it("returns schema_validation when inventory JSON fails schema (missing field)", async () => {
    const badInventory = [{ volcano_cd: "ak111", volcano_name: "Bad", obs_abbr: "avo" }]; // no lat/lon
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(badInventory), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ) as unknown as typeof fetch;
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result).toEqual({
      kind: "source_failure",
      reason: "schema_validation",
      stage: "volcano_inventory",
    });
  });

  it("returns schema_validation when notice JSON fails schema (missing noticeIdentifier)", async () => {
    const badNotice = { ...VALID_NOTICE };
    // @ts-expect-error intentionally deleting required field
    delete badNotice.noticeIdentifier;
    const fetchImpl = makeInventoryOkFetch(
      new Response(JSON.stringify(noticeSearchResult([badNotice])), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result).toEqual({
      kind: "source_failure",
      reason: "schema_validation",
      stage: "notice_search",
      schemaDiagnostic: {
        path: "$.noticeData[].noticeIdentifier",
        expected: "non-empty identifier up to 200 characters without controls",
        actualType: "missing",
      },
    });
  });

  it("reports only value-free HANS schema shape metadata", async () => {
    const rawMarker = "HANS_RAW_MARKER_MUST_NOT_ESCAPE";
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl: makeInventoryOkFetch(Response.json({ rawMarker })),
      now: () => NOW,
      inventoryCache: false,
    });

    expect(result).toEqual({
      kind: "source_failure",
      reason: "schema_validation",
      stage: "notice_search",
      schemaDiagnostic: {
        path: "$.noticeTotal",
        expected: "safe non-negative integer",
        actualType: "missing",
      },
    });
    expect(JSON.stringify(result)).not.toContain(rawMarker);
  });

  it("fails closed when the single-page notice total implies truncated results", async () => {
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl: makeInventoryOkFetch(Response.json({
        noticeTotal: 2,
        noticeData: [VALID_NOTICE],
      })),
      now: () => NOW,
      inventoryCache: false,
    });

    expect(result).toEqual({
      kind: "source_failure",
      reason: "schema_validation",
      stage: "notice_search",
      schemaDiagnostic: {
        path: "$.noticeTotal",
        expected: "equal to $.noticeData.length",
        actualType: "number",
      },
    });
  });

  // ── 6. Success preserves qualifiers and raw-byte hash ─────────────────────

  it("collapses identical duplicate notice records to one observation", async () => {
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl: makeInventoryOkFetch(Response.json(noticeSearchResult([
        VALID_NOTICE,
        { ...VALID_NOTICE },
      ]))),
      now: () => NOW,
      inventoryCache: false,
    });

    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    expect(result.observations).toHaveLength(1);
  });

  it("fails closed on conflicting records with the same notice identifier", async () => {
    const rawMarker = "HANS_DUPLICATE_CONFLICT_MUST_NOT_ESCAPE";
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl: makeInventoryOkFetch(Response.json(noticeSearchResult([
        VALID_NOTICE,
        { ...VALID_NOTICE, noticeHtml: rawMarker },
      ]))),
      now: () => NOW,
      inventoryCache: false,
    });

    expect(result).toEqual({
      kind: "source_failure",
      reason: "schema_validation",
      stage: "notice_search",
      schemaDiagnostic: {
        path: "$.noticeData[].noticeIdentifier",
        expected: "unique identifier per notice variant or identical duplicate record",
        actualType: "string",
      },
    });
    expect(JSON.stringify(result)).not.toContain(rawMarker);
  });

  it("normalizes paired notice and VONA variants to one issuance observation", async () => {
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl: makeInventoryOkFetch(Response.json(noticeSearchResult([
        VALID_NOTICE,
        VALID_VONA,
      ]))),
      now: () => NOW,
      inventoryCache: false,
    });

    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].provenance.sourceUrl).toBe(VALID_NOTICE.permLink);
    expect(result.observations[0].metadata).toMatchObject({
      noticeType: "DU,VONA",
      noticeVariants: "notice,vona",
    });
  });

  it("keeps paired-variant normalization independent of response order", async () => {
    const query = async (notices: unknown[]) => queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl: makeInventoryOkFetch(Response.json(noticeSearchResult(notices))),
      now: () => NOW,
      inventoryCache: false,
    });
    const noticeFirst = await query([VALID_NOTICE, VALID_VONA]);
    const vonaFirst = await query([VALID_VONA, VALID_NOTICE]);

    expect(noticeFirst.kind).toBe("observations");
    expect(vonaFirst.kind).toBe("observations");
    if (noticeFirst.kind !== "observations" || vonaFirst.kind !== "observations") {
      throw new Error("expected observations");
    }
    expect(vonaFirst.observations[0]).toMatchObject({
      observationId: noticeFirst.observations[0].observationId,
      provenance: {
        sourceUrl: noticeFirst.observations[0].provenance.sourceUrl,
        sourceRecordId: noticeFirst.observations[0].provenance.sourceRecordId,
      },
      metadata: noticeFirst.observations[0].metadata,
    });
  });

  it("fails closed when paired variants disagree on issuance context", async () => {
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl: makeInventoryOkFetch(Response.json(noticeSearchResult([
        VALID_NOTICE,
        {
          ...VALID_VONA,
          sentUtc: "2024-07-08 21:47:41",
          sentUnixtime: VALID_NOTICE.sentUnixtime + 1,
        },
      ]))),
      now: () => NOW,
      inventoryCache: false,
    });

    expect(result).toEqual({
      kind: "source_failure",
      reason: "schema_validation",
      stage: "notice_search",
      schemaDiagnostic: {
        path: "$.noticeData[].noticeIdentifier",
        expected: "paired notice variants with matching time, observatory, and volcano codes",
        actualType: "string",
      },
    });
  });

  it("success preserves required qualifiers and hashes the exact original bytes", async () => {
    const noticePayload = `\uFEFF  ${JSON.stringify(noticeSearchResult([VALID_NOTICE]))}\n`;
    const noticeBytes = new TextEncoder().encode(noticePayload);
    const fetchImpl = makeInventoryOkFetch(
      new Response(noticeBytes, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      })
    );
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    const obs = result.observations[0];
    expect(obs.qualifiers).toEqual(
      expect.arrayContaining([
        "observed_official_activity",
        "eruption_timing_not_predicted",
        "no_risk_score",
      ])
    );
    expect(obs.provenance.payloadHash).toBe(createHash("sha256").update(noticeBytes).digest("hex"));
    expect(obs.provenance.sourceId).toBe("usgs_volcano_hans");
    expect(obs.metadata).toMatchObject({
      volcanoCodes: "ak111",
      volcanoNames: "Great Sitkin",
      noticeType: "DU",
      noticeVariants: "notice",
      observatory: "avo",
    });
    expect(obs.metadata).not.toHaveProperty("alertLevel");
    expect(obs.metadata).not.toHaveProperty("colorCode");
    expect(obs.qualifiers).toEqual(expect.arrayContaining([
      "alert_level_not_structured_in_search_response",
      "color_code_not_structured_in_search_response",
    ]));
  });

  it("derives applicable volcano names from inventory for a multi-volcano notice", async () => {
    const secondVolcano = {
      volcano_cd: "ak222",
      volcano_name: "Second deterministic volcano",
      latitude: 61.5,
      longitude: -149.2,
      obs_abbr: "avo",
    };
    const fetchImpl = makeFetch(
      Response.json([VALID_VOLCANO, secondVolcano]),
      Response.json(noticeSearchResult([{ ...VALID_NOTICE, volcCds: "ak111,ak222" }]))
    );
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    expect(result.observations[0].metadata).toMatchObject({
      volcanoCodes: "ak111,ak222",
      volcanoNames: "Great Sitkin, Second deterministic volcano",
    });
  });

  it("accepts an official VONA permalink and preserves it as provenance", async () => {
    const vonaLink = "https://volcanoes.usgs.gov/hans-public/vona/DOI-USGS-AVO-MOCK-2024-07-08";
    const fetchImpl = makeInventoryOkFetch(Response.json(noticeSearchResult([{
      ...VALID_NOTICE,
      permLink: vonaLink,
    }])));
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });

    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") throw new Error("expected observations");
    expect(result.observations[0].provenance.sourceUrl).toBe(vonaLink);
  });

  it("rejects credentials in a HANS permalink without retaining them", async () => {
    const secretMarker = "HANS_PERMALINK_SECRET";
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl: makeInventoryOkFetch(Response.json(noticeSearchResult([{
        ...VALID_NOTICE,
        permLink: `https://user:${secretMarker}@volcanoes.usgs.gov${
          new URL(VALID_NOTICE.permLink).pathname
        }`,
      }]))),
      now: () => NOW,
      inventoryCache: false,
    });

    expect(result).toMatchObject({
      kind: "source_failure",
      reason: "schema_validation",
      stage: "notice_search",
      schemaDiagnostic: {
        path: "$.noticeData[].permLink",
        expected: "fixed-host HANS notice or VONA permalink",
        actualType: "string",
      },
    });
    expect(JSON.stringify(result)).not.toContain(secretMarker);
  });

  // ── 7. No in-area volcano → no_observation (geographic_applicability) ─────

  it("returns no_observation when no monitored volcano is inside the bounding box", async () => {
    const outsideVolcano = {
      volcano_cd: "hi1",
      volcano_name: "Outside area",
      latitude: 19.4,
      longitude: -155.3,
      obs_abbr: "hvo",
    };
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([outsideVolcano]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ) as unknown as typeof fetch;
    const result = await queryHansVolcanoActivity(DATE, AREA, {
      fetchImpl,
      now: () => NOW,
      inventoryCache: false,
    });
    expect(result).toEqual({ kind: "no_observation", stage: "geographic_applicability" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
