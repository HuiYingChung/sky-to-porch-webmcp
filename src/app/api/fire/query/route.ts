/**
 * src/app/api/fire/query/route.ts
 *
 * WP-05-004: Server-only fire evidence query boundary.
 *
 * This route is the sole production path for fire evidence. It validates
 * the explicit mode field and dispatches to either:
 *   - queryFireEvidence (fixture mode, deterministic, network-free)
 *   - queryLiveFireEvidence (live mode, server-only NOAA HMS retrieval)
 *
 * WP-07 revalidates and evaluates returned evidence, then produces exactly
 * one server-side, runtime-validated explanation from bounded evidence IDs.
 *
 * Fails closed on any malformed evidence or explanation: returns a
 * structured error that the client must treat as a failed query.
 * No stale evidence, no fallback, no raw validator/provider detail,
 * no unsafe claim reaches the client.
 */

import { NextResponse } from "next/server";
import { queryFireEvidence } from "@/lib/fire/fixture-adapter";
import { queryLiveFireEvidence } from "@/lib/fire/live-adapter";
import { validateEvidenceObject } from "@/contracts/evidence";
import { CONCERN_TYPES, type ConcernType } from "@/contracts/common";
import { evaluateEvidence } from "@/lib/evidence/evaluator";
import { explainEvaluatedEvidence } from "@/lib/ai/evidence-explainer";
import type {
  FireQueryInput,
  FireQueryRequest,
  FireLiveTimeSelection,
} from "@/lib/fire/types";
import { CUSTOM_AREA_PLACE_ID, validateCanonicalAreaQuery } from "@/lib/location/query-area";
import type { BoundingBox } from "@/contracts/common";
import { normalizeOptionalQuestion } from "@/lib/ai/optional-question";

export const runtime = "nodejs";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseLiveTime(value: unknown): FireLiveTimeSelection | null {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "latest") {
    if (!hasExactKeys(value, ["kind", "days"]) || (value.days !== 1 && value.days !== 7)) return null;
    return { kind: "latest", days: value.days };
  }
  if (value.kind === "range") {
    if (
      !hasExactKeys(value, ["kind", "startDate", "endDate"]) ||
      typeof value.startDate !== "string" ||
      typeof value.endDate !== "string"
    ) return null;
    return { kind: "range", startDate: value.startDate, endDate: value.endDate };
  }
  return null;
}

function parseConcern(value: unknown): ConcernType | null {
  return typeof value === "string" &&
    (CONCERN_TYPES as readonly string[]).includes(value)
    ? value as ConcernType
    : null;
}

function parseInput(body: unknown): FireQueryRequest | null {
  if (!isPlainRecord(body) || typeof body.placeId !== "string") return null;
  const concern = parseConcern(body.concern);
  if (!concern) return null;
  let optionalQuestion: string | undefined;
  try {
    optionalQuestion = normalizeOptionalQuestion(body.optionalQuestion);
  } catch {
    return null;
  }
  const explanationInput = optionalQuestion ? { optionalQuestion } : {};
  if (body.mode === "fixture") {
    if (
      !hasOnlyKeys(body, ["placeId", "date", "mode", "concern", "optionalQuestion"]) ||
      typeof body.date !== "string"
    ) return null;
    return {
      placeId: body.placeId,
      date: body.date,
      mode: "fixture",
      concern,
      ...explanationInput,
    };
  }
  if (body.mode !== "live") return null;
  if (
    hasOnlyKeys(body, ["placeId", "date", "mode", "concern", "optionalQuestion"]) &&
    typeof body.date === "string"
  ) {
    return {
      placeId: body.placeId,
      date: body.date,
      mode: "live",
      concern,
      ...explanationInput,
    };
  }
  if (!hasOnlyKeys(body, ["placeId", "mode", "time", "concern", "area", "optionalQuestion"])) {
    return null;
  }
  const hasArea = "area" in body;
  const time = parseLiveTime(body.time);
  if (!time) return null;
  // Temporal product queries always use one canonical area, regardless of
  // whether the selection originated from map, search, or a non-map control.
  if (body.placeId === CUSTOM_AREA_PLACE_ID && hasArea) {
    let area: BoundingBox;
    try {
      area = validateCanonicalAreaQuery(body.placeId, body.area).area;
    } catch {
      return null;
    }
    return {
      placeId: body.placeId,
      mode: "live",
      time,
      area,
      concern,
      ...explanationInput,
    };
  }
  return null;
}

function toAdapterInput(input: FireQueryRequest): FireQueryInput {
  if (input.mode === "fixture") {
    return { placeId: input.placeId, date: input.date, mode: "fixture" };
  }
  if ("date" in input) {
    return { placeId: input.placeId, date: input.date, mode: "live" };
  }
  return "area" in input && input.area
    ? { placeId: input.placeId, mode: "live", time: input.time, area: input.area }
    : { placeId: input.placeId, mode: "live", time: input.time };
}

export async function POST(request: Request) {
  let input: FireQueryRequest;
  try {
    const parsed = parseInput(await request.json());
    if (!parsed) {
      return NextResponse.json(
        { ok: false, error: "invalid_input" },
        { status: 400 }
      );
    }
    input = parsed;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_input" },
      { status: 400 }
    );
  }

  try {
    const adapterInput = toAdapterInput(input);
    const adapterResult = adapterInput.mode === "live"
      ? await queryLiveFireEvidence(adapterInput)
      : queryFireEvidence(adapterInput);

    if (adapterResult.evidence === undefined) {
      return NextResponse.json({ ok: true, result: adapterResult });
    }

    validateEvidenceObject(adapterResult.evidence);
    const hasObservationTime = adapterResult.evidence.observations.some(
      (observation) => observation.provenance.observedAt !== "unknown"
    );
    const evaluation = evaluateEvidence(adapterResult.evidence, {
      evaluatedAt: adapterResult.evidence.assembledAt,
      freshness: hasObservationTime
        ? { basis: "historical_context" }
        : { basis: "no_observation_time" },
    });
    const explained = await explainEvaluatedEvidence(
      evaluation,
      input.concern,
      input.optionalQuestion
    );
    const finalEvidence = {
      ...evaluation.evidence,
      explanations: [explained.explanation],
    };
    validateEvidenceObject(finalEvidence);

    const result = {
      ...adapterResult,
      evidence: finalEvidence,
      explanation: explained.explanation,
      explanationStatus: explained.status,
      ...(evaluation.conflicts.length > 0
        ? { evidenceConflicts: evaluation.conflicts }
        : {}),
    };
    return NextResponse.json({ ok: true, result });
  } catch {
    // Fail closed: malformed evidence or explanation must not reach the client.
    return NextResponse.json(
      { ok: false, error: "validation_failed" },
      { status: 500 }
    );
  }
}
