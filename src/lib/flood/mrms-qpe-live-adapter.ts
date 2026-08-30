import { createHash } from "node:crypto";
import type { BoundingBox } from "@/contracts/common";
import type { Observation } from "@/contracts/evidence";
import { areaCenter, validateQueryArea } from "@/lib/location/query-area";

export const MRMS_QPE_HOST = "mapservices.weather.noaa.gov";
export const MRMS_QPE_BASE_PATH = "/raster/rest/services/obs/mrms_qpe/ImageServer";
export const MRMS_QPE_TIMEOUT_MS = 10_000;
export const MRMS_QPE_MAX_BYTES = 1_000_000;

export type MrmsQpeFailureReason =
  | "network"
  | "timeout"
  | "redirect"
  | "rate_limited"
  | "provider_failure"
  | "oversize"
  | "malformed"
  | "schema_validation";

export type MrmsQpeResult =
  | { kind: "observation"; observation: Observation }
  | { kind: "no_observation"; reason: "no_raster" | "no_value" | "outside_valid_period" }
  | { kind: "source_failure"; reason: MrmsQpeFailureReason; stage: "catalog" | "identify" };

interface CatalogItem {
  objectId: number;
  name: string;
  validEndMs: number;
}

class MrmsQpeError extends Error {
  constructor(readonly reason: MrmsQpeFailureReason) {
    super(reason);
    this.name = "MrmsQpeError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchJson(fetchImpl: typeof fetch, url: URL): Promise<{ json: unknown; bytes: Uint8Array }> {
  if (url.protocol !== "https:" || url.hostname !== MRMS_QPE_HOST || !url.pathname.startsWith(MRMS_QPE_BASE_PATH)) {
    throw new MrmsQpeError("schema_validation");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MRMS_QPE_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { method: "GET", redirect: "manual", cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    } catch {
      throw new MrmsQpeError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) throw new MrmsQpeError("redirect");
    if (response.status === 429) throw new MrmsQpeError("rate_limited");
    if (!response.ok) throw new MrmsQpeError("provider_failure");
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MRMS_QPE_MAX_BYTES) throw new MrmsQpeError("oversize");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MRMS_QPE_MAX_BYTES) throw new MrmsQpeError("oversize");
    try {
      return { json: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), bytes };
    } catch {
      throw new MrmsQpeError("malformed");
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function parseMrmsCatalog(value: unknown): CatalogItem[] {
  if (!isRecord(value) || !Array.isArray(value.features)) throw new MrmsQpeError("schema_validation");
  const items: CatalogItem[] = [];
  for (const feature of value.features) {
    if (!isRecord(feature) || !isRecord(feature.attributes)) throw new MrmsQpeError("schema_validation");
    const attributes = feature.attributes;
    const objectId = attributes.objectid ?? attributes.OBJECTID;
    const name = attributes.name ?? attributes.Name;
    const validEndMs = attributes.idp_validendtime ?? attributes.IDP_VALIDENDTIME;
    if (!Number.isInteger(objectId) || typeof name !== "string" || !Number.isFinite(validEndMs)) {
      throw new MrmsQpeError("schema_validation");
    }
    if (!/_QPE_24H$/u.test(name)) continue;
    items.push({ objectId: objectId as number, name, validEndMs: validEndMs as number });
  }
  return items.sort((left, right) => right.validEndMs - left.validEndMs || left.name.localeCompare(right.name));
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && value.toLowerCase() !== "nodata") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseIdentify(value: unknown): number | null {
  if (!isRecord(value)) throw new MrmsQpeError("schema_validation");
  const direct = numericValue(value.value);
  if (direct !== null) return direct;
  if (isRecord(value.properties)) {
    return numericValue(value.properties.Value ?? value.properties.value);
  }
  return null;
}

function requestedDayBounds(date: string): { startMs: number; endMs: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null;
  const startMs = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || new Date(startMs).toISOString().slice(0, 10) !== date) return null;
  return { startMs, endMs: startMs + 86_400_000 };
}

export async function queryMrmsQpe(
  areaValue: unknown,
  date: string,
  dependencies: { fetchImpl?: typeof fetch; now?: () => Date } = {}
): Promise<MrmsQpeResult> {
  let area: BoundingBox;
  try {
    area = validateQueryArea(areaValue);
  } catch {
    return { kind: "source_failure", reason: "schema_validation", stage: "catalog" };
  }
  const day = requestedDayBounds(date);
  if (!day) return { kind: "source_failure", reason: "schema_validation", stage: "catalog" };
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const catalogUrl = new URL(`https://${MRMS_QPE_HOST}${MRMS_QPE_BASE_PATH}/query`);
  catalogUrl.search = new URLSearchParams({
    where: "name LIKE '%_QPE_24H'",
    outFields: "objectid,name,idp_validendtime",
    returnGeometry: "false",
    orderByFields: "idp_validendtime DESC",
    resultRecordCount: "12",
    f: "json",
  }).toString();
  let items: CatalogItem[];
  try {
    const catalog = await fetchJson(fetchImpl, catalogUrl);
    const byRegion = new Map<string, CatalogItem>();
    for (const candidate of parseMrmsCatalog(catalog.json)) {
      const periodStart = candidate.validEndMs - 86_400_000;
      if (periodStart >= day.endMs || candidate.validEndMs <= day.startMs || byRegion.has(candidate.name)) continue;
      byRegion.set(candidate.name, candidate);
    }
    items = [...byRegion.values()].slice(0, 4);
    if (items.length === 0) return { kind: "no_observation", reason: "outside_valid_period" };
  } catch (error) {
    return { kind: "source_failure", reason: error instanceof MrmsQpeError ? error.reason : "malformed", stage: "catalog" };
  }
  const center = areaCenter(area);
  try {
    const identifiedCandidates = await Promise.allSettled(items.map(async (item) => {
      const identifyUrl = new URL(`https://${MRMS_QPE_HOST}${MRMS_QPE_BASE_PATH}/identify`);
      identifyUrl.search = new URLSearchParams({
        geometry: JSON.stringify({ x: center.lon, y: center.lat, spatialReference: { wkid: 4326 } }),
        geometryType: "esriGeometryPoint",
        sr: "4326",
        mosaicRule: JSON.stringify({ mosaicMethod: "esriMosaicLockRaster", lockRasterIds: [item.objectId] }),
        renderingRule: JSON.stringify({ rasterFunction: "rft_24hr" }),
        returnGeometry: "false",
        returnCatalogItems: "false",
        f: "json",
      }).toString();
      const identified = await fetchJson(fetchImpl, identifyUrl);
      return { item, identifyUrl, identified, inches: parseIdentify(identified.json) };
    }));
    const selected = identifiedCandidates.find((candidate) =>
      candidate.status === "fulfilled" && candidate.value.inches !== null &&
      candidate.value.inches >= 0 && candidate.value.inches <= 100
    );
    if (!selected || selected.status !== "fulfilled" || selected.value.inches === null) {
      const failed = identifiedCandidates.find((candidate) => candidate.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      return { kind: "no_observation", reason: "no_value" };
    }
    const { item, identifyUrl, identified, inches } = selected.value;
    const retrievedAt = (dependencies.now?.() ?? new Date()).toISOString();
    const periodEnd = new Date(item.validEndMs).toISOString();
    const periodStart = new Date(item.validEndMs - 86_400_000).toISOString();
    return {
      kind: "observation",
      observation: {
        observationId: `obs-mrms-qpe-${item.objectId}`,
        provenance: {
          sourceId: "noaa_mrms_qpe",
          sourceUrl: identifyUrl.toString(),
          sourceRecordId: String(item.objectId),
          retrievedAt,
          observedAt: periodEnd,
          product: "NOAA MRMS radar-only 24-hour QPE",
          payloadHash: createHash("sha256").update(identified.bytes).digest("hex"),
          requestParameters: {
            requestedDate: date,
            rasterName: item.name,
            samplePoint: `${center.lat},${center.lon}`,
            bbox: `${area.west},${area.south},${area.east},${area.north}`,
            rasterFunction: "rft_24hr",
          },
        },
        variableName: "MRMS radar-only 24-hour precipitation estimate at selected-area center",
        value: inches,
        unit: "in",
        dataMode: "live",
        qualifiers: ["radar_derived_estimate", "rolling_24_hour_period", "center_point_not_area_total"],
        periodStart,
        periodEnd,
        metadata: {
          rasterName: item.name,
          sampleLatitude: center.lat,
          sampleLongitude: center.lon,
          requestedDateOverlapOnly: true,
        },
      },
    };
  } catch (error) {
    return { kind: "source_failure", reason: error instanceof MrmsQpeError ? error.reason : "malformed", stage: "identify" };
  }
}
