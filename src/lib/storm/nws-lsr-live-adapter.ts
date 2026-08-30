import { createHash } from "crypto";
import type { BoundingBox } from "@/contracts/common";
import type { Observation } from "@/contracts/evidence";
import { validateQueryableSourceId } from "@/contracts/dataset-registry";
import { validateQueryArea } from "@/lib/location/query-area";

type FetchLike = typeof fetch;

export const NWS_LSR_SOURCE_ID = "nws_local_storm_reports" as const;
export const NWS_LSR_HOST = "api.weather.gov";
export const NWS_LSR_USER_AGENT =
  "sky-to-porch-webmcp/0.1 (https://github.com/HuiYingChung/sky-to-porch-webmcp)";
export const NWS_LSR_RETENTION_DAYS = 7;
export const NWS_LSR_MAX_OFFICES = 4;
export const NWS_LSR_MAX_PRODUCTS = 8;
export const NWS_LSR_MAX_OBSERVATIONS = 6;
export const NWS_LSR_TIMEOUT_MS = 10_000;
export const NWS_LSR_POINTS_MAX_BYTES = 1_000_000;
export const NWS_LSR_INDEX_MAX_BYTES = 1_000_000;
export const NWS_LSR_PRODUCT_MAX_BYTES = 1_000_000;

export type NwsLsrHazard = "wind_storm" | "flood_storm";
export type NwsLsrFailureReason =
  | "rate_limited"
  | "timeout"
  | "network"
  | "redirect"
  | "oversize"
  | "malformed"
  | "schema_validation"
  | "provider_failure";

export type NwsLsrResult =
  | {
      kind: "observations";
      observations: Observation[];
      officeIds: string[];
      failedRequestCount: number;
    }
  | {
      kind: "no_observation";
      officeIds: string[];
      failedRequestCount: number;
    }
  | {
      kind: "not_applicable";
      reason: "outside_recent_index" | "no_applicable_office";
    }
  | {
      kind: "source_failure";
      reason: NwsLsrFailureReason;
      stage: "office_lookup" | "product_index" | "product_payload";
    };

interface ParsedProductIndexItem {
  id: string;
  issuanceTime: string;
  officeId: string;
}

interface ProductPayload {
  id: string;
  issuanceTime: string;
  productText: string;
  bytes: Uint8Array;
}

interface EventDefinition {
  canonicalName: string;
  hazard: NwsLsrHazard;
  aliases: string[];
}

const EVENT_DEFINITIONS: EventDefinition[] = [
  {
    canonicalName: "Thunderstorm wind damage",
    hazard: "wind_storm",
    aliases: ["thunderstorm wind damage", "tstm wnd dmg"],
  },
  {
    canonicalName: "Thunderstorm wind gust",
    hazard: "wind_storm",
    aliases: ["thunderstorm wind gust", "tstm wnd gst"],
  },
  {
    canonicalName: "Non-thunderstorm wind damage",
    hazard: "wind_storm",
    aliases: ["non-tstm wnd dmg", "non thunderstorm wind damage"],
  },
  {
    canonicalName: "Non-thunderstorm wind gust",
    hazard: "wind_storm",
    aliases: ["non-tstm wnd gst", "non thunderstorm wind gust"],
  },
  { canonicalName: "Marine thunderstorm wind", hazard: "wind_storm", aliases: ["marine tstm wind"] },
  { canonicalName: "High wind", hazard: "wind_storm", aliases: ["high wind"] },
  { canonicalName: "Downburst", hazard: "wind_storm", aliases: ["downburst"] },
  { canonicalName: "Tornado", hazard: "wind_storm", aliases: ["tornado"] },
  { canonicalName: "Funnel cloud", hazard: "wind_storm", aliases: ["funnel cloud"] },
  { canonicalName: "Hail", hazard: "wind_storm", aliases: ["hail"] },
  { canonicalName: "Flash flood", hazard: "flood_storm", aliases: ["flash flood"] },
  { canonicalName: "Coastal flood", hazard: "flood_storm", aliases: ["coastal flood"] },
  { canonicalName: "Flood", hazard: "flood_storm", aliases: ["flood"] },
  { canonicalName: "Heavy rain", hazard: "flood_storm", aliases: ["heavy rain"] },
  { canonicalName: "Debris flow", hazard: "flood_storm", aliases: ["debris flow"] },
];

const ACCEPTED_CONTENT_TYPES = [
  "application/geo+json",
  "application/json",
  "application/ld+json",
];

class NwsLsrError extends Error {
  constructor(readonly reason: NwsLsrFailureReason) {
    super(reason);
    this.name = "NwsLsrError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCoordinate(value: number): string {
  return String(Number(value.toFixed(4)));
}

function parseUtcDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? parsed
    : null;
}

function recentWindowApplies(startDate: string, endDate: string, now: Date): boolean {
  const start = parseUtcDate(startDate);
  const end = parseUtcDate(endDate);
  if (start === null || end === null || start > end) return false;
  const latestCompleted = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - 1
  );
  const earliestRetained = latestCompleted - (NWS_LSR_RETENTION_DAYS - 1) * 86_400_000;
  return end >= earliestRetained && start <= latestCompleted;
}

async function fetchBoundedJson(
  fetchImpl: FetchLike,
  url: URL,
  maximumBytes: number,
  accept: "application/geo+json" | "application/ld+json",
  notFoundIsEmpty = false
): Promise<{ json: unknown; bytes: Uint8Array } | null> {
  if (url.protocol !== "https:" || url.hostname !== NWS_LSR_HOST) {
    throw new NwsLsrError("schema_validation");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NWS_LSR_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: accept, "User-Agent": NWS_LSR_USER_AGENT },
      });
    } catch {
      throw new NwsLsrError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) throw new NwsLsrError("redirect");
    if (response.status === 404 && notFoundIsEmpty) return null;
    if (response.status === 429) throw new NwsLsrError("rate_limited");
    if (!response.ok) throw new NwsLsrError("provider_failure");
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!ACCEPTED_CONTENT_TYPES.includes(contentType)) {
      throw new NwsLsrError("schema_validation");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      throw new NwsLsrError("oversize");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new NwsLsrError("oversize");
    try {
      return {
        json: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        bytes,
      };
    } catch {
      throw new NwsLsrError("malformed");
    }
  } finally {
    clearTimeout(timeout);
  }
}

function officeIdFromPoint(json: unknown): string | null {
  if (!isRecord(json)) throw new NwsLsrError("schema_validation");
  const properties = isRecord(json.properties) ? json.properties : json;
  const gridId = properties.gridId;
  if (typeof gridId === "string" && /^[A-Z]{3}$/u.test(gridId)) return gridId;
  const officeUrl = properties.forecastOffice;
  if (typeof officeUrl !== "string") throw new NwsLsrError("schema_validation");
  const match = /^https:\/\/api\.weather\.gov\/offices\/([A-Z]{3})$/u.exec(officeUrl);
  if (!match) throw new NwsLsrError("schema_validation");
  return match[1];
}

function areaSamplePoints(area: BoundingBox): Array<{ lat: number; lon: number }> {
  const center = { lat: (area.south + area.north) / 2, lon: (area.west + area.east) / 2 };
  return [
    center,
    { lat: area.south, lon: area.west },
    { lat: area.south, lon: area.east },
    { lat: area.north, lon: area.west },
    { lat: area.north, lon: area.east },
  ];
}

async function resolveOffices(
  area: BoundingBox,
  fetchImpl: FetchLike
): Promise<{ offices: string[]; failures: NwsLsrFailureReason[] }> {
  const offices = new Set<string>();
  const failures: NwsLsrFailureReason[] = [];
  for (const point of areaSamplePoints(area)) {
    const url = new URL(
      `https://${NWS_LSR_HOST}/points/${normalizeCoordinate(point.lat)},${normalizeCoordinate(point.lon)}`
    );
    try {
      const payload = await fetchBoundedJson(
        fetchImpl,
        url,
        NWS_LSR_POINTS_MAX_BYTES,
        "application/geo+json",
        true
      );
      if (!payload) continue;
      const office = officeIdFromPoint(payload.json);
      if (office) offices.add(office);
    } catch (error) {
      failures.push(error instanceof NwsLsrError ? error.reason : "schema_validation");
    }
  }
  return {
    offices: [...offices].sort().slice(0, NWS_LSR_MAX_OFFICES),
    failures,
  };
}

function parseProductIndex(json: unknown, expectedOffice: string): ParsedProductIndexItem[] {
  if (!isRecord(json) || !Array.isArray(json["@graph"])) {
    throw new NwsLsrError("schema_validation");
  }
  return json["@graph"].flatMap((item): ParsedProductIndexItem[] => {
    if (!isRecord(item)) return [];
    const id = item.id;
    const productCode = item.productCode;
    const issuanceTime = item.issuanceTime;
    const issuingOffice = item.issuingOffice;
    if (
      typeof id !== "string" || !/^[A-Za-z0-9-]{8,80}$/u.test(id) ||
      productCode !== "LSR" ||
      typeof issuanceTime !== "string" || !Number.isFinite(Date.parse(issuanceTime)) ||
      typeof issuingOffice !== "string" || issuingOffice !== `K${expectedOffice}`
    ) return [];
    return [{ id, issuanceTime, officeId: expectedOffice }];
  });
}

function parseProductPayload(
  json: unknown,
  bytes: Uint8Array,
  expected: ParsedProductIndexItem
): ProductPayload {
  if (!isRecord(json)) throw new NwsLsrError("schema_validation");
  if (
    json.id !== expected.id ||
    json.productCode !== "LSR" ||
    typeof json.issuanceTime !== "string" || !Number.isFinite(Date.parse(json.issuanceTime)) ||
    typeof json.productText !== "string" ||
    json.productText.length === 0 || json.productText.length > 500_000
  ) throw new NwsLsrError("schema_validation");
  return {
    id: expected.id,
    issuanceTime: json.issuanceTime,
    productText: json.productText,
    bytes,
  };
}

function eventDefinitionFromMiddle(
  middle: string
): { definition: EventDefinition; location: string } | null {
  const lower = middle.toLowerCase();
  const matches = EVENT_DEFINITIONS.flatMap((definition) =>
    definition.aliases.map((alias) => ({ definition, alias, index: lower.indexOf(alias) }))
  )
    .filter((item) => item.index >= 0)
    .sort((left, right) => left.index - right.index || right.alias.length - left.alias.length);
  const match = matches[0];
  if (!match) return null;
  const location = middle.slice(match.index + match.alias.length).trim();
  return { definition: match.definition, location: location || "reported location" };
}

function mdyToUtcDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value);
  if (!match) return null;
  const iso = `${match[3]}-${match[1]}-${match[2]}`;
  return parseUtcDate(iso) === null ? null : iso;
}

function observedAtFromLocalReport(
  date: string,
  hhmm: string,
  meridiem: string,
  issuanceTime: string
): string {
  let hour = Number(hhmm.slice(0, 2));
  const minute = Number(hhmm.slice(2, 4));
  if (meridiem === "AM" && hour === 12) hour = 0;
  if (meridiem === "PM" && hour !== 12) hour += 12;
  const offset = /([+-]\d{2}:\d{2})$/u.exec(issuanceTime)?.[1] ?? "Z";
  const parsed = Date.parse(
    `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${offset}`
  );
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : `${date}T00:00:00.000Z`;
}

function coordinateInArea(latitude: number, longitude: number, area: BoundingBox): boolean {
  return longitude >= area.west && longitude <= area.east &&
    latitude >= area.south && latitude <= area.north;
}

function parseReports(
  product: ProductPayload,
  officeId: string,
  area: BoundingBox,
  startDate: string,
  endDate: string,
  hazard: NwsLsrHazard,
  retrievedAt: string
): Observation[] {
  const lines = product.productText.replaceAll("\r\n", "\n").split("\n");
  const observations: Observation[] = [];
  const firstLinePattern =
    /^\s*(\d{4})\s+(AM|PM)\s+(.+?)\s+(\d{1,2}\.\d{2})([NS])\s+(\d{1,3}\.\d{2})([EW])\s*$/u;
  const detailPattern =
    /^\s*(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s{2,}([A-Z]{2})\s{2,}(.+?)\s*$/u;
  for (let index = 0; index < lines.length; index += 1) {
    const first = firstLinePattern.exec(lines[index]);
    if (!first) continue;
    const classified = eventDefinitionFromMiddle(first[3]);
    if (!classified || classified.definition.hazard !== hazard) continue;
    let detailIndex = index + 1;
    while (detailIndex < lines.length && lines[detailIndex].trim() === "") detailIndex += 1;
    const detail = detailIndex < lines.length ? detailPattern.exec(lines[detailIndex]) : null;
    if (!detail) continue;
    const date = mdyToUtcDate(detail[1]);
    if (!date || date < startDate || date > endDate) continue;
    const latitude = Number(first[4]) * (first[5] === "S" ? -1 : 1);
    const longitude = Number(first[6]) * (first[7] === "W" ? -1 : 1);
    if (!coordinateInArea(latitude, longitude, area)) continue;
    const remarks: string[] = [];
    for (let lineIndex = detailIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (firstLinePattern.test(line) || /^\s*(?:&&|\$\$)/u.test(line)) break;
      const clean = line.trim();
      if (clean) remarks.push(clean);
      if (remarks.join(" ").length >= 300) break;
    }
    const observedAt = observedAtFromLocalReport(date, first[1], first[2], product.issuanceTime);
    const source = detail[4].trim();
    const location = classified.location;
    const county = detail[2].trim();
    const state = detail[3];
    const remarkText = remarks.join(" ").replace(/\s+/gu, " ").slice(0, 300);
    const summary =
      `${classified.definition.canonicalName} reported near ${location} in ${county}, ${state} by ${source}.` +
      (remarkText ? ` ${remarkText}` : "");
    const eventKey = [date, first[1], first[2], classified.definition.canonicalName, latitude, longitude]
      .join("|");
    observations.push({
      observationId: `obs-nws-lsr-${createHash("sha256").update(eventKey).digest("hex").slice(0, 16)}`,
      provenance: {
        sourceId: NWS_LSR_SOURCE_ID,
        sourceUrl: `https://${NWS_LSR_HOST}/products/${encodeURIComponent(product.id)}`,
        sourceRecordId: `${product.id}#${observations.length + 1}`,
        retrievedAt,
        observedAt,
        product: `NWS ${officeId} Preliminary Local Storm Report`,
        payloadHash: createHash("sha256").update(product.bytes).digest("hex"),
        requestParameters: {
          officeId,
          requestedStartDate: startDate,
          requestedEndDate: endDate,
          selectedArea: `${area.west},${area.south},${area.east},${area.north}`,
        },
      },
      variableName: `NWS Local Storm Report: ${classified.definition.canonicalName}`,
      textValue: summary,
      dataMode: "historical",
      qualifiers: [
        "preliminary_local_storm_report",
        "reported_event_not_property_measurement",
        "exact_coordinate_inside_selected_area",
      ],
      metadata: {
        eventType: classified.definition.canonicalName,
        location,
        county,
        state,
        reportSource: source,
        latitude,
        longitude,
        reportedLocalTime: `${first[1]} ${first[2]}`,
        preliminary: true,
      },
    });
  }
  return observations;
}

export async function queryNwsLocalStormReports(
  areaInput: BoundingBox,
  startDate: string,
  endDate: string,
  hazard: NwsLsrHazard,
  dependencies: { fetchImpl?: FetchLike; now?: () => Date } = {}
): Promise<NwsLsrResult> {
  validateQueryableSourceId(NWS_LSR_SOURCE_ID);
  let area: BoundingBox;
  try {
    area = validateQueryArea(areaInput);
  } catch {
    return { kind: "source_failure", reason: "schema_validation", stage: "office_lookup" };
  }
  const now = dependencies.now?.() ?? new Date();
  if (!recentWindowApplies(startDate, endDate, now)) {
    return { kind: "not_applicable", reason: "outside_recent_index" };
  }
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const resolved = await resolveOffices(area, fetchImpl);
  if (resolved.offices.length === 0) {
    if (resolved.failures.length > 0) {
      return {
        kind: "source_failure",
        reason: resolved.failures[0],
        stage: "office_lookup",
      };
    }
    return { kind: "not_applicable", reason: "no_applicable_office" };
  }

  const indexItems: ParsedProductIndexItem[] = [];
  let failedRequestCount = resolved.failures.length;
  let firstFailure: NwsLsrFailureReason | null = resolved.failures[0] ?? null;
  for (const office of resolved.offices) {
    try {
      const url = new URL(
        `https://${NWS_LSR_HOST}/products/types/LSR/locations/${encodeURIComponent(office)}`
      );
      const payload = await fetchBoundedJson(
        fetchImpl,
        url,
        NWS_LSR_INDEX_MAX_BYTES,
        "application/ld+json",
        true
      );
      if (payload) indexItems.push(...parseProductIndex(payload.json, office));
    } catch (error) {
      const reason = error instanceof NwsLsrError ? error.reason : "schema_validation";
      firstFailure ??= reason;
      failedRequestCount += 1;
    }
  }
  if (indexItems.length === 0 && firstFailure) {
    return { kind: "source_failure", reason: firstFailure, stage: "product_index" };
  }

  const startMs = Date.parse(`${startDate}T00:00:00Z`) - 12 * 60 * 60 * 1000;
  const endMs = Date.parse(`${endDate}T00:00:00Z`) + 48 * 60 * 60 * 1000;
  const candidates = indexItems
    .filter((item) => {
      const issued = Date.parse(item.issuanceTime);
      return issued >= startMs && issued <= endMs;
    })
    .sort((left, right) => right.issuanceTime.localeCompare(left.issuanceTime))
    .slice(0, NWS_LSR_MAX_PRODUCTS);

  const observations: Observation[] = [];
  let fetchedProductCount = 0;
  for (const candidate of candidates) {
    try {
      const url = new URL(
        `https://${NWS_LSR_HOST}/products/${encodeURIComponent(candidate.id)}`
      );
      const payload = await fetchBoundedJson(
        fetchImpl,
        url,
        NWS_LSR_PRODUCT_MAX_BYTES,
        "application/ld+json"
      );
      if (!payload) continue;
      fetchedProductCount += 1;
      const product = parseProductPayload(payload.json, payload.bytes, candidate);
      observations.push(...parseReports(
        product,
        candidate.officeId,
        area,
        startDate,
        endDate,
        hazard,
        now.toISOString()
      ));
    } catch (error) {
      const reason = error instanceof NwsLsrError ? error.reason : "schema_validation";
      firstFailure ??= reason;
      failedRequestCount += 1;
    }
  }

  const deduplicated = observations
    .filter((observation, index, all) =>
      all.findIndex((candidate) => candidate.observationId === observation.observationId) === index
    )
    .sort((left, right) =>
      left.provenance.observedAt.localeCompare(right.provenance.observedAt) ||
      left.observationId.localeCompare(right.observationId)
    )
    .slice(0, NWS_LSR_MAX_OBSERVATIONS);
  if (deduplicated.length > 0) {
    return {
      kind: "observations",
      observations: deduplicated,
      officeIds: resolved.offices,
      failedRequestCount,
    };
  }
  if (fetchedProductCount === 0 && firstFailure) {
    return { kind: "source_failure", reason: firstFailure, stage: "product_payload" };
  }
  return {
    kind: "no_observation",
    officeIds: resolved.offices,
    failedRequestCount,
  };
}
