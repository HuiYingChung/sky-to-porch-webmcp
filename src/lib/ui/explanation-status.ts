/**
 * src/lib/ui/explanation-status.ts
 *
 * UXFIX-01: One shared, truthful label for the explanation provenance that
 * every hazard's Meaning panel displays. Makes the active AI provider
 * (IBM watsonx or OpenAI), the exact model ID, and any fallback visible so
 * both providers can be verified end-to-end during development.
 */

import type { EvidenceExplanationStatus } from "@/lib/ai/evidence-explainer";

function providerLabel(provider: "ibm" | "openai"): string {
  return provider === "ibm" ? "IBM watsonx" : "OpenAI";
}

function explainedByLabel(provider: "ibm" | "openai"): string {
  return provider === "ibm" ? "IBM Granite (watsonx)" : "OpenAI";
}

function reasonLabel(reason: string): string {
  return reason.replaceAll("_", " ");
}

/** Human-readable provenance label for a validated explanation. */
export function explanationStatusLabel(status: EvidenceExplanationStatus | undefined): string {
  if (!status) return "Validated explanation unavailable";
  if (status.mode === "ai_assisted") {
    const provider = explainedByLabel(status.provider);
    // ADR-0042: name WHY the primary failed, so frequent fallbacks are
    // diagnosable from the UI instead of reading as random provider choice.
    const fallback = status.fallbackUsed
      ? ` · fallback used${
          status.fallbackReason ? ` · primary ${reasonLabel(status.fallbackReason)}` : ""
        }`
      : "";
    const summaryFallback = status.plainSummaryMode === "deterministic_fallback"
      ? ` · Deterministic Plain English fallback · ${
          reasonLabel(status.plainSummaryFallbackReason ?? "ai_output_rejected")
        }`
      : "";
    return `Explained by ${provider} · ${status.modelId}${fallback}${summaryFallback}`;
  }

  const reason = reasonLabel(status.reason);
  if (!status.provider) {
    // P0-C: with no provider even attempted, say plainly what the user sees.
    return status.reason === "ai_unavailable"
      ? "AI explanation is not configured · showing the rule-based explanation"
      : `Rule-based explanation · ${reason}`;
  }

  const provider = providerLabel(status.provider);
  const model = status.modelId ?? "model not configured";
  const outcome = status.providerFailureReason
    ? ` · ${reasonLabel(status.providerFailureReason)}`
    : "";
  const providerAction = status.providerFailureReason ? "attempted" : "AI selection";
  const fallback = status.fallbackUsed
    ? ` · fallback used${
        status.fallbackReason ? ` · primary ${reasonLabel(status.fallbackReason)}` : ""
      }`
    : "";

  return `Rule-based explanation · ${reason} · ${providerAction} ${provider} · ${model}${outcome}${fallback}`;
}
