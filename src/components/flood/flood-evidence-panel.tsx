"use client";

import type { FloodEvidenceAssessment, FloodEvidenceCode } from "@/lib/flood/claim-separation";
import type { FloodQueryResult } from "@/lib/flood/types";
import type { InsightTab } from "@/components/navigation/insight-navigation";
import { AdaptiveMeaningPanel } from "@/components/evidence/adaptive-meaning";
import { ExplanationAudit, MissionContextNote, MissionReferenceDetails } from "@/components/evidence/explanation-audit";
import { ProgressiveDisclosure } from "@/components/evidence/progressive-disclosure";
import {
  MissionDashboard,
  ObservationSelectionButton,
} from "@/components/missions/mission-dashboard";
import type { MissionSelectionIntegrationProps } from "@/components/missions/mission-selection";
import { publicSourceUrl } from "@/data/public-source-links";
import { dataModeLabel, evidenceStateLabel } from "@/lib/ui/evidence-labels";
import { sourceOutcomeLabel } from "@/lib/ui/outcome-labels";

const ASSESSMENT_LABELS: Record<FloodEvidenceCode, string> = {
  satellite_precipitation_visualization: "Satellite precipitation visualization",
  ground_gage_height: "Ground gage height",
  surface_water: "Surface-water extent",
  official_warning: "Official warning",
  route_disruption: "Route disruption",
  property_impact: "Property impact",
};

function statusLabel(status: FloodEvidenceAssessment["status"]): string {
  if (status === "evidence_present") return "Evidence present";
  if (status === "not_supported") return "Not supported by this evidence";
  return "Not included in this evidence";
}

function RejectionPanel({ result }: { result: FloodQueryResult }) {
  return (
    <div role="status" data-testid="flood-rejection-panel">
      <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>Flood evidence unavailable</h3>
      <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "14px" }}>
        {result.rejectionReason ?? "The request failed closed. No evidence was returned."}
      </p>
      <p style={{ margin: "8px 0 0", color: "var(--status-warning-fg)", fontSize: "14px" }}>
        Missing evidence is not evidence of no danger. No Houston fixture was substituted.
      </p>
      <p data-testid="explanation-provider-status" style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: "13px" }}>
        No AI was used because there was no validated evidence to explain.
      </p>
    </div>
  );
}

function MeaningPanel({ result }: { result: FloodQueryResult }) {
  const evidence = result.evidence;
  if (!evidence) return <RejectionPanel result={result} />;
  const explanation = result.explanation ?? evidence.explanations[0];

  return (
    <div data-testid="flood-meaning-panel" style={{ fontSize: "14px" }}>
      <div
        data-testid="flood-mode-label"
        style={{ fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px" }}
      >
        {dataModeLabel(evidence.dataMode)} · {evidenceStateLabel(evidence.evidenceState)}
      </div>
      {explanation ? (
        <AdaptiveMeaningPanel explanation={explanation} explanationStatus={result.explanationStatus} />
      ) : (
        <div>
          <p role="alert">A validated explanation is unavailable. Review the Evidence tab.</p>
          <p data-testid="explanation-provider-status">No AI was used, and no validated explanation is available.</p>
        </div>
      )}
    </div>
  );
}

function EvidencePanel({
  result,
  missionSelection,
  onMissionSelectionChange,
}: { result: FloodQueryResult } & MissionSelectionIntegrationProps) {
  const evidence = result.evidence;
  if (!evidence) return <RejectionPanel result={result} />;
  const assessments = result.assessments ?? [];
  const supportedCount = assessments.filter((assessment) => assessment.status === "evidence_present").length;

  return (
    <div data-testid="flood-evidence-panel" style={{ fontSize: "14px" }}>
      <p data-testid="flood-evidence-summary" style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
        {supportedCount} of {assessments.length} claim categories have supporting evidence. {evidence.observations.length} validated observations are available; open details for values, provenance, and limitations.
      </p>
      {result.sourceOutcomes && (
        <p data-testid="flood-source-outcomes" style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
          <strong>Source outcomes:</strong> satellite precipitation {sourceOutcomeLabel(result.sourceOutcomes.imerg)};
          flood-extent imagery {sourceOutcomeLabel(result.sourceOutcomes.floodExtent)}; ground gage {sourceOutcomeLabel(result.sourceOutcomes.usgs)}.
        </p>
      )}
      <ProgressiveDisclosure
        testId="flood-evidence-details"
        collapsedLabel="Show evidence details and audit trail"
        expandedLabel="Hide evidence details"
      >
      <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>Separated Flood claims</h3>
      <ol style={{ paddingLeft: "20px", marginTop: 0 }}>
        {assessments.map((assessment) => (
          <li key={assessment.code} data-testid={`flood-assessment-${assessment.code}`}>
            <strong>{ASSESSMENT_LABELS[assessment.code]}:</strong>{" "}
            <span>{statusLabel(assessment.status)}</span>
            {assessment.sourceIds.length > 0 && (
              <div style={{ color: "var(--text-muted)", overflowWrap: "anywhere" }}>
                Sources: {assessment.sourceIds.join(", ")} · Observation IDs:{" "}
                {assessment.observationIds.join(", ")}
              </div>
            )}
          </li>
        ))}
      </ol>

      <ExplanationAudit explanation={result.explanation ?? evidence.explanations[0]} />

      <h3 style={{ margin: "12px 0 6px", fontSize: "16px" }}>Validated observations</h3>
      {evidence.observations.length === 0 ? (
        <p data-testid="flood-no-observations">No observations were returned.</p>
      ) : (
        <ul style={{ paddingLeft: "20px" }}>
          {evidence.observations.map((observation) => (
            <li key={observation.observationId} data-testid="flood-observation">
              <ObservationSelectionButton
                evidence={evidence}
                observationId={observation.observationId}
                missionSelection={missionSelection}
                onMissionSelectionChange={onMissionSelectionChange}
              />
              <strong>{observation.variableName}</strong> · {observation.provenance.sourceId} ·{" "}
              {observation.provenance.observedAt}
              {observation.value !== undefined
                ? ` · ${observation.value} ${observation.unit}`
                : ` · ${observation.textValue}`}
              <div style={{ color: "var(--text-muted)" }}>
                Product: {observation.provenance.product} · Retrieved: {observation.provenance.retrievedAt}
              </div>
              {publicSourceUrl(observation.provenance.sourceId) && (
                <a
                  href={publicSourceUrl(observation.provenance.sourceId)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--text-link)", overflowWrap: "anywhere" }}
                >
                  Official dataset/product URL ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 style={{ margin: "12px 0 6px", fontSize: "16px" }}>Required limitations</h3>
      <ul data-testid="flood-limitations" style={{ paddingLeft: "20px" }}>
        {evidence.limitations.filter((limitation) => limitation.required).map((limitation) => (
          <li key={limitation.limitationId}>{limitation.description}</li>
        ))}
      </ul>
      </ProgressiveDisclosure>
    </div>
  );
}

function MissionsPanel({
  result,
  missionSelection,
  onMissionSelectionChange,
}: { result: FloodQueryResult } & MissionSelectionIntegrationProps) {
  const evidence = result.evidence;
  if (!evidence) return <RejectionPanel result={result} />;
  return (
    <div data-testid="flood-missions-panel" style={{ fontSize: "14px" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>Mission trace</h3>
      <MissionContextNote />
      <p data-testid="flood-missions-summary" style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
        {evidence.missionAttributions.length} contributing mission or data source{evidence.missionAttributions.length === 1 ? " is" : "s are"} shown. Select one to trace its observations in the Evidence tab.
      </p>
      <MissionDashboard
        evidence={evidence}
        missionSelection={missionSelection}
        onMissionSelectionChange={onMissionSelectionChange}
      />
      <ProgressiveDisclosure
        testId="flood-missions-details"
        collapsedLabel="Show official background references"
        expandedLabel="Hide official background references"
      >
      {evidence.missionAttributions.map((mission, index) => (
          <article key={`${mission.missionName}-${mission.datasetId}-${index}`}>
            <strong>{mission.missionName}</strong>
            <MissionReferenceDetails datasetId={mission.datasetId} missionName={mission.missionName} />
          </article>
        ))}
      <p style={{ color: "var(--text-muted)" }}>
        The USGS gage is a ground monitoring source, not a space mission.
      </p>
      </ProgressiveDisclosure>
    </div>
  );
}

export function FloodEvidenceInsightPanel({
  result,
  tab,
  missionSelection,
  onMissionSelectionChange,
}: {
  result: FloodQueryResult;
  tab: InsightTab;
} & MissionSelectionIntegrationProps) {
  if (tab === "meaning") return <MeaningPanel result={result} />;
  if (tab === "evidence") {
    return (
      <EvidencePanel
        result={result}
        missionSelection={missionSelection}
        onMissionSelectionChange={onMissionSelectionChange}
      />
    );
  }
  return (
    <MissionsPanel
      result={result}
      missionSelection={missionSelection}
      onMissionSelectionChange={onMissionSelectionChange}
    />
  );
}
