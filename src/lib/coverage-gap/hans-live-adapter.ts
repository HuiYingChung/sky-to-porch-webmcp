import { createHash } from "crypto";
import type { BoundingBox } from "@/contracts/common";
import { validateQueryArea } from "@/lib/location/query-area";

type FetchLike = typeof fetch;

export const HANS_HOST = "volcanoes.usgs.gov";
export const HANS_VOLCANO_PATH = "/hans-public/api/volcano/getUSVolcanoes";
export const HANS_SEARCH_PATH = "/hans-public/api/search/search";
export const HANS_TIMEOUT_MS = 10_000;
export const HANS_MAX_BYTES = 4_000_000;
export const HANS_VOLCANO_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export const HANS_NOTICE_CACHE_TTL_MS = 5 * 60 * 1_000;
export const HANS_MAX_CONCURRENCY = 2;
export const HANS_MAX_NOTICES = 20;

export type HansFailureReason =
  | "rate_limited"
  | "timeout"
  | "network"
  | "redirect"
  | "oversize"
  | "media_type"
  | "malformed"
  | "schema_validation"
  | "provider_failure";

export type HansJsonType =
  | "array"
  | "boolean"
  | "missing"
  | "null"
  | "number"
  | "object"
  | "string";

export interface HansSchemaDiagnostic {
  path: string;
  expected: string;
  actualType: HansJsonType;
}

export interface HansVolcano {
  volcanoCode: string;
  volcanoName: string;
  latitude: number;
  longitude: number;
  observatoryAbbreviation: string;
}

export interface HansObservation {
  observationId: string;
  provenance: {
    sourceId: "usgs_volcano_hans";
    sourceUrl: string;
    sourceRecordId: string;
    retrievedAt: string;
    observedAt: string;
    product: string;
    payloadHash: string;
    requestParameters: Record<string, string>;
  };
  variableName: "USGS volcano activity notice";
  textValue: string;
  dataMode: "live";
  qualifiers: string[];
  metadata: Record<string, string | number>;
}

export type HansResult =
  | { kind: "observations"; observations: HansObservation[]; applicableVolcanoCount: number }
  | { kind: "no_observation"; stage: "geographic_applicability" | "notice_search" }
  | {
      kind: "source_failure";
      reason: HansFailureReason;
      stage: "volcano_inventory" | "notice_search";
      schemaDiagnostic?: HansSchemaDiagnostic;
    };

export interface HansDependencies {
  fetchImpl?: FetchLike;
  now?: () => Date;
  inventoryCache?: false;
}

class HansError extends Error {
  constructor(
    readonly reason: HansFailureReason,
    readonly schemaDiagnostic?: HansSchemaDiagnostic
  ) {
    super(reason);
    this.name = "HansError";
  }
}

let inventoryCache: { expiresAt: number; volcanoes: HansVolcano[] } | null = null;
const noticeCache = new Map<string, { expiresAt: number; result: HansResult }>();
let activeRequests = 0;
const requestWaiters: Array<() => void> = [];

async function withHansConcurrency<T>(work: () => Promise<T>): Promise<T> {
  if (activeRequests >= HANS_MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => requestWaiters.push(resolve));
  }
  activeRequests += 1;
  try {
    return await work();
  } finally {
    activeRequests -= 1;
    requestWaiters.shift()?.();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonType(value: unknown): HansJsonType {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "object";
}

function schemaFailure(path: string, expected: string, actual: unknown): never {
  throw new HansError("schema_validation", {
    path,
    expected,
    actualType: jsonType(actual),
  });
}

async function readBody(response: Response): Promise<Uint8Array> {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null) {
    const length = Number(lengthHeader);
    if (!Number.isInteger(length) || length < 0 || length > HANS_MAX_BYTES) {
      throw new HansError("oversize");
    }
  }
  if (!response.body) throw new HansError("malformed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > HANS_MAX_BYTES) {
      await reader.cancel();
      throw new HansError("oversize");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isJsonMediaType(rawContentType: string): boolean {
  const base = rawContentType.split(";", 1)[0].trim().toLowerCase();
  return base === "application/json" ||
    /^application\/[a-z0-9!#$%&'*+\-.^_`|~]+\+json$/u.test(base);
}

async function requestJson(
  fetchImpl: FetchLike,
  url: URL,
  init: RequestInit
): Promise<{ bytes: Uint8Array; value: unknown }> {
  if (url.protocol !== "https:" || url.hostname !== HANS_HOST ||
    (url.pathname !== HANS_VOLCANO_PATH && url.pathname !== HANS_SEARCH_PATH)) {
    throw new HansError("schema_validation");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HANS_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await withHansConcurrency(() => fetchImpl(url, {
          ...init,
          redirect: "manual",
          cache: "no-store",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
        }));
    } catch {
      throw new HansError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) throw new HansError("redirect");
    if (response.status === 429) throw new HansError("rate_limited");
    if (!response.ok) throw new HansError("provider_failure");
    const rawContentType = response.headers.get("content-type") ?? "";
    const jsonLabelled = isJsonMediaType(rawContentType);
    let bytes: Uint8Array;
    try {
      bytes = await readBody(response);
    } catch (error) {
      if (error instanceof HansError) throw error;
      throw new HansError(controller.signal.aborted ? "timeout" : "network");
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text: string;
    try {
      text = decoder.decode(bytes);
    } catch {
      throw new HansError(jsonLabelled ? "malformed" : "media_type");
    }
    let value: unknown;
    if (jsonLabelled) {
      try {
        value = JSON.parse(text);
      } catch {
        throw new HansError("malformed");
      }
    } else {
      // Missing or non-JSON content-type: accept only a raw JSON object or array
      // after an optional UTF-8 BOM/whitespace; reject HTML, JSONP, callbacks, assignments.
      const trimmed = text.replace(/^\uFEFF/, "").trimStart();
      if (trimmed[0] !== "{" && trimmed[0] !== "[") throw new HansError("media_type");
      try {
        value = JSON.parse(trimmed);
      } catch {
        throw new HansError("media_type");
      }
      if (typeof value !== "object" || value === null) throw new HansError("media_type");
    }
    return { bytes, value };
  } finally {
    clearTimeout(timeout);
  }
}

export function parseHansVolcanoes(value: unknown): HansVolcano[] {
  if (!Array.isArray(value)) throw new HansError("schema_validation");
  if (value.length > 2_000) throw new HansError("oversize");
  const result: HansVolcano[] = [];
  const codes = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) throw new HansError("schema_validation");
    const code = item.volcano_cd;
    const name = item.volcano_name;
    const latitude = Number(item.latitude);
    const longitude = Number(item.longitude);
    const observatory = item.obs_abbr;
    if (
      typeof code !== "string" || !/^[a-z0-9-]{2,20}$/u.test(code) || codes.has(code) ||
      typeof name !== "string" || name.trim().length === 0 ||
      typeof observatory !== "string" || observatory.trim().length === 0 ||
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    ) throw new HansError("schema_validation");
    codes.add(code);
    result.push({
      volcanoCode: code,
      volcanoName: name.trim(),
      latitude,
      longitude,
      observatoryAbbreviation: observatory.trim(),
    });
  }
  return result;
}

type ParsedNotice = {
  noticeIdentifier: string;
  volcanoCodes: string[];
  volcanoNames: string[];
  sentAt: string;
  noticeType: string;
  noticeVariants: Array<"notice" | "vona">;
  observatory: string;
  sourceUrl: string;
};

type ParsedNoticeVariant = {
  signature: string;
  noticeType: string;
  sourceUrl: string;
};

type ParsedNoticeBundle = {
  noticeIdentifier: string;
  volcanoCodes: string[];
  sentAt: string;
  observatory: string;
  contextSignature: string;
  variants: Map<"notice" | "vona", ParsedNoticeVariant>;
};

function noticeArray(value: unknown): unknown[] {
  if (!isRecord(value)) schemaFailure("$", "object", value);
  if (typeof value.noticeTotal !== "number" || !Number.isSafeInteger(value.noticeTotal) ||
    value.noticeTotal < 0) {
    schemaFailure("$.noticeTotal", "safe non-negative integer", value.noticeTotal);
  }
  if (!Array.isArray(value.noticeData)) {
    schemaFailure("$.noticeData", "array", value.noticeData);
  }
  if (value.noticeTotal !== value.noticeData.length) {
    schemaFailure("$.noticeTotal", "equal to $.noticeData.length", value.noticeTotal);
  }
  return value.noticeData;
}

function parseNotices(
  value: unknown,
  applicableVolcanoes: Map<string, HansVolcano>,
  date: string
): ParsedNotice[] {
  const values = noticeArray(value);
  if (values.length > HANS_MAX_NOTICES) throw new HansError("oversize");
  const bundles = new Map<string, ParsedNoticeBundle>();
  for (const item of values) {
    if (!isRecord(item)) schemaFailure("$.noticeData[]", "object", item);
    if (typeof item.noticeIdentifier !== "string" || item.noticeIdentifier.length === 0 ||
      item.noticeIdentifier.length > 200 || /[\u0000-\u001f\u007f]/u.test(item.noticeIdentifier)) {
      schemaFailure(
        "$.noticeData[].noticeIdentifier",
        "non-empty identifier up to 200 characters without controls",
        item.noticeIdentifier
      );
    }
    if (typeof item.sentUtc !== "string") {
      schemaFailure("$.noticeData[].sentUtc", "UTC date-time string", item.sentUtc);
    }
    if (typeof item.sentUnixtime !== "number" || !Number.isSafeInteger(item.sentUnixtime)) {
      schemaFailure("$.noticeData[].sentUnixtime", "safe integer epoch seconds", item.sentUnixtime);
    }
    if (typeof item.noticeTypeCd !== "string" || item.noticeTypeCd.length === 0 ||
      item.noticeTypeCd.length > 16) {
      schemaFailure(
        "$.noticeData[].noticeTypeCd",
        "non-empty notice type up to 16 characters",
        item.noticeTypeCd
      );
    }
    if (typeof item.volcCds !== "string") {
      schemaFailure("$.noticeData[].volcCds", "comma-separated volcano codes", item.volcCds);
    }
    if (typeof item.obsAbbr !== "string" || item.obsAbbr.length === 0 || item.obsAbbr.length > 16) {
      schemaFailure(
        "$.noticeData[].obsAbbr",
        "non-empty observatory abbreviation up to 16 characters",
        item.obsAbbr
      );
    }
    if (typeof item.noticeHtml !== "string") {
      schemaFailure("$.noticeData[].noticeHtml", "string", item.noticeHtml);
    }
    if (typeof item.permLink !== "string") {
      schemaFailure("$.noticeData[].permLink", "absolute HTTPS HANS permalink", item.permLink);
    }
    const allCodes = item.volcCds.split(",").map((code) => code.trim());
    if (allCodes.length === 0 || allCodes.some((code) => !/^[a-z0-9-]{2,20}$/u.test(code)) ||
      new Set(allCodes).size !== allCodes.length) {
      schemaFailure(
        "$.noticeData[].volcCds",
        "comma-separated unique volcano codes",
        item.volcCds
      );
    }
    let permalink: URL;
    let permalinkPath: string;
    try {
      permalink = new URL(item.permLink);
      permalinkPath = decodeURIComponent(permalink.pathname);
    } catch {
      schemaFailure("$.noticeData[].permLink", "absolute HTTPS HANS permalink", item.permLink);
    }
    const allowedPaths = [
      `/hans-public/notice/${item.noticeIdentifier}`,
      `/hans-public/vona/${item.noticeIdentifier}`,
    ];
    if (permalink.protocol !== "https:" || permalink.hostname !== HANS_HOST ||
      permalink.port !== "" || permalink.username !== "" || permalink.password !== "" ||
      !allowedPaths.includes(permalinkPath) ||
      permalink.search !== "" || permalink.hash !== "") {
      schemaFailure("$.noticeData[].permLink", "fixed-host HANS notice or VONA permalink", item.permLink);
    }
    const variant = permalinkPath === allowedPaths[0] ? "notice" : "vona";
    const sentAtMs = Date.parse(item.sentUtc.endsWith("Z") ? item.sentUtc : `${item.sentUtc}Z`);
    if (!Number.isFinite(sentAtMs) || Math.floor(sentAtMs / 1_000) !== item.sentUnixtime) {
      schemaFailure("$.noticeData[].sentUnixtime", "epoch matching sentUtc", item.sentUnixtime);
    }
    const sentAt = new Date(sentAtMs).toISOString();
    const normalizedCodes = [...allCodes].sort();
    const signature = createHash("sha256").update(JSON.stringify([
      item.sentUtc,
      item.sentUnixtime,
      item.noticeTypeCd,
      item.volcCds,
      item.noticeHtml,
      item.obsAbbr,
      item.noticeIdentifier,
      item.permLink,
    ])).digest("hex");
    const contextSignature = createHash("sha256").update(JSON.stringify([
      sentAt,
      item.obsAbbr,
      normalizedCodes,
    ])).digest("hex");
    const bundle = bundles.get(item.noticeIdentifier);
    const priorVariant = bundle?.variants.get(variant);
    if (priorVariant !== undefined) {
      if (priorVariant.signature === signature) continue;
      schemaFailure(
        "$.noticeData[].noticeIdentifier",
        "unique identifier per notice variant or identical duplicate record",
        item.noticeIdentifier
      );
    }
    if (bundle !== undefined) {
      if (bundle.contextSignature !== contextSignature) {
        schemaFailure(
          "$.noticeData[].noticeIdentifier",
          "paired notice variants with matching time, observatory, and volcano codes",
          item.noticeIdentifier
        );
      }
      bundle.variants.set(variant, {
        signature,
        noticeType: item.noticeTypeCd,
        sourceUrl: permalink.href,
      });
    } else {
      bundles.set(item.noticeIdentifier, {
        noticeIdentifier: item.noticeIdentifier,
        volcanoCodes: normalizedCodes,
        sentAt,
        observatory: item.obsAbbr,
        contextSignature,
        variants: new Map([[variant, {
          signature,
          noticeType: item.noticeTypeCd,
          sourceUrl: permalink.href,
        }]]),
      });
    }
  }

  const result: ParsedNotice[] = [];
  for (const bundle of bundles.values()) {
    if (bundle.sentAt.slice(0, 10) !== date) continue;
    const applicableCodes = bundle.volcanoCodes.filter((code) => applicableVolcanoes.has(code));
    if (applicableCodes.length === 0) continue;
    const noticeVariants = (["notice", "vona"] as const)
      .filter((variant) => bundle.variants.has(variant));
    const noticeTypes = [...new Set(noticeVariants.map(
      (variant) => bundle.variants.get(variant)!.noticeType
    ))].sort();
    const preferredVariant = bundle.variants.get("notice") ?? bundle.variants.get("vona")!;
    result.push({
      noticeIdentifier: bundle.noticeIdentifier,
      volcanoCodes: applicableCodes,
      volcanoNames: applicableCodes.map((code) => applicableVolcanoes.get(code)!.volcanoName),
      sentAt: bundle.sentAt,
      noticeType: noticeTypes.join(","),
      noticeVariants,
      observatory: bundle.observatory,
      sourceUrl: preferredVariant.sourceUrl,
    });
  }
  return result.slice(0, HANS_MAX_NOTICES);
}

export async function queryHansVolcanoActivity(
  date: string,
  value: unknown,
  dependencies: HansDependencies = {}
): Promise<HansResult> {
  const area: BoundingBox = validateQueryArea(value);
  const dateMs = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
    !Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== date) {
    return { kind: "source_failure", reason: "schema_validation", stage: "volcano_inventory" };
  }
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now?.() ?? new Date();
  let volcanoes: HansVolcano[];
  try {
    if (dependencies.inventoryCache !== false && inventoryCache && inventoryCache.expiresAt > now.getTime()) {
      volcanoes = inventoryCache.volcanoes;
    } else {
      const response = await requestJson(
        fetchImpl,
        new URL(`https://${HANS_HOST}${HANS_VOLCANO_PATH}`),
        { method: "GET" }
      );
      volcanoes = parseHansVolcanoes(response.value);
      if (dependencies.inventoryCache !== false) {
        inventoryCache = { expiresAt: now.getTime() + HANS_VOLCANO_CACHE_TTL_MS, volcanoes };
      }
    }
  } catch (error) {
    return {
      kind: "source_failure",
      reason: error instanceof HansError ? error.reason : "schema_validation",
      stage: "volcano_inventory",
    };
  }
  const applicable = volcanoes.filter((volcano) =>
    volcano.longitude >= area.west && volcano.longitude <= area.east &&
    volcano.latitude >= area.south && volcano.latitude <= area.north
  );
  if (applicable.length === 0) {
    return { kind: "no_observation", stage: "geographic_applicability" };
  }
  const cacheEnabled = dependencies.fetchImpl === undefined;
  const cacheKey = `${date}|${area.west},${area.south},${area.east},${area.north}`;
  const cached = cacheEnabled ? noticeCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > now.getTime()) {
    return structuredClone(cached.result);
  }
  const startUnixtime = Math.floor(dateMs / 1_000);
  const endUnixtime = startUnixtime + 86_399;
  const searchBody = {
    obsAbbr: "",
    noticeTypeCd: "",
    volcCd: "",
    startUnixtime,
    endUnixtime,
    searchText: "",
    pageIndex: 0,
  };
  try {
    const response = await requestJson(
      fetchImpl,
      new URL(`https://${HANS_HOST}${HANS_SEARCH_PATH}`),
      { method: "POST", body: JSON.stringify(searchBody) }
    );
    const notices = parseNotices(
      response.value,
      new Map(applicable.map((volcano) => [volcano.volcanoCode, volcano])),
      date
    );
    if (notices.length === 0) {
      const result: HansResult = { kind: "no_observation", stage: "notice_search" };
      if (cacheEnabled) {
        noticeCache.set(cacheKey, {
          expiresAt: now.getTime() + HANS_NOTICE_CACHE_TTL_MS,
          result,
        });
      }
      return result;
    }
    const payloadHash = createHash("sha256").update(response.bytes).digest("hex");
    const observations = notices.map((notice): HansObservation => ({
      observationId: `obs-hans-${createHash("sha256").update(notice.noticeIdentifier).digest("hex").slice(0, 16)}`,
      provenance: {
        sourceId: "usgs_volcano_hans",
        sourceUrl: notice.sourceUrl,
        sourceRecordId: notice.noticeIdentifier,
        retrievedAt: now.toISOString(),
        observedAt: notice.sentAt,
        product: "USGS Volcano Hazards Notification System notice search",
        payloadHash,
        requestParameters: {
          utcDate: date,
          canonicalBoundingBox: `${area.west},${area.south},${area.east},${area.north}`,
          pageIndex: "0",
        },
      },
      variableName: "USGS volcano activity notice",
      textValue: "official_activity_notice_returned",
      dataMode: "live",
      qualifiers: [
        "observed_official_activity",
        "eruption_timing_not_predicted",
        "no_risk_score",
        "alert_level_not_structured_in_search_response",
        "color_code_not_structured_in_search_response",
      ],
      metadata: {
        volcanoCodes: notice.volcanoCodes.join(","),
        volcanoNames: notice.volcanoNames.join(", "),
        noticeType: notice.noticeType,
        noticeVariants: notice.noticeVariants.join(","),
        observatory: notice.observatory,
      },
    }));
    const result: HansResult = {
      kind: "observations",
      observations,
      applicableVolcanoCount: applicable.length,
    };
    if (cacheEnabled) {
      noticeCache.set(cacheKey, {
        expiresAt: now.getTime() + HANS_NOTICE_CACHE_TTL_MS,
        result,
      });
    }
    return result;
  } catch (error) {
    const result: HansResult = {
      kind: "source_failure",
      reason: error instanceof HansError ? error.reason : "schema_validation",
      stage: "notice_search",
      ...(error instanceof HansError && error.schemaDiagnostic
        ? { schemaDiagnostic: error.schemaDiagnostic }
        : {}),
    };
    if (cacheEnabled) {
      noticeCache.set(cacheKey, {
        expiresAt: now.getTime() + HANS_NOTICE_CACHE_TTL_MS,
        result,
      });
    }
    return result;
  }
}
