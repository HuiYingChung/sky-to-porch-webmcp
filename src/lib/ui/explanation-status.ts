/**
 * src/lib/ui/explanation-status.ts
 *
 * One shared, truthful label for deterministic explanation provenance.
 */

/** Human-readable provenance label for a validated explanation. */
export function explanationStatusLabel(status: unknown): string {
  if (!status) return "Validated explanation unavailable";
  if (typeof status !== "object") return "Explanation status unavailable";
  const reason = "reason" in status ? status.reason : undefined;
  if (reason === "insufficient_evidence") {
    return "rule-based explanation · evidence is insufficient";
  }
  if (reason === "validated_evidence") {
    return "rule-based explanation · derived from validated evidence";
  }
  return "Explanation status unavailable";
}
