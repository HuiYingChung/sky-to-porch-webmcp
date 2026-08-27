/**
 * Minimal typed status values for the foundation health response.
 * Product contracts (Intent, EvidenceObject, etc.) will be defined in WP-02.
 */

export type FoundationStatus = {
  status: "ok" | "error";
  service: string;
  stage: string;
  liveData: boolean;
  ai: boolean;
};

/**
 * Single source of truth for the stage string reported by /api/health.
 * Update this constant when a work package or ADR changes what the product
 * ships; no route or test may hardcode its own stage string.
 */
export const CURRENT_STAGE =
  "WebMCP + ADR-0002 — seven-hazard evidence, automatic storm-impact bundle, per-layer map status";

/**
 * Return true when all required environment variables for a named integration
 * are present. Intended for server-side checks only.
 * Currently returns false for all integrations because none are configured.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function isIntegrationConfigured(_name: string): boolean {
  // No integrations are verified at foundation stage.
  // Each integration will declare its required variables when implemented.
  return false;
}
