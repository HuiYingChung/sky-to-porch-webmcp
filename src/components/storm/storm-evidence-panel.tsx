"use client";

import type { InsightTab } from "@/components/navigation/insight-navigation";
import { AdaptiveMeaningPanel } from "@/components/evidence/adaptive-meaning";
import { ExplanationAudit } from "@/components/evidence/explanation-audit";
import { ProgressiveDisclosure } from "@/components/evidence/progressive-disclosure";
import { FloodEvidenceInsightPanel } from "@/components/flood/flood-evidence-panel";
import type { MissionSelectionIntegrationProps } from "@/components/missions/mission-selection";
import { publicSourceUrl } from "@/data/public-source-links";
import type { FloodQueryResult } from "@/lib/flood/types";
import type { StormQueryResult } from "@/lib/storm/types";
import { dataModeLabel, evidenceStateLabel } from "@/lib/ui/evidence-labels";

function RejectionPanel({ result }: { result: StormQueryResult }) {
  return (
    <div role="status" data-testid="wind-rejection-panel">
      <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>Wind & Storm evidence unavailable</h3>
      <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "14px" }}>
        {result.rejectionReason ?? "The request failed closed. No evidence was returned."}
      </p>
      <p style={{ margin: "8px 0 0", color: "var(--status-warning-fg)", fontSize: "14px" }}>
        Missing wind evidence is not evidence that damaging wind did not occur. Flood or rain data was not substituted.
      </p>
    </div>
  );
}

function ClaimDiscussion({
  result,
  open,
  onOpenChange,
}: {
  result: StormQueryResult;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const discussion = result.claimDiscussion;
  if (!discussion) return null;
  return (
    <section
      aria-label="Storm claim discussion use case"
      data-testid="storm-claim-discussion"
      style={{
        marginTop: "14px",
        padding: "12px",
        border: "1px solid var(--border-default)",
        borderRadius: "8px",
        background: "var(--surface-2)",
      }}
    >
      <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>
        One useful home workflow — not the site&apos;s only purpose
      </p>
      <h3 style={{ margin: "3px 0 8px", fontSize: "16px" }}>{discussion.title}</h3>
      <button
        type="button"
        data-testid="toggle-storm-claim-discussion"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        style={{
          padding: "7px 10px",
          border: "1px solid var(--border-default)",
          borderRadius: "6px",
          background: "var(--surface-1)",
          color: "var(--text-link)",
          cursor: "pointer",
        }}
      >
        {open ? "Hide claim discussion guide" : "Prepare an insurer discussion"}
      </button>
      {open && (
        <div data-testid="storm-claim-discussion-content" style={{ marginTop: "12px", fontSize: "14px" }}>
          <div
            style={{
              marginBottom: "12px",
              padding: "9px 10px",
              borderLeft: "3px solid var(--hazard-wind-storm-border)",
              background: "var(--surface-1)",
            }}
          >
            <strong>Evidence-supported assessment · {discussion.assessmentConfidence} confidence</strong>
            <p style={{ margin: "4px 0 0" }}>{discussion.assessmentSummary}</p>
          </div>
          <h4 style={{ margin: "0 0 5px" }}>What official evidence supports</h4>
          <ul style={{ marginTop: 0, paddingLeft: "20px" }}>
            {discussion.supportedStatements.map((statement) => <li key={statement}>{statement}</li>)}
          </ul>
          <h4 style={{ margin: "10px 0 5px" }}>Property-specific questions that can change the assessment</h4>
          <ul style={{ marginTop: 0, paddingLeft: "20px" }}>
            {discussion.notEstablished.map((statement) => <li key={statement}>{statement}</li>)}
          </ul>
          <h4 style={{ margin: "10px 0 5px" }}>What to document before talking with an insurer</h4>
          <ol style={{ marginTop: 0, paddingLeft: "20px" }}>
            {discussion.documentationChecklist.map((item) => <li key={item}>{item}</li>)}
          </ol>
          <p style={{ margin: "10px 0 4px", fontWeight: 600 }}>Official consumer guidance</p>
          <ul style={{ margin: 0, paddingLeft: "20px" }}>
            {discussion.officialGuidance.map((item) => (
              <li key={item.url}>
                <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-link)" }}>
                  {item.label} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function MeaningPanel({
  result,
  claimDiscussionOpen,
  onClaimDiscussionOpenChange,
}: {
  result: StormQueryResult;
  claimDiscussionOpen: boolean;
  onClaimDiscussionOpenChange: (open: boolean) => void;
}) {
  const evidence = result.evidence;
  if (!evidence) return <RejectionPanel result={result} />;
  const explanation = result.explanation ?? evidence.explanations[0];
  return (
    <div data-testid="wind-meaning-panel" style={{ fontSize: "14px" }}>
      <div data-testid="wind-mode-label" style={{ fontWeight: 700, marginBottom: "8px" }}>
        {dataModeLabel(evidence.dataMode)} · {evidenceStateLabel(evidence.evidenceState)}
      </div>
      {explanation ? (
        <AdaptiveMeaningPanel explanation={explanation} explanationStatus={result.explanationStatus} />
      ) : (
        <p role="alert">A validated explanation is unavailable. Review the Evidence tab.</p>
      )}
      <div
        data-testid="wind-flood-boundary"
        style={{ marginTop: "12px", padding: "9px 10px", borderLeft: "3px solid var(--hazard-wind-storm-border)", background: "var(--surface-2)" }}
      >
        <strong>Wind evidence only.</strong> This result uses wind speed, gust, and official wind-event context.
        Rainfall, inundation, and river gages belong to a separate <strong>Flood & Heavy Rain</strong> analysis.
      </div>
      <ClaimDiscussion
        result={result}
        open={claimDiscussionOpen}
        onOpenChange={onClaimDiscussionOpenChange}
      />
    </div>
  );
}

function EvidencePanel({ result }: { result: StormQueryResult }) {
  const evidence = result.evidence;
  if (!evidence) return <RejectionPanel result={result} />;
  return (
    <div data-testid="wind-evidence-panel" style={{ fontSize: "14px" }}>
      <p style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
        {evidence.observations.length} validated wind/event observations are available. No precipitation, flood extent, or water-gage record is included in this chain.
      </p>
      <ProgressiveDisclosure
        testId="wind-evidence-details"
        collapsedLabel="Show wind evidence details and audit trail"
        expandedLabel="Hide wind evidence details"
      >
        <ExplanationAudit explanation={result.explanation ?? evidence.explanations[0]} />
        <h3 style={{ margin: "12px 0 6px", fontSize: "16px" }}>Validated observations</h3>
        {evidence.observations.length === 0 ? (
          <p>No usable wind observation was returned.</p>
        ) : (
          <ul style={{ paddingLeft: "20px" }}>
            {evidence.observations.map((observation) => {
              const mph = evidence.derivedMetrics.find(
                (metric) => metric.sourceObservationIds.includes(observation.observationId) && metric.unit === "mph"
              );
              return (
                <li key={observation.observationId} data-testid="wind-observation">
                  <strong>{observation.variableName}</strong> · {observation.provenance.sourceId} · {observation.provenance.observedAt}
                  {observation.value !== undefined
                    ? ` · ${observation.value} ${observation.unit}${mph ? ` (${mph.value} mph)` : ""}`
                    : ` · ${observation.textValue}`}
                  <div style={{ color: "var(--text-muted)" }}>
                    Product: {observation.provenance.product} · Retrieved: {observation.provenance.retrievedAt}
                  </div>
                  {publicSourceUrl(observation.provenance.sourceId) && (
                    <a href={publicSourceUrl(observation.provenance.sourceId)!} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-link)" }}>
                      Official source ↗
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <h3 style={{ margin: "12px 0 6px", fontSize: "16px" }}>Required limitations</h3>
        <ul data-testid="wind-limitations" style={{ paddingLeft: "20px" }}>
          {evidence.limitations.filter((item) => item.required).map((item) => (
            <li key={item.limitationId}>{item.description}</li>
          ))}
        </ul>
      </ProgressiveDisclosure>
    </div>
  );
}

function MissionsPanel({ result }: { result: StormQueryResult }) {
  const evidence = result.evidence;
  if (!evidence) return <RejectionPanel result={result} />;
  return (
    <div data-testid="wind-missions-panel" style={{ fontSize: "14px" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>Wind evidence trace</h3>
      <p style={{ color: "var(--text-secondary)" }}>
        These are weather data sources, not a flood evidence chain and not a property inspection.
      </p>
      {evidence.missionAttributions.map((source) => (
        <article key={`${source.missionName}-${source.datasetId}`} style={{ marginBottom: "12px" }}>
          <strong>{source.missionName}</strong>
          <div>{source.purpose}</div>
          <div style={{ color: "var(--text-muted)" }}>Status: {source.retrievalStatus} · {source.keyLimitation}</div>
        </article>
      ))}
    </div>
  );
}

export function StormEvidenceInsightPanel({
  result,
  tab,
  claimDiscussionOpen,
  onClaimDiscussionOpenChange,
  relatedFloodResult = null,
  missionSelection,
  onMissionSelectionChange,
}: {
  result: StormQueryResult;
  tab: InsightTab;
  claimDiscussionOpen: boolean;
  onClaimDiscussionOpenChange: (open: boolean) => void;
  relatedFloodResult?: FloodQueryResult | null;
} & MissionSelectionIntegrationProps) {
  const windPanel = tab === "meaning" ? (
      <MeaningPanel
        result={result}
        claimDiscussionOpen={claimDiscussionOpen}
        onClaimDiscussionOpenChange={onClaimDiscussionOpenChange}
      />
    ) : tab === "evidence" ? (
      <EvidencePanel result={result} />
    ) : (
      <MissionsPanel result={result} />
    );

  return (
    <div data-testid={relatedFloodResult ? "storm-impact-bundle-panel" : "wind-only-panel"}>
      {windPanel}
      {relatedFloodResult && (
        <section
          aria-label="Related Flood and Heavy Rain evidence chain"
          data-testid="related-flood-evidence-chain"
          style={{
            marginTop: "18px",
            paddingTop: "14px",
            borderTop: "2px solid var(--hazard-flood-storm-border)",
          }}
        >
          <h3 style={{ margin: "0 0 5px", fontSize: "16px" }}>
            Related Flood &amp; Heavy Rain evidence
          </h3>
          <p style={{ margin: "0 0 12px", color: "var(--text-secondary)", fontSize: "14px" }}>
            Collected automatically for the same broad storm-impact question. This is a separate water-only chain;
            it is not wind or roof-causation evidence.
          </p>
          <FloodEvidenceInsightPanel
            result={relatedFloodResult}
            tab={tab}
            missionSelection={missionSelection}
            onMissionSelectionChange={onMissionSelectionChange}
          />
        </section>
      )}
    </div>
  );
}
