/**
 * src/app/api/geocode/route.ts
 *
 * UXFIX-02 (W8): POST /api/geocode — bounded place-name search proxy.
 *
 * Input: { "query": "place name" } (exact keys; 2–200 chars; no control chars)
 * Output: { ok: true, results: [{ label, lon, lat }], attribution }
 *
 * Good-citizen rules (ADR-0022): at most one upstream Photon request per
 * second process-wide (429 otherwise), 8s timeout, 1 MiB body cap, no retry,
 * redirect rejection, fail-closed 503 on any upstream problem. Search results
 * are display candidates only — selecting one produces a coordinate selection
 * that goes through the exact same validation as a map click.
 */

import { NextResponse } from "next/server";
import {
  buildPhotonUrl,
  geocodeRateLimiterAllows,
  parsePhotonResponse,
  readBoundedJsonBody,
  GEOCODE_ATTRIBUTION,
} from "@/lib/location/geocode";

export const runtime = "nodejs";

const TIMEOUT_MS = 8_000;
const BODY_CAP_BYTES = 1024 * 1024;
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F-\u009F]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseQuery(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "query") return null;
  if (typeof body.query !== "string") return null;
  const query = body.query.trim();
  if (query.length < 2 || query.length > 200) return null;
  if (CONTROL_CHAR_RE.test(query)) return null;
  return query;
}

export async function POST(request: Request) {
  let query: string;
  try {
    const parsed = parseQuery(await request.json());
    if (parsed === null) {
      return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
    }
    query = parsed;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  if (!geocodeRateLimiterAllows(Date.now())) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(buildPhotonUrl(query), {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
    } catch {
      return NextResponse.json({ ok: false, error: "geocoder_unavailable" }, { status: 503 });
    }
    if (!response.ok) {
      return NextResponse.json({ ok: false, error: "geocoder_unavailable" }, { status: 503 });
    }
    const results = parsePhotonResponse(await readBoundedJsonBody(response, BODY_CAP_BYTES));
    return NextResponse.json({ ok: true, results, attribution: GEOCODE_ATTRIBUTION });
  } catch {
    return NextResponse.json({ ok: false, error: "geocoder_unavailable" }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}
