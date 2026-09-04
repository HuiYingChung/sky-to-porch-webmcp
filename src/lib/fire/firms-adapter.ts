/**
 * src/lib/fire/firms-adapter.ts
 *
 * UXFIX-02 (ADR-0022): NASA FIRMS global active-fire retrieval for
 * map-selected areas outside NOAA HMS coverage.
 *
 * Server-only and key-gated: requires the FIRMS_MAP_KEY environment variable
 * (free registration at https://firms.modaps.eosdis.nasa.gov/api/). Without a
 * key the adapter fails closed with an explicit source-failure result —
 * it never guesses and never substitutes another source.
 *
 * Credential rules:
 *   - The MAP_KEY is read from the environment at request time, used only in
 *     the outbound URL, and REDACTED from every stored sourceUrl, error, and
 *     request-parameter record.
 *
 * Retrieval rules (mirrors the WP-05 fail-closed posture):
 *   - Exact HTTPS host allowlist, no redirect, no retry, bounded bytes,
 *     bounded timeout. 429/timeout/network/oversize/malformed fail closed.
 *   - Detection counts are pixel detections, not distinct fires or damage.
 */

import { createHash } from "node:crypto";
import { validateEvidenceObject } from "@/contracts/evidence";
import type { EvidenceObject, Observation } from "@/contracts/evidence";
import type { BoundingBox } from "@/contracts/common";
import { validateQueryArea } from "@/lib/location/query-area";
import type { FireQueryResult, FireTemporalCoverage } from "./types";

const FIRMS_HOST = "firms.modaps.eosdis.nasa.gov";
/** Standard-processing VIIRS product (historical archive; NRT excluded). */
const FIRMS_PRODUCT = "VIIRS_SNPP_SP";
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
export const FIRMS_MAX_RANGE_DAYS = 5;

export interface FirmsDependencies {
  fetch: typeof globalThis.fetch;
  nowIso: () => string;
  /** Injectable for tests; defaults to process.env.FIRMS_MAP_KEY. */
  mapKey?: string;
}

function redactedUrl(box: BoundingBox, dayRange: number, startDate: string): string {
  return (
    `https://${FIRMS_HOST}/api/area/csv/MAP_KEY/${FIRMS_PRODUCT}/` +
    `${box.west},${box.south},${box.east},${box.north}/${dayRange}/${startDate}`
  );
}

function buildFirmsUrl(
  mapKey: string,
  box: BoundingBox,
  dayRange: number,
  startDate: string
): URL {
  const url = new URL(
    `https://${FIRMS_HOST}/api/area/csv/${encodeURIComponent(mapKey)}/${FIRMS_PRODUCT}/` +
    `${box.west},${box.south},${box.east},${box.north}/${dayRange}/${startDate}`
  );
  if (url.hostname !== FIRMS_HOST || url.protocol !== "https:") {
    throw new Error("FIRMS URL outside exact allowlist");
  }
  return url;
}

/**
 * Parses the FIRMS area CSV. First line is the header; every following
 * non-empty line is one detection. Validates the header shape and bounds the
 * accepted acquisition dates to the requested window.
 */
export function parseFirmsCsv(
  text: string,
  startDate: string,
  endDate: string,
  box: BoundingBox
): { total: number; perDate: Map<string, number> } {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error("malformed");
  const header = lines[0].split(",").map((column) => column.trim().toLowerCase());
  const latIndex = header.indexOf("latitude");
  const lonIndex = header.indexOf("longitude");
  const dateIndex = header.indexOf("acq_date");
  if (latIndex === -1 || lonIndex === -1 || dateIndex === -1) {
    throw new Error("schema_validation");
  }
  const perDate = new Map<string, number>();
  let total = 0;
  for (const line of lines.slice(1)) {
    const columns = line.split(",");
    if (columns.length < header.length) throw new Error("malformed");
    const latitudeText = columns[latIndex]?.trim();
    const longitudeText = columns[lonIndex]?.trim();
    if (!latitudeText || !longitudeText) throw new Error("schema_validation");
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < box.south ||
      latitude > box.north ||
      longitude < box.west ||
      longitude > box.east
    ) {
      throw new Error("schema_validation");
    }
    const acqDate = columns[dateIndex]?.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(acqDate)) throw new Error("malformed");
    if (acqDate < startDate || acqDate > endDate) throw new Error("schema_validation");
    total += 1;
    perDate.set(acqDate, (perDate.get(acqDate) ?? 0) + 1);
  }
  return { total, perDate };
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null) {
    const declaredLength = Number(lengthHeader);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > maximumBytes) {
      throw new Error("oversize");
    }
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("oversize");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (
    let ms = Date.parse(`${startDate}T00:00:00Z`);
    ms <= Date.parse(`${endDate}T00:00:00Z`);
    ms += 86_400_000
  ) {
    dates.push(new Date(ms).toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Retrieves global VIIRS active-fire detections for a validated custom area
 * and inclusive date range (1–5 completed UTC days, the FIRMS Area API cap).
 */
export async function queryFirmsEvidence(
  box: BoundingBox,
  startDate: string,
  endDate: string,
  deps: FirmsDependencies
): Promise<FireQueryResult> {
  let validatedBox: BoundingBox;
  try {
    validatedBox = validateQueryArea(box);
  } catch {
    return {
      kind: "unsupported_place",
      rejectionReason: "The selected map area could not be used. Please choose the location again.",
    };
  }
  const mapKey = deps.mapKey ?? process.env.FIRMS_MAP_KEY;
  const dates = enumerateDates(startDate, endDate);
  const coverage: FireTemporalCoverage = {
    requestType: "custom",
    status: "complete",
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    resolvedStartDate: startDate,
    resolvedEndDate: endDate,
    days: dates.map((date) => ({
      date,
      status: "complete" as const,
      fireStatus: "complete" as const,
      smokeStatus: "not_checked" as const,
    })),
  };
  const retrievedAt = deps.nowIso();

  if (!mapKey || mapKey.trim().length === 0) {
    return firmsFailure("server credential not configured", coverage, retrievedAt);
  }
  if (dates.length === 0 || dates.length > FIRMS_MAX_RANGE_DAYS) {
    return {
      kind: "unsupported_date",
      rejectionReason: `FIRMS retrieval accepts an inclusive range of 1-${FIRMS_MAX_RANGE_DAYS} UTC days.`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await deps.fetch(buildFirmsUrl(mapKey, validatedBox, dates.length, startDate), {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "text/csv" },
      });
    } catch {
      return firmsFailure(controller.signal.aborted ? "timeout" : "network", coverage, retrievedAt);
    }
    if (response.status >= 300 && response.status < 400) {
      return firmsFailure("provider_failure", coverage, retrievedAt);
    }
    if (response.status === 429) return firmsFailure("rate_limited", coverage, retrievedAt);
    if (!response.ok) return firmsFailure("provider_failure", coverage, retrievedAt);

    const contentType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== "text/csv" && contentType !== "application/csv") {
      return firmsFailure("schema_validation", coverage, retrievedAt);
    }
    let text: string;
    try {
      text = await readBoundedText(response, MAX_BYTES);
    } catch (error) {
      return firmsFailure(
        error instanceof Error && error.message === "oversize" ? "oversize" : "parse_failure",
        coverage,
        retrievedAt
      );
    }

    let parsed: { total: number; perDate: Map<string, number> };
    try {
      parsed = parseFirmsCsv(text, startDate, endDate, validatedBox);
    } catch {
      return firmsFailure("parse_failure", coverage, retrievedAt);
    }

    const sourceUrl = redactedUrl(validatedBox, dates.length, startDate);
    const observation: Observation = {
      observationId: `obs-firms-viirs-custom-area-${startDate}-${endDate}`,
      provenance: {
        sourceId: "nasa_firms",
        sourceUrl,
        retrievedAt,
        observedAt: `${endDate}T00:00:00Z`,
        product: FIRMS_PRODUCT,
        payloadHash: createHash("sha256").update(text).digest("hex"),
        requestParameters: {
          area: `${validatedBox.west},${validatedBox.south},${validatedBox.east},${validatedBox.north}`,
          dayRange: String(dates.length),
          date: startDate,
          keyDisclosure: "MAP_KEY redacted; configured server-side only",
        },
      },
      variableName: "Active fire detections (VIIRS pixel detections in area)",
      value: parsed.total,
      unit: "detections",
      dataMode: "live",
      qualifiers: parsed.total === 0 ? ["no_detection_is_not_no_fire"] : [],
      periodStart: `${startDate}T00:00:00Z`,
      periodEnd: `${endDate}T23:59:59Z`,
      metadata: {
        instrument: "VIIRS (Suomi NPP)",
        product: FIRMS_PRODUCT,
        perDateCounts: JSON.stringify(Object.fromEntries(parsed.perDate)),
        detectionDisclosure:
          "Counts are satellite pixel detections, not distinct fires, homes, or people.",
      },
    };

    const evidence: EvidenceObject = {
      evidenceId: `evd-fire-firms-custom-area-${startDate}-${endDate}`,
      hazardId: "fire_smoke",
      intentId: `intent-fire-firms-custom-area-${startDate}`,
      evidenceState: parsed.total > 0 ? "observations_returned" : "no_observation",
      dataMode: "live",
      observations: [observation],
      derivedMetrics: [],
      missionAttributions: [
        {
          missionName: "Suomi NPP",
          agency: "NASA / NOAA",
          purpose: "Global VIIRS active-fire detection distributed through NASA FIRMS",
          selectionReason:
            "Global coverage for map-selected areas outside NOAA HMS (North America) coverage",
          contributedObservationIds: [observation.observationId],
          retrievalStatus: "success",
          keyLimitation:
            "Missed detections (cloud, canopy, timing) mean absence of detections is not absence of fire.",
          datasetId: FIRMS_PRODUCT,
        },
      ],
      freshness: {
        status: "historical",
        classificationBasis: "historical_context",
        mostRecentObservationAt: `${endDate}T00:00:00Z`,
        evaluatedAt: retrievedAt,
        ageSeconds: Math.max(0, Math.floor((Date.parse(retrievedAt) - Date.parse(`${endDate}T00:00:00Z`)) / 1000)),
        note: "FIRMS standard-processing detections for the explicitly requested completed UTC dates.",
      },
      confidence: {
        level: parsed.total > 0 ? "low" : "insufficient",
        rationale: parsed.total > 0
          ? "Global satellite detections are present for the requested window; they are regional evidence " +
            "and do not establish conditions at any specific property."
          : "No detection was returned for the requested window. Missed detections are common; " +
            "absence of detections is not evidence of no fire.",
      },
      limitations: [
        {
          limitationId: "lim-uxfix02-firms-detection-limits",
          source: "nasa_firms",
          description:
            "Cloud cover, canopy, small or cool fires, and satellite revisit timing cause missed detections; " +
            "zero detections is not evidence of no fire.",
          required: true,
        },
        {
          limitationId: "lim-uxfix02-firms-not-property",
          source: "nasa_firms",
          description:
            "Detection counts are pixel detections, not distinct fires, and do not establish property damage, " +
            "air quality, or evacuation need.",
          required: true,
        },
      ],
      explanations: [],
      assembledAt: retrievedAt,
    };
    validateEvidenceObject(evidence);
    return {
      kind: parsed.total > 0 ? "success" : "no_observation",
      evidence,
      temporalCoverage: coverage,
    };
  } finally {
    clearTimeout(timer);
  }
}

function firmsFailure(
  reason: string,
  coverage: FireTemporalCoverage,
  evaluatedAt: string
): FireQueryResult {
  void evaluatedAt; // reserved for a future failure-evidence record
  return {
    kind: "source_failure",
    failureReason: "provider_failure",
    rejectionReason:
      `FIRMS retrieval failed (${reason}). No stale or substituted data is shown; ` +
      "a failed lookup is not evidence of no fire.",
    temporalCoverage: {
      ...coverage,
      status: "failed",
      days: coverage.days.map((day) => ({
        ...day,
        status: "failed",
        fireStatus: "failed",
      })),
    },
    evidence: undefined,
  };
}
