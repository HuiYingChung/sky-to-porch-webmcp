import { createHmac } from "node:crypto";
import type { ProviderConfig } from "@/lib/ai/provider-router";
import {
  loadUpstashLimiter,
  type DistributedLimiter,
} from "./upstash-rate-limiter";

/** Injection seam so tests can supply a limiter without touching the network. */
export type LoadDistributedLimiter = (
  policy: AiRateLimitPolicy
) => DistributedLimiter | null;

export type AiAccessDenialReason =
  | "ai_unavailable"
  | "abuse_controls_unconfigured"
  | "origin_rejected"
  | "rate_limited"
  | "budget_exhausted"
  | "duplicate_request";

export interface AiRateLimitPolicy {
  burstLimit: number;
  burstWindowMs: number;
  sustainedLimit: number;
  sustainedWindowMs: number;
  dailyLimit: number;
  dailyWindowMs: number;
  globalDailyLimit: number;
  duplicateWindowMs: number;
}

export const DEFAULT_AI_RATE_LIMIT_POLICY: AiRateLimitPolicy = {
  burstLimit: 3,
  burstWindowMs: 30_000,
  sustainedLimit: 10,
  sustainedWindowMs: 10 * 60_000,
  dailyLimit: 40,
  dailyWindowMs: 24 * 60 * 60_000,
  globalDailyLimit: 500,
  duplicateWindowMs: 60_000,
};

export type AiAccessLease =
  | {
      allowed: true;
      release: () => void;
    }
  | {
      allowed: false;
      reason: Exclude<AiAccessDenialReason, "ai_unavailable" | "abuse_controls_unconfigured" | "origin_rejected">;
      retryAfterSeconds: number;
    };

type PrincipalState = {
  timestamps: number[];
  inFlight: boolean;
  recentFingerprints: Map<string, number>;
};

/**
 * Process-local defense in depth. Production must also have an independently
 * verified distributed/platform limiter; the environment gate below refuses
 * paid provider calls until that separate control is declared configured.
 */
export class InMemoryAiAbuseController {
  private readonly principals = new Map<string, PrincipalState>();
  private globalTimestamps: number[] = [];

  constructor(private readonly policy: AiRateLimitPolicy = DEFAULT_AI_RATE_LIMIT_POLICY) {}

  acquire(principal: string, fingerprint: string, now = Date.now()): AiAccessLease {
    const state = this.principals.get(principal) ?? {
      timestamps: [],
      inFlight: false,
      recentFingerprints: new Map<string, number>(),
    };
    const oldestWindow = now - this.policy.dailyWindowMs;
    state.timestamps = state.timestamps.filter((timestamp) => timestamp > oldestWindow);
    this.globalTimestamps = this.globalTimestamps.filter((timestamp) => timestamp > oldestWindow);
    for (const [key, expiresAt] of state.recentFingerprints) {
      if (expiresAt <= now) state.recentFingerprints.delete(key);
    }

    if (state.inFlight) {
      return { allowed: false, reason: "rate_limited", retryAfterSeconds: 2 };
    }
    const duplicateUntil = state.recentFingerprints.get(fingerprint);
    if (duplicateUntil && duplicateUntil > now) {
      return {
        allowed: false,
        reason: "duplicate_request",
        retryAfterSeconds: Math.max(1, Math.ceil((duplicateUntil - now) / 1000)),
      };
    }
    if (this.globalTimestamps.length >= this.policy.globalDailyLimit) {
      return { allowed: false, reason: "budget_exhausted", retryAfterSeconds: 60 };
    }

    const burstStart = now - this.policy.burstWindowMs;
    const sustainedStart = now - this.policy.sustainedWindowMs;
    const burstCount = state.timestamps.filter((timestamp) => timestamp > burstStart).length;
    const sustainedCount = state.timestamps.filter((timestamp) => timestamp > sustainedStart).length;
    if (
      burstCount >= this.policy.burstLimit ||
      sustainedCount >= this.policy.sustainedLimit ||
      state.timestamps.length >= this.policy.dailyLimit
    ) {
      return { allowed: false, reason: "rate_limited", retryAfterSeconds: 30 };
    }

    state.timestamps.push(now);
    state.inFlight = true;
    this.globalTimestamps.push(now);
    this.principals.set(principal, state);
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        state.inFlight = false;
        state.recentFingerprints.set(fingerprint, now + this.policy.duplicateWindowMs);
      },
    };
  }
}

export type GuardedProviderAccess =
  | {
      allowed: true;
      config: ProviderConfig;
      release: () => void;
    }
  | {
      allowed: false;
      reason: AiAccessDenialReason;
      retryAfterSeconds?: number;
    };

const defaultController = new InMemoryAiAbuseController();

const SESSION_BUDGET_KEY = "__skyToPorchAiSessionBudgetV1__" as const;
type SessionBudgetState = {
  acquiredProviderLeases: number;
};

function sessionBudgetState(): SessionBudgetState {
  const processGlobal = globalThis as typeof globalThis & {
    [SESSION_BUDGET_KEY]?: SessionBudgetState;
  };
  processGlobal[SESSION_BUDGET_KEY] ??= {
    acquiredProviderLeases: 0,
  };
  return processGlobal[SESSION_BUDGET_KEY];
}

function configuredSessionRequestLimit(): number | null | "invalid" {
  const raw = process.env.AI_SESSION_MAX_REQUESTS;
  if (raw === undefined || raw === "") return null;
  if (!/^\d+$/u.test(raw)) return "invalid";
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 500
    ? parsed
    : "invalid";
}

function providerHasCredential(config: ProviderConfig): boolean {
  return config.primaryProvider === "openai"
    ? Boolean(config.openAiApiKey)
    : Boolean(config.ibmWatsonxApiKey) || Boolean(config.openAiApiKey);
}

function safeSecret(): string | null {
  const secret = process.env.AI_ABUSE_HMAC_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function paidProviderCallsEnabled(): boolean {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.AI_BOUNDED_IBM_ONLY === "true"
  ) {
    return process.env.AI_BOUNDED_IBM_CALLS_ENABLED === "true";
  }
  return process.env.AI_PAID_API_ENABLED === "true";
}

function canonicalOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function requestPrincipal(request: Request, secret: string): string {
  /*
   * ADR-0055: order matters. The first value of x-forwarded-for is written by
   * the caller, so trusting it first lets anyone reset their own limit bucket
   * by sending a new fake IP each time. Platform-written headers come first;
   * x-forwarded-for stays only as a last resort behind them.
   */
  const platformIp = request.headers.get("x-vercel-forwarded-for")?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = platformIp || realIp || forwarded || "unknown-address";
  const userAgent = request.headers.get("user-agent")?.slice(0, 160) ?? "unknown-agent";
  return createHmac("sha256", secret).update(`${address}|${userAgent}`).digest("hex");
}

function requestFingerprint(input: unknown, secret: string): string {
  return createHmac("sha256", secret).update(JSON.stringify(input)).digest("hex");
}

/**
 * Returns a paid-provider lease only when explicit enablement, secret-backed
 * pseudonymous identity, same-origin policy, and production distributed-limit
 * evidence are configured. Otherwise callers keep the evidence path and use a
 * visible deterministic explanation without spending the owner's API budget.
 */
export async function acquireGuardedProviderAccess(
  request: Request,
  input: unknown,
  config: ProviderConfig | null,
  controller: InMemoryAiAbuseController = defaultController,
  loadLimiter: LoadDistributedLimiter = loadUpstashLimiter
): Promise<GuardedProviderAccess> {
  if (!config || !providerHasCredential(config)) {
    return { allowed: false, reason: "ai_unavailable" };
  }
  if (!paidProviderCallsEnabled()) {
    return { allowed: false, reason: "abuse_controls_unconfigured" };
  }
  const secret = safeSecret();
  if (!secret) return { allowed: false, reason: "abuse_controls_unconfigured" };

  const allowedOrigin = process.env.AI_ALLOWED_ORIGIN
    ? canonicalOrigin(process.env.AI_ALLOWED_ORIGIN)
    : null;
  if (!allowedOrigin) return { allowed: false, reason: "abuse_controls_unconfigured" };
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || canonicalOrigin(requestOrigin) !== allowedOrigin) {
    return { allowed: false, reason: "origin_rejected" };
  }

  /*
   * ADR-0055: this used to read AI_DISTRIBUTED_RATE_LIMIT_CONFIRMED, a flag
   * asserting that some other limiter existed. A flag can be set truthfully
   * or not, and nothing checked. Now the guard looks for the limiter itself:
   * configured means present, and in production absent means no paid call.
   */
  const limiter = loadLimiter(DEFAULT_AI_RATE_LIMIT_POLICY);
  if (!limiter && process.env.NODE_ENV === "production") {
    return { allowed: false, reason: "abuse_controls_unconfigured" };
  }

  const sessionRequestLimit = configuredSessionRequestLimit();
  if (sessionRequestLimit === "invalid") {
    return { allowed: false, reason: "abuse_controls_unconfigured" };
  }
  const budget = sessionBudgetState();
  if (
    sessionRequestLimit !== null &&
    budget.acquiredProviderLeases >= sessionRequestLimit
  ) {
    return { allowed: false, reason: "budget_exhausted", retryAfterSeconds: 86_400 };
  }

  const principal = requestPrincipal(request, secret);
  const fingerprint = requestFingerprint(input, secret);

  /*
   * Redis first, process-local second. The distributed layer is the one that
   * actually bounds spending across instances; the in-memory controller stays
   * as defence in depth for a single instance under burst.
   */
  if (limiter) {
    const distributed = await limiter.acquire(principal, fingerprint);
    if (distributed === "backend_unavailable") {
      // No verdict is not permission. Refuse the paid call and let the
      // caller answer deterministically.
      return { allowed: false, reason: "abuse_controls_unconfigured" };
    }
    if (!distributed.allowed) return distributed;

    const local = controller.acquire(principal, fingerprint);
    if (!local.allowed) {
      distributed.release();
      return local;
    }
    if (sessionRequestLimit !== null) budget.acquiredProviderLeases += 1;
    return {
      allowed: true,
      config,
      release: () => {
        local.release();
        distributed.release();
      },
    };
  }

  const lease = controller.acquire(principal, fingerprint);
  if (!lease.allowed) return lease;
  if (sessionRequestLimit !== null) budget.acquiredProviderLeases += 1;
  return { allowed: true, config, release: lease.release };
}

/** Test-only reset for the process-lifetime paid-provider session counter. */
export function clearAiSessionBudgetForTests(): void {
  const budget = sessionBudgetState();
  budget.acquiredProviderLeases = 0;
}

export function denialExplanationReason(reason: AiAccessDenialReason):
  | "ai_unavailable"
  | "abuse_controls_unconfigured"
  | "request_rate_limited"
  | "budget_exhausted" {
  if (reason === "ai_unavailable") return "ai_unavailable";
  if (reason === "budget_exhausted") return "budget_exhausted";
  if (reason === "rate_limited" || reason === "duplicate_request") {
    return "request_rate_limited";
  }
  return "abuse_controls_unconfigured";
}

export function queryAccessRejection(access: GuardedProviderAccess):
  | { status: 403 | 429; error: "origin_rejected" | "rate_limited"; retryAfterSeconds?: number }
  | null {
  if (access.allowed) return null;
  if (access.reason === "origin_rejected") {
    return { status: 403, error: "origin_rejected" };
  }
  if (
    access.reason === "rate_limited" ||
    access.reason === "duplicate_request" ||
    access.reason === "budget_exhausted"
  ) {
    return {
      status: 429,
      error: "rate_limited",
      retryAfterSeconds: access.retryAfterSeconds ?? 60,
    };
  }
  return null;
}
