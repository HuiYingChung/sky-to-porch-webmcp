/**
 * ADR-0055: distributed rate limiting.
 *
 * serverless-ai-proxy.md section 9 requires three paths to be covered:
 * counters increment, over-limit rejects, and a failing backend degrades.
 * Every Upstash response here is mocked; no network request is made.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_RATE_LIMIT_POLICY } from "@/lib/security/ai-abuse-control";
import {
  loadUpstashLimiter,
  policyFromEnv,
} from "@/lib/security/upstash-rate-limiter";

const URL_VAR = "UPSTASH_REDIS_REST_URL";
const TOKEN_VAR = "UPSTASH_REDIS_REST_TOKEN";

function configure(): void {
  vi.stubEnv(URL_VAR, "https://example.upstash.io");
  vi.stubEnv(TOKEN_VAR, "test-token");
}

/**
 * Upstash's pipeline endpoint answers with one {result} per command, in
 * order. `counts` supplies the six values the limiter reads.
 */
function pipelineResponse(counts: {
  lock?: string | null;
  duplicate?: number;
  burst?: number;
  sustained?: number;
  daily?: number;
  global?: number;
}): Response {
  const body = [
    { result: counts.lock === undefined ? "OK" : counts.lock },
    { result: counts.duplicate ?? 0 },
    { result: counts.burst ?? 1 },
    { result: 1 },
    { result: counts.sustained ?? 1 },
    { result: 1 },
    { result: counts.daily ?? 1 },
    { result: 1 },
    { result: counts.global ?? 1 },
    { result: 1 },
  ];
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("loadUpstashLimiter configuration", () => {
  it("returns null when either variable is absent, so the guard sees no limiter", () => {
    expect(loadUpstashLimiter(DEFAULT_AI_RATE_LIMIT_POLICY)).toBeNull();
    vi.stubEnv(URL_VAR, "https://example.upstash.io");
    expect(loadUpstashLimiter(DEFAULT_AI_RATE_LIMIT_POLICY)).toBeNull();
    vi.unstubAllEnvs();
    vi.stubEnv(TOKEN_VAR, "test-token");
    expect(loadUpstashLimiter(DEFAULT_AI_RATE_LIMIT_POLICY)).toBeNull();
  });

  it("refuses a non-https endpoint rather than sending a token in the clear", () => {
    vi.stubEnv(URL_VAR, "http://example.upstash.io");
    vi.stubEnv(TOKEN_VAR, "test-token");
    expect(loadUpstashLimiter(DEFAULT_AI_RATE_LIMIT_POLICY)).toBeNull();
  });
});

describe("counters increment (path 1)", () => {
  it("sends one pipeline that locks, checks the duplicate, and increments every window", async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValue(pipelineResponse({}));
    const limiter = loadUpstashLimiter(DEFAULT_AI_RATE_LIMIT_POLICY, fetchMock)!;

    const lease = await limiter.acquire("principal-a", "fingerprint-a");
    expect(lease).not.toBe("backend_unavailable");
    expect(typeof lease === "object" && lease.allowed).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.upstash.io/pipeline");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    const commands = JSON.parse(init.body as string) as unknown[][];
    expect(commands[0][0]).toBe("SET");
    expect(commands[0].slice(3)).toEqual(["NX", "EX", 30]);
    expect(commands.filter((c) => c[0] === "INCR")).toHaveLength(4);
    // Every counter must expire; an un-TTLed key would leak forever.
    expect(commands.filter((c) => c[0] === "EXPIRE")).toHaveLength(4);
    for (const command of commands.filter((c) => c[0] === "EXPIRE")) {
      expect(command.at(-1)).toBe("NX");
    }
  });

  it("keeps identifiers out of Redis keys, storing only the supplied digests", async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValue(pipelineResponse({}));
    const limiter = loadUpstashLimiter(DEFAULT_AI_RATE_LIMIT_POLICY, fetchMock)!;
    await limiter.acquire("digest-only", "fp-digest");

    const body = fetchMock.mock.calls[0][1].body as string;
    expect(body).toContain("digest-only");
    expect(body).not.toMatch(/\d+\.\d+\.\d+\.\d+/u); // no IP address
  });
});

describe("over limit rejects (path 2)", () => {
  it.each([
    ["burst", { burst: DEFAULT_AI_RATE_LIMIT_POLICY.burstLimit + 1 }, "rate_limited"],
    ["sustained", { sustained: DEFAULT_AI_RATE_LIMIT_POLICY.sustainedLimit + 1 }, "rate_limited"],
    ["daily", { daily: DEFAULT_AI_RATE_LIMIT_POLICY.dailyLimit + 1 }, "rate_limited"],
    ["global", { global: DEFAULT_AI_RATE_LIMIT_POLICY.globalDailyLimit + 1 }, "budget_exhausted"],
  ] as const)("rejects when the %s window is exceeded", async (_name, counts, reason) => {
    configure();
    const fetchMock = vi.fn().mockResolvedValue(pipelineResponse(counts));
    const limiter = loadUpstashLimiter(DEFAULT_AI_RATE_LIMIT_POLICY, fetchMock)!;

    const lease = await limiter.acquire("principal-b", "fingerprint-b");
    expect(lease).not.toBe("backend_unavailable");
    if (lease === "backend_unavailable" || lease.allowed) throw new Error("expected a denial");
    expect(lease.reason).toBe(reason);
    expect(lease.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("rejects a replayed request and a second concurrent one", async () => {
    configure();
    const duplicateFetch = vi.fn().mockResolvedValue(pipelineResponse({ duplicate: 1 }));
    const duplicate = await loadUpstashLimiter(DEFAULT_AI_RATE_LIMIT_POLICY, duplicateFetch)!
      .acquire("principal-c", "same-fingerprint");
    if (duplicate === "backend_unavailable" || duplicate.allowed) throw new Error("expected a denial");
    expect(duplicate.reason).toBe("duplicate_request");

    // A held lock means another instance is already generating for this user.
    const lockedFetch = vi.fn().mockResolvedValue(pipelineResponse({ lock: null }));
    const locked = await loadUpstashLimiter(DEFAULT_AI_RATE_LIMIT_POLICY, lockedFetch)!
      .acquire("principal-c", "other-fingerprint");
    if (locked === "backend_unavailable" || locked.allowed) throw new Error("expected a denial");
    expect(locked.reason).toBe("rate_limited");
  });

  it("does not release a lock it never took", async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValue(pipelineResponse({ lock: null }));
    await loadUpstashLimiter(DEFAULT_AI_RATE_LIMIT_POLICY, fetchMock)!
      .acquire("principal-d", "fingerprint-d");
    // One pipeline only: no follow-up DEL for someone else's lock.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("backend failure degrades (path 3)", () => {
  it.each([
    ["a network error", () => Promise.reject(new Error("ECONNREFUSED"))],
    ["an HTTP error", () => Promise.resolve(new Response("nope", { status: 500 }))],
    ["a redis-level error", () => Promise.resolve(new Response(JSON.stringify([{ error: "ERR" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))],
    ["a truncated pipeline", () => Promise.resolve(new Response(JSON.stringify([{ result: "OK" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))],
    ["malformed JSON", () => Promise.resolve(new Response("not json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))],
  ])("reports backend_unavailable on %s, never a lease", async (_name, impl) => {
    configure();
    const limiter = loadUpstashLimiter(DEFAULT_AI_RATE_LIMIT_POLICY, vi.fn(impl))!;
    const lease = await limiter.acquire("principal-e", "fingerprint-e");
    // Not a denial and not a lease: the absence of a verdict. The guard turns
    // this into a deterministic answer with no paid call.
    expect(lease).toBe("backend_unavailable");
  });

  it("gives up rather than hanging when Redis never answers", async () => {
    configure();
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(
        (_url: unknown, init: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          })
      );
      const limiter = loadUpstashLimiter(
        DEFAULT_AI_RATE_LIMIT_POLICY,
        fetchMock as unknown as typeof globalThis.fetch
      )!;
      const pending = limiter.acquire("principal-f", "fingerprint-f");
      await vi.advanceTimersByTimeAsync(2_500);
      expect(await pending).toBe("backend_unavailable");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("policyFromEnv", () => {
  it("uses the supplied defaults when nothing is set", () => {
    expect(policyFromEnv(DEFAULT_AI_RATE_LIMIT_POLICY)).toEqual(DEFAULT_AI_RATE_LIMIT_POLICY);
  });

  it("accepts positive integers and ignores anything else", () => {
    vi.stubEnv("AI_RATE_BURST_LIMIT", "7");
    vi.stubEnv("AI_RATE_GLOBAL_DAILY_LIMIT", "not-a-number");
    vi.stubEnv("AI_RATE_DAILY_LIMIT", "0");
    const policy = policyFromEnv(DEFAULT_AI_RATE_LIMIT_POLICY);
    expect(policy.burstLimit).toBe(7);
    // A malformed or zero value must not disable a limit.
    expect(policy.globalDailyLimit).toBe(DEFAULT_AI_RATE_LIMIT_POLICY.globalDailyLimit);
    expect(policy.dailyLimit).toBe(DEFAULT_AI_RATE_LIMIT_POLICY.dailyLimit);
  });
});
