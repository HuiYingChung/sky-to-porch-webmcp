/**
 * src/lib/ui/explanation-status.ts
 *
 * One shared, truthful label for deterministic explanation provenance.
 */

import type { EvidenceExplanationStatus } from "@/lib/ai/evidence-explainer";

/** Human-readable provenance label for a validated explanation. */
export function explanationStatusLabel(status: EvidenceExplanationStatus | undefined): string {
  if (!status) return "Validated explanation unavailable";
  return status.reason === "insufficient_evidence"
    ? "rule-based explanation · evidence is insufficient"
    : "rule-based explanation · derived from validated evidence";
}
