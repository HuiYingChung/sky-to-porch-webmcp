import { createHash } from "node:crypto";
import type { BoundingBox } from "@/contracts/common";
import type { Observation } from "@/contracts/evidence";
import { areaCenter, validateQueryArea } from "@/lib/location/query-area";

export const CANADA_DROUGHT_HOST = "agriculture.canada.ca";
export const CANADA_DROUGHT_BASE_PATH = "/imagery-images/rest/services/canadian_drought_monitor/ImageServer";
export const CANADA_DROUGHT_TIMEOUT_MS = 10_000;
export const CANADA_DROUGHT_MAX_BYTES = 1_000_000;

export type CanadaDroughtFailureReason =
  | "network"
  | "timeout"
  | "redirect"
  | "rate_limited"
  | "provider_failure"
  | "oversize"
  | "malformed"
  | "schema_validation";

export type CanadaDroughtResult =
  | { kind: "observation"; observation: Observation }
  | { kind: "no_observation" }
  | { kind: "not_applicable"; reason: "before_record" }
  | { kind: "source_failure"; reason: CanadaDroughtFailureReason; stage: "catalog" | "identify" };

interface CatalogItem {
  objectId: number;
  name: string;
  productDate: string;
}

class CanadaDroughtError extends Error {
  constructor(readonly reason: CanadaDroughtFailureReason) {
    super(reason);
    this.name = "CanadaDroughtError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchJson(fetchImpl: typeof fetch, url: URL): Promise<{ json: unknown; bytes: Uint8Array }> {
  if (url.protocol !== "https:" || url.hostname !== CANADA_DROUGHT_HOST || !url.pathname.startsWith(CANADA_DROUGHT_BASE_PATH)) {
    throw new CanadaDroughtError("schema_validation");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CANADA_DROUGHT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { method: "GET", redirect: "manual", cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    } catch {
      throw new CanadaDroughtError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) throw new CanadaDroughtError("redirect");
    if (response.status === 429) throw new CanadaDroughtError("rate_limited");
    if (!response.ok) throw new CanadaDroughtError("provider_failure");
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > CANADA_DROUGHT_MAX_BYTES) throw new CanadaDroughtError("oversize");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > CANADA_DROUGHT_MAX_BYTES) throw new CanadaDroughtError("oversize");
    try {
      return { json: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), bytes };
    } catch {
      throw new CanadaDroughtError("malformed");
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function parseCanadaDroughtCatalog(value: unknown): CatalogItem[] {
  if (!isRecord(value) || !Array.isArray(value.features)) throw new CanadaDroughtError("schema_validation");
  const items: CatalogItem[] = [];
  for (const feature of value.features) {
    if (!isRecord(feature) || !isRecord(feature.attributes)) throw new CanadaDroughtError("schema_validation");
    const objectId = feature.attributes.OBJECTID ?? feature.attributes.objectid;
    const name = feature.attributes.Name ?? feature.attributes.name;
    if (!Number.isInteger(objectId) || typeof name !== "string") throw new CanadaDroughtError("schema_validation");
    const match = /^cdm_(\d{4})_(\d{2})_(\d{2})$/u.exec(name);
    if (!match) continue;
    const productDate = `${match[1]}-${match[2]}-${match[3]}`;
    const ms = Date.parse(`${productDate}T00:00:00Z`);
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== productDate) continue;
    items.push({ objectId: objectId as number, name, productDate });
  }
  return items.sort((left, right) => right.productDate.localeCompare(left.productDate));
}

function identifyValue(value: unknown): string | null {
  if (!isRecord(value)) throw new CanadaDroughtError("schema_validation");
  const candidate = value.value ?? (isRecord(value.properties) ? value.properties.Value ?? value.properties.value : undefined);
  if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  if (typeof candidate === "string" && candidate.trim() !== "" && candidate.toLowerCase() !== "nodata") return candidate.trim().slice(0, 80);
  return null;
}

export async function queryCanadaDroughtMonitor(
  areaValue: unknown,
  date: string,
  dependencies: { fetchImpl?: typeof fetch; now?: () => Date } = {}
): Promise<CanadaDroughtResult> {
  let area: BoundingBox;
  try {
    area = validateQueryArea(areaValue);
  } catch {
    return { kind: "source_failure", reason: "schema_validation", stage: "catalog" };
  }
  if (date < "2002-01-01") return { kind: "not_applicable", reason: "before_record" };
  const year = Number(date.slice(0, 4));
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isInteger(year)) return { kind: "source_failure", reason: "schema_validation", stage: "catalog" };
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const catalogUrl = new URL(`https://${CANADA_DROUGHT_HOST}${CANADA_DROUGHT_BASE_PATH}/query`);
  catalogUrl.search = new URLSearchParams({
    where: `Name LIKE 'cdm_${year}_%' OR Name LIKE 'cdm_${year - 1}_%'`,
    outFields: "OBJECTID,Name,dateEnd",
    returnGeometry: "false",
    orderByFields: "dateEnd DESC",
    resultRecordCount: "30",
    f: "json",
  }).toString();
  let item: CatalogItem | undefined;
  try {
    item = parseCanadaDroughtCatalog((await fetchJson(fetchImpl, catalogUrl)).json)
      .find((candidate) => candidate.productDate <= date);
    if (!item) return { kind: "no_observation" };
  } catch (error) {
    return { kind: "source_failure", reason: error instanceof CanadaDroughtError ? error.reason : "malformed", stage: "catalog" };
  }
  const center = areaCenter(area);
  const identifyUrl = new URL(`https://${CANADA_DROUGHT_HOST}${CANADA_DROUGHT_BASE_PATH}/identify`);
  identifyUrl.search = new URLSearchParams({
    geometry: JSON.stringify({ x: center.lon, y: center.lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    sr: "4326",
    mosaicRule: JSON.stringify({ mosaicMethod: "esriMosaicLockRaster", lockRasterIds: [item.objectId] }),
    renderingRule: JSON.stringify({ rasterFunction: "canadian_drought_monitor" }),
    returnGeometry: "false",
    returnCatalogItems: "false",
    f: "json",
  }).toString();
  try {
    const identified = await fetchJson(fetchImpl, identifyUrl);
    const classCode = identifyValue(identified.json);
    if (classCode === null) return { kind: "no_observation" };
    const retrievedAt = (dependencies.now?.() ?? new Date()).toISOString();
    return {
      kind: "observation",
      observation: {
        observationId: `obs-canada-drought-${item.objectId}`,
        provenance: {
          sourceId: "canada_drought_monitor",
          sourceUrl: identifyUrl.toString(),
          sourceRecordId: String(item.objectId),
          retrievedAt,
          observedAt: `${item.productDate}T12:00:00.000Z`,
          product: "Canadian Drought Monitor ArcGIS ImageServer",
          payloadHash: createHash("sha256").update(identified.bytes).digest("hex"),
          requestParameters: {
            requestedDate: date,
            productDate: item.productDate,
            rasterName: item.name,
            samplePoint: `${center.lat},${center.lon}`,
            bbox: `${area.west},${area.south},${area.east},${area.north}`,
          },
        },
        variableName: "Canadian Drought Monitor source raster class",
        textValue: `Official source raster class code ${classCode}`,
        // The monthly classification is historical context retrieved from the
        // live service. Keep retrieval mode aligned with the enclosing live
        // EvidenceObject; observation age remains explicit in its dates.
        dataMode: "live",
        qualifiers: ["official_monthly_classification_source", "source_code_not_relabelled_without_verified_attribute_table", "center_point_not_property_assessment"],
        periodStart: `${item.productDate}T00:00:00.000Z`,
        periodEnd: `${item.productDate}T23:59:59.999Z`,
        metadata: {
          classCode,
          rasterName: item.name,
          sampleLatitude: center.lat,
          sampleLongitude: center.lon,
          requestedDateUsesLatestPublishedProduct: true,
        },
      },
    };
  } catch (error) {
    return { kind: "source_failure", reason: error instanceof CanadaDroughtError ? error.reason : "malformed", stage: "identify" };
  }
}
