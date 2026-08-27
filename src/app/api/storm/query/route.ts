import { NextResponse } from "next/server";
import { CONCERN_TYPES, type ConcernType } from "@/contracts/common";
import { normalizeOptionalQuestion } from "@/lib/ai/optional-question";
import { validateCanonicalAreaQuery } from "@/lib/location/query-area";
import { queryLiveStormEvidence } from "@/lib/storm/live-adapter";
import { finalizeStormQueryResult } from "@/lib/storm/service";
import type { StormQueryRequest } from "@/lib/storm/types";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInput(value: unknown): StormQueryRequest | null {
  if (!isRecord(value)) return null;
  const allowedKeys = new Set(["area", "concern", "date", "mode", "placeId", "optionalQuestion"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return null;
  if (
    typeof value.placeId !== "string" ||
    typeof value.date !== "string" ||
    value.mode !== "live" ||
    typeof value.concern !== "string" ||
    !(CONCERN_TYPES as readonly string[]).includes(value.concern) ||
    !("area" in value)
  ) return null;
  let optionalQuestion: string | undefined;
  try {
    optionalQuestion = normalizeOptionalQuestion(value.optionalQuestion);
    return {
      ...validateCanonicalAreaQuery(value.placeId, value.area),
      date: value.date,
      mode: "live",
      concern: value.concern as ConcernType,
      ...(optionalQuestion ? { optionalQuestion } : {}),
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let input: StormQueryRequest;
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
    const adapterResult = await queryLiveStormEvidence(input);
    const result = await finalizeStormQueryResult(
      adapterResult,
      input.concern,
      input.optionalQuestion
    );
    return NextResponse.json({ ok: true, result });
  } catch {
    return NextResponse.json({ ok: false, error: "validation_failed" }, { status: 500 });
  }
}
