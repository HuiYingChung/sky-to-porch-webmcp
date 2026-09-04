import { createHash } from "node:crypto";
import type { BoundingBox } from "@/contracts/common";
import type { Observation } from "@/contracts/evidence";
import { validateQueryArea } from "@/lib/location/query-area";

export const GVP_WFS_HOST = "webservices.volcano.si.edu";
export const GVP_WFS_PATH = "/geoserver/GVP-VOTW/ows";
export const GVP_WFS_TIMEOUT_MS = 10_000;
export const GVP_WFS_MAX_BYTES = 3_000_000;
export const GVP_WFS_MAX_FEATURES = 200;
export const GVP_MAX_OBSERVATIONS = 12;

export type GvpFailureReason =
  | "network"
  | "timeout"
  | "redirect"
  | "rate_limited"
  | "provider_failure"
  | "oversize"
  | "result_limit"
  | "malformed"
  | "schema_validation";

export type GvpResult =
  | { kind: "observations"; observations: Observation[] }
  | { kind: "no_observation" }
  | { kind: "source_failure"; reason: GvpFailureReason };

class GvpError extends Error {
  constructor(readonly reason: GvpFailureReason) {
    super(reason);
    this.name = "GvpError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function boundedDate(year: number, month: number | null, day: number | null, end: boolean): number {
  const safeMonth = month !== null && month >= 1 && month <= 12 ? month : end ? 12 : 1;
  const maximumDay = new Date(Date.UTC(year, safeMonth, 0)).getUTCDate();
  const safeDay = day !== null && day >= 1 && day <= maximumDay ? day : end ? maximumDay : 1;
  return Date.UTC(year, safeMonth - 1, safeDay, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
}

function intervalContains(properties: Record<string, unknown>, requestedMs: number): boolean {
  const startYear = optionalInteger(properties.StartDateYear);
  if (startYear === null || startYear < -10000 || startYear > 3000) return false;
  const endYear = optionalInteger(properties.EndDateYear);
  const startMs = boundedDate(startYear, optionalInteger(properties.StartDateMonth), optionalInteger(properties.StartDateDay), false);
  const endMs = endYear === null || endYear === 0
    ? boundedDate(startYear, 12, 31, true)
    : boundedDate(endYear, optionalInteger(properties.EndDateMonth), optionalInteger(properties.EndDateDay), true);
  return requestedMs >= startMs && requestedMs <= endMs;
}

function coordinate(value: unknown): { longitude: number; latitude: number } | null {
  if (!isRecord(value) || value.type !== "Point" || !Array.isArray(value.coordinates) || value.coordinates.length < 2) return null;
  const [longitude, latitude] = value.coordinates;
  return typeof longitude === "number" && Number.isFinite(longitude) &&
    typeof latitude === "number" && Number.isFinite(latitude)
    ? { longitude, latitude }
    : null;
}

function safeText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, maximum) : "";
}

export function observationsFromGvpGeoJson(
  json: unknown,
  bytes: Uint8Array,
  sourceUrl: string,
  areaValue: unknown,
  date: string,
  retrievedAt: string
): Observation[] {
  const area = validateQueryArea(areaValue);
  if (!isRecord(json) || !Array.isArray(json.features)) throw new GvpError("schema_validation");
  const numberMatched = optionalInteger(json.numberMatched);
  if ((numberMatched !== null && numberMatched > GVP_WFS_MAX_FEATURES) || json.features.length > GVP_WFS_MAX_FEATURES) {
    throw new GvpError("result_limit");
  }
  const requestedMs = Date.parse(`${date}T12:00:00.000Z`);
  if (!Number.isFinite(requestedMs)) throw new GvpError("schema_validation");
  const payloadHash = createHash("sha256").update(bytes).digest("hex");
  const observations: Observation[] = [];
  const seen = new Set<string>();
  for (const feature of json.features) {
    if (!isRecord(feature) || !isRecord(feature.properties)) throw new GvpError("schema_validation");
    const point = coordinate(feature.geometry);
    if (!point || point.latitude < area.south || point.latitude > area.north || point.longitude < area.west || point.longitude > area.east) continue;
    if (!intervalContains(feature.properties, requestedMs)) continue;
    const volcanoNumber = optionalInteger(feature.properties.Volcano_Number);
    const eruptionNumber = optionalInteger(feature.properties.Eruption_Number);
    const volcanoName = safeText(feature.properties.Volcano_Name, 160);
    if (volcanoNumber === null || eruptionNumber === null || volcanoName === "") continue;
    const recordId = `${volcanoNumber}-${eruptionNumber}`;
    if (seen.has(recordId)) continue;
    seen.add(recordId);
    const activityType = safeText(feature.properties.Activity_Type, 120) || "eruption record";
    observations.push({
      observationId: `obs-gvp-eruption-${recordId}`,
      provenance: {
        sourceId: "smithsonian_gvp_eruptions",
        sourceUrl,
        sourceRecordId: recordId,
        retrievedAt,
        observedAt: `${date}T12:00:00.000Z`,
        product: "Smithsonian GVP Volcanoes of the World Holocene Eruptions WFS",
        payloadHash,
        requestParameters: {
          requestedDate: date,
          bbox: `${area.west},${area.south},${area.east},${area.north}`,
          typeName: "GVP-VOTW:Smithsonian_VOTW_Holocene_Eruptions",
          applicability: "catalog_interval_contains_date_and_volcano_point_inside_selected_bbox",
        },
      },
      variableName: "Smithsonian GVP historical eruption record",
      textValue: `${activityType} at ${volcanoName} overlaps the requested date in the GVP catalog.`,
      // This record describes historical activity, but it was retrieved from
      // the live source for this request. Historical timing is represented by
      // the observation dates and freshness classification; dataMode tracks
      // the retrieval path and must match the enclosing EvidenceObject.
      dataMode: "live",
      qualifiers: ["official_historical_catalog", "date_precision_may_be_incomplete", "not_a_prediction_or_alert"],
      periodStart: `${date}T00:00:00.000Z`,
      periodEnd: `${date}T23:59:59.999Z`,
      metadata: {
        volcanoNumber,
        eruptionNumber,
        volcanoName,
        activityType,
        latitude: point.latitude,
        longitude: point.longitude,
        ...(optionalInteger(feature.properties.ExplosivityIndexMax) === null
          ? {}
          : { maximumVei: optionalInteger(feature.properties.ExplosivityIndexMax) as number }),
      },
    });
    if (observations.length >= GVP_MAX_OBSERVATIONS) break;
  }
  return observations;
}

export async function queryGvpEruptions(
  areaValue: unknown,
  date: string,
  dependencies: { fetchImpl?: typeof fetch; now?: () => Date } = {}
): Promise<GvpResult> {
  let area: BoundingBox;
  try {
    area = validateQueryArea(areaValue);
  } catch {
    return { kind: "source_failure", reason: "schema_validation" };
  }
  const requestedYear = Number(date.slice(0, 4));
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isInteger(requestedYear)) {
    return { kind: "source_failure", reason: "schema_validation" };
  }
  const url = new URL(`https://${GVP_WFS_HOST}${GVP_WFS_PATH}`);
  url.search = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: "GVP-VOTW:Smithsonian_VOTW_Holocene_Eruptions",
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    CQL_FILTER: `BBOX(GeoLocation,${area.west},${area.south},${area.east},${area.north},'EPSG:4326') AND StartDateYear <= ${requestedYear} AND (EndDateYear IS NULL OR EndDateYear = 0 OR EndDateYear >= ${requestedYear})`,
    count: String(GVP_WFS_MAX_FEATURES),
  }).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GVP_WFS_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await (dependencies.fetchImpl ?? fetch)(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/geo+json, application/json" },
      });
    } catch {
      throw new GvpError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) throw new GvpError("redirect");
    if (response.status === 429) throw new GvpError("rate_limited");
    if (!response.ok) throw new GvpError("provider_failure");
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > GVP_WFS_MAX_BYTES) throw new GvpError("oversize");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > GVP_WFS_MAX_BYTES) throw new GvpError("oversize");
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new GvpError("malformed");
    }
    const observations = observationsFromGvpGeoJson(json, bytes, url.toString(), area, date, (dependencies.now?.() ?? new Date()).toISOString());
    return observations.length > 0 ? { kind: "observations", observations } : { kind: "no_observation" };
  } catch (error) {
    return { kind: "source_failure", reason: error instanceof GvpError ? error.reason : "malformed" };
  } finally {
    clearTimeout(timeout);
  }
}
