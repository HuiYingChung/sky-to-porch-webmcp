"use client";

import type { InsightTab } from "@/components/navigation/insight-navigation";
import { AdaptiveMeaningPanel } from "@/components/evidence/adaptive-meaning";
import { ExplanationAudit, MissionContextNote, MissionReferenceDetails } from "@/components/evidence/explanation-audit";
import { ProgressiveDisclosure } from "@/components/evidence/progressive-disclosure";
import {
  MissionDashboard,
  ObservationSelectionButton,
} from "@/components/missions/mission-dashboard";
import type { MissionSelectionIntegrationProps } from "@/components/missions/mission-selection";
import type { DroughtQueryResult } from "@/lib/drought/types";
import { publicSourceUrl } from "@/data/public-source-links";
import { dataModeLabel, evidenceStateLabel } from "@/lib/ui/evidence-labels";
import { sourceOutcomeLabel } from "@/lib/ui/outcome-labels";
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

function rejectionMessage(result: DroughtQueryResult): string {
  const fallback = "The check could not be completed. No evidence was returned.";
  if (!result.rejectionReason) return fallback;
  if (result.kind === "source_failure" || INTERNAL_DISPLAY_VALUE.test(result.rejectionReason)) {
    return publicErrorMessage(result.rejectionReason);
  }
  return result.rejectionReason;
}

function RejectionPanel({ result }: { result: DroughtQueryResult }) {
  return (
    <div role="status" data-testid="drought-rejection-panel">
      <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>Drought &amp; Land evidence unavailable</h3>
      <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "14px" }}>
        {rejectionMessage(result)}
      </p>
      <p style={{ margin: "8px 0 0", color: "var(--status-warning-fg)", fontSize: "14px" }}>
        Missing regional data is not proof of normal conditions. No information from another place was substituted.
      </p>
      <p data-testid="explanation-provider-status" style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: "13px" }}>
        No AI was used because there was no validated evidence to explain.
      </p>
    </div>
  );
}

function MeaningPanel({ result }: { result: DroughtQueryResult }) {
  const evidence = result.evidence;
  if (!evidence) return <RejectionPanel result={result} />;
  const explanation = result.explanation ?? evidence.explanations[0];
  return (
    <div data-testid="drought-meaning-panel" style={{ display: "grid", gap: "10px" }}>
      <div style={{ fontWeight: 700, fontSize: "14px" }}>
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
}: { result: DroughtQueryResult } & MissionSelectionIntegrationProps) {
  const evidence = result.evidence;
  if (!evidence) return <RejectionPanel result={result} />;
  return (
    <div data-testid="drought-evidence-panel" style={{ fontSize: "14px" }}>
      <p data-testid="drought-evidence-summary" style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
        {evidence.observations.length} validated observations are available from the registered drought products. Open details for source outcomes, values, provenance, and limitations.
      </p>
      <p data-testid="drought-source-outcomes" style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
        <strong>Source outcomes:</strong> NASA GIBS {sourceOutcomeLabel(result.sourceOutcomes.gibs)}; U.S. Drought
        Monitor {sourceOutcomeLabel(result.sourceOutcomes.usdm)}
        {result.sourceOutcomes.administrativeArea
          ? `; administrative-area lookup ${sourceOutcomeLabel(result.sourceOutcomes.administrativeArea)}`
          : ""}
        {result.sourceOutcomes.canadaDrought
          ? `; Canadian Drought Monitor ${sourceOutcomeLabel(result.sourceOutcomes.canadaDrought)}`
          : ""}.
      </p>
      <ProgressiveDisclosure
        testId="drought-evidence-details"
        collapsedLabel="Show evidence details and audit trail"
        expandedLabel="Hide evidence details"
      >
      <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>Drought evidence audit trail</h3>
      <p style={{ marginTop: 0 }}>
        <strong>Evidence state:</strong> {evidenceStateLabel(evidence.evidenceState)} · <strong>Data mode:</strong>{" "}
        {dataModeLabel(evidence.dataMode)} · <strong>Assembled:</strong> {formatUtcTimestamp(evidence.assembledAt)}
      </p>
      <ExplanationAudit explanation={result.explanation ?? evidence.explanations[0]} />

      <h3 style={{ margin: "12px 0 6px", fontSize: "16px" }}>Validated observations</h3>
      {evidence.observations.length === 0 ? (
        <p>No observations were returned.</p>
      ) : (
        <div style={{ display: "grid", gap: "8px" }}>
          {evidence.observations.map((observation) => (
            <article key={observation.observationId} data-testid="drought-observation"
              style={{ padding: "8px", border: "1px solid var(--border-subtle)", borderRadius: "4px" }}>
              <ObservationSelectionButton
                evidence={evidence}
                observationId={observation.observationId}
                missionSelection={missionSelection}
                onMissionSelectionChange={onMissionSelectionChange}
              />
              <strong>{observationLabel(observation.variableName)}</strong>
              <div>Dataset/product: {sourceDetail(observation.provenance.product)}</div>
              <div>Source: {publicSourceName(observation.provenance.sourceId)}</div>
              <div>Observed: {formatUtcTimestamp(observation.provenance.observedAt)}</div>
              <div>Retrieved: {formatUtcTimestamp(observation.provenance.retrievedAt)}</div>
              <div>Value: {observation.value !== undefined
                ? publicObservationValue(observation.value, observation.unit)
                : sourceDetail(observation.textValue ?? "Visualization only; no numeric value inferred")}</div>
              {publicSourceUrl(observation.provenance.sourceId) && (
                <a href={publicSourceUrl(observation.provenance.sourceId)!} target="_blank" rel="noopener noreferrer"
                  style={{ color: "var(--text-link)", overflowWrap: "anywhere" }}>
                  Official dataset/product URL ↗
                </a>
              )}
            </article>
          ))}
        </div>
      )}

      <h3 style={{ margin: "12px 0 6px", fontSize: "16px" }}>Required limitations</h3>
      <ul style={{ paddingInlineStart: "20px" }}>
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
}: { result: DroughtQueryResult } & MissionSelectionIntegrationProps) {
  const evidence = result.evidence;
  if (!evidence) return <RejectionPanel result={result} />;
  return (
    <div data-testid="drought-missions-panel" style={{ fontSize: "14px" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>Mission and sensor background</h3>
      <MissionContextNote />
      <p data-testid="drought-missions-summary" style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
        {evidence.missionAttributions.length} contributing mission or data source{evidence.missionAttributions.length === 1 ? " is" : "s are"} shown. Select one to trace its observations in the Evidence tab.
      </p>
      <MissionDashboard
        evidence={evidence}
        missionSelection={missionSelection}
        onMissionSelectionChange={onMissionSelectionChange}
      />
      <ProgressiveDisclosure
        testId="drought-missions-details"
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
        The U.S. Drought Monitor is a multi-agency regional assessment, not a satellite mission
        and not a property-level water-availability measurement.
      </p>
      </ProgressiveDisclosure>
    </div>
  );
}

export function DroughtEvidenceInsightPanel({
  result,
  tab,
  missionSelection,
  onMissionSelectionChange,
}: {
  result: DroughtQueryResult;
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
