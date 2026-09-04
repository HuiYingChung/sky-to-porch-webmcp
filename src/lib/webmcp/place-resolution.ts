import {
  validateBoundingBox,
  type BoundingBox,
} from "@/contracts/common";
import {
  GEOCODE_ATTRIBUTION,
  type GeocodeAdminContext,
  type GeocodeResult,
} from "@/lib/location/geocode";

export const PLACE_CHOICE_ID_PATTERN_SOURCE =
  "^place-[A-Za-z0-9._-]{3,120}$";
export const PLACE_CHOICE_ID_RE = new RegExp(PLACE_CHOICE_ID_PATTERN_SOURCE, "u");

const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F-\u009F]/u;
const UPSTREAM_ID_RE = /^[A-Za-z0-9._-]{3,120}$/u;
const MAX_UPSTREAM_CANDIDATES = 5;
const MAX_PUBLIC_CHOICES = 3;

export type ResolvedPlaceCandidate = GeocodeResult;

export interface AgentPlaceChoice {
  choice_id: string;
  label: string;
}

export type NamedPlaceResolution =
  | { status: "resolved"; candidate: ResolvedPlaceCandidate }
  | { status: "place_not_found" }
  | { status: "place_lookup_failed"; reason?: "rate_limited" }
  | {
      status: "needs_place_choice";
      choices: AgentPlaceChoice[];
      refreshed: boolean;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedBoundingBox(
  value: unknown,
  representativeLon: number,
  representativeLat: number
): BoundingBox | null {
  if (!isRecord(value)) return null;
  const candidate = {
    west: value.west,
    south: value.south,
    east: value.east,
    north: value.north,
  };
  try {
    validateBoundingBox(candidate);
    if (
      representativeLon < candidate.west ||
      representativeLon > candidate.east ||
      representativeLat < candidate.south ||
      representativeLat > candidate.north
    ) return null;
    return candidate;
  } catch {
    return null;
  }
}

function adminContext(value: unknown): GeocodeAdminContext {
  if (!isRecord(value)) return {};
  const output: GeocodeAdminContext = {};
  for (const key of [
    "locality",
    "city",
    "district",
    "county",
    "state",
    "country",
    "countryCode",
  ] as const) {
    const item = value[key];
    if (
      typeof item === "string" &&
      item.trim().length > 0 &&
      item.length <= 200 &&
      !CONTROL_CHAR_RE.test(item)
    ) output[key] = item.trim();
  }
  return output;
}

function parseCandidates(
  payload: Record<string, unknown>
): ResolvedPlaceCandidate[] | null {
  if (!Array.isArray(payload.results)) return null;
  const candidates: ResolvedPlaceCandidate[] = [];
  // The same-origin geocode route returns at most five results. Inspect that
  // entire bounded set before limiting public choices so duplicate leading
  // rows cannot hide a later ambiguity or ID conflict.
  for (const item of payload.results.slice(0, MAX_UPSTREAM_CANDIDATES)) {
    if (!isRecord(item)) return null;
    if (
      typeof item.label !== "string" ||
      item.label.trim().length === 0 ||
      item.label.length > 200 ||
      CONTROL_CHAR_RE.test(item.label) ||
      typeof item.lon !== "number" ||
      !Number.isFinite(item.lon) ||
      item.lon < -180 ||
      item.lon > 180 ||
      typeof item.lat !== "number" ||
      !Number.isFinite(item.lat) ||
      item.lat < -90 ||
      item.lat > 90
    ) return null;
    candidates.push({
      ...(typeof item.id === "string" && UPSTREAM_ID_RE.test(item.id)
        ? { id: item.id }
        : {}),
      label: item.label.trim(),
      lon: item.lon,
      lat: item.lat,
      boundingBox: normalizedBoundingBox(item.boundingBox, item.lon, item.lat),
      adminContext: adminContext(item.adminContext),
    });
  }
  return candidates;
}

export function placeChoiceId(candidate: ResolvedPlaceCandidate): string {
  const upstreamChoiceId = candidate.id ? `place-${candidate.id}` : null;
  if (upstreamChoiceId && PLACE_CHOICE_ID_RE.test(upstreamChoiceId)) {
    return upstreamChoiceId;
  }

  const latitude = candidate.lat.toFixed(7);
  const longitude = candidate.lon.toFixed(7);
  const normalizedLabel = candidate.label
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
  const fingerprint = `${normalizedLabel}|${latitude}|${longitude}`;
  // Two independent 32-bit FNV-style accumulators keep the browser-safe ID
  // compact while avoiding the old same-coordinate collision. No Node-only
  // crypto is used because this resolver also runs in the browser.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < fingerprint.length; index += 1) {
    const codeUnit = fingerprint.charCodeAt(index);
    first = Math.imul(first ^ codeUnit, 0x01000193);
    second = Math.imul(second ^ codeUnit, 0x85ebca6b);
  }
  const labelHash = `${(first >>> 0).toString(36).padStart(7, "0")}` +
    `${(second >>> 0).toString(36).padStart(7, "0")}`;
  const fallbackChoiceId =
    `place-coordinate-${latitude}-${longitude}-${labelHash}`;
  if (!PLACE_CHOICE_ID_RE.test(fallbackChoiceId)) {
    throw new Error("generated place choice id violates the public schema");
  }
  return fallbackChoiceId;
}

export function placeChoices(
  candidates: ResolvedPlaceCandidate[]
): AgentPlaceChoice[] {
  const unique = uniqueCandidatesByChoiceId(candidates);
  if (unique === null) {
    throw new Error("conflicting place candidates share one public choice id");
  }
  return unique.map((candidate) => ({
    choice_id: placeChoiceId(candidate),
    label: candidate.label,
  }));
}

function sameCandidate(
  first: ResolvedPlaceCandidate,
  second: ResolvedPlaceCandidate
): boolean {
  return first.label === second.label &&
    first.lon === second.lon &&
    first.lat === second.lat &&
    JSON.stringify(first.boundingBox ?? null) ===
      JSON.stringify(second.boundingBox ?? null) &&
    JSON.stringify(first.adminContext ?? {}) ===
      JSON.stringify(second.adminContext ?? {});
}

/**
 * Upstream IDs are untrusted. Exact duplicate rows may be collapsed, but one
 * ID resolving to different places is ambiguous and must fail closed rather
 * than letting Array.find silently select the first coordinate.
 */
function uniqueCandidatesByChoiceId(
  candidates: ResolvedPlaceCandidate[]
): ResolvedPlaceCandidate[] | null {
  const byChoiceId = new Map<string, ResolvedPlaceCandidate>();
  for (const candidate of candidates) {
    const choiceId = placeChoiceId(candidate);
    const existing = byChoiceId.get(choiceId);
    if (!existing) {
      byChoiceId.set(choiceId, candidate);
      continue;
    }
    if (!sameCandidate(existing, candidate)) return null;
  }
  return [...byChoiceId.values()];
}

export function validPlaceQuery(value: unknown): value is string {
  return typeof value === "string" &&
    value.trim().length >= 2 &&
    value.trim().length <= 200 &&
    !CONTROL_CHAR_RE.test(value);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Tool execution cancelled", "AbortError");
  }
}

export async function resolveNamedPlace(
  place: string,
  placeChoiceIdInput: string | undefined,
  fetchImpl: typeof fetch,
  signal: AbortSignal
): Promise<NamedPlaceResolution> {
  let response: Response;
  try {
    response = await fetchImpl("/api/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: place.trim() }),
      signal,
    });
  } catch {
    throwIfAborted(signal);
    return { status: "place_lookup_failed" };
  }
  // A dependency-injected or non-conforming transport may resolve even after
  // AbortSignal cancellation. Do not inspect or return that stale response.
  throwIfAborted(signal);

  if (response.status === 429) {
    return { status: "place_lookup_failed", reason: "rate_limited" };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throwIfAborted(signal);
    return { status: "place_lookup_failed" };
  }
  // Body parsing is asynchronous too; cancellation during response.json()
  // must remain cancellation instead of being downgraded to lookup failure.
  throwIfAborted(signal);
  if (!response.ok || !isRecord(payload) || payload.ok !== true) {
    return { status: "place_lookup_failed" };
  }

  const parsedCandidates = parseCandidates(payload);
  if (parsedCandidates === null) return { status: "place_lookup_failed" };
  const uniqueCandidates = uniqueCandidatesByChoiceId(parsedCandidates);
  if (uniqueCandidates === null) return { status: "place_lookup_failed" };
  if (uniqueCandidates.length === 0) return { status: "place_not_found" };
  if (placeChoiceIdInput !== undefined) {
    // Reordered upstream results must not invalidate a choice that was
    // previously offered. Search the full bounded unique set before capping
    // refreshed display choices.
    const selected = uniqueCandidates.find(
      (candidate) => placeChoiceId(candidate) === placeChoiceIdInput
    );
    if (selected) return { status: "resolved", candidate: selected };
    return {
      status: "needs_place_choice",
      choices: placeChoices(uniqueCandidates.slice(0, MAX_PUBLIC_CHOICES)),
      refreshed: true,
    };
  }
  const candidates = uniqueCandidates.slice(0, MAX_PUBLIC_CHOICES);
  if (candidates.length > 1) {
    return {
      status: "needs_place_choice",
      choices: placeChoices(candidates),
      refreshed: false,
    };
  }
  return { status: "resolved", candidate: candidates[0] };
}

export { GEOCODE_ATTRIBUTION };
