/**
 * src/lib/ai/provider-router.ts
 *
 * WP-06 (corrected C01): Server-only AI provider router.
 *
 * Manages sequential IBM watsonx → OpenAI fallback routing.
 * Uses built-in fetch only; adds no SDK or dependency.
 * Both adapters are server-only, single attempt, no-store cache,
 * redirect rejection, full-response abort (8 seconds for IBM, 20 seconds for
 * OpenAI structured output), and a 1 MiB body cap.
 *
 * Never returns provider bodies, credentials, or error detail.
 * OpenAI is never labelled IBM. Model output is never cached or reused.
 *
 * Server-only. No client bundle.
 */

import {
  assertNoUnsafeModelProposal,
  SemanticModelCandidateError,
  validateModelCandidate,
  SYSTEM_PROMPT,
} from "@/lib/ai/intent-parser";
import type { ModelCandidate } from "@/lib/ai/intent-parser";
import { ValidationError } from "@/contracts/common";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  /** Primary provider. Default: ibm. */
  primaryProvider: "ibm" | "openai";
  /** Fallback provider. Default: openai. */
  fallbackProvider: "openai" | "none";
  // IBM
  ibmWatsonxUrl?: string;
  ibmWatsonxApiKey?: string;
  ibmWatsonxProjectId?: string;
  ibmWatsonxModelId?: string;
  // OpenAI
  openAiApiKey?: string;
  openAiModel?: string;
}

export type ProviderId = "ibm" | "openai";

/**
 * Safe, allowlisted provider outcome codes. These codes may be returned to the
 * browser or written to server logs; provider response bodies never are.
 */
export type ProviderFailureReason =
  | "unconfigured"
  | "auth_failure"
  | "config_failure"
  | "timeout"
  | "network_error"
  | "rate_limited"
  | "server_error"
  | "redirect_rejected"
  | "body_too_large"
  | "incomplete_response"
  | "malformed_json"
  | "structural_invalid"
  | "semantic_invalid"
  | "provider_refusal"
  | "unknown_error";

/**
 * Loads provider configuration from environment variables.
 *
 * Valid competition configuration: AI_PRIMARY_PROVIDER=ibm + AI_FALLBACK_PROVIDER=openai
 * Valid bounded IBM test mode: AI_PRIMARY_PROVIDER=ibm + AI_FALLBACK_PROVIDER=none
 * Valid post-competition: AI_PRIMARY_PROVIDER=openai + AI_FALLBACK_PROVIDER=none
 * Absent/empty values default to the competition configuration.
 * Any non-empty value outside the two enums, or any other pair, is invalid.
 * Invalid non-empty modes return null so the route can fail closed.
 */
export function loadProviderConfig(): ProviderConfig | null {
  const primaryRaw = process.env.AI_PRIMARY_PROVIDER ?? "";
  const fallbackRaw = process.env.AI_FALLBACK_PROVIDER ?? "";
  const primary = primaryRaw === "" ? "ibm" : primaryRaw;
  const fallback = fallbackRaw === "" ? "openai" : fallbackRaw;

  // Local bounded verification mode is deliberately separate from the normal
  // provider variables because Next may reload those values from .env.local
  // during its child-process bootstrap. It is ignored in production.
  if (
    process.env.NODE_ENV === "development" &&
    process.env.AI_BOUNDED_IBM_ONLY === "true"
  ) {
    return {
      primaryProvider: "ibm",
      fallbackProvider: "none",
      ibmWatsonxUrl: process.env.IBM_WATSONX_URL,
      ibmWatsonxApiKey: process.env.IBM_WATSONX_API_KEY,
      ibmWatsonxProjectId: process.env.IBM_WATSONX_PROJECT_ID,
      ibmWatsonxModelId: process.env.IBM_WATSONX_MODEL_ID,
    };
  }

  // Competition mode: ibm + openai
  if (primary === "ibm" && fallback === "openai") {
    return {
      primaryProvider: "ibm",
      fallbackProvider: "openai",
      ibmWatsonxUrl: process.env.IBM_WATSONX_URL,
      ibmWatsonxApiKey: process.env.IBM_WATSONX_API_KEY,
      ibmWatsonxProjectId: process.env.IBM_WATSONX_PROJECT_ID,
      ibmWatsonxModelId: process.env.IBM_WATSONX_MODEL_ID,
      openAiApiKey: process.env.OPENAI_API_KEY,
      openAiModel: process.env.OPENAI_MODEL,
    };
  }

  // Bounded IBM-only mode: preserves the real IBM outcome without attempting
  // an unconfigured or intentionally disabled fallback provider.
  if (primary === "ibm" && fallback === "none") {
    return {
      primaryProvider: "ibm",
      fallbackProvider: "none",
      ibmWatsonxUrl: process.env.IBM_WATSONX_URL,
      ibmWatsonxApiKey: process.env.IBM_WATSONX_API_KEY,
      ibmWatsonxProjectId: process.env.IBM_WATSONX_PROJECT_ID,
      ibmWatsonxModelId: process.env.IBM_WATSONX_MODEL_ID,
    };
  }

  // Post-competition mode: openai + none
  if (primary === "openai" && fallback === "none") {
    return {
      primaryProvider: "openai",
      fallbackProvider: "none",
      openAiApiKey: process.env.OPENAI_API_KEY,
      openAiModel: process.env.OPENAI_MODEL,
    };
  }

  // Any non-empty value outside the two valid pairs → invalid
  return null;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ProviderSuccess {
  kind: "success";
  candidate: ModelCandidate;
  provider: "ibm" | "openai";
  modelId: string;
  fallbackUsed: boolean;
  fallbackReason?: ProviderFailureReason;
}

export interface ProviderUnavailable {
  kind: "unavailable";
}

export type ProviderResult = ProviderSuccess | ProviderUnavailable;

/**
 * A server-only structured-output task that reuses the hardened WP-06
 * provider transport while keeping task-specific parsing and schemas local.
 */
export interface StructuredTaskDefinition<TCandidate> {
  systemPrompt: string;
  schemaName: string;
  openAiSchema: unknown;
  /** Bounded per-task response budget. Defaults to 512 and may not exceed 2048. */
  maxOutputTokens?: number;
  parseCandidate: (text: string) => TCandidate;
  classifyError?: (error: unknown) => string;
}

export interface StructuredProviderSuccess<TCandidate> {
  kind: "success";
  candidate: TCandidate;
  provider: "ibm" | "openai";
  modelId: string;
  fallbackUsed: boolean;
  fallbackReason?: ProviderFailureReason;
}

export interface StructuredProviderUnavailable {
  kind: "unavailable";
  reason: "ai_unavailable" | "ai_output_rejected";
  /** The provider that made the final attempt. */
  provider: ProviderId;
  /** Configured model identifier, when it passed the bounded format check. */
  modelId?: string;
  /** Safe reason for the final failed or rejected attempt. */
  providerFailureReason: ProviderFailureReason;
  fallbackUsed: boolean;
  /** Safe reason the primary provider yielded to the fallback. */
  fallbackReason?: ProviderFailureReason;
}

export type StructuredProviderResult<TCandidate> =
  | StructuredProviderSuccess<TCandidate>
  | StructuredProviderUnavailable;

// ---------------------------------------------------------------------------
// Fallback trigger classification
// ---------------------------------------------------------------------------

/**
 * Availability failures that permit OpenAI fallback.
 * These are infrastructure/syntax failures, NOT semantic validation failures.
 *
 * Does NOT include semantic failures: unsupported candidate, unsafe_request,
 * unregistered/wrong-hazard source, model-supplied coordinate/URL, or
 * deterministic Intent assembly failure.
 */
export function isAvailabilityFailure(reason: string): boolean {
  return (
    reason === "unconfigured" ||
    reason === "auth_failure" ||
    reason === "config_failure" ||
    reason === "timeout" ||
    reason === "network_error" ||
    reason === "rate_limited" ||
    reason === "server_error" ||
    reason === "redirect_rejected" ||
    reason === "body_too_large" ||
    reason === "incomplete_response" ||
    reason === "malformed_json" ||
    reason === "structural_invalid"
  );
}

const SAFE_FAILURE_REASONS = new Set<ProviderFailureReason>([
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
  "semantic_invalid",
  "provider_refusal",
  "unknown_error",
]);

const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const loggedFailureKeys = new Set<string>();

function normalizeFailureReason(reason: string): ProviderFailureReason {
  return SAFE_FAILURE_REASONS.has(reason as ProviderFailureReason)
    ? reason as ProviderFailureReason
    : "unknown_error";
}

function requireSafeModelId(modelId: string | undefined): string {
  if (!modelId) throw new Error("unconfigured");
  if (!SAFE_MODEL_ID.test(modelId)) throw new Error("config_failure");
  return modelId;
}

function configuredModelId(config: ProviderConfig, provider: ProviderId): string | undefined {
  const modelId = provider === "ibm" ? config.ibmWatsonxModelId : config.openAiModel;
  return modelId && SAFE_MODEL_ID.test(modelId) ? modelId : undefined;
}

function unavailableResult(
  config: ProviderConfig,
  schemaName: string,
  provider: ProviderId,
  providerFailureReason: ProviderFailureReason,
  fallbackUsed: boolean,
  fallbackReason?: ProviderFailureReason
): StructuredProviderUnavailable {
  const reason = isAvailabilityFailure(providerFailureReason)
    ? "ai_unavailable"
    : "ai_output_rejected";
  const modelId = configuredModelId(config, provider);
  const result: StructuredProviderUnavailable = {
    kind: "unavailable",
    reason,
    provider,
    ...(modelId ? { modelId } : {}),
    providerFailureReason,
    fallbackUsed,
    ...(fallbackReason ? { fallbackReason } : {}),
  };

  if (process.env.NODE_ENV !== "test") {
    const safeModelId = modelId ?? "not_configured";
    const logKey = [
      schemaName,
      reason,
      provider,
      safeModelId,
      providerFailureReason,
      String(fallbackUsed),
      fallbackReason ?? "none",
    ].join("|");
    if (!loggedFailureKeys.has(logKey)) {
      loggedFailureKeys.add(logKey);
      console.warn("[ai-provider] structured task unavailable", {
        schemaName,
        reason,
        provider,
        modelId: safeModelId,
        providerFailureReason,
        fallbackUsed,
        fallbackReason,
      });
    }
  }

  return result;
}

/**
 * Returns true when a parse/validation error is a structural availability
 * failure (malformed JSON or structural mismatch) that permits fallback.
 *
 * Returns false for semantic failures (unsafe values, unallowlisted sources,
 * wrong-hazard sources, injected coordinates/URLs) which must fail closed
 * without calling another provider.
 */
export function isStructuralFailure(err: unknown): boolean {
  return err instanceof ValidationError && !(err instanceof SemanticModelCandidateError);
}

// ---------------------------------------------------------------------------
// IBM watsonx adapter
// ---------------------------------------------------------------------------

/** Validates that the IBM URL is a plain HTTPS origin ending in .ml.cloud.ibm.com */
export function validateIbmUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("config_failure");
  }
  if (parsed.protocol !== "https:") throw new Error("config_failure");
  if (!parsed.hostname.endsWith(".ml.cloud.ibm.com")) throw new Error("config_failure");
  if (parsed.pathname !== "/" && parsed.pathname !== "") throw new Error("config_failure");
  if (parsed.search !== "") throw new Error("config_failure");
  if (parsed.username !== "" || parsed.password !== "") throw new Error("config_failure");
  if (parsed.hash !== "") throw new Error("config_failure");
}

const IBM_IAM_URL = "https://iam.cloud.ibm.com/identity/token";
// IBM's Granite 4 watsonx chat example uses this API version. Keep it explicit
// and covered by transport tests so it cannot drift silently.
const IBM_WATSONX_PATH = "/ml/v1/text/chat?version=2025-10-25";
/**
 * ADR-0042: aligned with the OpenAI budget. The original 8-second IBM budget
 * predated the structured evidence task and caused routine timeouts while
 * Granite generated large JSON answers, silently pushing traffic to the
 * fallback provider.
 */
const IBM_FETCH_TIMEOUT_MS = 20_000;
const OPENAI_FETCH_TIMEOUT_MS = 20_000;
const BODY_CAP_BYTES = 1 * 1024 * 1024; // 1 MiB

/**
 * Reads a response body with a cap, sharing the AbortController from the caller.
 * The signal must already be armed; if it fires during body read the reader
 * will fail and we map it to "timeout". Exceeding 1 MiB throws "body_too_large".
 */
async function readBodyWithCap(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("body_too_large");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await readChunkWithAbort(reader, signal);
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > BODY_CAP_BYTES) {
          reader.cancel().catch(() => undefined);
          throw new Error("body_too_large");
        }
        chunks.push(value);
      }
    }
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.message === "timeout")) {
      reader.cancel().catch(() => undefined);
      throw new Error("timeout");
    }
    if (err instanceof Error && err.message === "body_too_large") throw err;
    reader.cancel().catch(() => undefined);
    throw new Error("network_error");
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

/**
 * Races each body read against the request signal. This keeps mocked and
 * platform fetch streams bounded even when a reader never resolves on abort.
 */
function readChunkWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      void reader.cancel().catch(() => undefined);
      reject(new Error("timeout"));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

/**
 * Fetches with a single AbortController covering both headers and body read.
 * Returns the Response and the controller so callers can pass the signal to readBodyWithCap.
 * Does NOT clear the timer — callers must cancel the controller after body consumption.
 */
async function fetchWithAbort(
  url: string,
  init: RequestInit,
  controller: AbortController
): Promise<Response> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "error",
    });
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("timeout");
    }
    if (err instanceof Error && err.message.toLowerCase().includes("redirect")) {
      throw new Error("redirect_rejected");
    }
    throw new Error("network_error");
  }
}

/**
 * ADR-0042: IAM token cache. IBM IAM tokens are valid for about an hour, but
 * every request previously paid a fresh token exchange inside the same fetch
 * budget as the model call — doubling latency and doubling the chances the
 * primary provider was classified unavailable. The token is cached per API
 * key with a safety margin and dropped on any watsonx auth failure.
 */
const IBM_TOKEN_EXPIRY_MARGIN_MS = 60_000;
let ibmTokenCache: { apiKey: string; token: string; expiresAtMs: number } | null = null;

/** Test hook: token caching must never leak between isolated test cases. */
export function resetIbmTokenCacheForTests(): void {
  ibmTokenCache = null;
}

function invalidateIbmTokenCache(): void {
  ibmTokenCache = null;
}

/** Exchange IBM Cloud API key for an IAM access token (cached). */
async function getIbmToken(apiKey: string): Promise<string> {
  if (
    ibmTokenCache &&
    ibmTokenCache.apiKey === apiKey &&
    Date.now() < ibmTokenCache.expiresAtMs
  ) {
    return ibmTokenCache.token;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IBM_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchWithAbort(
      IBM_IAM_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: `grant_type=urn%3Aibm%3Aparams%3Aoauth%3Agrant-type%3Aapikey&apikey=${encodeURIComponent(apiKey)}`,
        cache: "no-store",
      },
      controller
    );
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("auth_failure");
      if (response.status === 429) throw new Error("rate_limited");
      if (response.status >= 500) throw new Error("server_error");
      throw new Error("auth_failure");
    }
    const body = await readBodyWithCap(response, controller.signal);
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error("malformed_json");
    }
    if (
      typeof json !== "object" ||
      json === null ||
      typeof (json as Record<string, unknown>).access_token !== "string"
    ) {
      throw new Error("structural_invalid");
    }
    const accessToken = (json as Record<string, unknown>).access_token as string;
    // ADR-0042: cache only when IAM stated a sane lifetime; otherwise the
    // token is used once and the next request exchanges again.
    const expiresIn = (json as Record<string, unknown>).expires_in;
    if (
      typeof expiresIn === "number" &&
      Number.isFinite(expiresIn) &&
      expiresIn >= 120 &&
      expiresIn <= 86_400
    ) {
      ibmTokenCache = {
        apiKey,
        token: accessToken,
        expiresAtMs: Date.now() + expiresIn * 1000 - IBM_TOKEN_EXPIRY_MARGIN_MS,
      };
    }
    return accessToken;
  } finally {
    clearTimeout(timer);
    controller.abort(); // ensure body reader sees abort if abandoned
  }
}

/**
 * ADR-0042: watsonx chat message content may arrive as a plain string or as
 * an array of text parts. Both are the model answering; only genuinely
 * missing or non-text content stays an incomplete response.
 */
function normalizeChatContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const part of content) {
      if (
        part === null ||
        typeof part !== "object" ||
        typeof (part as Record<string, unknown>).text !== "string"
      ) {
        return null;
      }
      texts.push((part as Record<string, unknown>).text as string);
    }
    return texts.length > 0 ? texts.join("") : null;
  }
  return null;
}

/** Call IBM watsonx chat API. Returns raw model text. */
async function callIbmWatsonx(
  config: ProviderConfig,
  userText: string,
  task: Pick<
    StructuredTaskDefinition<unknown>,
    "systemPrompt" | "openAiSchema" | "maxOutputTokens"
  >
): Promise<{ text: string; modelId: string }> {
  const { ibmWatsonxUrl, ibmWatsonxApiKey, ibmWatsonxProjectId, ibmWatsonxModelId } = config;
  if (!ibmWatsonxUrl || !ibmWatsonxApiKey || !ibmWatsonxProjectId || !ibmWatsonxModelId) {
    throw new Error("unconfigured");
  }
  const safeModelId = requireSafeModelId(ibmWatsonxModelId);
  validateIbmUrl(ibmWatsonxUrl);
  const maxOutputTokens = task.maxOutputTokens ?? 512;
  if (
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 64 ||
    maxOutputTokens > 2_048
  ) throw new Error("config_failure");

  let schemaJson: string | undefined;
  try {
    schemaJson = JSON.stringify(task.openAiSchema);
  } catch {
    throw new Error("config_failure");
  }
  if (!schemaJson || schemaJson.length > 32_768) throw new Error("config_failure");
  const structuredSystemPrompt = `${task.systemPrompt}
Return exactly one JSON object that conforms to this JSON Schema:
<schema>
${schemaJson}
</schema>
Do not wrap the JSON in Markdown or add text before or after the object.`;

  const token = await getIbmToken(ibmWatsonxApiKey);
  const endpoint = `${ibmWatsonxUrl.replace(/\/+$/, "")}${IBM_WATSONX_PATH}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IBM_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchWithAbort(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model_id: safeModelId,
          project_id: ibmWatsonxProjectId,
          messages: [
            { role: "system", content: structuredSystemPrompt },
            { role: "user", content: userText },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
          max_completion_tokens: maxOutputTokens,
        }),
        cache: "no-store",
      },
      controller
    );

    if (response.redirected) throw new Error("redirect_rejected");
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        // ADR-0042: a rejected bearer token may simply be expired or revoked;
        // drop the cache so the next request exchanges a fresh one.
        invalidateIbmTokenCache();
        throw new Error("auth_failure");
      }
      if (response.status === 408) throw new Error("timeout");
      if (response.status === 429) throw new Error("rate_limited");
      if (response.status >= 500) throw new Error("server_error");
      throw new Error("config_failure");
    }

    const body = await readBodyWithCap(response, controller.signal);
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error("malformed_json");
    }

    // Require a completed assistant text response
    const j = json as Record<string, unknown>;
    const choices = j.choices;
    if (!Array.isArray(choices) || choices.length === 0) throw new Error("incomplete_response");
    const choice = choices[0] as Record<string, unknown>;
    if (!choice || typeof choice !== "object") throw new Error("incomplete_response");
    // ADR-0042: "stop" and an absent finish_reason are completed answers;
    // any other stated reason (for example "length") is still incomplete —
    // a truncated JSON answer must never be parsed as if it were whole.
    const finishReason = choice.finish_reason;
    if (finishReason !== undefined && finishReason !== null && finishReason !== "stop") {
      throw new Error("incomplete_response");
    }
    const message = choice.message as Record<string, unknown> | undefined;
    if (
      message &&
      typeof message.refusal === "string" &&
      message.refusal.trim().length > 0
    ) {
      throw new Error("provider_refusal");
    }
    const contentText = message ? normalizeChatContent(message.content) : null;
    if (contentText === null || contentText.trim().length === 0) {
      throw new Error("incomplete_response");
    }

    return { text: contentText, modelId: safeModelId };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// ---------------------------------------------------------------------------
// OpenAI adapter — official Responses REST wire shape
// ---------------------------------------------------------------------------

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

/**
 * The strict JSON Schema for the intent candidate sent to OpenAI Structured Outputs.
 * Every object must have additionalProperties:false; every field in an object must be required.
 * Uses anyOf for nullable fields and for the timeRange union.
 */
export const OPENAI_INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "placeId",
    "hazardId",
    "timeRange",
    "concern",
    "sourceIds",
    "reasonCode",
  ],
  properties: {
    status: {
      type: "string",
      enum: ["parsed", "unsupported"],
    },
    placeId: {
      anyOf: [
        {
          type: "string",
          // UXFIX-02: kept in sync with intent-parser PARSED_PLACE_IDS.
          enum: ["demo-los-angeles", "demo-lake-michigan", "demo-houston", "demo-tucson"],
        },
        { type: "null" },
      ],
    },
    hazardId: {
      anyOf: [
        {
          type: "string",
          enum: [
            "fire_smoke",
            "flood_storm",
            "extreme_heat",
            "drought_land",
            "air_quality",
            "earth_volcanoes",
          ],
        },
        { type: "null" },
      ],
    },
    timeRange: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["type"],
          properties: {
            type: { type: "string", enum: ["latest", "past_7d"] },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "startTs", "endTs"],
          properties: {
            type: { type: "string", enum: ["custom"] },
            startTs: { type: "string" },
            endTs: { type: "string" },
          },
        },
        { type: "null" },
      ],
    },
    concern: {
      anyOf: [
        {
          type: "string",
          enum: ["home", "health", "pets", "travel", "power_internet", "community"],
        },
        { type: "null" },
      ],
    },
    sourceIds: {
      type: "array",
      items: {
        type: "string",
        // UXFIX-02: kept in sync with the intent-parser hazard route rules.
        enum: [
          "noaa_hms_fire_points",
          "noaa_hms_smoke_polygons",
          "nasa_gibs_imerg",
          "nasa_lance_flood_extent",
          "usgs_instantaneous_values",
          "nasa_gibs_modis_lst_day",
          "noaa_uscrn_heat_exposure",
          "nws_station_observations",
          "noaa_ncei_global_hourly",
        ],
      },
    },
    reasonCode: {
      anyOf: [
        {
          type: "string",
          enum: [
            "unsupported_place",
            "unsupported_hazard",
            "unsupported_time",
            "unsupported_request",
            "unsafe_request",
          ],
        },
        { type: "null" },
      ],
    },
  },
};

/** Call OpenAI Responses API with strict JSON Schema output. */
async function callOpenAi(
  config: ProviderConfig,
  userText: string,
  task: Pick<
    StructuredTaskDefinition<unknown>,
    "systemPrompt" | "schemaName" | "openAiSchema" | "maxOutputTokens"
  >
): Promise<{ text: string; modelId: string }> {
  const { openAiApiKey, openAiModel } = config;
  if (!openAiApiKey || !openAiModel) throw new Error("unconfigured");
  const safeModelId = requireSafeModelId(openAiModel);
  const maxOutputTokens = task.maxOutputTokens ?? 512;
  if (
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 64 ||
    maxOutputTokens > 2_048
  ) throw new Error("config_failure");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchWithAbort(
      OPENAI_RESPONSES_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAiApiKey}`,
        },
        body: JSON.stringify({
          model: safeModelId,
          store: false,
          max_output_tokens: maxOutputTokens,
          input: [
            { role: "system", content: task.systemPrompt },
            { role: "user", content: userText },
          ],
          text: {
            format: {
              type: "json_schema",
              name: task.schemaName,
              strict: true,
              schema: task.openAiSchema,
            },
          },
        }),
        cache: "no-store",
      },
      controller
    );

    if (response.redirected) throw new Error("redirect_rejected");
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("auth_failure");
      if (response.status === 408) throw new Error("timeout");
      if (response.status === 429) throw new Error("rate_limited");
      if (response.status >= 500) throw new Error("server_error");
      throw new Error("config_failure");
    }

    const body = await readBodyWithCap(response, controller.signal);
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error("malformed_json");
    }

    // Require status="completed"
    const j = json as Record<string, unknown>;
    if (j.status !== "completed") {
      if (j.status === "failed") throw new Error("server_error");
      throw new Error("incomplete_response");
    }

    // Find exactly one unambiguous assistant output_text content item.
    // Known reasoning items may accompany a structured response; every other
    // output/content shape is rejected rather than silently ignored.
    // Official Responses REST wire shape: output[] contains message objects with content[]
    if (!Array.isArray(j.output) || j.output.length === 0) {
      throw new Error("incomplete_response");
    }

    let outputText: string | null = null;
    for (const outputItem of j.output as unknown[]) {
      if (typeof outputItem !== "object" || outputItem === null || Array.isArray(outputItem)) {
        throw new Error("incomplete_response");
      }
      const item = outputItem as Record<string, unknown>;
      if (item.type === "reasoning") continue;
      if (item.type !== "message" || item.role !== "assistant") {
        throw new Error("incomplete_response");
      }
      const contentArr = item.content;
      if (!Array.isArray(contentArr) || contentArr.length === 0) {
        throw new Error("incomplete_response");
      }
      for (const contentItem of contentArr as unknown[]) {
        if (
          typeof contentItem !== "object" ||
          contentItem === null ||
          Array.isArray(contentItem)
        ) {
          throw new Error("incomplete_response");
        }
        const ci = contentItem as Record<string, unknown>;
        if (ci.type === "refusal") {
          // Provider-explicit refusal — fail closed, no fallback
          throw new Error("provider_refusal");
        }
        if (ci.type === "output_text") {
          if (typeof ci.text !== "string" || ci.text.trim().length === 0) {
            throw new Error("incomplete_response");
          }
          if (outputText !== null) {
            // Multiple text items — ambiguous
            throw new Error("incomplete_response");
          }
          outputText = ci.text;
          continue;
        }
        throw new Error("incomplete_response");
      }
    }

    if (outputText === null) {
      throw new Error("incomplete_response");
    }

    return { text: outputText, modelId: safeModelId };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// ---------------------------------------------------------------------------
// Generic structured router and intent compatibility API
// ---------------------------------------------------------------------------

/**
 * Runs one typed structured-output task through the exact ADR-0013 provider
 * order. Only availability or structural failures from IBM may use OpenAI.
 * Semantic/unsafe output and provider refusal fail closed without fallback.
 */
export async function routeStructuredTask<TCandidate>(
  userText: string,
  config: ProviderConfig,
  task: StructuredTaskDefinition<TCandidate>
): Promise<StructuredProviderResult<TCandidate>> {
  const primaryIsIbm = config.primaryProvider !== "openai";
  let fallbackReason: ProviderFailureReason | undefined;

  if (primaryIsIbm) {
    // Try IBM first
    try {
      const { text, modelId } = await callIbmWatsonx(config, userText, task);
      const candidate = task.parseCandidate(text);
      return {
        kind: "success",
        candidate,
        provider: "ibm",
        modelId,
        fallbackUsed: false,
      };
    } catch (err) {
      const reason = classifyTaskError(err, task);
      // Only availability failures permit fallback
      if (!isAvailabilityFailure(reason)) {
        return unavailableResult(
          config,
          task.schemaName,
          "ibm",
          reason,
          false
        );
      }
      fallbackReason = reason;
      // Fall through to OpenAI fallback below
    }

    // Fallback to OpenAI if permitted
    if (config.fallbackProvider !== "none") {
      // ADR-0042: a successful fallback previously left no trace of WHY the
      // primary failed, which made frequent silent fallbacks undiagnosable.
      if (process.env.NODE_ENV !== "test") {
        const logKey = `fallback-success|${task.schemaName}|${fallbackReason}`;
        if (!loggedFailureKeys.has(logKey)) {
          loggedFailureKeys.add(logKey);
          console.warn("[ai-provider] primary provider failed; using fallback", {
            schemaName: task.schemaName,
            primary: "ibm",
            primaryFailureReason: fallbackReason,
          });
        }
      }
      try {
        const { text, modelId } = await callOpenAi(config, userText, task);
        const candidate = task.parseCandidate(text);
        return {
          kind: "success",
          candidate,
          provider: "openai",
          modelId,
          fallbackUsed: true,
          fallbackReason,
        };
      } catch (err) {
        const reason = classifyTaskError(err, task);
        return unavailableResult(
          config,
          task.schemaName,
          "openai",
          reason,
          true,
          fallbackReason
        );
      }
    }
    return unavailableResult(
      config,
      task.schemaName,
      "ibm",
      fallbackReason ?? "unknown_error",
      false
    );
  } else {
    // Primary is OpenAI (post-competition config)
    try {
      const { text, modelId } = await callOpenAi(config, userText, task);
      const candidate = task.parseCandidate(text);
      return {
        kind: "success",
        candidate,
        provider: "openai",
        modelId,
        fallbackUsed: false,
      };
    } catch (err) {
      const reason = classifyTaskError(err, task);
      return unavailableResult(
        config,
        task.schemaName,
        "openai",
        reason,
        false
      );
    }
  }
}

/**
 * Routes the original WP-06 intent task without changing its public result
 * contract or fallback behavior.
 */
export async function routeToProvider(
  userText: string,
  config: ProviderConfig
): Promise<ProviderResult> {
  const result = await routeStructuredTask(userText, config, {
    systemPrompt: SYSTEM_PROMPT,
    schemaName: "intent_candidate",
    openAiSchema: OPENAI_INTENT_SCHEMA,
    parseCandidate: parseCandidateSafely,
    classifyError,
  });

  if (result.kind === "unavailable") return { kind: "unavailable" };
  return result;
}

/**
 * Parses and validates a model output string into a ModelCandidate.
 *
 * Throws the original ValidationError (not re-wrapped) so callers can
 * distinguish structural from semantic failures with isStructuralFailure().
 *
 * JSON parse failure throws Error("malformed_json").
 */
function parseCandidateSafely(text: string): ModelCandidate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("malformed_json");
  }
  // Semantic proposals are typed explicitly so fallback classification never
  // depends on provider-controlled validation-message text.
  assertNoUnsafeModelProposal(parsed);
  validateModelCandidate(parsed);
  return parsed as ModelCandidate;
}

/**
 * Classifies an error into a reason string for isAvailabilityFailure.
 * ValidationError from parseCandidateSafely is classified as structural
 * (availability failure) only if isStructuralFailure returns true;
 * otherwise it is classified as "semantic_invalid" (not an availability failure).
 */
function classifyError(err: unknown): string {
  if (err instanceof Error) {
    // ValidationError from candidate schema validation
    if (err instanceof ValidationError) {
      return isStructuralFailure(err) ? "structural_invalid" : "semantic_invalid";
    }
    return err.message;
  }
  return "unknown";
}

function classifyTaskError<TCandidate>(
  err: unknown,
  task: StructuredTaskDefinition<TCandidate>
): ProviderFailureReason {
  const reason = task.classifyError?.(err) ?? (err instanceof Error ? err.message : "unknown_error");
  if (SAFE_FAILURE_REASONS.has(reason as ProviderFailureReason)) {
    return normalizeFailureReason(reason);
  }
  return err instanceof ValidationError ? "semantic_invalid" : "unknown_error";
}
