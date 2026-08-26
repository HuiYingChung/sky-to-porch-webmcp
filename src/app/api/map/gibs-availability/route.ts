import { NextResponse } from "next/server";
import type { BoundingBox } from "@/contracts/common";
import {
  GIBS_AVAILABILITY_PRODUCTS,
  checkGibsAvailability,
  type GibsAvailabilityProduct,
} from "@/lib/map/gibs-availability";
import { mapLayersFetchForRequest } from "@/lib/map/map-e2e-fixture-mode";
import { validateQueryArea } from "@/lib/location/query-area";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PARAMETER_NAMES = ["product", "date", "west", "south", "east", "north"] as const;

function parseInput(
  request: Request
): { product: GibsAvailabilityProduct; date: string; area: BoundingBox } | null {
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()].sort();
  const expected = [...PARAMETER_NAMES].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return null;
  }

  const product = params.get("product");
  if (product !== "rain" && product !== "surface_temp") return null;

  const date = params.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null;
  const parsedDate = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsedDate) || new Date(parsedDate).toISOString().slice(0, 10) !== date) {
    return null;
  }

  const values: Record<string, number> = {};
  for (const name of ["west", "south", "east", "north"] as const) {
    const raw = params.get(name);
    if (raw === null || raw.trim() === "" || !/^-?\d+(?:\.\d+)?$/u.test(raw)) return null;
    values[name] = Number(raw);
  }
  try {
    return { product, date, area: validateQueryArea(values) };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const input = parseInput(request);
  if (!input) {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }
  const outcome = await checkGibsAvailability(
    input.product,
    input.date,
    input.area,
    mapLayersFetchForRequest(request)
  );
  if (outcome.kind === "source_failure") {
    const status = outcome.reason === "invalid_input"
      ? 400
      : outcome.reason === "rate_limited"
        ? 429
        : outcome.reason === "timeout"
          ? 504
          : 502;
    return NextResponse.json({ ok: false, error: outcome.reason }, { status });
  }
  return NextResponse.json(
    {
      ok: true as const,
      result: {
        product: GIBS_AVAILABILITY_PRODUCTS[input.product],
        date: input.date,
        available: outcome.available,
        claimBoundary:
          "Availability describes published NASA GIBS imagery only. Missing imagery is not evidence of no hazard.",
      },
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
