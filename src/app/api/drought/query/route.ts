import { NextResponse } from "next/server";
import { CONCERN_TYPES, type ConcernType } from "@/contracts/common";
import { loadProviderConfig } from "@/lib/ai/provider-router";
import { normalizeOptionalQuestion } from "@/lib/ai/optional-question";
import { queryDroughtFixture } from "@/lib/drought/fixture-adapter";
import { queryLiveDroughtEvidence } from "@/lib/drought/live-adapter";
import { finalizeDroughtQueryResult } from "@/lib/drought/service";
import type { DroughtQueryInput, DroughtQueryRequest } from "@/lib/drought/types";
import { validateCanonicalAreaQuery } from "@/lib/location/query-area";
import {
  acquireGuardedProviderAccess,
} from "@/lib/security/ai-abuse-control";

export const runtime = "nodejs";

const ALLOWED_KEYS = new Set(["placeId", "date", "mode", "concern", "optionalQuestion", "area"]);

function parseInput(value: unknown): DroughtQueryRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const hasArea = "area" in obj;

  // Reject extra keys
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) return null;
  }

  if (
    typeof obj.placeId !== "string" ||
    typeof obj.date !== "string" ||
    (obj.mode !== "live" && obj.mode !== "fixture") ||
    typeof obj.concern !== "string" ||
    !(CONCERN_TYPES as readonly string[]).includes(obj.concern)
  ) {
    return null;
  }

  let optionalQuestion: string | undefined;
  try {
    optionalQuestion = normalizeOptionalQuestion(obj.optionalQuestion);
  } catch {
    return null;
  }

  if (obj.mode === "live") {
    if (!hasArea) return null;
    try {
      return {
        ...validateCanonicalAreaQuery(obj.placeId, obj.area),
        date: obj.date,
        mode: "live",
        concern: obj.concern as ConcernType,
        ...(optionalQuestion ? { optionalQuestion } : {}),
      } as DroughtQueryRequest;
    } catch {
      return null;
    }
  }
  if (hasArea) return null;
  return {
    placeId: obj.placeId,
    date: obj.date,
    mode: obj.mode,
    concern: obj.concern as ConcernType,
    ...(optionalQuestion ? { optionalQuestion } : {}),
  } as DroughtQueryRequest;
}

function toAdapterInput(input: DroughtQueryRequest): DroughtQueryInput {
  if (input.mode === "live") {
    return {
      placeId: input.placeId,
      date: input.date,
      mode: "live",
      area: input.area,
    };
  }
  return {
    placeId: input.placeId,
    date: input.date,
    mode: input.mode,
  } as DroughtQueryInput;
}

export async function POST(request: Request) {
  let input: DroughtQueryRequest;
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
    const rawProviderConfig = input.mode === "fixture" ? null : loadProviderConfig();
    const adapterResult =
      adapterInput.mode === "fixture"
        ? queryDroughtFixture(adapterInput)
        : await queryLiveDroughtEvidence(adapterInput);
    const result = await finalizeDroughtQueryResult(
      adapterResult,
      input.concern,
      rawProviderConfig,
      input.optionalQuestion,
      undefined,
      input.mode === "live"
        ? () => acquireGuardedProviderAccess(request, input, rawProviderConfig)
        : undefined
    );
    return NextResponse.json({ ok: true, result });
  } catch {
    return NextResponse.json({ ok: false, error: "validation_failed" }, { status: 500 });
  }
}
