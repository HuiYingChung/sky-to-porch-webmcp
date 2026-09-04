"use client";

import { ProgressiveDisclosure } from "@/components/evidence/progressive-disclosure";
import type { Explanation } from "@/contracts/evidence";
import type { MeaningSectionKind } from "@/contracts/meaning";
import { getVerificationSource } from "@/data/verification-sources";
import type { EvidenceExplanationStatus } from "@/lib/ai/evidence-explainer";
import { explanationStatusLabel } from "@/lib/ui/explanation-status";
import { publicNarrativeText } from "@/lib/ui/public-presentation";

const SECTION_ACCENTS: Record<MeaningSectionKind, string> = {
  observed: "#2563eb",
  inferred: "#7c3aed",
  rationale: "#0f766e",
  limitation: "#b45309",
  next_step: "#15803d",
};

export interface AdaptiveMeaningPanelProps {
  explanation: Explanation;
  explanationStatus?: EvidenceExplanationStatus;
}

function conciseAnswer(answer: string): string {
  const protectedAnswer = answer
    .replaceAll("U.S.", "U§S§")
    .replaceAll("e.g.", "e§g§")
    .replaceAll("i.e.", "i§e§");
  const sentences = protectedAnswer
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence
      .replaceAll("U§S§", "U.S.")
      .replaceAll("e§g§", "e.g.")
      .replaceAll("i§e§", "i.e."));
  if (sentences.length <= 2) return answer;
  return `${sentences[0]} ${sentences[sentences.length - 1]}`;
}

/**
 * Shows the direct answer first and progressively reveals reasoning, limits,
 * and fixed official verification links.
 */
export function AdaptiveMeaningPanel({
  explanation,
  explanationStatus,
}: AdaptiveMeaningPanelProps) {
  const meaning = explanation.meaning;
  const directAnswer = publicNarrativeText(
    meaning?.directAnswer ?? explanation.plainSummary ?? explanation.observed
  );
  const answerPreview = conciseAnswer(directAnswer);
  const sections = meaning?.sections ?? [];
  const verificationSources = (meaning?.verificationSourceIds ?? []).map(getVerificationSource);
  const hasDetails = answerPreview !== directAnswer || sections.length > 0 || verificationSources.length > 0;

  return (
    <div data-testid="adaptive-meaning" style={{ display: "grid", gap: "12px" }}>
      <p
        data-testid="meaning-direct-answer"
        style={{
          margin: 0,
          fontSize: "17px",
          lineHeight: 1.5,
          fontWeight: 650,
          letterSpacing: "-0.01em",
          color: "var(--text-primary)",
        }}
      >
        {answerPreview}
      </p>

      {hasDetails && (
        <ProgressiveDisclosure
          testId="meaning-details"
          collapsedLabel="Show full answer, reasoning, and sources"
          expandedLabel="Hide answer details"
        >
          {answerPreview !== directAnswer && (
            <section data-testid="meaning-full-answer" style={{ marginBottom: "12px" }}>
              <h3 style={{ margin: "0 0 4px", fontSize: "15px" }}>Full answer</h3>
              <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.55, color: "var(--text-secondary)" }}>
                {directAnswer}
              </p>
            </section>
          )}

          {sections.length > 0 && (
            <div data-testid="meaning-sections" style={{ display: "grid", gap: "10px" }}>
              {sections.map((section, index) => (
                <section
                  key={`${section.kind}-${section.heading}-${index}`}
                  data-section-kind={section.kind}
                  style={{
                    borderInlineStart: `3px solid ${SECTION_ACCENTS[section.kind]}`,
                    paddingInlineStart: "10px",
                  }}
                >
                  <h3 style={{ margin: "0 0 3px", fontSize: "15px", color: "var(--text-primary)" }}>
                    {publicNarrativeText(section.heading)}
                  </h3>
                  <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.55, color: "var(--text-secondary)" }}>
                    {publicNarrativeText(section.body)}
                  </p>
                </section>
              ))}
            </div>
          )}

          {verificationSources.length > 0 && (
            <section
              aria-label="Official checks you can use now"
              data-testid="official-verification-sources"
              style={{ marginTop: sections.length > 0 ? "14px" : 0 }}
            >
              <h3 style={{ margin: "0 0 8px", fontSize: "15px" }}>
                Official checks you can use now
              </h3>
              <div style={{ display: "grid", gap: "8px" }}>
                {verificationSources.map((source) => (
                  <article
                    key={source.id}
                    style={{
                      padding: "10px",
                      border: "1px solid var(--border-default)",
                      borderRadius: "6px",
                      background: "var(--surface-2)",
                    }}
                  >
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid={`verification-source-${source.id}`}
                      style={{ color: "var(--text-link)", fontWeight: 650 }}
                    >
                      {source.label} ↗
                    </a>
                    <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-secondary)" }}>
                      {source.purpose} Coverage: {source.coverageLabel}
                    </p>
                    <p style={{ margin: "3px 0 0", fontSize: "13px", color: "var(--text-muted)" }}>
                      Limitation: {source.limitation}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          )}
        </ProgressiveDisclosure>
      )}

      {/* The provenance badge makes deterministic authorship easy to audit. */}
      <p
        role="status"
        data-testid="explanation-provider-status"
        style={{
          margin: 0,
          display: "inline-flex",
          alignItems: "baseline",
          gap: "7px",
          width: "fit-content",
          maxWidth: "100%",
          padding: "4px 11px",
          borderRadius: "999px",
          border: "1px solid var(--border-default)",
          background: "var(--surface-2)",
          fontSize: "12px",
          lineHeight: 1.5,
          color: "var(--text-muted)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: "7px",
            height: "7px",
            flexShrink: 0,
            alignSelf: "center",
            borderRadius: "50%",
            background: "var(--text-muted)",
          }}
        />
        <span>{explanationStatusLabel(explanationStatus)}</span>
      </p>
    </div>
  );
}
