import { createHash } from "node:crypto";
import type { BoundingBox } from "@/contracts/common";
import type { Observation } from "@/contracts/evidence";
import { validateQueryArea } from "@/lib/location/query-area";

export const WFIGS_HOST = "services3.arcgis.com";
export const WFIGS_PATH = "/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query";
export const WFIGS_TIMEOUT_MS = 10_000;
export const WFIGS_MAX_BYTES = 4_000_000;
export const WFIGS_MAX_FEATURES = 500;
export const WFIGS_MAX_OBSERVATIONS = 12;

export type WfigsFailureReason =
  | "network"
  | "timeout"
  | "redirect"
  | "rate_limited"
  | "provider_failure"
  | "oversize"
  | "result_limit"
  | "malformed"
  | "schema_validation";

export type WfigsResult =
  | { kind: "observations"; observations: Observation[] }
  | { kind: "no_observation" }
  | { kind: "not_applicable"; reason: "before_2020" }
  | { kind: "source_failure"; reason: WfigsFailureReason };

class WfigsError extends Error {
  constructor(readonly reason: WfigsFailureReason) {
    super(reason);
    this.name = "WfigsError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, maximum) : "";
}

export function observationsFromWfigsGeoJson(
  json: unknown,
  bytes: Uint8Array,
  sourceUrl: string,
  date: string,
  retrievedAt: string
): Observation[] {
  if (!isRecord(json) || !Array.isArray(json.features)) throw new WfigsError("schema_validation");
  if (json.exceededTransferLimit === true || json.features.length > WFIGS_MAX_FEATURES) throw new WfigsError("result_limit");
  const payloadHash = createHash("sha256").update(bytes).digest("hex");
  const observations: Observation[] = [];
  const seen = new Set<string>();
  for (const feature of json.features) {
    if (!isRecord(feature) || !isRecord(feature.properties)) throw new WfigsError("schema_validation");
    const properties = feature.properties;
    const objectId = finiteNumber(properties.OBJECTID ?? properties.objectid);
    const irwinId = safeText(properties.attr_IRWINID, 100);
    const incidentName = safeText(properties.attr_IncidentName ?? properties.poly_IncidentName, 180);
    if (objectId === null || incidentName === "") continue;
    const recordId = irwinId || String(objectId);
    if (seen.has(recordId)) continue;
    seen.add(recordId);
    const acres = finiteNumber(properties.poly_GISAcres ?? properties.attr_IncidentSize);
    const percentContained = finiteNumber(properties.attr_PercentContained);
    observations.push({
      observationId: `obs-wfigs-perimeter-${String(objectId)}`,
      provenance: {
        sourceId: "nifc_wfigs_fire_perimeters",
        sourceUrl,
        sourceRecordId: recordId,
        retrievedAt,
        observedAt: `${date}T12:00:00.000Z`,
        product: "NIFC WFIGS Interagency Fire Perimeters 2020-present",
        payloadHash,
        requestParameters: {
          requestedDate: date,
          applicability: "official_feature_geometry_intersects_selected_bbox_and_incident_dates_overlap",
        },
      },
      variableName: "Official interagency wildfire perimeter record",
      textValue: `${incidentName} has a WFIGS perimeter intersecting the selected area for the requested date.`,
      dataMode: "historical",
      qualifiers: ["official_interagency_perimeter", "publication_timing_varies", "not_property_or_tactical_truth"],
      periodStart: `${date}T00:00:00.000Z`,
      periodEnd: `${date}T23:59:59.999Z`,
      metadata: {
        incidentName,
        featureCategory: safeText(properties.poly_FeatureCategory, 100) || "not supplied",
        ...(acres === null ? {} : { mappedAcres: acres }),
        ...(percentContained === null ? {} : { percentContained }),
        fireCause: safeText(properties.attr_FireCause, 80) || "not supplied",
      },
    });
    if (observations.length >= WFIGS_MAX_OBSERVATIONS) break;
  }
  return observations;
}

export async function queryWfigsPerimeters(
  areaValue: unknown,
  date: string,
  dependencies: { fetchImpl?: typeof fetch; now?: () => Date } = {}
): Promise<WfigsResult> {
  let area: BoundingBox;
  try {
    area = validateQueryArea(areaValue);
  } catch {
    return { kind: "source_failure", reason: "schema_validation" };
  }
  if (date < "2020-01-01") return { kind: "not_applicable", reason: "before_2020" };
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return { kind: "source_failure", reason: "schema_validation" };
  const url = new URL(`https://${WFIGS_HOST}${WFIGS_PATH}`);
  url.search = new URLSearchParams({
    where: `attr_FireDiscoveryDateTime <= DATE '${date} 23:59:59' AND (attr_FireOutDateTime IS NULL OR attr_FireOutDateTime >= DATE '${date} 00:00:00')`,
    geometry: `${area.west},${area.south},${area.east},${area.north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "OBJECTID,poly_IncidentName,poly_FeatureCategory,poly_GISAcres,attr_IncidentName,attr_IncidentSize,attr_IRWINID,attr_PercentContained,attr_FireCause",
    returnGeometry: "false",
    resultRecordCount: String(WFIGS_MAX_FEATURES),
    f: "geojson",
  }).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WFIGS_TIMEOUT_MS);
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
      throw new WfigsError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) throw new WfigsError("redirect");
    if (response.status === 429) throw new WfigsError("rate_limited");
    if (!response.ok) throw new WfigsError("provider_failure");
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > WFIGS_MAX_BYTES) throw new WfigsError("oversize");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > WFIGS_MAX_BYTES) throw new WfigsError("oversize");
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new WfigsError("malformed");
    }
    const observations = observationsFromWfigsGeoJson(json, bytes, url.toString(), date, (dependencies.now?.() ?? new Date()).toISOString());
    return observations.length > 0 ? { kind: "observations", observations } : { kind: "no_observation" };
  } catch (error) {
    return { kind: "source_failure", reason: error instanceof WfigsError ? error.reason : "malformed" };
  } finally {
    clearTimeout(timeout);
  }
}
