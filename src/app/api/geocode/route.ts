/**
 * src/app/api/geocode/route.ts
 *
 * UXFIX-02 (W8): POST /api/geocode — bounded place-name search proxy.
 *
 * Input: { "query": "place name" } (exact keys; 2–200 chars; no control chars)
 * Output: { ok: true, results: [{ id?, label, lon, lat,
 *   boundingBox, adminContext }], attribution }
 *
 * Good-citizen rules (ADR-0022): at most one upstream Photon request per
 * second process-wide through a bounded serial queue (429 only on overload),
 * 8s upstream timeout, 1 MiB body cap, no retry, redirect rejection, and
 * fail-closed 503 on abort or any upstream problem. Search results are display
 * candidates only — selecting one produces a coordinate selection that goes
 * through the exact same validation as a map click.
 */

import { NextResponse } from "next/server";
import {
  buildPhotonUrl,
  parsePhotonResponse,
  readBoundedJsonBody,
  GEOCODE_ATTRIBUTION,
  scheduleGeocodeRequest,
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

function rateLimitedResponse() {
  return NextResponse.json(
    { ok: false, error: "rate_limited" },
    { status: 429, headers: { "Retry-After": "1" } }
  );
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

  try {
    const scheduled = await scheduleGeocodeRequest(async (scheduledSignal) => {
      if (scheduledSignal.aborted) {
        return NextResponse.json(
          { ok: false, error: "geocoder_unavailable" },
          { status: 503 }
        );
      }

      const controller = new AbortController();
      const abortUpstream = () => controller.abort();
      scheduledSignal.addEventListener("abort", abortUpstream, { once: true });
      if (scheduledSignal.aborted) controller.abort();
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
          return NextResponse.json(
            { ok: false, error: "geocoder_unavailable" },
            { status: 503 }
          );
        }
        if (controller.signal.aborted) {
          return NextResponse.json(
            { ok: false, error: "geocoder_unavailable" },
            { status: 503 }
          );
        }
        if (response.status === 429) return rateLimitedResponse();
        if (!response.ok) {
          return NextResponse.json(
            { ok: false, error: "geocoder_unavailable" },
            { status: 503 }
          );
        }
        const results = parsePhotonResponse(await readBoundedJsonBody(response, BODY_CAP_BYTES));
        if (controller.signal.aborted) {
          return NextResponse.json(
            { ok: false, error: "geocoder_unavailable" },
            { status: 503 }
          );
        }
        return NextResponse.json({ ok: true, results, attribution: GEOCODE_ATTRIBUTION });
      } catch {
        return NextResponse.json(
          { ok: false, error: "geocoder_unavailable" },
          { status: 503 }
        );
      } finally {
        clearTimeout(timer);
        scheduledSignal.removeEventListener("abort", abortUpstream);
      }
    }, request.signal);

    if (scheduled.kind === "rate_limited") {
      return rateLimitedResponse();
    }
    if (scheduled.kind === "aborted") {
      return NextResponse.json({ ok: false, error: "geocoder_unavailable" }, { status: 503 });
    }
    return scheduled.value;
  } catch {
    return NextResponse.json({ ok: false, error: "geocoder_unavailable" }, { status: 503 });
  }
}
