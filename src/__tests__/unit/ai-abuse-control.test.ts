import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireGuardedProviderAccess,
  clearAiSessionBudgetForTests,
  DEFAULT_AI_RATE_LIMIT_POLICY,
  InMemoryAiAbuseController,
  queryAccessRejection,
} from "@/lib/security/ai-abuse-control";
import type { ProviderConfig } from "@/lib/ai/provider-router";

const config: ProviderConfig = {
  primaryProvider: "openai",
  fallbackProvider: "none",
  openAiApiKey: "test-only-key",
  openAiModel: "test-model",
};

function request(origin = "https://sky.example"): Request {
  return new Request("https://sky.example/api/fire/query", {
    method: "POST",
    headers: {
      origin,
      "x-forwarded-for": "192.0.2.10",
      "user-agent": "test-agent",
    },
  });
}

afterEach(() => {
  clearAiSessionBudgetForTests();
  vi.unstubAllEnvs();
});

describe("paid AI abuse-control gate", () => {
  it("fails closed when explicit paid-API controls are not configured", async () => {
    vi.stubEnv("AI_PAID_API_ENABLED", "false");
    expect(await acquireGuardedProviderAccess(request(), { hazard: "fire" }, config)).toEqual({
      allowed: false,
      reason: "abuse_controls_unconfigured",
    });
  });

  it("keeps bounded IBM development calls disabled despite the general paid flag", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_BOUNDED_IBM_ONLY", "true");
    vi.stubEnv("AI_BOUNDED_IBM_CALLS_ENABLED", "false");
    vi.stubEnv("AI_PAID_API_ENABLED", "true");

    expect(await acquireGuardedProviderAccess(request(), { hazard: "fire" }, config)).toEqual({
      allowed: false,
      reason: "abuse_controls_unconfigured",
    });
  });

  it("allows the bounded IBM development flag to enter the remaining guards", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_BOUNDED_IBM_ONLY", "true");
    vi.stubEnv("AI_BOUNDED_IBM_CALLS_ENABLED", "true");
    vi.stubEnv("AI_PAID_API_ENABLED", "false");
    vi.stubEnv("AI_ABUSE_HMAC_SECRET", "x".repeat(32));
    vi.stubEnv("AI_ALLOWED_ORIGIN", "https://sky.example");

    const lease = await acquireGuardedProviderAccess(
      request(),
      { hazard: "fire" },
      config,
      new InMemoryAiAbuseController()
    );
    expect(lease.allowed).toBe(true);
    if (lease.allowed) lease.release();
  });

  it("requires an allowlisted same origin and a long server-side HMAC secret", async () => {
    vi.stubEnv("AI_PAID_API_ENABLED", "true");
    vi.stubEnv("AI_ABUSE_HMAC_SECRET", "x".repeat(32));
    vi.stubEnv("AI_ALLOWED_ORIGIN", "https://sky.example");
    const rejected = await acquireGuardedProviderAccess(
      request("https://attacker.example"),
      { hazard: "fire" },
      config,
      new InMemoryAiAbuseController()
    );
    expect(rejected).toEqual({ allowed: false, reason: "origin_rejected" });
  });

  it("allows one in-flight generation, rejects concurrency, and blocks an immediate replay", async () => {
    vi.stubEnv("AI_PAID_API_ENABLED", "true");
    vi.stubEnv("AI_ABUSE_HMAC_SECRET", "x".repeat(32));
    vi.stubEnv("AI_ALLOWED_ORIGIN", "https://sky.example");
    const controller = new InMemoryAiAbuseController(DEFAULT_AI_RATE_LIMIT_POLICY);
    const first = await acquireGuardedProviderAccess(request(), { hazard: "fire" }, config, controller);
    expect(first.allowed).toBe(true);
    expect(await acquireGuardedProviderAccess(request(), { hazard: "heat" }, config, controller))
      .toMatchObject({ allowed: false, reason: "rate_limited" });
    if (first.allowed) first.release();
    expect(await acquireGuardedProviderAccess(request(), { hazard: "fire" }, config, controller))
      .toMatchObject({ allowed: false, reason: "duplicate_request" });
  });

  it("enforces burst and global cost ceilings with a fake clock", () => {
    const policy = {
      ...DEFAULT_AI_RATE_LIMIT_POLICY,
      burstLimit: 2,
      globalDailyLimit: 2,
      duplicateWindowMs: 0,
    };
    const controller = new InMemoryAiAbuseController(policy);
    const one = controller.acquire("principal-a", "one", 1_000);
    expect(one.allowed).toBe(true);
    if (one.allowed) one.release();
    const two = controller.acquire("principal-b", "two", 2_000);
    expect(two.allowed).toBe(true);
    if (two.allowed) two.release();
    expect(controller.acquire("principal-c", "three", 3_000)).toMatchObject({
      allowed: false,
      reason: "budget_exhausted",
    });
  });

  it("fails closed after an explicitly bounded provider-call session cap", async () => {
    vi.stubEnv("AI_PAID_API_ENABLED", "true");
    vi.stubEnv("AI_ABUSE_HMAC_SECRET", "x".repeat(32));
    vi.stubEnv("AI_ALLOWED_ORIGIN", "https://sky.example");
    vi.stubEnv("AI_SESSION_MAX_REQUESTS", "3");
    const controller = new InMemoryAiAbuseController({
      ...DEFAULT_AI_RATE_LIMIT_POLICY,
      burstLimit: 10,
      sustainedLimit: 10,
      dailyLimit: 10,
      globalDailyLimit: 10,
      duplicateWindowMs: 0,
    });

    for (const hazard of ["fire", "flood", "heat"]) {
      const lease = await acquireGuardedProviderAccess(request(), { hazard }, config, controller);
      expect(lease.allowed).toBe(true);
      if (lease.allowed) lease.release();
    }
    expect(await acquireGuardedProviderAccess(request(), { hazard: "drought" }, config, controller))
      .toMatchObject({ allowed: false, reason: "budget_exhausted" });
  });

  it("maps abusive requests to explicit HTTP rejection semantics", () => {
    expect(queryAccessRejection({
      allowed: false,
      reason: "duplicate_request",
      retryAfterSeconds: 60,
    })).toEqual({ status: 429, error: "rate_limited", retryAfterSeconds: 60 });
    expect(queryAccessRejection({ allowed: false, reason: "origin_rejected" }))
      .toEqual({ status: 403, error: "origin_rejected" });
    expect(queryAccessRejection({ allowed: false, reason: "abuse_controls_unconfigured" }))
      .toBeNull();
  });
});

/**
 * ADR-0055: the guard no longer trusts a flag that claims a distributed
 * limiter exists. It looks for the limiter, and treats "no verdict" as "no
 * paid call".
 */
describe("ADR-0055 distributed limiting", () => {
  const allowingLimiter = {
    acquire: vi.fn(async () => ({ allowed: true as const, release: vi.fn() })),
  };

  function guard(
    loadLimiter: Parameters<typeof acquireGuardedProviderAccess>[4],
    controller = new InMemoryAiAbuseController()
  ) {
    vi.stubEnv("AI_PAID_API_ENABLED", "true");
    vi.stubEnv("AI_ABUSE_HMAC_SECRET", "x".repeat(32));
    vi.stubEnv("AI_ALLOWED_ORIGIN", "https://sky.example");
    return acquireGuardedProviderAccess(
      request(),
      { hazard: "fire" },
      config,
      controller,
      loadLimiter
    );
  }

  it("refuses paid calls in production when no distributed limiter is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await guard(() => null)).toEqual({
      allowed: false,
      reason: "abuse_controls_unconfigured",
    });
  });

  it("still allows local development without one", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const lease = await guard(() => null);
    expect(lease.allowed).toBe(true);
    if (lease.allowed) lease.release();
  });

  it("refuses the paid call when the limiter cannot reach its backend", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // Redis down must never mean "go ahead": the answer falls back to
    // deterministic text instead of spending the owner's budget blind.
    const lease = await guard(() => ({
      acquire: async () => "backend_unavailable" as const,
    }));
    expect(lease).toEqual({ allowed: false, reason: "abuse_controls_unconfigured" });
  });

  it("passes a distributed denial through unchanged", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const lease = await guard(() => ({
      acquire: async () => ({
        allowed: false as const,
        reason: "rate_limited" as const,
        retryAfterSeconds: 30,
      }),
    }));
    expect(lease).toMatchObject({ allowed: false, reason: "rate_limited" });
  });

  it("grants a lease in production once the limiter answers, and releases both layers", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const release = vi.fn();
    const lease = await guard(() => ({
      acquire: async () => ({ allowed: true as const, release }),
    }));
    expect(lease.allowed).toBe(true);
    if (lease.allowed) lease.release();
    expect(release).toHaveBeenCalledOnce();
  });

  it("keeps the process-local controller as a second layer", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const controller = new InMemoryAiAbuseController();
    const distributedRelease = vi.fn();
    const limiter = () => ({
      acquire: async () => ({ allowed: true as const, release: distributedRelease }),
    });
    const first = await guard(limiter, controller);
    expect(first.allowed).toBe(true);
    // The distributed layer says yes, but one instance still refuses a
    // second concurrent generation, and hands its distributed lease back.
    const second = await guard(limiter, controller);
    expect(second).toMatchObject({ allowed: false, reason: "rate_limited" });
    expect(distributedRelease).toHaveBeenCalled();
  });

  it("prefers platform-written client IP headers over a caller-supplied one", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_PAID_API_ENABLED", "true");
    vi.stubEnv("AI_ABUSE_HMAC_SECRET", "x".repeat(32));
    vi.stubEnv("AI_ALLOWED_ORIGIN", "https://sky.example");
    const seen: string[] = [];
    const limiter = () => ({
      acquire: async (principal: string) => {
        seen.push(principal);
        return { allowed: true as const, release: vi.fn() };
      },
    });

    // Same platform IP, different forged x-forwarded-for values. If the
    // forged header won, these would be different principals and an attacker
    // could reset their own bucket at will.
    for (const forged of ["203.0.113.1", "203.0.113.2"]) {
      const req = new Request("https://sky.example/api/fire/query", {
        method: "POST",
        headers: {
          origin: "https://sky.example",
          "x-vercel-forwarded-for": "192.0.2.10",
          "x-forwarded-for": forged,
          "user-agent": "test-agent",
        },
      });
      const lease = await acquireGuardedProviderAccess(
        req,
        { hazard: "fire" },
        config,
        new InMemoryAiAbuseController(),
        limiter
      );
      if (lease.allowed) lease.release();
    }
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });
});
