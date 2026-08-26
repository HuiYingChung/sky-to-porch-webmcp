/**
 * src/lib/security/upstash-rate-limiter.ts
 *
 * ADR-0055: distributed rate limiting for paid-provider access.
 *
 * The in-memory controller next door counts inside one Node process. On
 * serverless every instance has its own copy and every cold start resets it,
 * so it cannot bound spending across a deployment. This module holds the
 * counters in Upstash Redis instead, which every instance shares.
 *
 * Three properties this module must never lose:
 *
 *   - Fail degraded. If Redis is unreachable, misconfigured, or slow, the
 *     answer is "backend_unavailable", and the caller must then refuse the
 *     paid call and fall back to deterministic text. Never fail open (which
 *     would spend money blind) and never fail closed in a way that hides the
 *     evidence path from the user.
 *   - Privacy minimal. Keys are HMAC digests supplied by the caller, never an
 *     IP address or message content, and every key carries a TTL.
 *   - No dependencies. Upstash's REST API is plain HTTP, so this is `fetch`.
 */

import type { AiAccessLease, AiRateLimitPolicy } from "./ai-abuse-control";

/** Namespace so a shared Redis database cannot collide with other keys. */
const PREFIX = "stp:ai";

/** Upstash is a network hop in a request's critical path; cap the wait. */
const REQUEST_TIMEOUT_MS = 2_000;

export interface DistributedLimiter {
  /**
   * Returns a lease, a denial, or "backend_unavailable" when Redis could not
   * answer. The third case is deliberately distinct from a denial: a denial
   * is a decision, an unavailable backend is the absence of one.
   */
  acquire(
    principal: string,
    fingerprint: string,
    now?: number
  ): Promise<AiAccessLease | "backend_unavailable">;
}

interface UpstashConfig {
  url: string;
  token: string;
}

function readConfig(): UpstashConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/+$/u, ""), token };
}

type Command = (string | number)[];

/** One Upstash pipeline round trip. Any problem at all becomes null. */
async function pipeline(
  config: UpstashConfig,
  commands: Command[],
  fetchImpl: typeof globalThis.fetch
): Promise<unknown[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${config.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!Array.isArray(body) || body.length !== commands.length) return null;
    const results: unknown[] = [];
    for (const entry of body) {
      if (typeof entry !== "object" || entry === null) return null;
      if ("error" in entry) return null;
      results.push((entry as { result?: unknown }).result);
    }
    return results;
  } catch {
    // Timeout, DNS failure, malformed JSON: all the same answer.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function seconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Reads the policy from the environment, falling back to each supplied
 * default. A malformed value is ignored rather than throwing: the limiter
 * must never be the reason a deployment cannot start.
 */
export function policyFromEnv(defaults: AiRateLimitPolicy): AiRateLimitPolicy {
  const read = (name: string, fallback: number): number => {
    const raw = process.env[name];
    if (raw === undefined || !/^\d+$/u.test(raw.trim())) return fallback;
    const parsed = Number(raw.trim());
    return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : fallback;
  };
  return {
    burstLimit: read("AI_RATE_BURST_LIMIT", defaults.burstLimit),
    burstWindowMs: read("AI_RATE_BURST_WINDOW_MS", defaults.burstWindowMs),
    sustainedLimit: read("AI_RATE_SUSTAINED_LIMIT", defaults.sustainedLimit),
    sustainedWindowMs: read("AI_RATE_SUSTAINED_WINDOW_MS", defaults.sustainedWindowMs),
    dailyLimit: read("AI_RATE_DAILY_LIMIT", defaults.dailyLimit),
    dailyWindowMs: read("AI_RATE_DAILY_WINDOW_MS", defaults.dailyWindowMs),
    globalDailyLimit: read("AI_RATE_GLOBAL_DAILY_LIMIT", defaults.globalDailyLimit),
    duplicateWindowMs: read("AI_RATE_DUPLICATE_WINDOW_MS", defaults.duplicateWindowMs),
  };
}

class UpstashRateLimiter implements DistributedLimiter {
  constructor(
    private readonly config: UpstashConfig,
    private readonly policy: AiRateLimitPolicy,
    private readonly fetchImpl: typeof globalThis.fetch
  ) {}

  async acquire(
    principal: string,
    fingerprint: string,
    now = Date.now()
  ): Promise<AiAccessLease | "backend_unavailable"> {
    const lockKey = `${PREFIX}:lock:${principal}`;
    const dupKey = `${PREFIX}:dup:${principal}:${fingerprint}`;
    const burstKey = `${PREFIX}:burst:${principal}`;
    const sustainedKey = `${PREFIX}:sust:${principal}`;
    const dailyKey = `${PREFIX}:day:${principal}`;
    const globalKey = `${PREFIX}:global`;

    const burstTtl = seconds(this.policy.burstWindowMs);
    const sustainedTtl = seconds(this.policy.sustainedWindowMs);
    const dailyTtl = seconds(this.policy.dailyWindowMs);

    // One round trip. Counters are incremented before the verdict, so a
    // rejected request still counts against its window. That errs toward
    // spending less, which is the correct direction for a cost control.
    const results = await pipeline(
      this.config,
      [
        ["SET", lockKey, "1", "NX", "EX", 30],
        ["EXISTS", dupKey],
        ["INCR", burstKey],
        ["EXPIRE", burstKey, burstTtl, "NX"],
        ["INCR", sustainedKey],
        ["EXPIRE", sustainedKey, sustainedTtl, "NX"],
        ["INCR", dailyKey],
        ["EXPIRE", dailyKey, dailyTtl, "NX"],
        ["INCR", globalKey],
        ["EXPIRE", globalKey, dailyTtl, "NX"],
      ],
      this.fetchImpl
    );
    if (results === null) return "backend_unavailable";

    const lockAcquired = results[0] === "OK";
    const isDuplicate = asCount(results[1]) === 1;
    const burst = asCount(results[2]);
    const sustained = asCount(results[4]);
    const daily = asCount(results[6]);
    const globalCount = asCount(results[8]);
    if (burst === null || sustained === null || daily === null || globalCount === null) {
      return "backend_unavailable";
    }

    const deny = async (
      lease: Extract<AiAccessLease, { allowed: false }>
    ): Promise<AiAccessLease> => {
      // Only release a lock this call actually took.
      if (lockAcquired) {
        await pipeline(this.config, [["DEL", lockKey]], this.fetchImpl);
      }
      return lease;
    };

    if (!lockAcquired) {
      return deny({ allowed: false, reason: "rate_limited", retryAfterSeconds: 2 });
    }
    if (isDuplicate) {
      return deny({
        allowed: false,
        reason: "duplicate_request",
        retryAfterSeconds: seconds(this.policy.duplicateWindowMs),
      });
    }
    if (globalCount > this.policy.globalDailyLimit) {
      return deny({ allowed: false, reason: "budget_exhausted", retryAfterSeconds: 60 });
    }
    if (
      burst > this.policy.burstLimit ||
      sustained > this.policy.sustainedLimit ||
      daily > this.policy.dailyLimit
    ) {
      return deny({ allowed: false, reason: "rate_limited", retryAfterSeconds: 30 });
    }

    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        // Fire and forget: the response must not wait on cleanup, and a
        // failed cleanup only means the lock expires on its own TTL.
        void pipeline(
          this.config,
          [
            ["DEL", lockKey],
            ["SET", dupKey, "1", "NX", "EX", seconds(this.policy.duplicateWindowMs)],
          ],
          this.fetchImpl
        );
      },
    };
  }
}

/**
 * Builds the limiter, or returns null when Upstash is not configured. A null
 * return is what the guard reads as "no distributed limiter exists": in
 * production that must refuse the paid call, and in development it falls
 * through to the process-local controller.
 */
export function loadUpstashLimiter(
  policy: AiRateLimitPolicy,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): DistributedLimiter | null {
  const config = readConfig();
  if (!config) return null;
  return new UpstashRateLimiter(config, policyFromEnv(policy), fetchImpl);
}
