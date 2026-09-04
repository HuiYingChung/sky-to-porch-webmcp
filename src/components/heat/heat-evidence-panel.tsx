"use client";

import type { InsightTab } from "@/components/navigation/insight-navigation";
import type { HeatEvidenceAssessment, HeatEvidenceCode } from "@/lib/heat/claim-separation";
import type { HeatQueryResult } from "@/lib/heat/types";
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
import {
  formatUtcTimestamp,
  publicErrorMessage,
  publicNarrativeText,
  publicObservationValue,
  publicSourceName,
  publicVariableName,
} from "@/lib/ui/public-presentation";

const INTERNAL_DISPLAY_VALUE = /(?:\b(?:obs|evd|intent|lim|src)-[a-z0-9_-]+\b|\b(?:analysis|place)-[a-z0-9_-]{8,}\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b[0-9a-f]{32,}\b|[a-z]:\\|\\\\[^\\\s]+\\|(?:^|\s)\/(?:[^/\s]+\/)+[^/\s]+|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\.(?:csv|json|geojson|png|tiff?|kml|xml|psv|txt|zip|gz|pdf|nc|grib2?|hdf5?|parquet)\b)/iu;

function observationLabel(value: string): string {
  return INTERNAL_DISPLAY_VALUE.test(value) ? publicVariableName(value) : value;
}

function sourceDetail(value: string): string {
  const safeValue = publicNarrativeText(value);
  return INTERNAL_DISPLAY_VALUE.test(safeValue) ? "Source details unavailable" : safeValue;
}

function rejectionMessage(result: HeatQueryResult): string {
  const fallback = "The check could not be completed. No evidence was returned.";
  if (!result.rejectionReason) return fallback;
  if (result.kind === "source_failure" || INTERNAL_DISPLAY_VALUE.test(result.rejectionReason)) {
    return publicErrorMessage(result.rejectionReason);
  }
  return result.rejectionReason;
}

const LABELS: Record<HeatEvidenceCode, string> = {
  satellite_land_surface_temperature_visualization: "Satellite land-surface-temperature visualization",
  ground_air_temperature: "Outdoor station air temperature",
  derived_heat_index: "NOAA-derived heat index",
  indoor_temperature: "Indoor temperature",
  household_heat_certainty: "Household heat certainty",
  individual_medical_risk: "Individual medical risk",
};

function statusLabel(status: HeatEvidenceAssessment["status"]): string {
  if (status === "evidence_present") return "Evidence present";
  if (status === "not_supported") return "Not supported by this evidence";
  return "Not included in this evidence";
}

function RejectionPanel({ result }: { result: HeatQueryResult }) {
  return (
    <div role="status" data-testid="heat-rejection-panel">
      <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>Extreme Heat evidence unavailable</h3>
      <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "14px" }}>
        {rejectionMessage(result)}
      </p>
      <p style={{ margin: "8px 0 0", color: "var(--status-warning-fg)", fontSize: "14px" }}>
        Missing evidence is not evidence of safe conditions. No information from another place was substituted.
      </p>
      <p data-testid="explanation-provider-status" style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: "13px" }}>
        No AI was used because there was no validated evidence to explain.
      </p>
    </div>
  );
}

function MeaningPanel({ result }: { result: HeatQueryResult }) {
  const evidence = result.evidence;
  if (!evidence) return <RejectionPanel result={result} />;
  const explanation = result.explanation ?? evidence.explanations[0];
  return (
    <div data-testid="heat-meaning-panel" style={{ fontSize: "14px" }}>
      <div data-testid="heat-mode-label" style={{ fontWeight: 700, marginBottom: "8px" }}>
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
}: { result: HeatQueryResult } & MissionSelectionIntegrationProps) {
  const evidence = result.evidence;
  if (!evidence) return <RejectionPanel result={result} />;
  const assessments = result.assessments ?? [];
  const supportedCount = assessments.filter((assessment) => assessment.status === "evidence_present").length;
  return (
    <div data-testid="heat-evidence-panel" style={{ fontSize: "14px" }}>
      <p data-testid="heat-evidence-summary" style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
        {supportedCount} of {assessments.length} claim categories have supporting evidence. {evidence.observations.length} validated observations are available; open details for values, provenance, and limitations.
      </p>
      <ProgressiveDisclosure
        testId="heat-evidence-details"
        collapsedLabel="Show evidence details and audit trail"
        expandedLabel="Hide evidence details"
      >
      <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>Separated Extreme Heat claims</h3>
      <ol style={{ paddingLeft: "20px", marginTop: 0 }}>
        {assessments.map((assessment) => (
          <li key={assessment.code} data-testid={`heat-assessment-${assessment.code}`}>
            <strong>{LABELS[assessment.code]}:</strong> {statusLabel(assessment.status)}
            {assessment.sourceIds.length > 0 && (
              <div style={{ color: "var(--text-muted)", overflowWrap: "anywhere" }}>
                Sources: {Array.from(new Set(assessment.sourceIds.map(publicSourceName))).join(", ")} · {assessment.observationIds.length}{" "}
                {assessment.observationIds.length === 1 ? "observation" : "observations"}
              </div>
            )}
          </li>
        ))}
      </ol>

      <ExplanationAudit explanation={result.explanation ?? evidence.explanations[0]} />

      <h3 style={{ margin: "12px 0 6px", fontSize: "16px" }}>Validated observations</h3>
      {evidence.observations.length === 0 ? (
        <p data-testid="heat-no-observations">No observations were returned.</p>
      ) : (
        <ul style={{ paddingLeft: "20px" }}>
          {evidence.observations.map((observation) => (
            <li key={observation.observationId} data-testid="heat-observation">
              <ObservationSelectionButton
                evidence={evidence}
                observationId={observation.observationId}
                missionSelection={missionSelection}
                onMissionSelectionChange={onMissionSelectionChange}
              />
              <strong>{observationLabel(observation.variableName)}</strong> · {publicSourceName(observation.provenance.sourceId)} ·{" "}
              {formatUtcTimestamp(observation.provenance.observedAt)}
              {observation.value !== undefined
                ? ` · ${publicObservationValue(observation.value, observation.unit)}`
                : " · visualization available · no numeric temperature inferred"}
              <div style={{ color: "var(--text-muted)" }}>
                Product: {sourceDetail(observation.provenance.product)} · Retrieved: {formatUtcTimestamp(observation.provenance.retrievedAt)}
              </div>
              {publicSourceUrl(observation.provenance.sourceId) && (
                <a href={publicSourceUrl(observation.provenance.sourceId)!} target="_blank" rel="noopener noreferrer"
                  style={{ color: "var(--text-link)", overflowWrap: "anywhere" }}>
                  Official dataset/product URL ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 style={{ margin: "12px 0 6px", fontSize: "16px" }}>Required limitations</h3>
      <ul data-testid="heat-limitations" style={{ paddingLeft: "20px" }}>
        {evidence.limitations.filter((limitation) => limitation.required).map((limitation) => (
          <li key={limitation.limitationId}>{publicNarrativeText(limitation.description)}</li>
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
}: { result: HeatQueryResult } & MissionSelectionIntegrationProps) {
  const evidence = result.evidence;
  if (!evidence) return <RejectionPanel result={result} />;
  return (
    <div data-testid="heat-missions-panel" style={{ fontSize: "14px" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>Mission trace</h3>
      <MissionContextNote />
      <p data-testid="heat-missions-summary" style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
        {evidence.missionAttributions.length} contributing mission or data source{evidence.missionAttributions.length === 1 ? " is" : "s are"} shown. Select one to trace its observations in the Evidence tab.
      </p>
      <MissionDashboard
        evidence={evidence}
        missionSelection={missionSelection}
        onMissionSelectionChange={onMissionSelectionChange}
      />
      <ProgressiveDisclosure
        testId="heat-missions-details"
        collapsedLabel="Show official background references"
        expandedLabel="Hide official background references"
      >
      {evidence.missionAttributions.map((mission, index) => (
        <article key={`${mission.missionName}-${mission.datasetId}-${index}`}>
          <strong>{publicNarrativeText(mission.missionName)}</strong>
          <MissionReferenceDetails datasetId={mission.datasetId} missionName={mission.missionName} />
        </article>
      ))}
      <p style={{ color: "var(--text-muted)" }}>
        NOAA USCRN is an outdoor ground station network, not a space mission or indoor sensor.
      </p>
      </ProgressiveDisclosure>
    </div>
  );
}

export function HeatEvidenceInsightPanel({
  result,
  tab,
  missionSelection,
  onMissionSelectionChange,
}: {
  result: HeatQueryResult;
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
