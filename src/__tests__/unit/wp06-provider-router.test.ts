/**
 * src/__tests__/unit/wp06-provider-router.test.ts
 *
 * WP-06 C01: Corrected targeted unit tests for provider-router.ts.
 *
 * Tests (acceptance items per correction capsule):
 * 1. OpenAI Responses nested wire shape and strict schema in request
 * 2. Fallback classification safety boundary
 * 3. Timeout/body-cap covering full response
 * 5. Deterministic env routing including invalid modes
 * 6. Existing valid behavior preserved
 *
 * No network requests are made. fetch is mocked globally.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  routeStructuredTask,
  routeToProvider,
  isAvailabilityFailure,
  isStructuralFailure,
  validateIbmUrl,
  loadProviderConfig,
  resetIbmTokenCacheForTests,
  type ProviderConfig,
  OPENAI_INTENT_SCHEMA,
} from "@/lib/ai/provider-router";
import {
  SemanticModelCandidateError,
  type ModelCandidate,
} from "@/lib/ai/intent-parser";
import { ValidationError } from "@/contracts/common";

// ---------------------------------------------------------------------------
// Global fetch mock — no real network calls ever
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  vi.useRealTimers();
  // ADR-0042: token caching must never leak between isolated test cases.
  resetIbmTokenCacheForTests();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    primaryProvider: "ibm",
    fallbackProvider: "openai",
    ibmWatsonxUrl: "https://us-south.ml.cloud.ibm.com",
    ibmWatsonxApiKey: "test-ibm-api-key",
    ibmWatsonxProjectId: "test-project-id",
    ibmWatsonxModelId: "ibm/granite-4-h-small",
    openAiApiKey: "test-openai-key",
    openAiModel: "gpt-4o-mini",
    ...overrides,
  };
}

function validParsedCandidateJson(): string {
  const c: ModelCandidate = {
    status: "parsed",
    placeId: "demo-los-angeles",
    hazardId: "fire_smoke",
    timeRange: { type: "latest" },
    concern: "home",
    sourceIds: ["noaa_hms_fire_points", "noaa_hms_smoke_polygons"],
    reasonCode: null,
  };
  return JSON.stringify(c);
}

function validUnsupportedCandidateJson(): string {
  const c: ModelCandidate = {
    status: "unsupported",
    placeId: null,
    hazardId: null,
    timeRange: null,
    concern: null,
    sourceIds: [],
    reasonCode: "unsupported_place",
  };
  return JSON.stringify(c);
}

function unsafeRequestCandidateJson(): string {
  const c: ModelCandidate = {
    status: "unsupported",
    placeId: null,
    hazardId: null,
    timeRange: null,
    concern: null,
    sourceIds: [],
    reasonCode: "unsafe_request",
  };
  return JSON.stringify(c);
}

/** Creates a fake streaming Response with the given body text. */
function makeStreamingResponse(text: string, status = 200): Response {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** IBM IAM token response */
function iamTokenResponse(): Response {
  return makeStreamingResponse(JSON.stringify({ access_token: "test-iam-token" }));
}

/** IBM watsonx chat response with a given candidate JSON as the assistant text */
function ibmChatResponse(candidateJson: string): Response {
  return makeStreamingResponse(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: { role: "assistant", content: candidateJson },
        },
      ],
    })
  );
}

/**
 * OpenAI Responses API response using the OFFICIAL nested wire shape:
 * output[].type="message", output[].content[].type="output_text", .text=<candidate>
 */
function openAiResponse(candidateJson: string): Response {
  return makeStreamingResponse(
    JSON.stringify({
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: candidateJson },
          ],
        },
      ],
    })
  );
}

/**
 * OpenAI Responses API response with a nested refusal content item.
 */
function openAiRefusalResponse(): Response {
  return makeStreamingResponse(
    JSON.stringify({
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            { type: "refusal", refusal: "I cannot help with that." },
          ],
        },
      ],
    })
  );
}

// ---------------------------------------------------------------------------
// ADR-0042 — watsonx reliability: token cache, response-shape tolerance
// ---------------------------------------------------------------------------

/** IAM token response that states a cacheable lifetime. */
function iamTokenResponseWithExpiry(expiresIn = 3_600): Response {
  return makeStreamingResponse(
    JSON.stringify({ access_token: "test-iam-token", expires_in: expiresIn })
  );
}

describe("ADR-0042 watsonx reliability", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    resetIbmTokenCacheForTests();
  });

  it("reuses a cached IAM token across requests instead of re-exchanging", async () => {
    fetchMock
      .mockResolvedValueOnce(iamTokenResponseWithExpiry())
      .mockResolvedValueOnce(ibmChatResponse(validParsedCandidateJson()))
      .mockResolvedValueOnce(ibmChatResponse(validParsedCandidateJson()));

    const first = await routeToProvider("fires?", makeConfig());
    const second = await routeToProvider("fires again?", makeConfig());
    expect(first.kind).toBe("success");
    expect(second.kind).toBe("success");

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toHaveLength(3);
    expect(urls.filter((url) => url.includes("iam.cloud.ibm.com"))).toHaveLength(1);
    expect(urls.filter((url) => url.includes("ml.cloud.ibm.com"))).toHaveLength(2);
  });

  it("does not cache when IAM omits expires_in", async () => {
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(ibmChatResponse(validParsedCandidateJson()))
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(ibmChatResponse(validParsedCandidateJson()));

    await routeToProvider("fires?", makeConfig());
    await routeToProvider("fires again?", makeConfig());
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => url.includes("iam.cloud.ibm.com"))).toHaveLength(2);
  });

  it("drops the cached token after a watsonx auth failure", async () => {
    fetchMock
      .mockResolvedValueOnce(iamTokenResponseWithExpiry())
      .mockResolvedValueOnce(makeStreamingResponse("denied", 401))
      .mockResolvedValueOnce(openAiResponse(validParsedCandidateJson()))
      .mockResolvedValueOnce(iamTokenResponseWithExpiry())
      .mockResolvedValueOnce(ibmChatResponse(validParsedCandidateJson()));

    const first = await routeToProvider("fires?", makeConfig());
    expect(first.kind).toBe("success");
    if (first.kind === "success") expect(first.provider).toBe("openai");

    const second = await routeToProvider("fires again?", makeConfig());
    expect(second.kind).toBe("success");
    if (second.kind === "success") expect(second.provider).toBe("ibm");

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => url.includes("iam.cloud.ibm.com"))).toHaveLength(2);
  });

  it("accepts a completed answer with an absent finish_reason", async () => {
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(makeStreamingResponse(JSON.stringify({
        choices: [{ message: { role: "assistant", content: validParsedCandidateJson() } }],
      })));

    const result = await routeToProvider("fires?", makeConfig());
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.provider).toBe("ibm");
      expect(result.fallbackUsed).toBe(false);
    }
  });

  it("accepts assistant content delivered as an array of text parts", async () => {
    const candidate = validParsedCandidateJson();
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(makeStreamingResponse(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: candidate.slice(0, 10) },
              { type: "text", text: candidate.slice(10) },
            ],
          },
        }],
      })));

    const result = await routeToProvider("fires?", makeConfig());
    expect(result.kind).toBe("success");
    if (result.kind === "success") expect(result.provider).toBe("ibm");
  });

  it("still treats a truncated answer (finish_reason length) as incomplete", async () => {
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(makeStreamingResponse(JSON.stringify({
        choices: [{
          finish_reason: "length",
          message: { role: "assistant", content: "{\"truncated\":" },
        }],
      })))
      .mockResolvedValueOnce(openAiResponse(validParsedCandidateJson()));

    const result = await routeToProvider("fires?", makeConfig());
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.provider).toBe("openai");
      expect(result.fallbackUsed).toBe(true);
      expect(result.fallbackReason).toBe("incomplete_response");
    }
  });
});

// ---------------------------------------------------------------------------
// isAvailabilityFailure
// ---------------------------------------------------------------------------

describe("isAvailabilityFailure", () => {
  it("returns true for availability failures", () => {
    for (const reason of [
      "unconfigured",
      "auth_failure",
      "config_failure",
      "timeout",
      "network_error",
      "rate_limited",
      "server_error",
      "redirect_rejected",
      "body_too_large",
      "incomplete_response",
      "malformed_json",
      "structural_invalid",
    ]) {
      expect(isAvailabilityFailure(reason)).toBe(true);
    }
  });

  it("returns false for non-availability reasons", () => {
    for (const reason of [
      "unsupported_place",
      "unsupported_hazard",
      "invalid_input",
      "validation_failed",
      "unsafe_request",
      "unknown_error",
      "semantic_invalid",
      "provider_refusal",
    ]) {
      expect(isAvailabilityFailure(reason)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// isStructuralFailure
// ---------------------------------------------------------------------------

describe("isStructuralFailure", () => {
  it("returns true for missing required key (structural)", () => {
    const err = new ValidationError("model candidate must be an object");
    expect(isStructuralFailure(err)).toBe(true);
  });

  it("classifies by typed semantic error, not provider-controlled message text", () => {
    expect(isStructuralFailure(new SemanticModelCandidateError())).toBe(false);
    expect(
      isStructuralFailure(
        new ValidationError("model candidate contains unexpected field(s): coordinate")
      )
    ).toBe(true);
  });

  it("does not infer semantic meaning from ValidationError text", () => {
    const err = new ValidationError('sourceId "evil_source" is not in the queryable allowlist');
    expect(isStructuralFailure(err)).toBe(true);
  });

  it("returns false for non-ValidationError", () => {
    expect(isStructuralFailure(new Error("timeout"))).toBe(false);
    expect(isStructuralFailure("string")).toBe(false);
    expect(isStructuralFailure(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateIbmUrl
// ---------------------------------------------------------------------------

describe("validateIbmUrl", () => {
  it("accepts valid IBM URLs", () => {
    expect(() => validateIbmUrl("https://us-south.ml.cloud.ibm.com")).not.toThrow();
    expect(() => validateIbmUrl("https://eu-de.ml.cloud.ibm.com")).not.toThrow();
  });

  it("rejects http (non-HTTPS)", () => {
    expect(() => validateIbmUrl("http://us-south.ml.cloud.ibm.com")).toThrow();
  });

  it("rejects URL with a path segment", () => {
    expect(() => validateIbmUrl("https://us-south.ml.cloud.ibm.com/v1")).toThrow();
  });

  it("rejects URL with query string", () => {
    expect(() => validateIbmUrl("https://us-south.ml.cloud.ibm.com?evil=1")).toThrow();
  });

  it("rejects URL with credentials", () => {
    expect(() => validateIbmUrl("https://user:pass@us-south.ml.cloud.ibm.com")).toThrow();
  });

  it("rejects non-.ml.cloud.ibm.com hostname", () => {
    expect(() => validateIbmUrl("https://evil.example.com")).toThrow();
    expect(() => validateIbmUrl("https://evil-ml.cloud.ibm.com")).toThrow();
  });

  it("rejects URL with fragment", () => {
    expect(() => validateIbmUrl("https://us-south.ml.cloud.ibm.com#frag")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// OpenAI wire shape — acceptance item 1
// ---------------------------------------------------------------------------

describe("OpenAI wire shape and request schema (acceptance 1)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("parses the official nested wire shape: output[].content[].type=output_text", async () => {
    const config = makeConfig({ primaryProvider: "openai", fallbackProvider: "none" });
    fetchMock.mockResolvedValueOnce(openAiResponse(validParsedCandidateJson()));

    const result = await routeToProvider("fires near LA?", config);
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.candidate.status).toBe("parsed");
      expect(result.provider).toBe("openai");
    }
  });

  it("fails closed on a non-completed OpenAI status (incomplete)", async () => {
    const config = makeConfig({ primaryProvider: "openai", fallbackProvider: "none" });
    fetchMock.mockResolvedValueOnce(
      makeStreamingResponse(
        JSON.stringify({
          status: "incomplete",
          output: [],
        })
      )
    );

    const result = await routeToProvider("fires?", config);
    expect(result.kind).toBe("unavailable");
  });

  it("fails closed when OpenAI output[] is empty", async () => {
    const config = makeConfig({ primaryProvider: "openai", fallbackProvider: "none" });
    fetchMock.mockResolvedValueOnce(
      makeStreamingResponse(JSON.stringify({ status: "completed", output: [] }))
    );

    const result = await routeToProvider("fires?", config);
    expect(result.kind).toBe("unavailable");
  });

  it("fails closed when output contains no message type", async () => {
    const config = makeConfig({ primaryProvider: "openai", fallbackProvider: "none" });
    fetchMock.mockResolvedValueOnce(
      makeStreamingResponse(
        JSON.stringify({
          status: "completed",
          output: [{ type: "function_call", name: "get_data" }],
        })
      )
    );

    const result = await routeToProvider("fires?", config);
    expect(result.kind).toBe("unavailable");
  });

  it("fails closed when content[] has multiple output_text items (ambiguous)", async () => {
    const config = makeConfig({ primaryProvider: "openai", fallbackProvider: "none" });
    fetchMock.mockResolvedValueOnce(
      makeStreamingResponse(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                { type: "output_text", text: validParsedCandidateJson() },
                { type: "output_text", text: validParsedCandidateJson() },
              ],
            },
          ],
        })
      )
    );

    const result = await routeToProvider("fires?", config);
    expect(result.kind).toBe("unavailable");
  });

  it("fails closed when a valid output_text is accompanied by an unknown content shape", async () => {
    const config = makeConfig({ primaryProvider: "openai", fallbackProvider: "none" });
    fetchMock.mockResolvedValueOnce(
      makeStreamingResponse(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                { type: "output_text", text: validParsedCandidateJson() },
                { type: "unknown_content", value: "ignored-before-takeover" },
              ],
            },
          ],
        })
      )
    );

    const result = await routeToProvider("fires?", config);
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("fails closed when a message output is accompanied by an unknown output item", async () => {
    const config = makeConfig({ primaryProvider: "openai", fallbackProvider: "none" });
    fetchMock.mockResolvedValueOnce(
      makeStreamingResponse(
        JSON.stringify({
          status: "completed",
          output: [
            { type: "function_call", name: "unexpected" },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: validParsedCandidateJson() }],
            },
          ],
        })
      )
    );

    const result = await routeToProvider("fires?", config);
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("accepts a known reasoning item plus one assistant output_text", async () => {
    const config = makeConfig({ primaryProvider: "openai", fallbackProvider: "none" });
    fetchMock.mockResolvedValueOnce(
      makeStreamingResponse(
        JSON.stringify({
          status: "completed",
          output: [
            { type: "reasoning", summary: [] },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: validParsedCandidateJson() }],
            },
          ],
        })
      )
    );

    const result = await routeToProvider("fires?", config);
    expect(result.kind).toBe("success");
  });

  it("does not accept a top-level output_text (old non-wire shape)", async () => {
    const config = makeConfig({ primaryProvider: "openai", fallbackProvider: "none" });
    // Old incorrect shape — should NOT be accepted
    fetchMock.mockResolvedValueOnce(
      makeStreamingResponse(
        JSON.stringify({
          status: "completed",
          output_text: validParsedCandidateJson(),
          output: [],
        })
      )
    );

    const result = await routeToProvider("fires?", config);
    // output[] is empty → incomplete_response → unavailable
    expect(result.kind).toBe("unavailable");
  });

  it("sends the correct strict schema in the OpenAI request body", async () => {
    const config = makeConfig({ primaryProvider: "openai", fallbackProvider: "none" });
    fetchMock.mockResolvedValueOnce(openAiResponse(validParsedCandidateJson()));

    await routeToProvider("fires?", config);

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const schema = callBody.text?.format?.schema;
    expect(schema).toBeDefined();
    // Must have additionalProperties: false at root
    expect(schema.additionalProperties).toBe(false);
    // timeRange must be anyOf (union variants), not unconstrained object
    expect(schema.properties.timeRange.anyOf).toBeDefined();
    // Each timeRange variant must have additionalProperties: false
    for (const variant of schema.properties.timeRange.anyOf) {
      if (variant.type === "object") {
        expect(variant.additionalProperties).toBe(false);
        expect(Array.isArray(variant.required)).toBe(true);
      }
    }
    // status must have enum
    expect(schema.properties.status.enum).toContain("parsed");
    expect(schema.properties.status.enum).toContain("unsupported");
    // Exported schema constant must match what was sent
    expect(schema).toEqual(OPENAI_INTENT_SCHEMA);
  });
});

// ---------------------------------------------------------------------------
// Fallback safety boundary — acceptance item 2
// ---------------------------------------------------------------------------

describe("routeToProvider — fallback safety boundary (acceptance 2)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("malformed JSON triggers fallback (availability failure)", async () => {
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(ibmChatResponse("not-json-at-all"))
      .mockResolvedValueOnce(openAiResponse(validParsedCandidateJson()));

    const result = await routeToProvider("fires?", makeConfig());
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.provider).toBe("openai");
      expect(result.fallbackUsed).toBe(true);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("plain structural/schema-invalid object triggers fallback (availability failure)", async () => {
    // JSON is valid but schema is completely wrong (not even status key)
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(ibmChatResponse(JSON.stringify({ wrong: "shape" })))
      .mockResolvedValueOnce(openAiResponse(validParsedCandidateJson()));

    const result = await routeToProvider("fires?", makeConfig());
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.provider).toBe("openai");
      expect(result.fallbackUsed).toBe(true);
    }
  });

  it("coordinate extra key injection does NOT trigger fallback (semantic — safety boundary)", async () => {
    // Model injects a coordinate extra key → unexpected field → semantic failure
    const injected = JSON.stringify({
      status: "parsed",
      placeId: "demo-los-angeles",
      hazardId: "fire_smoke",
      timeRange: { type: "latest" },
      concern: "home",
      sourceIds: ["noaa_hms_fire_points", "noaa_hms_smoke_polygons"],
      reasonCode: null,
      coordinate: { lon: 0, lat: 0 },
    });
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(ibmChatResponse(injected));
    // fallback is configured but must NOT be called

    const result = await routeToProvider("fires?", makeConfig());
    expect(result.kind).toBe("unavailable");
    // Only IBM calls (IAM + watsonx), no OpenAI
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes("openai.com"))).toBe(false);
  });

  it("URL extra key injection does NOT trigger fallback (semantic)", async () => {
    const injected = JSON.stringify({
      status: "parsed",
      placeId: "demo-los-angeles",
      hazardId: "fire_smoke",
      timeRange: { type: "latest" },
      concern: "home",
      sourceIds: ["noaa_hms_fire_points", "noaa_hms_smoke_polygons"],
      reasonCode: null,
      url: "https://evil.example/exfiltrate",
    });
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(ibmChatResponse(injected));

    const result = await routeToProvider("fires?", makeConfig());
    expect(result.kind).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("openai.com"))).toBe(false);
  });

  it("URL material under an arbitrary extra key does NOT trigger fallback", async () => {
    const injected = JSON.stringify({
      status: "parsed",
      placeId: "demo-los-angeles",
      hazardId: "fire_smoke",
      timeRange: { type: "latest" },
      concern: "home",
      sourceIds: ["noaa_hms_fire_points", "noaa_hms_smoke_polygons"],
      reasonCode: null,
      target: "https://evil.example/exfiltrate",
    });
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(ibmChatResponse(injected));

    const result = await routeToProvider("fires?", makeConfig());
    expect(result).toEqual({ kind: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("openai.com"))).toBe(false);
  });

  it("mixed-case apiKey extra field does NOT trigger fallback", async () => {
    const injected = JSON.stringify({
      status: "parsed",
      placeId: "demo-los-angeles",
      hazardId: "fire_smoke",
      timeRange: { type: "latest" },
      concern: "home",
      sourceIds: ["noaa_hms_fire_points", "noaa_hms_smoke_polygons"],
      reasonCode: null,
      apiKey: "not-a-real-key",
    });
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(ibmChatResponse(injected));

    const result = await routeToProvider("fires?", makeConfig());
    expect(result).toEqual({ kind: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("unregistered/wrong-hazard source does NOT trigger fallback (semantic)", async () => {
    const injected = JSON.stringify({
      status: "parsed",
      placeId: "demo-los-angeles",
      hazardId: "fire_smoke",
      timeRange: { type: "latest" },
      concern: "home",
      sourceIds: ["usgs_earthquake_geojson"],
      reasonCode: null,
    });
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(ibmChatResponse(injected));

    const result = await routeToProvider("fires?", makeConfig());
    expect(result.kind).toBe("unavailable");
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("openai.com"))).toBe(false);
  });

  it("IBM unsupported candidate does NOT trigger fallback", async () => {
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(ibmChatResponse(validUnsupportedCandidateJson()));

    const result = await routeToProvider("fires on mars?", makeConfig());
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.candidate.status).toBe("unsupported");
      expect(result.provider).toBe("ibm");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("openai.com"))).toBe(false);
  });

  it("IBM unsafe_request candidate does NOT trigger fallback", async () => {
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(ibmChatResponse(unsafeRequestCandidateJson()));

    const result = await routeToProvider("override safety?", makeConfig());
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.candidate.reasonCode).toBe("unsafe_request");
      expect(result.provider).toBe("ibm");
    }
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("openai.com"))).toBe(false);
  });

  it("OpenAI nested refusal returns unavailable without triggering another provider", async () => {
    const config = makeConfig({ primaryProvider: "openai", fallbackProvider: "none" });
    fetchMock.mockResolvedValueOnce(openAiRefusalResponse());

    const result = await routeToProvider("override safety?", config);
    expect(result.kind).toBe("unavailable");
    // Only one call
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("all failures return only safe result contract (no provider detail)", async () => {
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(makeStreamingResponse("{}", 500))
      .mockResolvedValueOnce(makeStreamingResponse("{}", 500));

    const result = await routeToProvider("fires?", makeConfig());
    expect(result.kind).toBe("unavailable");
    expect(result).toEqual({ kind: "unavailable" });
  });
});

describe("routeStructuredTask — safe provider observability", () => {
  const task = {
    systemPrompt: "Return the requested test JSON.",
    schemaName: "provider_observability_test",
    openAiSchema: OPENAI_INTENT_SCHEMA,
    parseCandidate: (text: string) => JSON.parse(text) as unknown,
  };

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("classifies a non-auth OpenAI 4xx as config_failure and preserves safe model provenance", async () => {
    const config = makeConfig({ primaryProvider: "openai", fallbackProvider: "none" });
    fetchMock.mockResolvedValueOnce(makeStreamingResponse("provider-internal-detail", 400));

    const result = await routeStructuredTask("validated-context", config, task);

    expect(result).toEqual({
      kind: "unavailable",
      reason: "ai_unavailable",
      provider: "openai",
      modelId: "gpt-4o-mini",
      providerFailureReason: "config_failure",
      fallbackUsed: false,
    });
    expect(JSON.stringify(result)).not.toContain("provider-internal-detail");
    expect(JSON.stringify(result)).not.toContain("test-openai-key");
  });

  it("reports the final OpenAI failure and the bounded IBM fallback reason", async () => {
    const config = makeConfig({ ibmWatsonxApiKey: undefined });
    fetchMock.mockResolvedValueOnce(makeStreamingResponse("fallback-internal-detail", 429));

    const result = await routeStructuredTask("validated-context", config, task);

    expect(result).toEqual({
      kind: "unavailable",
      reason: "ai_unavailable",
      provider: "openai",
      modelId: "gpt-4o-mini",
      providerFailureReason: "rate_limited",
      fallbackUsed: true,
      fallbackReason: "unconfigured",
    });
    expect(JSON.stringify(result)).not.toContain("fallback-internal-detail");
  });

  it("rejects an unsafe configured model ID before fetch and does not echo it", async () => {
    const config = makeConfig({
      primaryProvider: "openai",
      fallbackProvider: "none",
      openAiModel: "unsafe\nmodel",
    });

    const result = await routeStructuredTask("validated-context", config, task);

    expect(result).toEqual({
      kind: "unavailable",
      reason: "ai_unavailable",
      provider: "openai",
      providerFailureReason: "config_failure",
      fallbackUsed: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("unsafe");
  });
});

// ---------------------------------------------------------------------------
// Timeout and body cap (acceptance item 3)
// ---------------------------------------------------------------------------

describe("routeToProvider — timeout and body cap covering full response (acceptance 3)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("fails closed when an OpenAI response body stalls until the 20-second abort", async () => {
    vi.useFakeTimers();
    const config = makeConfig({ primaryProvider: "openai", fallbackProvider: "none" });
    const stalledStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode("partial"));
      },
    });
    const stalledResponse = new Response(stalledStream, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    fetchMock.mockResolvedValueOnce(stalledResponse);

    const pending = routeToProvider("fires?", config);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;
    expect(result.kind).toBe("unavailable");
  });

  it("bounds a stalled IBM IAM body and falls back exactly once", async () => {
    vi.useFakeTimers();
    const stalledIam = new Response(new ReadableStream({ start() {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    fetchMock
      .mockResolvedValueOnce(stalledIam)
      .mockResolvedValueOnce(openAiResponse(validParsedCandidateJson()));

    const pending = routeToProvider("fires?", makeConfig());
    // ADR-0042: the IBM budget is aligned with OpenAI at 20 seconds.
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.provider).toBe("openai");
      expect(result.fallbackReason).toBe("timeout");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the body exceeds 1 MiB", async () => {
    const config = makeConfig({ primaryProvider: "openai", fallbackProvider: "none" });

    // Build a response body > 1 MiB
    const oversizedChunk = new Uint8Array(1024 * 1024 + 1).fill(65); // 1 MiB + 1 byte of 'A'
    const oversizedStream = new ReadableStream({
      start(controller) {
        controller.enqueue(oversizedChunk);
        controller.close();
      },
    });
    const oversizedResponse = new Response(oversizedStream, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    fetchMock.mockResolvedValueOnce(oversizedResponse);

    const result = await routeToProvider("fires?", config);
    expect(result.kind).toBe("unavailable");
  });

  it("IBM body cap also works: > 1 MiB IBM response fails closed", async () => {
    fetchMock.mockResolvedValueOnce(iamTokenResponse());

    const oversizedChunk = new Uint8Array(1024 * 1024 + 1).fill(65);
    const oversizedStream = new ReadableStream({
      start(controller) {
        controller.enqueue(oversizedChunk);
        controller.close();
      },
    });
    const oversizedResponse = new Response(oversizedStream, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    fetchMock.mockResolvedValueOnce(oversizedResponse);

    // With fallback configured, IBM body_too_large → OpenAI fallback
    fetchMock.mockResolvedValueOnce(openAiResponse(validParsedCandidateJson()));

    const result = await routeToProvider("fires?", makeConfig());
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.provider).toBe("openai");
      expect(result.fallbackUsed).toBe(true);
      expect(result.fallbackReason).toBe("body_too_large");
    }
  });

  it("IBM IAM body cap also works before the chat request", async () => {
    const oversizedChunk = new Uint8Array(1024 * 1024 + 1).fill(65);
    const oversizedIam = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(oversizedChunk);
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    fetchMock
      .mockResolvedValueOnce(oversizedIam)
      .mockResolvedValueOnce(openAiResponse(validParsedCandidateJson()));

    const result = await routeToProvider("fires?", makeConfig());
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.provider).toBe("openai");
      expect(result.fallbackReason).toBe("body_too_large");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// IBM success — does NOT call OpenAI (existing behavior)
// ---------------------------------------------------------------------------

describe("routeToProvider — IBM success (existing behavior)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("returns parsed candidate from IBM without calling OpenAI", async () => {
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(ibmChatResponse(validParsedCandidateJson()));

    const result = await routeToProvider("fires near LA?", makeConfig());
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.provider).toBe("ibm");
      expect(result.fallbackUsed).toBe(false);
      expect(result.candidate.status).toBe("parsed");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes("openai.com"))).toBe(false);
  });

  it("falls back to OpenAI on IBM 401 (auth_failure)", async () => {
    fetchMock
      .mockResolvedValueOnce(makeStreamingResponse("{}", 401))
      .mockResolvedValueOnce(openAiResponse(validParsedCandidateJson()));

    const result = await routeToProvider("fires?", makeConfig());
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.provider).toBe("openai");
      expect(result.fallbackUsed).toBe(true);
      expect(result.fallbackReason).toBe("auth_failure");
    }
  });

  it("falls back to OpenAI on IBM 429 (rate_limited)", async () => {
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(makeStreamingResponse("{}", 429))
      .mockResolvedValueOnce(openAiResponse(validParsedCandidateJson()));

    const result = await routeToProvider("fires?", makeConfig());
    expect(result.kind === "success" && result.fallbackReason).toBe("rate_limited");
  });

  it("falls back to OpenAI on IBM 500 (server_error)", async () => {
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(makeStreamingResponse("{}", 500))
      .mockResolvedValueOnce(openAiResponse(validParsedCandidateJson()));

    const result = await routeToProvider("fires?", makeConfig());
    expect(result.kind === "success" && result.fallbackReason).toBe("server_error");
  });

  it("falls back when IBM is unconfigured", async () => {
    const config = makeConfig({ ibmWatsonxApiKey: undefined });
    fetchMock.mockResolvedValueOnce(openAiResponse(validParsedCandidateJson()));

    const result = await routeToProvider("fires?", config);
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.provider).toBe("openai");
      expect(result.fallbackReason).toBe("unconfigured");
    }
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.every((u) => (u as string).includes("openai.com"))).toBe(true);
  });

  it("returns unavailable when both providers fail", async () => {
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(makeStreamingResponse("{}", 500))
      .mockResolvedValueOnce(makeStreamingResponse("{}", 500));

    const result = await routeToProvider("fires?", makeConfig());
    expect(result.kind).toBe("unavailable");
  });
});

// ---------------------------------------------------------------------------
// Endpoint allowlisting (existing behavior preserved)
// ---------------------------------------------------------------------------

describe("routeToProvider — endpoint allowlisting", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("calls only IBM IAM and watsonx endpoints", async () => {
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(ibmChatResponse(validParsedCandidateJson()));

    await routeToProvider("fires?", makeConfig());
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls[0]).toBe("https://iam.cloud.ibm.com/identity/token");
    expect(urls[1]).toContain(".ml.cloud.ibm.com/ml/v1/text/chat?version=2025-10-25");
    expect(urls).toHaveLength(2);
  });

  it("calls only the OpenAI responses endpoint for OpenAI primary", async () => {
    const config = makeConfig({ primaryProvider: "openai", fallbackProvider: "none" });
    fetchMock.mockResolvedValueOnce(openAiResponse(validParsedCandidateJson()));

    await routeToProvider("fires?", config);
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe("https://api.openai.com/v1/responses");
  });

  it("uses no-store cache and redirect=error on IBM watsonx call", async () => {
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(ibmChatResponse(validParsedCandidateJson()));

    await routeToProvider("fires?", makeConfig());
    const watsonxOptions = fetchMock.mock.calls[1][1] as RequestInit;
    expect(watsonxOptions.cache).toBe("no-store");
    expect(watsonxOptions.redirect).toBe("error");
  });

  it("uses the task-specific bounded output budget on IBM watsonx", async () => {
    fetchMock
      .mockResolvedValueOnce(iamTokenResponse())
      .mockResolvedValueOnce(ibmChatResponse(JSON.stringify({ ok: true })));

    await routeStructuredTask("explain", makeConfig(), {
      systemPrompt: "Return JSON.",
      schemaName: "bounded_ibm_task",
      openAiSchema: {},
      maxOutputTokens: 1_024,
      parseCandidate: (text) => JSON.parse(text) as { ok: boolean },
    });

    const watsonxBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(watsonxBody.max_completion_tokens).toBe(1_024);
    expect(watsonxBody).not.toHaveProperty("max_tokens");
    expect(watsonxBody.response_format).toEqual({ type: "json_object" });
    expect(watsonxBody.messages).toEqual([
      {
        role: "system",
        content: [
          "Return JSON.",
          "Return exactly one JSON object that conforms to this JSON Schema:",
          "<schema>",
          "{}",
          "</schema>",
          "Do not wrap the JSON in Markdown or add text before or after the object.",
        ].join("\n"),
      },
      {
        role: "user",
        content: "explain",
      },
    ]);
    const watsonxHeaders = fetchMock.mock.calls[1][1].headers as Record<string, string>;
    expect(watsonxHeaders.Accept).toBe("application/json");
  });

  it("uses no-store cache on OpenAI call", async () => {
    const config = makeConfig({ primaryProvider: "openai", fallbackProvider: "none" });
    fetchMock.mockResolvedValueOnce(openAiResponse(validParsedCandidateJson()));

    await routeToProvider("fires?", config);
    const openAiOptions = fetchMock.mock.calls[0][1] as RequestInit;
    expect(openAiOptions.cache).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------
// loadProviderConfig and environment routing (acceptance item 5)
// ---------------------------------------------------------------------------

describe("loadProviderConfig — deterministic environment routing (acceptance 5)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    fetchMock.mockReset();
  });

  it("defaults to IBM primary, OpenAI fallback when both vars absent", () => {
    // Remove both env vars
    vi.stubEnv("AI_PRIMARY_PROVIDER", "");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "");
    const config = loadProviderConfig();
    expect(config).not.toBeNull();
    expect(config?.primaryProvider).toBe("ibm");
    expect(config?.fallbackProvider).toBe("openai");
  });

  it("defaults either individually empty competition value", () => {
    vi.stubEnv("AI_PRIMARY_PROVIDER", "");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openai");
    expect(loadProviderConfig()).toMatchObject({
      primaryProvider: "ibm",
      fallbackProvider: "openai",
    });

    vi.stubEnv("AI_PRIMARY_PROVIDER", "ibm");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "");
    expect(loadProviderConfig()).toMatchObject({
      primaryProvider: "ibm",
      fallbackProvider: "openai",
    });
  });

  it("returns valid competition config: ibm + openai", () => {
    vi.stubEnv("AI_PRIMARY_PROVIDER", "ibm");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openai");
    const config = loadProviderConfig();
    expect(config?.primaryProvider).toBe("ibm");
    expect(config?.fallbackProvider).toBe("openai");
  });

  it("returns valid post-competition config: openai + none", () => {
    vi.stubEnv("AI_PRIMARY_PROVIDER", "openai");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "none");
    const config = loadProviderConfig();
    expect(config?.primaryProvider).toBe("openai");
    expect(config?.fallbackProvider).toBe("none");
  });

  it("returns null for a typo in primary (non-empty invalid value)", () => {
    vi.stubEnv("AI_PRIMARY_PROVIDER", "ibm2");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openai");
    const config = loadProviderConfig();
    expect(config).toBeNull();
  });

  it("returns null for a typo in fallback (non-empty invalid value)", () => {
    vi.stubEnv("AI_PRIMARY_PROVIDER", "ibm");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openai2");
    const config = loadProviderConfig();
    expect(config).toBeNull();
  });

  it("returns null for an invalid pair (openai + openai)", () => {
    vi.stubEnv("AI_PRIMARY_PROVIDER", "openai");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openai");
    const config = loadProviderConfig();
    expect(config).toBeNull();
  });

  it("returns valid bounded IBM-only config: ibm + none", () => {
    vi.stubEnv("AI_PRIMARY_PROVIDER", "ibm");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "none");
    vi.stubEnv("IBM_WATSONX_URL", "https://us-south.ml.cloud.ibm.com");
    vi.stubEnv("IBM_WATSONX_API_KEY", "test-key");
    vi.stubEnv("IBM_WATSONX_PROJECT_ID", "test-project");
    vi.stubEnv("IBM_WATSONX_MODEL_ID", "ibm/granite-4-h-small");
    const config = loadProviderConfig();
    expect(config).toMatchObject({
      primaryProvider: "ibm",
      fallbackProvider: "none",
      ibmWatsonxUrl: "https://us-south.ml.cloud.ibm.com",
      ibmWatsonxApiKey: "test-key",
      ibmWatsonxProjectId: "test-project",
      ibmWatsonxModelId: "ibm/granite-4-h-small",
    });
  });

  it("forces IBM-only in the bounded development launcher mode", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_BOUNDED_IBM_ONLY", "true");
    vi.stubEnv("AI_PRIMARY_PROVIDER", "ibm");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openai");
    vi.stubEnv("IBM_WATSONX_URL", "https://us-south.ml.cloud.ibm.com");
    vi.stubEnv("IBM_WATSONX_API_KEY", "test-key");
    vi.stubEnv("IBM_WATSONX_PROJECT_ID", "test-project");
    vi.stubEnv("IBM_WATSONX_MODEL_ID", "ibm/granite-4-h-small");

    expect(loadProviderConfig()).toMatchObject({
      primaryProvider: "ibm",
      fallbackProvider: "none",
    });
  });

  it("ignores the bounded IBM-only launcher flag in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_BOUNDED_IBM_ONLY", "true");
    vi.stubEnv("AI_PRIMARY_PROVIDER", "ibm");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openai");

    expect(loadProviderConfig()).toMatchObject({
      primaryProvider: "ibm",
      fallbackProvider: "openai",
    });
  });

  it("routes directly to OpenAI when primaryProvider=openai (no IBM calls)", async () => {
    vi.stubEnv("AI_PRIMARY_PROVIDER", "openai");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "none");
    const config = loadProviderConfig()!;
    config.openAiApiKey = "test-openai-key";
    config.openAiModel = "gpt-4o-mini";

    fetchMock.mockResolvedValueOnce(openAiResponse(validParsedCandidateJson()));

    const result = await routeToProvider("fires?", config);
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.provider).toBe("openai");
      expect(result.fallbackUsed).toBe(false);
    }
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes("ibm.com"))).toBe(false);
    vi.unstubAllEnvs();
  });
});
