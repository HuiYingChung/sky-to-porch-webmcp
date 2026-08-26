import { NextResponse } from "next/server";
import type { BoundingBox } from "@/contracts/common";
import {
  FLOOD_EXTENT_LAYER_PRODUCT,
  FLOOD_EXTENT_LAYER_SOURCE_ID,
  FLOOD_EXTENT_LAYER_SOURCE_URL,
  parseFloodExtentLayerEnvelope,
  type FloodExtentLayerErrorCode,
} from "@/contracts/flood-extent-layer";
import {
  queryFloodExtent,
  type FloodExtentFailureReason,
} from "@/lib/flood/extent-live-adapter";
import { mapLayersFetchForRequest } from "@/lib/map/map-e2e-fixture-mode";
import { validateQueryArea } from "@/lib/location/query-area";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PARAMETER_NAMES = ["date", "west", "south", "east", "north"] as const;

function parseInput(request: Request): { date: string; area: BoundingBox } | null {
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()].sort();
  if (
    keys.length !== PARAMETER_NAMES.length ||
    keys.some((key, index) => key !== [...PARAMETER_NAMES].sort()[index])
  ) return null;

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

function publicError(reason: FloodExtentFailureReason): FloodExtentLayerErrorCode {
  if (reason === "rate_limited") return "rate_limited";
  if (reason === "timeout") return "timeout";
  if (reason === "oversize") return "response_too_large";
  if (reason === "schema_validation" || reason === "malformed" || reason === "media_type") {
    return "schema_validation";
  }
  return "source_failure";
}

function errorStatus(error: FloodExtentLayerErrorCode): number {
  if (error === "invalid_input") return 400;
  if (error === "rate_limited") return 429;
  if (error === "response_too_large") return 502;
  if (error === "schema_validation") return 502;
  if (error === "timeout") return 504;
  return 502;
}

export async function GET(request: Request) {
  const input = parseInput(request);
  if (!input) {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  const e2eFetch = mapLayersFetchForRequest(request);
  const outcome = await queryFloodExtent(input.date, input.area, {
    includeVisualization: true,
    ...(e2eFetch ? { fetchImpl: e2eFetch } : {}),
  });
  if (outcome.kind === "source_failure") {
    const error = publicError(outcome.reason);
    return NextResponse.json({ ok: false, error }, { status: errorStatus(error) });
  }

  const observation = outcome.observation;
  const claimBoundary = observation.metadata.claimBoundary;
  if (typeof claimBoundary !== "string") {
    return NextResponse.json({ ok: false, error: "schema_validation" }, { status: 500 });
  }
  if (outcome.kind === "observation" && !outcome.visualization) {
    return NextResponse.json({ ok: false, error: "schema_validation" }, { status: 500 });
  }

  const envelope = {
    ok: true as const,
    result: {
      sourceId: FLOOD_EXTENT_LAYER_SOURCE_ID,
      sourceUrl: FLOOD_EXTENT_LAYER_SOURCE_URL,
      product: FLOOD_EXTENT_LAYER_PRODUCT,
      dataMode: "live" as const,
      evidenceState: outcome.kind === "observation"
        ? "observations_returned" as const
        : "no_observation" as const,
      retrievedAt: observation.provenance.retrievedAt,
      observedDate: outcome.kind === "observation" ? input.date : null,
      requestArea: input.area,
      imageDataUrl: outcome.kind === "observation"
        ? outcome.visualization?.imageDataUrl ?? null
        : null,
      imageWidth: 512 as const,
      imageHeight: 512 as const,
      payloadHash: observation.provenance.payloadHash,
      claimBoundary,
      limitations: [
        "NASA-rendered flood-extent visualization only; colors and pixel classes are not interpreted by Sky to Porch.",
        "The layer is not flood depth, property impact, road status, an official alert, or an evacuation instruction.",
        "No observation or source failure is not evidence of no flood or no danger.",
      ],
    },
  };
  if (!parseFloodExtentLayerEnvelope(envelope)) {
    return NextResponse.json({ ok: false, error: "schema_validation" }, { status: 500 });
  }
  return NextResponse.json(envelope, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
