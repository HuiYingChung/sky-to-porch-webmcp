import { NextResponse } from "next/server";
import { CONCERN_TYPES, type ConcernType } from "@/contracts/common";
import { queryFloodFixture } from "@/lib/flood/fixture-adapter";
import { queryLiveFloodEvidence } from "@/lib/flood/live-adapter";
import { finalizeFloodQueryResult } from "@/lib/flood/service";
import type { FloodQueryInput, FloodQueryRequest } from "@/lib/flood/types";
import { validateCanonicalAreaQuery } from "@/lib/location/query-area";
import { normalizeOptionalQuestion } from "@/lib/ai/optional-question";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseConcern(value: unknown): ConcernType | null {
  return typeof value === "string" &&
    (CONCERN_TYPES as readonly string[]).includes(value)
    ? value as ConcernType
    : null;
}

function parseInput(body: unknown): FloodQueryRequest | null {
  if (!isRecord(body) || typeof body.placeId !== "string") return null;
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

  if (body.mode === "live") {
    if (!hasOnlyKeys(body, [
      "placeId",
      "startDate",
      "endDate",
      "mode",
      "concern",
      "area",
      "optionalQuestion",
    ])) return null;
    const hasArea = "area" in body;
    if (
      typeof body.startDate !== "string" ||
      typeof body.endDate !== "string"
    ) return null;
    if (!hasArea) return null;
    try {
      const canonicalArea = validateCanonicalAreaQuery(body.placeId, body.area);
      return {
        ...canonicalArea,
        startDate: body.startDate,
        endDate: body.endDate,
        mode: "live",
        concern,
        ...explanationInput,
      };
    } catch {
      return null;
    }
  }

  return null;
}

function toAdapterInput(input: FloodQueryRequest): FloodQueryInput {
  if (input.mode === "fixture") {
    return { placeId: input.placeId, date: input.date, mode: "fixture" };
  }
  return {
    placeId: input.placeId,
    startDate: input.startDate,
    endDate: input.endDate,
    mode: "live",
    area: input.area,
  };
}

export async function POST(request: Request) {
  let input: FloodQueryRequest;
  try {
    const parsed = parseInput(await request.json());
    if (!parsed) {
      return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
    }
    input = parsed;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  try {
    const adapterInput = toAdapterInput(input);
    const adapterResult = adapterInput.mode === "fixture"
      ? queryFloodFixture(adapterInput)
      : await queryLiveFloodEvidence(adapterInput);
    const result = await finalizeFloodQueryResult(
      adapterResult,
      input.concern,
      input.optionalQuestion
    );
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    // Server-side only: without this line a route-level exception is
    // indistinguishable from input validation, which hid a real defect.
    console.error("[flood-query] unhandled route error", error);
    return NextResponse.json(
      { ok: false, error: "validation_failed" },
      { status: 500 }
    );
  }
}
