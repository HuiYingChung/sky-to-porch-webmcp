import { createHash } from "node:crypto";
import type { BoundingBox } from "@/contracts/common";
import type { Observation } from "@/contracts/evidence";
import { validateQueryArea } from "@/lib/location/query-area";

export const EPA_AQS_HOST = "aqs.epa.gov";
export const EPA_AQS_PATH = "/data/api/sampleData/byBox";
export const EPA_AQS_TIMEOUT_MS = 12_000;
export const EPA_AQS_MAX_BYTES = 4_000_000;
export const EPA_AQS_MAX_OBSERVATIONS = 12;

export interface EpaAqsCredentials {
  email: string;
  key: string;
}

export type EpaAqsFailureReason =
  | "network"
  | "timeout"
  | "redirect"
  | "rate_limited"
  | "provider_failure"
  | "oversize"
  | "malformed"
  | "schema_validation";

export type EpaAqsResult =
  | { kind: "observations"; observations: Observation[] }
  | { kind: "no_observation" }
  | { kind: "credential_gate_closed" }
  | { kind: "source_failure"; reason: EpaAqsFailureReason };

class EpaAqsError extends Error {
  constructor(readonly reason: EpaAqsFailureReason) {
    super(reason);
    this.name = "EpaAqsError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeCredentials(value: EpaAqsCredentials | undefined): EpaAqsCredentials | null {
  if (!value || !/^\S+@\S+\.\S+$/u.test(value.email) || !/^[A-Za-z0-9_-]{8,128}$/u.test(value.key)) return null;
  return value;
}

function safeText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, maximum) : "";
}

export function observationsFromAqsJson(
  json: unknown,
  bytes: Uint8Array,
  areaValue: unknown,
  date: string,
  retrievedAt: string
): Observation[] {
  const area = validateQueryArea(areaValue);
  if (!isRecord(json) || !isRecord(json.Header) || !Array.isArray(json.Data)) throw new EpaAqsError("schema_validation");
  const status = safeText(json.Header.status, 80).toLowerCase();
  if (status !== "success" && !status.includes("no data")) throw new EpaAqsError("provider_failure");
  const payloadHash = createHash("sha256").update(bytes).digest("hex");
  const observations: Observation[] = [];
  const seen = new Set<string>();
  for (const row of json.Data) {
    if (!isRecord(row)) throw new EpaAqsError("schema_validation");
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    const measurement = Number(row.sample_measurement);
    const rowDate = safeText(row.date_gmt, 10);
    const rowTime = safeText(row.time_gmt, 5);
    const units = safeText(row.units_of_measure, 80);
    if (rowDate !== date || !/^\d{2}:\d{2}$/u.test(rowTime)) continue;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(measurement) || units === "") {
      throw new EpaAqsError("schema_validation");
    }
    if (latitude < area.south || latitude > area.north || longitude < area.west || longitude > area.east) continue;
    const parameterCode = safeText(row.parameter_code, 12) || "88101";
    const siteId = `${safeText(row.state_code, 4)}-${safeText(row.county_code, 4)}-${safeText(row.site_number, 8)}`;
    const recordId = `${siteId}-${parameterCode}-${rowDate}-${rowTime.replace(":", "")}`;
    if (seen.has(recordId)) continue;
    seen.add(recordId);
    observations.push({
      observationId: `obs-epa-aqs-${recordId}`,
      provenance: {
        sourceId: "epa_aqs",
        sourceUrl: "https://aqs.epa.gov/aqsweb/documents/data_api.html",
        sourceRecordId: recordId,
        retrievedAt,
        observedAt: `${rowDate}T${rowTime}:00.000Z`,
        product: "EPA AQS sampleData/byBox validated sample data",
        payloadHash,
        requestParameters: {
          requestedDate: date,
          parameterCode,
          bbox: `${area.west},${area.south},${area.east},${area.north}`,
          credentials: "server_only_not_retained",
        },
      },
      variableName: safeText(row.parameter, 160) || "EPA AQS outdoor pollutant sample",
      value: measurement,
      unit: units,
      // AQS publishes historical samples, but this adapter retrieves them
      // live for the current request. Observation age belongs in freshness;
      // dataMode identifies the retrieval path used by the evidence object.
      dataMode: "live",
      qualifiers: ["validated_regulatory_monitoring_data", "outdoor_station", "publication_lag_applies"],
      metadata: {
        siteId,
        parameterCode,
        latitude,
        longitude,
        method: safeText(row.method_name, 160) || "not supplied",
        sampleDuration: safeText(row.sample_duration, 80) || "not supplied",
        dateOfLastChange: safeText(row.date_of_last_change, 10) || "not supplied",
      },
    });
    if (observations.length >= EPA_AQS_MAX_OBSERVATIONS) break;
  }
  return observations;
}

export async function queryEpaAqs(
  areaValue: unknown,
  date: string,
  dependencies: { fetchImpl?: typeof fetch; now?: () => Date; credentials?: EpaAqsCredentials } = {}
): Promise<EpaAqsResult> {
  let area: BoundingBox;
  try {
    area = validateQueryArea(areaValue);
  } catch {
    return { kind: "source_failure", reason: "schema_validation" };
  }
  const credentials = safeCredentials(dependencies.credentials ?? (
    process.env.EPA_AQS_EMAIL && process.env.EPA_AQS_KEY
      ? { email: process.env.EPA_AQS_EMAIL, key: process.env.EPA_AQS_KEY }
      : undefined
  ));
  if (!credentials) return { kind: "credential_gate_closed" };
  const compactDate = date.replaceAll("-", "");
  if (!/^\d{8}$/u.test(compactDate)) return { kind: "source_failure", reason: "schema_validation" };
  const url = new URL(`https://${EPA_AQS_HOST}${EPA_AQS_PATH}`);
  url.search = new URLSearchParams({
    email: credentials.email,
    key: credentials.key,
    param: "88101",
    bdate: compactDate,
    edate: compactDate,
    minlat: String(area.south),
    maxlat: String(area.north),
    minlon: String(area.west),
    maxlon: String(area.east),
  }).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EPA_AQS_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await (dependencies.fetchImpl ?? fetch)(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new EpaAqsError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) throw new EpaAqsError("redirect");
    if (response.status === 429) throw new EpaAqsError("rate_limited");
    if (!response.ok) throw new EpaAqsError("provider_failure");
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > EPA_AQS_MAX_BYTES) throw new EpaAqsError("oversize");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > EPA_AQS_MAX_BYTES) throw new EpaAqsError("oversize");
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new EpaAqsError("malformed");
    }
    const observations = observationsFromAqsJson(json, bytes, area, date, (dependencies.now?.() ?? new Date()).toISOString());
    return observations.length > 0 ? { kind: "observations", observations } : { kind: "no_observation" };
  } catch (error) {
    return { kind: "source_failure", reason: error instanceof EpaAqsError ? error.reason : "malformed" };
  } finally {
    clearTimeout(timeout);
  }
}
