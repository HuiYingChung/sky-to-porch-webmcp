import { createHash } from "node:crypto";
import type { BoundingBox } from "@/contracts/common";
import type { Observation } from "@/contracts/evidence";
import { validateQueryArea } from "@/lib/location/query-area";

export const NHC_HURDAT_HOST = "www.nhc.noaa.gov";
export const NHC_HURDAT_INDEX_PATH = "/data/hurdat/";
export const NHC_HURDAT_TIMEOUT_MS = 10_000;
export const NHC_HURDAT_MAX_BYTES = 20_000_000;
export const NHC_HURDAT_MAX_OBSERVATIONS = 8;

export type NhcHurdatFailureReason =
  | "network"
  | "timeout"
  | "redirect"
  | "rate_limited"
  | "provider_failure"
  | "oversize"
  | "malformed"
  | "schema_validation";

export type NhcHurdatResult =
  | { kind: "observations"; observations: Observation[]; files: string[] }
  | { kind: "no_observation"; files: string[] }
  | { kind: "not_applicable"; reason: "outside_record" }
  | { kind: "source_failure"; reason: NhcHurdatFailureReason; stage: "index" | "track" };

interface TrackPoint {
  stormId: string;
  stormName: string;
  date: string;
  time: string;
  recordIdentifier: string;
  status: string;
  latitude: number;
  longitude: number;
  maximumWindKnots: number | null;
  minimumPressureMb: number | null;
}

class NhcHurdatError extends Error {
  constructor(readonly reason: NhcHurdatFailureReason) {
    super(reason);
    this.name = "NhcHurdatError";
  }
}

function parseCoordinate(raw: string, positive: string, negative: string): number | null {
  const match = /^(\d+(?:\.\d+)?)([NSEW])$/u.exec(raw.trim().toUpperCase());
  if (!match || (match[2] !== positive && match[2] !== negative)) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  return match[2] === negative ? -magnitude : magnitude;
}

function inside(area: BoundingBox, latitude: number, longitude: number): boolean {
  return latitude >= area.south && latitude <= area.north &&
    longitude >= area.west && longitude <= area.east;
}

export function parseHurdat2(text: string): TrackPoint[] {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const points: TrackPoint[] = [];
  let stormId = "";
  let stormName = "";
  let remaining = 0;
  for (const line of lines) {
    const columns = line.split(",").map((value) => value.trim());
    if (remaining === 0) {
      if (columns.length < 3 || !/^[A-Z]{2}\d{6}$/u.test(columns[0])) {
        throw new NhcHurdatError("malformed");
      }
      const count = Number(columns[2]);
      if (!Number.isInteger(count) || count < 1 || count > 500) throw new NhcHurdatError("malformed");
      stormId = columns[0];
      stormName = columns[1] || "UNNAMED";
      remaining = count;
      continue;
    }
    remaining -= 1;
    if (columns.length < 8 || !/^\d{8}$/u.test(columns[0]) || !/^\d{4}$/u.test(columns[1])) {
      throw new NhcHurdatError("malformed");
    }
    const date = `${columns[0].slice(0, 4)}-${columns[0].slice(4, 6)}-${columns[0].slice(6, 8)}`;
    const latitude = parseCoordinate(columns[4], "N", "S");
    const longitude = parseCoordinate(columns[5], "E", "W");
    const rawWind = Number(columns[6]);
    const pressure = Number(columns[7]);
    if (latitude === null || longitude === null || !Number.isFinite(rawWind) || (rawWind !== -99 && (rawWind < 0 || rawWind > 250))) {
      throw new NhcHurdatError("schema_validation");
    }
    points.push({
      stormId,
      stormName,
      date,
      time: columns[1],
      recordIdentifier: columns[2],
      status: columns[3],
      latitude,
      longitude,
      maximumWindKnots: rawWind === -99 ? null : rawWind,
      minimumPressureMb: Number.isFinite(pressure) && pressure > 0 ? pressure : null,
    });
  }
  if (remaining !== 0) throw new NhcHurdatError("malformed");
  return points;
}

export function selectHurdat2Files(indexHtml: string): string[] {
  const matches = [...indexHtml.matchAll(/href="(hurdat2(?:-nepac)?-\d{4}-\d{4}-\d+\.txt)"/giu)]
    .map((match) => match[1]);
  const byBasin = new Map<string, string>();
  for (const filename of matches) {
    const basin = filename.includes("-nepac-") ? "nepac" : "atlantic";
    const previous = byBasin.get(basin);
    if (!previous || filename.localeCompare(previous) > 0) byBasin.set(basin, filename);
  }
  return [...byBasin.values()].sort();
}

async function fetchText(fetchImpl: typeof fetch, url: URL, maximumBytes: number): Promise<{ text: string; bytes: Uint8Array }> {
  if (url.protocol !== "https:" || url.hostname !== NHC_HURDAT_HOST) throw new NhcHurdatError("schema_validation");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NHC_HURDAT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { method: "GET", redirect: "manual", cache: "no-store", signal: controller.signal });
    } catch {
      throw new NhcHurdatError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) throw new NhcHurdatError("redirect");
    if (response.status === 429) throw new NhcHurdatError("rate_limited");
    if (!response.ok) throw new NhcHurdatError("provider_failure");
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > maximumBytes) throw new NhcHurdatError("oversize");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new NhcHurdatError("oversize");
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), bytes };
  } finally {
    clearTimeout(timeout);
  }
}

export async function queryNhcHurdat2(
  areaValue: unknown,
  date: string,
  dependencies: { fetchImpl?: typeof fetch; now?: () => Date } = {}
): Promise<NhcHurdatResult> {
  let area: BoundingBox;
  try {
    area = validateQueryArea(areaValue);
  } catch {
    return { kind: "source_failure", reason: "schema_validation", stage: "index" };
  }
  const year = Number(date.slice(0, 4));
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isInteger(year)) {
    return { kind: "source_failure", reason: "schema_validation", stage: "index" };
  }
  if (year < 1851) return { kind: "not_applicable", reason: "outside_record" };
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const indexUrl = new URL(`https://${NHC_HURDAT_HOST}${NHC_HURDAT_INDEX_PATH}`);
  let files: string[];
  try {
    files = selectHurdat2Files((await fetchText(fetchImpl, indexUrl, 1_000_000)).text);
    if (files.length === 0) throw new NhcHurdatError("schema_validation");
    const latestPublishedYear = Math.max(...files.map((filename) => {
      const match = /-(\d{4})-\d+\.txt$/u.exec(filename);
      return match ? Number(match[1]) : 0;
    }));
    if (year > latestPublishedYear) return { kind: "not_applicable", reason: "outside_record" };
  } catch (error) {
    return { kind: "source_failure", reason: error instanceof NhcHurdatError ? error.reason : "malformed", stage: "index" };
  }
  const observations: Observation[] = [];
  try {
    for (const filename of files) {
      const sourceUrl = new URL(filename, indexUrl);
      const payload = await fetchText(fetchImpl, sourceUrl, NHC_HURDAT_MAX_BYTES);
      const payloadHash = createHash("sha256").update(payload.bytes).digest("hex");
      for (const point of parseHurdat2(payload.text)) {
        if (point.date !== date || point.maximumWindKnots === null || !inside(area, point.latitude, point.longitude)) continue;
        const observedAt = `${date}T${point.time.slice(0, 2)}:${point.time.slice(2, 4)}:00.000Z`;
        observations.push({
          observationId: `obs-hurdat2-${point.stormId}-${date.replaceAll("-", "")}-${point.time}`,
          provenance: {
            sourceId: "nhc_hurdat2",
            sourceUrl: sourceUrl.toString(),
            sourceRecordId: `${point.stormId}-${date.replaceAll("-", "")}-${point.time}`,
            retrievedAt: (dependencies.now?.() ?? new Date()).toISOString(),
            observedAt,
            product: "NHC HURDAT2 best-track database",
            payloadHash,
            requestParameters: {
              requestedDate: date,
              bbox: `${area.west},${area.south},${area.east},${area.north}`,
              applicability: "best_track_center_point_inside_selected_bbox",
            },
          },
          variableName: "NHC HURDAT2 tropical cyclone maximum sustained wind",
          value: point.maximumWindKnots,
          unit: "kt",
          dataMode: "historical",
          qualifiers: ["official_post_analysis_best_track", "six_hour_track_point", "storm_center_not_impact_footprint"],
          metadata: {
            stormId: point.stormId,
            stormName: point.stormName,
            status: point.status || "unspecified",
            recordIdentifier: point.recordIdentifier || "regular_track_point",
            latitude: point.latitude,
            longitude: point.longitude,
            ...(point.minimumPressureMb === null ? {} : { minimumPressureMb: point.minimumPressureMb }),
          },
        });
        if (observations.length >= NHC_HURDAT_MAX_OBSERVATIONS) break;
      }
      if (observations.length >= NHC_HURDAT_MAX_OBSERVATIONS) break;
    }
    return observations.length > 0
      ? { kind: "observations", observations, files }
      : { kind: "no_observation", files };
  } catch (error) {
    return { kind: "source_failure", reason: error instanceof NhcHurdatError ? error.reason : "malformed", stage: "track" };
  }
}
