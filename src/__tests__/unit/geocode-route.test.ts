import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/geocode/route";
import {
  GEOCODE_MAX_QUEUED_REQUESTS,
  GEOCODE_MAX_QUEUE_WAIT_MS,
  GEOCODE_MIN_INTERVAL_MS,
  resetGeocodeSchedulerForTests,
  scheduleGeocodeRequest,
} from "@/lib/location/geocode";

const START_TIME = new Date("2026-09-03T12:00:00.000Z");

function request(query: string, signal?: AbortSignal): Request {
  const result = new Request("http://localhost/api/geocode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  // Vitest's jsdom AbortSignal and Node's Request implementation come from
  // different realms. The route only consumes the standard signal contract,
  // so install it directly for cancellation behavior tests.
  if (signal) Object.defineProperty(result, "signal", { value: signal });
  return result;
}

function photonResponse(name: string): Response {
  return new Response(JSON.stringify({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "Point", coordinates: [-95.36, 29.76] },
      properties: { name, type: "city", state: "Texas", country: "United States" },
    }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function flushScheduling(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  resetGeocodeSchedulerForTests();
  vi.useFakeTimers();
  vi.setSystemTime(START_TIME);
});

afterEach(() => {
  resetGeocodeSchedulerForTests();
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("POST /api/geocode bounded serial scheduling", () => {
  it("waits for the one-second Photon start interval instead of rejecting a valid consecutive query", async () => {
    const starts: number[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      starts.push(Date.now());
      return photonResponse(new URL(String(input)).searchParams.get("q") ?? "Unknown");
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await POST(request("Houston"));
    expect(first.status).toBe(200);

    const secondPromise = POST(request("Austin"));
    await vi.advanceTimersByTimeAsync(GEOCODE_MIN_INTERVAL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const second = await secondPromise;
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(starts[1] - starts[0]).toBe(GEOCODE_MIN_INTERVAL_MS);
  });

  it("never overlaps upstream Photon work even after the start interval has elapsed", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const starts: number[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      starts.push(Date.now());
      if (starts.length === 1) await firstGate;
      return photonResponse(new URL(String(input)).searchParams.get("q") ?? "Unknown");
    });
    vi.stubGlobal("fetch", fetchMock);

    const firstPromise = POST(request("Houston"));
    await flushScheduling();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const secondPromise = POST(request("Austin"));
    await vi.advanceTimersByTimeAsync(GEOCODE_MIN_INTERVAL_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseFirst();
    expect((await firstPromise).status).toBe(200);
    await flushScheduling();
    expect((await secondPromise).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(GEOCODE_MIN_INTERVAL_MS);
  });

  it("returns 429 when the bounded waiting queue is full", async () => {
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => { releaseActive = resolve; });
    const active = scheduleGeocodeRequest(async () => {
      await activeGate;
      return "active";
    });
    await flushScheduling();

    const queued = Array.from({ length: GEOCODE_MAX_QUEUED_REQUESTS }, (_, index) =>
      scheduleGeocodeRequest(async () => `queued-${index}`)
    );
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const overloaded = await POST(request("San Antonio"));
    expect(overloaded.status).toBe(429);
    expect(overloaded.headers.get("Retry-After")).toBe("1");
    await expect(overloaded.json()).resolves.toEqual({ ok: false, error: "rate_limited" });
    expect(fetchMock).not.toHaveBeenCalled();

    releaseActive();
    await active;
    await vi.runAllTimersAsync();
    await Promise.all(queued);
  });

  it("returns bounded 429 when a queued request waits behind a stalled predecessor", async () => {
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => { releaseActive = resolve; });
    const active = scheduleGeocodeRequest(async () => {
      await activeGate;
      return "active";
    });
    await flushScheduling();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const waiting = POST(request("Dallas"));
    await vi.advanceTimersByTimeAsync(GEOCODE_MAX_QUEUE_WAIT_MS);
    const response = await waiting;
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("1");
    await expect(response.json()).resolves.toEqual({ ok: false, error: "rate_limited" });
    expect(fetchMock).not.toHaveBeenCalled();

    releaseActive();
    await active;
    await flushScheduling();
  });

  it("does not dispatch a waiter aborted immediately before its start window", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => photonResponse("Houston"));
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(request("Houston"))).status).toBe(200);

    const controller = new AbortController();
    const waiting = POST(request("Austin", controller.signal));
    await flushScheduling();
    await vi.advanceTimersByTimeAsync(GEOCODE_MIN_INTERVAL_MS - 1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1);

    const response = await waiting;
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "geocoder_unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not let a forward wall-clock jump bypass the monotonic start interval", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => photonResponse("Houston"));
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(request("Houston"))).status).toBe(200);

    vi.setSystemTime(new Date(START_TIME.getTime() + 60_000));
    const waiting = POST(request("Austin"));
    await vi.advanceTimersByTimeAsync(GEOCODE_MIN_INTERVAL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const response = await waiting;
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reset aborts active and queued work without leaking into the replacement scheduler", async () => {
    let activeSignal: AbortSignal | undefined;
    const active = scheduleGeocodeRequest(async (signal) => {
      activeSignal = signal;
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return "old-active";
    });
    await flushScheduling();
    const queuedRun = vi.fn(async () => "old-queued");
    const queued = scheduleGeocodeRequest(queuedRun);

    resetGeocodeSchedulerForTests();

    await expect(active).resolves.toEqual({ kind: "aborted" });
    await expect(queued).resolves.toEqual({ kind: "aborted" });
    expect(activeSignal?.aborted).toBe(true);
    expect(queuedRun).not.toHaveBeenCalled();

    await expect(scheduleGeocodeRequest(async () => "fresh")).resolves.toEqual({
      kind: "completed",
      value: "fresh",
    });
  });

  it("aborts active upstream work and does not bypass the start interval for the next waiter", async () => {
    const firstController = new AbortController();
    const starts: number[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      starts.push(Date.now());
      if (starts.length === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          );
        });
      }
      return photonResponse(new URL(String(input)).searchParams.get("q") ?? "Unknown");
    });
    vi.stubGlobal("fetch", fetchMock);

    const active = POST(request("Houston", firstController.signal));
    await flushScheduling();
    const waiting = POST(request("Austin"));
    await flushScheduling();

    firstController.abort();
    expect((await active).status).toBe(503);
    await vi.advanceTimersByTimeAsync(GEOCODE_MIN_INTERVAL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect((await waiting).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(starts[1] - starts[0]).toBe(GEOCODE_MIN_INTERVAL_MS);
  });

  it("preserves an upstream Photon 429 as a bounded rate-limit response", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(null, { status: 429 })));
    const response = await POST(request("Houston"));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("1");
    await expect(response.json()).resolves.toEqual({ ok: false, error: "rate_limited" });
  });

  it("keeps timeout and response-size failures fail-closed", async () => {
    const timeoutFetch = vi.fn<typeof fetch>(async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true,
        });
      })
    );
    vi.stubGlobal("fetch", timeoutFetch);
    const timedOut = POST(request("Houston"));
    await vi.advanceTimersByTimeAsync(8_000);
    expect((await timedOut).status).toBe(503);

    await vi.advanceTimersByTimeAsync(GEOCODE_MIN_INTERVAL_MS);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response("{}", {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(1024 * 1024 + 1),
      },
    })));
    const oversized = await POST(request("Austin"));
    expect(oversized.status).toBe(503);
  });

  it("still rejects unsafe input before queueing or contacting Photon", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request("bad\u0000query"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
