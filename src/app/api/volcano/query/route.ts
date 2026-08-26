import { NextResponse } from "next/server";
import { coverageGapFetchForRequest } from "@/lib/coverage-gap/e2e-fixture-mode";
import { finalizeCoverageGapQueryResult } from "@/lib/coverage-gap/finalize";
import { parseCoverageGapInput, queryVolcanoEvidence } from "@/lib/coverage-gap/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = parseCoverageGapInput(await request.json());
    if (!input) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
    const fetchImpl = await coverageGapFetchForRequest(request);
    const adapterResult = await queryVolcanoEvidence(input, fetchImpl ? { fetchImpl } : {});
    const result = await finalizeCoverageGapQueryResult(
      adapterResult,
      input.concern,
      input.optionalQuestion
    );
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    // Server-side only: without this line a route-level exception is
    // indistinguishable from input validation (flood-route precedent).
    console.error("[volcano-query] unhandled route error", error);
    return NextResponse.json({ ok: false, error: "validation_failed" }, { status: 500 });
  }
}
