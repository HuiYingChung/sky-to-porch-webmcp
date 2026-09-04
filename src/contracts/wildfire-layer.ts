import type { BoundingBox } from "./common";

export const WILDFIRE_LAYER_SOURCE_ID = "nasa_firms" as const;
export const WILDFIRE_LAYER_PRODUCT = "VIIRS_NOAA20_NRT" as const;

export type WildfireProcessing =
  | "ultra_real_time"
  | "real_time"
  | "near_real_time"
  | "unknown";

export interface WildfirePointProperties {
  detectionId: string;
  acquiredAt: string;
  satellite: "N20";
  instrument: "VIIRS";
  confidence: "low" | "nominal" | "high";
  processing: WildfireProcessing;
  version: string;
  frpMw: number;
  dayNight: "day" | "night";
}

export type WildfirePointFeature = GeoJSON.Feature<
  GeoJSON.Point,
  WildfirePointProperties
>;

export interface WildfireLayerResult {
  sourceId: typeof WILDFIRE_LAYER_SOURCE_ID;
  sourceUrl: "https://firms.modaps.eosdis.nasa.gov/api/area/";
  product: typeof WILDFIRE_LAYER_PRODUCT;
  dataMode: "live";
  evidenceState: "observations_returned" | "no_observation";
  retrievedAt: string;
  latestAcquiredAt: string | null;
  requestArea: BoundingBox;
  featureCollection: GeoJSON.FeatureCollection<
    GeoJSON.Point,
    WildfirePointProperties
  >;
  payloadHash: string;
  limitations: string[];
}

export type WildfireLayerErrorCode =
  | "invalid_input"
  | "unsupported_date"
  | "unconfigured"
  | "source_failure"
  | "rate_limited"
  | "schema_validation"
  | "response_too_large";

export type WildfireLayerEnvelope =
  | { ok: true; result: WildfireLayerResult }
  | { ok: false; error: WildfireLayerErrorCode };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isBoundingBox(value: unknown): value is BoundingBox {
  if (!isRecord(value) || !hasExactKeys(value, ["west", "south", "east", "north"])) return false;
  const { west, south, east, north } = value;
  return (
    typeof west === "number" && Number.isFinite(west) && west >= -180 && west < 180 &&
    typeof east === "number" && Number.isFinite(east) && east > -180 && east <= 180 &&
    typeof south === "number" && Number.isFinite(south) && south >= -90 && south < 90 &&
    typeof north === "number" && Number.isFinite(north) && north > -90 && north <= 90 &&
    west < east && south < north
  );
}

function isWildfireFeature(
  value: unknown,
  area: BoundingBox
): value is WildfirePointFeature {
  if (!isRecord(value) || !hasExactKeys(value, ["type", "geometry", "properties"])) return false;
  if (value.type !== "Feature" || !isRecord(value.geometry) || !isRecord(value.properties)) return false;
  if (!hasExactKeys(value.geometry, ["type", "coordinates"]) || value.geometry.type !== "Point") return false;
  const coordinates = value.geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return false;
  const [lon, lat] = coordinates;
  if (
    typeof lon !== "number" || !Number.isFinite(lon) || lon < area.west || lon > area.east ||
    typeof lat !== "number" || !Number.isFinite(lat) || lat < area.south || lat > area.north
  ) return false;

  const properties = value.properties;
  if (!hasExactKeys(properties, [
    "detectionId", "acquiredAt", "satellite", "instrument", "confidence",
    "processing", "version", "frpMw", "dayNight",
  ])) return false;
  return (
    typeof properties.detectionId === "string" && properties.detectionId.length > 0 && properties.detectionId.length <= 160 &&
    isIsoTimestamp(properties.acquiredAt) &&
    properties.satellite === "N20" &&
    properties.instrument === "VIIRS" &&
    ["low", "nominal", "high"].includes(String(properties.confidence)) &&
    ["ultra_real_time", "real_time", "near_real_time", "unknown"].includes(String(properties.processing)) &&
    typeof properties.version === "string" && /^\d+(?:\.\d+)?(?:URT|RT|NRT)?$/u.test(properties.version) &&
    typeof properties.frpMw === "number" && Number.isFinite(properties.frpMw) && properties.frpMw >= 0 &&
    (properties.dayNight === "day" || properties.dayNight === "night")
  );
}

export function parseWildfireLayerEnvelope(value: unknown): WildfireLayerEnvelope | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;
  if (value.ok === false) {
    if (!hasExactKeys(value, ["ok", "error"])) return null;
    const allowedErrors: WildfireLayerErrorCode[] = [
      "invalid_input", "unsupported_date", "unconfigured", "source_failure", "rate_limited",
      "schema_validation", "response_too_large",
    ];
    return allowedErrors.includes(value.error as WildfireLayerErrorCode)
      ? { ok: false, error: value.error as WildfireLayerErrorCode }
      : null;
  }
  if (!hasExactKeys(value, ["ok", "result"]) || !isRecord(value.result)) return null;
  const result = value.result;
  if (!hasExactKeys(result, [
    "sourceId", "sourceUrl", "product", "dataMode", "evidenceState", "retrievedAt",
    "latestAcquiredAt", "requestArea", "featureCollection", "payloadHash", "limitations",
  ])) return null;
  if (
    result.sourceId !== WILDFIRE_LAYER_SOURCE_ID ||
    result.sourceUrl !== "https://firms.modaps.eosdis.nasa.gov/api/area/" ||
    result.product !== WILDFIRE_LAYER_PRODUCT ||
    result.dataMode !== "live" ||
    (result.evidenceState !== "observations_returned" && result.evidenceState !== "no_observation") ||
    !isIsoTimestamp(result.retrievedAt) ||
    (result.latestAcquiredAt !== null && !isIsoTimestamp(result.latestAcquiredAt)) ||
    !isBoundingBox(result.requestArea) ||
    typeof result.payloadHash !== "string" || !/^[a-f0-9]{64}$/u.test(result.payloadHash) ||
    !Array.isArray(result.limitations) || result.limitations.length < 2 ||
    !result.limitations.every((item) => typeof item === "string" && item.length > 0 && item.length <= 500) ||
    !isRecord(result.featureCollection) ||
    !hasExactKeys(result.featureCollection, ["type", "features"]) ||
    result.featureCollection.type !== "FeatureCollection" ||
    !Array.isArray(result.featureCollection.features) ||
    result.featureCollection.features.length > 5000 ||
    !result.featureCollection.features.every((feature) =>
      isWildfireFeature(feature, result.requestArea as BoundingBox)
    )
  ) return null;
  if (
    (result.evidenceState === "observations_returned") !== (result.featureCollection.features.length > 0) ||
    (result.featureCollection.features.length === 0) !== (result.latestAcquiredAt === null)
  ) return null;
  const typedFeatures = result.featureCollection.features as WildfirePointFeature[];
  const latestFeatureTime = typedFeatures.reduce<string | null>(
    (latest, feature) => !latest || feature.properties.acquiredAt > latest
      ? feature.properties.acquiredAt
      : latest,
    null
  );
  const detectionIds = typedFeatures.map((feature) => feature.properties.detectionId);
  const retrievedMs = Date.parse(result.retrievedAt as string);
  if (
    latestFeatureTime !== result.latestAcquiredAt ||
    new Set(detectionIds).size !== detectionIds.length ||
    typedFeatures.some((feature) => {
      const acquiredMs = Date.parse(feature.properties.acquiredAt);
      return acquiredMs > retrievedMs + 5 * 60_000 || acquiredMs < retrievedMs - 48 * 60 * 60_000;
    })
  ) return null;
  return { ok: true, result: result as unknown as WildfireLayerResult };
}
