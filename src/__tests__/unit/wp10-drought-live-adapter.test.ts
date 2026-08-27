import { createHash } from "crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { validateEvidenceObject } from "@/contracts/evidence";
import {
  buildGibsNdviDescribeDomainsUrl,
  buildGibsNdviWmsUrl,
  buildUsdmArizonaPercentRequest,
} from "@/lib/drought/source-contracts";
import { queryLiveDroughtEvidence } from "@/lib/drought/live-adapter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function makePng(alpha = 255, r = 100, g = 150, b = 200): Promise<Buffer> {
  return sharp({
    create: { width: 256, height: 256, channels: 4, background: { r, g, b, alpha: alpha / 255 } },
  }).png().toBuffer();
}

function makeUsdmJson(options: {
  mapDate?: string;
  none?: number;
  d0?: number;
  d1?: number;
  d2?: number;
  d3?: number;
  d4?: number;
  statisticFormatID?: number;
  stateAbbreviation?: string;
} = {}): Buffer {
  const row = {
    mapDate: options.mapDate ?? "6/4/2024",
    stateAbbreviation: options.stateAbbreviation ?? "AZ",
    none: options.none ?? 28.64,
    d0: options.d0 ?? 71.36,
    d1: options.d1 ?? 20.02,
    d2: options.d2 ?? 3.15,
    d3: options.d3 ?? 0,
    d4: options.d4 ?? 0,
    validStart: "6/4/2024",
    validEnd: "6/10/2024",
    statisticFormatID: options.statisticFormatID ?? 1,
  };
  return Buffer.from(JSON.stringify([row]));
}

function domainXml(interval = "2024-05-08/2024-06-25/P16D"): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><Capabilities><Layer><Dimension><DimensionDomain>${interval}</DimensionDomain></Dimension></Layer></Capabilities>`
  );
}

// Convert Buffer to a BodyInit-compatible type
function asBody(b: Buffer | string | null): BodyInit | null {
  if (b === null) return null;
  if (typeof b === "string") return b;
  // Convert to a pure ArrayBuffer (not ArrayBufferLike) for TypeScript BodyInit compatibility
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  return ab;
}

type TestTransportStage = "gibs_domain_transport" | "gibs_image_transport" | "usdm_transport";

function stageForUrl(url: string): TestTransportStage {
  if (url.includes("gitc.earthdata.nasa.gov")) return "gibs_domain_transport";
  if (url.includes("gibs.earthdata.nasa.gov")) return "gibs_image_transport";
  if (url.includes("usdmdataservices.unl.edu")) return "usdm_transport";
  throw new Error(`Unexpected URL: ${url}`);
}

function successfulStageResponse(stage: TestTransportStage, pngBytes: Buffer): Response {
  if (stage === "gibs_domain_transport") {
    return new Response(asBody(domainXml()), {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }
  if (stage === "gibs_image_transport") {
    return new Response(asBody(pngBytes), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });
  }
  return new Response(asBody(makeUsdmJson()), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// NOW: a date that makes 2024-06-04 a past completed date
const NOW = new Date("2026-08-13T12:00:00Z");

// ---------------------------------------------------------------------------
// 1. Fixed 3-request success, exact URLs/order, selected dates, hashes, provenance, limitations, validated evidence
// ---------------------------------------------------------------------------

describe("queryLiveDroughtEvidence", () => {
  it("fixed 3-request success with demo-tucson 2024-06-04", async () => {
    const domainBytes = domainXml("2024-05-08/2024-06-25/P16D");
    const pngBytes = await makePng(200);
    const usdmBytes = makeUsdmJson({ mapDate: "6/4/2024" });
    const calls: string[] = [];

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      calls.push(url);
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(asBody(domainBytes), { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      if (url.includes("gibs.earthdata.nasa.gov")) {
        return new Response(asBody(pngBytes), { status: 200, headers: { "Content-Type": "image/png" } });
      }
      if (url.includes("usdmdataservices.unl.edu")) {
        return new Response(asBody(usdmBytes), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("success");
    expect(result.sourceOutcomes.gibs).toBe("success");
    expect(result.sourceOutcomes.usdm).toBe("success");
    expect(result.evidence).toBeDefined();
    validateEvidenceObject(result.evidence!);

    // Verify 3 calls were made (domain, png, usdm)
    expect(calls).toHaveLength(3);

    // Verify domain URL (always first since GIBS domain is sequential start)
    const domainUrl = buildGibsNdviDescribeDomainsUrl(
      new Date(Date.parse("2024-06-04T00:00:00Z") - 64 * 86400000).toISOString().slice(0, 10),
      "2024-06-04"
    );
    // Verify PNG URL uses selected date 2024-05-24.
    const pngUrl = buildGibsNdviWmsUrl("2024-05-24");
    const usdmUrl = buildUsdmArizonaPercentRequest("2024-06-04").url;
    expect(calls).toEqual([domainUrl, usdmUrl, pngUrl]);

    // Verify observations
    const obs = result.evidence!.observations;
    expect(obs).toHaveLength(2);
    expect(obs[0].observationId).toBe("obs-wp10-gibs-live-demo-tucson-20240524");
    expect(obs[0].provenance.observedAt).toBe("2024-05-24T00:00:00Z");
    expect(obs[0].provenance.payloadHash).toBe(sha256(pngBytes));
    expect(obs[1].observationId).toBe("obs-wp10-usdm-live-20240604");
    expect(obs[1].provenance.observedAt).toBe("2024-06-04T00:00:00Z");
    expect(obs[1].provenance.payloadHash).toBe(sha256(usdmBytes));

    // Verify limitations
    const limIds = result.evidence!.limitations.map((l) => l.limitationId);
    expect(limIds).toContain("lim-wp10-gibs-visual-only");
    expect(limIds).toContain("lim-wp10-usdm-regional");
    expect(limIds).toContain("lim-wp10-scale-mismatch");
    expect(limIds).not.toContain("lim-wp10-partial-not-complete");
    expect(limIds).not.toContain("lim-wp10-failure-no-fallback");

    // Validate evidence
    expect(result.evidence!.confidence.level).toBe("moderate");
    expect(result.evidence!.freshness.status).toBe("historical");
  });

  // 2. Another arbitrary completed date and deterministic source-date resolution
  it("arbitrary completed date 2024-06-09 selects 2024-05-24 (before 2024-06-09)", async () => {
    // 2024-06-09 is a Sunday; latest Tuesday not after = 2024-06-04
    // Domain window: 2024-04-06 through 2024-06-09
    // Feasibility interval: 2024-05-08/2024-06-25/P16D -> 2024-05-08, 2024-05-24, 2024-06-09
    // selectedDate for 2024-06-09: 2024-06-09 itself
    const pngBytes = await makePng(200);
    const usdmBytes = makeUsdmJson({ mapDate: "6/4/2024" });
    const domainBytes = domainXml("2024-05-08/2024-06-25/P16D");

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(asBody(domainBytes), { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      if (url.includes("gibs.earthdata.nasa.gov")) {
        return new Response(asBody(pngBytes), { status: 200, headers: { "Content-Type": "image/png" } });
      }
      if (url.includes("usdmdataservices.unl.edu")) {
        return new Response(asBody(usdmBytes), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected: ${url}`);
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-09", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.kind).toBe("success");
    // 2024-06-09 is a Sunday -> tuesday = 2024-06-04
    expect(result.evidence?.observations[1].provenance.observedAt).toBe("2024-06-04T00:00:00Z");
    // GIBS selected date for 2024-06-09 from the feasibility interval: 2024-06-09
    expect(result.evidence?.observations[0].provenance.observedAt).toBe("2024-06-09T00:00:00Z");
  });

  // 3. One safe same-host redirect and every rejected redirect case
  it("follows one safe same-host redirect for domain request", async () => {
    const domainBytes = domainXml();
    const pngBytes = await makePng(200);
    const usdmBytes = makeUsdmJson();
    let redirected = false;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov") && !redirected) {
        redirected = true;
        // Same-host redirect
        const redirectTarget = url.replace("all/2024-04-06--2024-06-04.xml", "all/2024-04-06--2024-06-04-redir.xml");
        return new Response(null, { status: 302, headers: { Location: redirectTarget } });
      }
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(asBody(domainBytes), { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      if (url.includes("gibs.earthdata.nasa.gov")) {
        return new Response(asBody(pngBytes), { status: 200, headers: { "Content-Type": "image/png" } });
      }
      if (url.includes("usdmdataservices.unl.edu")) {
        return new Response(asBody(usdmBytes), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected: ${url}`);
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.kind).toBe("success");
  });

  it("rejects cross-host redirect", async () => {
    const pngBytes = await makePng(200);
    const usdmBytes = makeUsdmJson();

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://other.host.com/data.xml" },
        });
      }
      if (url.includes("gibs.earthdata.nasa.gov")) {
        return new Response(asBody(pngBytes), { status: 200, headers: { "Content-Type": "image/png" } });
      }
      if (url.includes("usdmdataservices.unl.edu")) {
        return new Response(asBody(usdmBytes), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected: ${url}`);
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.sourceOutcomes.gibs).toBe("failed");
    expect(result.failureReason).toBe("redirect");
    expect(result.failureStage).toContain("gibs_domain");
  });

  it("rejects HTTP downgrade redirect", async () => {
    const usdmBytes = makeUsdmJson();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(null, {
          status: 302,
          headers: { Location: "http://gitc.earthdata.nasa.gov/same-path" },
        });
      }
      if (url.includes("usdmdataservices.unl.edu")) {
        return new Response(asBody(usdmBytes), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected: ${url}`);
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.failureReason).toBe("redirect");
  });

  it("rejects second redirect (chained)", async () => {
    const usdmBytes = makeUsdmJson();
    let firstRedirectDone = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        if (!firstRedirectDone) {
          firstRedirectDone = true;
          return new Response(null, {
            status: 302,
            headers: { Location: url + "-redir1" },
          });
        }
        // Second redirect
        return new Response(null, {
          status: 302,
          headers: { Location: url + "-redir2" },
        });
      }
      if (url.includes("usdmdataservices.unl.edu")) {
        return new Response(asBody(usdmBytes), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected: ${url}`);
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.failureReason).toBe("redirect");
  });

  it("resolves one safe relative same-host redirect", async () => {
    const pngBytes = await makePng();
    let redirected = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      const stage = stageForUrl(url);
      if (stage === "gibs_domain_transport" && !redirected) {
        redirected = true;
        const path = new URL(url).pathname.replace(".xml", "-redirected.xml");
        return new Response(null, { status: 302, headers: { Location: path } });
      }
      return successfulStageResponse(stage, pngBytes);
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("success");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["path-family change", "https://gitc.earthdata.nasa.gov/outside/domain.xml"],
    ["non-default port", "https://gitc.earthdata.nasa.gov:444/wmts/epsg4326/std/1.0.0/file.xml"],
    ["URL credential", "https://user:pass@192.0.2.1/wmts/epsg4326/std/1.0.0/file.xml"],
  ])("rejects redirect %s", async (_label, location) => {
    const pngBytes = await makePng();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      const stage = stageForUrl(url);
      if (stage === "gibs_domain_transport") {
        return new Response(null, { status: 302, headers: { Location: location } });
      }
      return successfulStageResponse(stage, pngBytes);
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );

    expect(result.failureReason).toBe("redirect");
    expect(result.failureStage).toBe("gibs_domain_transport");
  });

  it("rejects a same-host image redirect outside the exact WMS path", async () => {
    const pngBytes = await makePng();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      const stage = stageForUrl(url);
      if (stage === "gibs_image_transport") {
        return new Response(null, {
          status: 302,
          headers: {
            Location: "https://gibs.earthdata.nasa.gov/wms/epsg4326/std/wms.cgi-elsewhere",
          },
        });
      }
      return successfulStageResponse(stage, pngBytes);
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("inconclusive_evidence");
    expect(result.failureReason).toBe("redirect");
    expect(result.failureStage).toBe("gibs_image_transport");
  });

  // 4. 429, timeout, network, non-2xx, media, oversize, malformed, schema failures at every stage
  it("domain 429 -> rate_limited at gibs_domain_transport", async () => {
    const usdmBytes = makeUsdmJson();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(null, { status: 429 });
      }
      return new Response(asBody(usdmBytes), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.failureReason).toBe("rate_limited");
    expect(result.failureStage).toBe("gibs_domain_transport");
  });

  it("domain network error -> network at gibs_domain_transport", async () => {
    const usdmBytes = makeUsdmJson();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) throw new Error("network failure");
      return new Response(asBody(usdmBytes), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.failureReason).toBe("network");
    expect(result.failureStage).toBe("gibs_domain_transport");
  });

  it("domain non-2xx -> provider_failure at gibs_domain_transport", async () => {
    const usdmBytes = makeUsdmJson();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(null, { status: 503 });
      }
      return new Response(asBody(usdmBytes), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.failureReason).toBe("provider_failure");
    expect(result.failureStage).toBe("gibs_domain_transport");
  });

  it("domain wrong media type -> media_type at gibs_domain_transport", async () => {
    const usdmBytes = makeUsdmJson();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(asBody(Buffer.from([1, 2])), { status: 200, headers: { "Content-Type": "text/html" } });
      }
      return new Response(asBody(usdmBytes), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.failureReason).toBe("media_type");
    expect(result.failureStage).toMatch(/gibs_domain/);
  });

  it("domain XML unparseable -> schema_validation at gibs_domain_payload", async () => {
    const usdmBytes = makeUsdmJson();
    const badXmlBytes = Buffer.from("<bad interval '...'>");
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(asBody(badXmlBytes), { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      return new Response(asBody(usdmBytes), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    // No DimensionDomain found -> not_attempted; USDM may still succeed
    // This is actually not a failure — no domain date found
    expect(result.kind).toBe("inconclusive_evidence");
    expect(result.sourceOutcomes.gibs).toBe("failed");
    expect(result.failureReason).toBe("schema_validation");
    expect(result.failureStage).toBe("gibs_domain_payload");
  });

  it("PNG 429 -> rate_limited at gibs_image_transport", async () => {
    const usdmBytes = makeUsdmJson();
    const domainBytes = domainXml();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(asBody(domainBytes), { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      if (url.includes("gibs.earthdata.nasa.gov")) {
        return new Response(null, { status: 429 });
      }
      return new Response(asBody(usdmBytes), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.failureReason).toBe("rate_limited");
    expect(result.failureStage).toBe("gibs_image_transport");
  });

  it("PNG wrong dimensions -> schema_validation at gibs_image_payload", async () => {
    const usdmBytes = makeUsdmJson();
    const domainBytes = domainXml();
    const wrongPng = await sharp({
      create: { width: 128, height: 128, channels: 4, background: { r: 100, g: 100, b: 100, alpha: 1 } },
    }).png().toBuffer();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(asBody(domainBytes), { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      if (url.includes("gibs.earthdata.nasa.gov")) {
        return new Response(asBody(wrongPng), { status: 200, headers: { "Content-Type": "image/png" } });
      }
      return new Response(asBody(usdmBytes), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.failureReason).toBe("schema_validation");
    expect(result.failureStage).toBe("gibs_image_payload");
  });

  it("USDM 429 -> rate_limited at usdm_transport", async () => {
    const domainBytes = domainXml();
    const pngBytes = await makePng();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(asBody(domainBytes), { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      if (url.includes("gibs.earthdata.nasa.gov")) {
        return new Response(asBody(pngBytes), { status: 200, headers: { "Content-Type": "image/png" } });
      }
      return new Response(null, { status: 429 });
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    // GIBS succeeded; USDM failed -> inconclusive
    expect(result.sourceOutcomes.usdm).toBe("failed");
    expect(result.failureReason).toBe("rate_limited");
    expect(result.failureStage).toBe("usdm_transport");
    expect(result.kind).toBe("inconclusive_evidence");
  });

  it("USDM malformed JSON -> malformed at usdm_payload", async () => {
    const domainBytes = domainXml();
    const pngBytes = await makePng();
    const badJson = Buffer.from("not json {{{");
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(asBody(domainBytes), { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      if (url.includes("gibs.earthdata.nasa.gov")) {
        return new Response(asBody(pngBytes), { status: 200, headers: { "Content-Type": "image/png" } });
      }
      return new Response(asBody(badJson), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.failureReason).toBe("malformed");
    expect(result.failureStage).toBe("usdm_payload");
  });

  it("USDM schema validation failure -> schema_validation at usdm_payload", async () => {
    const domainBytes = domainXml();
    const pngBytes = await makePng();
    // Percentage identity violation: none + d0 != 100
    const badUsdm = makeUsdmJson({ none: 50, d0: 60 });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(asBody(domainBytes), { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      if (url.includes("gibs.earthdata.nasa.gov")) {
        return new Response(asBody(pngBytes), { status: 200, headers: { "Content-Type": "image/png" } });
      }
      return new Response(asBody(badUsdm), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.failureReason).toBe("schema_validation");
    expect(result.failureStage).toBe("usdm_payload");
  });

  // 5. Domain no date prevents PNG but not USDM
  it("domain returns no matching dates: skips PNG but USDM still runs", async () => {
    const usdmBytes = makeUsdmJson();
    // XML with a future-only interval (2025-01-01/2025-01-17/P16D: 2 dates, both > 2024-06-04)
    const futureOnly = domainXml("2025-01-01/2025-01-17/P16D");
    let pngCalled = false;
    let usdmCalled = false;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(asBody(futureOnly), { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      if (url.includes("gibs.earthdata.nasa.gov")) {
        pngCalled = true;
        throw new Error("PNG should not be called");
      }
      if (url.includes("usdmdataservices.unl.edu")) {
        usdmCalled = true;
        return new Response(asBody(usdmBytes), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected: ${url}`);
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(pngCalled).toBe(false);
    expect(usdmCalled).toBe(true);
    expect(result.sourceOutcomes.gibs).toBe("not_attempted");
    expect(result.sourceOutcomes.usdm).toBe("success");
  });

  // 6. Transparent PNG, zero USDM row, partial states, total no-observation, total/partial source failure
  it("transparent PNG returns no_observation for GIBS branch", async () => {
    const domainBytes = domainXml();
    const transparentPng = await makePng(0); // fully transparent
    const usdmBytes = makeUsdmJson();

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(asBody(domainBytes), { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      if (url.includes("gibs.earthdata.nasa.gov")) {
        return new Response(asBody(transparentPng), { status: 200, headers: { "Content-Type": "image/png" } });
      }
      return new Response(asBody(usdmBytes), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.sourceOutcomes.gibs).toBe("no_observation");
    expect(result.sourceOutcomes.usdm).toBe("success");
    expect(result.kind).toBe("inconclusive_evidence");
  });

  it("zero USDM rows returns no_observation for USDM branch", async () => {
    const domainBytes = domainXml();
    const pngBytes = await makePng(200);
    // USDM row for different date -> no match
    const emptyUsdm = Buffer.from(JSON.stringify([]));

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(asBody(domainBytes), { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      if (url.includes("gibs.earthdata.nasa.gov")) {
        return new Response(asBody(pngBytes), { status: 200, headers: { "Content-Type": "image/png" } });
      }
      return new Response(asBody(emptyUsdm), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.sourceOutcomes.usdm).toBe("no_observation");
    // GIBS success + USDM no_observation = inconclusive
    expect(result.kind).toBe("inconclusive_evidence");
    // Verify no-row marker observation is present
    const noRowObs = result.evidence!.observations.find(
      (obs) => obs.textValue === "no_regional_row_returned"
    );
    expect(noRowObs).toBeDefined();
  });

  it("both GIBS and USDM failed: source_failure", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("gitc.earthdata.nasa.gov")) {
        return new Response(null, { status: 503 });
      }
      return new Response(null, { status: 503 });
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.kind).toBe("source_failure");
    expect(result.sourceOutcomes.gibs).toBe("failed");
    expect(result.sourceOutcomes.usdm).toBe("failed");
    expect(result.failureReason).toBe("provider_failure");
    expect(result.failureStage).toMatch(/gibs_domain/);
  });

  it("transparent GIBS plus zero USDM rows is total no_observation", async () => {
    const transparentPng = await makePng(0);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      const stage = stageForUrl(url);
      if (stage === "gibs_image_transport") {
        return new Response(asBody(transparentPng), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      if (stage === "usdm_transport") {
        return new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return successfulStageResponse(stage, transparentPng);
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("no_observation");
    expect(result.sourceOutcomes).toEqual({ gibs: "no_observation", usdm: "no_observation" });
    expect(result.evidence?.evidenceState).toBe("no_observation");
    expect(result.evidence?.limitations.map((item) => item.limitationId)).toContain(
      "lim-wp10-no-observation-not-safe"
    );
  });

  const transportStages: TestTransportStage[] = [
    "gibs_domain_transport",
    "gibs_image_transport",
    "usdm_transport",
  ];
  const transportFailures = [
    ["rate_limited", 429],
    ["provider_failure", 503],
    ["media_type", 200],
    ["oversize", 200],
    ["network", 0],
  ] as const;

  it.each(transportStages.flatMap((stage) => transportFailures.map(([reason, status]) => [stage, reason, status] as const)))(
    "%s classifies %s without retry or fallback",
    async (targetStage, expectedReason, status) => {
      const pngBytes = await makePng();
      const maxBytes = targetStage === "gibs_image_transport" ? 2_000_000 : 65_536;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : (input as URL).toString();
        const stage = stageForUrl(url);
        if (stage !== targetStage) return successfulStageResponse(stage, pngBytes);
        if (expectedReason === "network") throw new Error("network failure");
        if (expectedReason === "rate_limited" || expectedReason === "provider_failure") {
          return new Response(null, { status });
        }
        const contentType = stage === "gibs_domain_transport"
          ? "text/xml"
          : stage === "gibs_image_transport"
            ? "image/png"
            : "application/json";
        if (expectedReason === "media_type") {
          return new Response("unexpected", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        }
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(maxBytes + 1),
          },
        });
      });
      const fetchImpl = fetchMock as unknown as typeof fetch;

      const result = await queryLiveDroughtEvidence(
        { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
        { fetchImpl, now: () => NOW }
      );

      expect(result.kind).toBe("inconclusive_evidence");
      expect(result.failureReason).toBe(expectedReason);
      expect(result.failureStage).toBe(targetStage);
      expect(
        fetchMock.mock.calls.filter(([input]) => stageForUrl(String(input)) === targetStage)
      ).toHaveLength(1);
    }
  );

  it.each(transportStages)("%s classifies a stalled response body as timeout", async (targetStage) => {
    const pngBytes = await makePng();
    vi.useFakeTimers();
    let markTargetReached: (() => void) | undefined;
    const targetReached = new Promise<void>((resolve) => {
      markTargetReached = resolve;
    });
    try {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : (input as URL).toString();
        const stage = stageForUrl(url);
        if (stage !== targetStage) return successfulStageResponse(stage, pngBytes);
        const signal = init?.signal;
        if (!signal) throw new Error("missing abort signal");
        markTargetReached?.();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            signal.addEventListener("abort", () => controller.error(new Error("aborted")), {
              once: true,
            });
          },
        });
        const contentType = stage === "gibs_domain_transport"
          ? "text/xml"
          : stage === "gibs_image_transport"
            ? "image/png"
            : "application/json";
        return new Response(body, { status: 200, headers: { "Content-Type": contentType } });
      }) as unknown as typeof fetch;

      const query = queryLiveDroughtEvidence(
        { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
        { fetchImpl, now: () => NOW }
      );
      await targetReached;
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await query;

      expect(result.kind).toBe("inconclusive_evidence");
      expect(result.failureReason).toBe("timeout");
      expect(result.failureStage).toBe(targetStage);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(transportStages)("%s classifies a missing response body as malformed", async (targetStage) => {
    const pngBytes = await makePng();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      const stage = stageForUrl(url);
      if (stage !== targetStage) return successfulStageResponse(stage, pngBytes);
      const contentType = stage === "gibs_domain_transport"
        ? "text/xml"
        : stage === "gibs_image_transport"
          ? "image/png"
          : "application/json";
      return new Response(null, {
        status: 200,
        headers: { "Content-Type": contentType },
      });
    }) as unknown as typeof fetch;

    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );

    expect(result.kind).toBe("inconclusive_evidence");
    expect(result.failureReason).toBe("malformed");
    expect(result.failureStage).toBe(targetStage);
  });

  // 7. No retry, no fixture import/use, no raw persistence
  it("no retry: each host called at most once per stage", async () => {
    const callCounts: Record<string, number> = {};
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      const host = url.split("/")[2];
      callCounts[host] = (callCounts[host] ?? 0) + 1;
      return new Response(null, { status: 503 });
    }) as unknown as typeof fetch;

    await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    // Each host called at most once
    for (const [host, count] of Object.entries(callCounts)) {
      expect(count, `${host} should be called at most once`).toBeLessThanOrEqual(1);
    }
  });

  describe("validated custom-area national satellite and regional path", () => {
    const area = { west: -74.3, south: 40.4, east: -73.6, north: 41 };

    it("uses the canonical bbox, resolves New York, and queries matching USDM statistics", async () => {
      const pngBytes = await makePng(220, 60, 130, 70);
      const calls: string[] = [];
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("gitc.earthdata.nasa.gov")) {
          return new Response(asBody(domainXml()), {
            status: 200,
            headers: { "Content-Type": "text/xml" },
          });
        }
        if (url.includes("gibs.earthdata.nasa.gov")) {
          return new Response(asBody(pngBytes), {
            status: 200,
            headers: { "Content-Type": "image/png" },
          });
        }
        if (url.includes("tigerweb.geo.census.gov")) {
          return new Response(JSON.stringify({
            type: "FeatureCollection",
            features: [{
              type: "Feature",
              properties: { STATE: "36", NAME: "New York", STUSAB: "NY" },
              geometry: {
                type: "Polygon",
                coordinates: [[
                  [-80, 40], [-71, 40], [-71, 45], [-80, 45], [-80, 40],
                ]],
              },
            }],
          }), {
            status: 200,
            headers: { "Content-Type": "application/geo+json" },
          });
        }
        if (url.includes("usdmdataservices.unl.edu")) {
          return new Response(asBody(makeUsdmJson({ stateAbbreviation: "NY" })), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      }) as unknown as typeof fetch;

      const result = await queryLiveDroughtEvidence(
        { placeId: "custom-area", date: "2024-06-04", mode: "live", area },
        { fetchImpl, now: () => NOW }
      );

      expect(calls).toHaveLength(4);
      const censusUrl = new URL(calls.find((url) => url.includes("tigerweb.geo.census.gov"))!);
      expect(JSON.parse(censusUrl.searchParams.get("geometry")!)).toEqual({
        xmin: area.west,
        ymin: area.south,
        xmax: area.east,
        ymax: area.north,
        spatialReference: { wkid: 4326 },
      });
      const usdmUrl = new URL(calls.find((url) => url.includes("usdmdataservices.unl.edu"))!);
      expect(usdmUrl.searchParams.get("aoi")).toBe("36");
      const imageUrl = new URL(calls.find((url) => url.includes("gibs.earthdata.nasa.gov"))!);
      expect(imageUrl.searchParams.get("BBOX")).toBe("-74.3,40.4,-73.6,41");
      expect(result.kind).toBe("success");
      expect(result.sourceOutcomes).toEqual({
        gibs: "success",
        usdm: "success",
        administrativeArea: "success",
      });
      expect(result.evidence?.observations).toHaveLength(2);
      expect(result.evidence?.observations[0].provenance.requestParameters?.BBOX).toBe(
        "-74.3,40.4,-73.6,41"
      );
      expect(result.evidence?.observations[0].observationId).toMatch(
        /^obs-wp10-gibs-live-custom-[a-f0-9]{12}-20240524$/
      );
      expect(result.evidence?.observations[1].metadata).toMatchObject({
        stateFips: "36",
        areaName: "New York",
      });
      expect(result.evidence?.missionAttributions).toHaveLength(2);
      expect(result.evidence?.limitations.map((item) => item.limitationId)).toEqual(
        expect.arrayContaining([
          "lim-wp10-gibs-visual-only",
          "lim-wp10-usdm-regional",
          "lim-wp10-scale-mismatch",
        ])
      );
      expect(result.evidence?.confidence.rationale).toMatch(/both bounded regional source roles/i);
      validateEvidenceObject(result.evidence!);
    });

    it("reports transparent custom-area imagery as no observation without a fallback", async () => {
      const transparentPng = await makePng(0);
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("gitc.earthdata.nasa.gov")) {
          return new Response(asBody(domainXml()), {
            status: 200,
            headers: { "Content-Type": "text/xml" },
          });
        }
        if (url.includes("gibs.earthdata.nasa.gov")) {
          return new Response(asBody(transparentPng), {
            status: 200,
            headers: { "Content-Type": "image/png" },
          });
        }
        if (url.includes("tigerweb.geo.census.gov")) {
          return new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), {
            status: 200,
            headers: { "Content-Type": "application/geo+json" },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      }) as unknown as typeof fetch;

      const result = await queryLiveDroughtEvidence(
        { placeId: "custom-area", date: "2024-06-04", mode: "live", area },
        { fetchImpl, now: () => NOW }
      );

      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(result.kind).toBe("no_observation");
      expect(result.sourceOutcomes).toEqual({
        gibs: "no_observation",
        usdm: "not_attempted",
        administrativeArea: "no_observation",
      });
      expect(result.evidence?.dataMode).toBe("live");
      expect(result.evidence?.limitations.map((item) => item.limitationId)).toContain(
        "lim-wp10-gibs-no-observation-not-safe"
      );
      expect(JSON.stringify(result)).not.toContain("fixture");
    });

    it("rejects a missing custom area before transport", async () => {
      const fetchImpl = vi.fn() as unknown as typeof fetch;
      const result = await queryLiveDroughtEvidence(
        { placeId: "custom-area", date: "2024-06-04", mode: "live" },
        { fetchImpl, now: () => NOW }
      );

      expect(result.kind).toBe("unsupported_place");
      expect(result.sourceOutcomes).toEqual({ gibs: "not_attempted", usdm: "not_attempted" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  // 8. Unsupported place/date makes zero fetch calls
  it("unsupported place makes zero fetch calls", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await queryLiveDroughtEvidence(
      { placeId: "other-place", date: "2024-06-04", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.kind).toBe("unsupported_place");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.sourceOutcomes.gibs).toBe("not_attempted");
    expect(result.sourceOutcomes.usdm).toBe("not_attempted");
  });

  it("today UTC date makes zero fetch calls", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const today = new Date(NOW);
    const todayStr = today.toISOString().slice(0, 10);
    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: todayStr, mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.kind).toBe("unsupported_date");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("future date makes zero fetch calls", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "2030-01-01", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.kind).toBe("unsupported_date");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("invalid date makes zero fetch calls", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await queryLiveDroughtEvidence(
      { placeId: "demo-tucson", date: "not-a-date", mode: "live" },
      { fetchImpl, now: () => NOW }
    );
    expect(result.kind).toBe("unsupported_date");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
