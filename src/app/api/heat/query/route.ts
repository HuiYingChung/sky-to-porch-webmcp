import { NextResponse } from "next/server";
import { CONCERN_TYPES, type ConcernType } from "@/contracts/common";
import { queryHeatFixture } from "@/lib/heat/fixture-adapter";
import { queryLiveHeatEvidence } from "@/lib/heat/live-adapter";
import { finalizeHeatQueryResult } from "@/lib/heat/service";
import type { HeatQueryInput, HeatQueryRequest } from "@/lib/heat/types";
import { validateCanonicalAreaQuery } from "@/lib/location/query-area";
import { normalizeOptionalQuestion } from "@/lib/ai/optional-question";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInput(value: unknown): HeatQueryRequest | null {
  if (!isRecord(value)) return null;
  const allowedKeys = new Set(["area", "concern", "date", "mode", "placeId", "optionalQuestion"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return null;
  const hasArea = "area" in value;
  if (
    typeof value.placeId !== "string" ||
    typeof value.date !== "string" ||
    (value.mode !== "fixture" && value.mode !== "live") ||
    typeof value.concern !== "string" ||
    !(CONCERN_TYPES as readonly string[]).includes(value.concern)
  ) return null;
  let optionalQuestion: string | undefined;
  try {
    optionalQuestion = normalizeOptionalQuestion(value.optionalQuestion);
  } catch {
    return null;
  }
  const explanationInput = optionalQuestion ? { optionalQuestion } : {};
  if (value.mode === "live") {
    if (!hasArea) return null;
    try {
      return {
        ...validateCanonicalAreaQuery(value.placeId, value.area),
        date: value.date,
        mode: "live",
        concern: value.concern as ConcernType,
        ...explanationInput,
      } as HeatQueryRequest;
    } catch {
      return null;
    }
  }
  if (hasArea) return null;
  return {
    placeId: value.placeId,
    date: value.date,
    mode: value.mode,
    concern: value.concern as ConcernType,
    ...explanationInput,
  } as HeatQueryRequest;
}

function toAdapterInput(input: HeatQueryRequest): HeatQueryInput {
  if (input.mode === "fixture") {
    return { placeId: input.placeId, date: input.date, mode: "fixture" };
  }
  return { placeId: input.placeId, date: input.date, mode: "live", area: input.area };
}

export async function POST(request: Request) {
  let input: HeatQueryRequest;
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
      ? queryHeatFixture(adapterInput)
      : await queryLiveHeatEvidence(adapterInput);
    const result = await finalizeHeatQueryResult(
      adapterResult,
      input.concern as ConcernType,
      input.optionalQuestion
    );
    return NextResponse.json({ ok: true, result });
  } catch {
    return NextResponse.json({ ok: false, error: "validation_failed" }, { status: 500 });
  }
}
