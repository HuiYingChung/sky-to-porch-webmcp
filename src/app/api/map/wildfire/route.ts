import { NextResponse } from "next/server";
import type { BoundingBox } from "@/contracts/common";
import { parseWildfireLayerEnvelope } from "@/contracts/wildfire-layer";
import { queryFirmsNrtLayerGuarded } from "@/lib/fire/firms-nrt-layer";
import { validateQueryArea } from "@/lib/location/query-area";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PARAMETER_NAMES = ["date", "west", "south", "east", "north"] as const;

function parseInput(request: Request): { date: string; area: BoundingBox } | null {
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()].sort();
  const expected = [...PARAMETER_NAMES].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return null;
  }
  // ADR-0040 (Bug F): the layer shows the requested UTC detection day.
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
    return { date, area: validateQueryArea(values) };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const input = parseInput(request);
  if (!input) {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }
  const outcome = await queryFirmsNrtLayerGuarded(input.date, input.area, {
    fetch: globalThis.fetch,
    nowIso: () => new Date().toISOString(),
  });
  if (outcome.kind === "failure") {
    const status = outcome.error === "unconfigured"
      ? 503
      : outcome.error === "rate_limited"
        ? 429
        : outcome.error === "source_failure"
          ? 502
          : 502;
    return NextResponse.json({ ok: false, error: outcome.error }, { status });
  }
  const envelope = { ok: true as const, result: outcome.result };
  if (!parseWildfireLayerEnvelope(envelope)) {
    return NextResponse.json({ ok: false, error: "schema_validation" }, { status: 500 });
  }
  return NextResponse.json(envelope, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
