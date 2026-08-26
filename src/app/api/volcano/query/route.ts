import { NextResponse } from "next/server";
import { loadProviderConfig } from "@/lib/ai/provider-router";
import { acquireGuardedProviderAccess } from "@/lib/security/ai-abuse-control";
import { coverageGapFetchForRequest } from "@/lib/coverage-gap/e2e-fixture-mode";
import { finalizeCoverageGapQueryResult } from "@/lib/coverage-gap/finalize";
import { parseCoverageGapInput, queryVolcanoEvidence } from "@/lib/coverage-gap/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = parseCoverageGapInput(await request.json());
    if (!input) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
    const fetchImpl = await coverageGapFetchForRequest(request);
    // ADR-0045: earth joins the guarded Granite chain. Coverage-gap queries are
    // live-only, so the abuse-control factory is always attached; a missing or
    // denied provider yields the deterministic explanation, never an error.
    const rawProviderConfig = loadProviderConfig();
    const adapterResult = await queryVolcanoEvidence(input, fetchImpl ? { fetchImpl } : {});
    const result = await finalizeCoverageGapQueryResult(
      adapterResult,
      input.concern,
      rawProviderConfig,
      input.optionalQuestion,
      undefined,
      () => acquireGuardedProviderAccess(request, input, rawProviderConfig)
    );
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    // Server-side only: without this line a route-level exception is
    // indistinguishable from input validation (flood-route precedent).
    console.error("[volcano-query] unhandled route error", error);
    return NextResponse.json({ ok: false, error: "validation_failed" }, { status: 500 });
  }
}
