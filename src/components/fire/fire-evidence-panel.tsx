"use client";
/**
 * src/components/fire/fire-evidence-panel.tsx
 *
 * WP-05 fire evidence panel — Meaning, Evidence, and Missions views for a
 * validated fire EvidenceObject.
 *
 * WP-05-004: FixtureBadge replaced by EvidenceModeBadge which derives its
 * label from evidence.dataMode:
 *   - dataMode="live"    → "LIVE RETRIEVAL · HISTORICAL OBSERVATION"
 *   - dataMode="fixture" → "FIXTURE · HISTORICAL"
 *   - dataMode="failed"  → "FAILED RETRIEVAL"
 *
 * Safety rules enforced here:
 *   - Every answer surface is visibly labelled with the actual mode.
 *   - source_failure: zero observations, no stale result, no fallback.
 *   - no_observation: prominent "no data is not safety" limitation.
 *   - observations_returned: counts are parsing counts, not distinct fires.
 *   - No perimeter, AQI, indoor air, evacuation, or property certainty claims.
 *   - All limitations with required=true are shown on every surface.
 *   - Explanation provenance is taken only from the validated server result.
 *
 * Map geometry is exposed via onEvidenceReady callback (handled by AnalysisMap).
 */

import React from "react";
import type { EvidenceObject } from "@/contracts/evidence";
import type { FireQueryResult, FireTemporalCoverage } from "@/lib/fire/types";
import { AdaptiveMeaningPanel } from "@/components/evidence/adaptive-meaning";
import {
  ExplanationAudit,
  MissionContextNote,
  MissionReferenceDetails,
} from "@/components/evidence/explanation-audit";
import { ProgressiveDisclosure } from "@/components/evidence/progressive-disclosure";
import {
  MissionDashboard,
  ObservationSelectionButton,
} from "@/components/missions/mission-dashboard";
import type { MissionSelectionIntegrationProps } from "@/components/missions/mission-selection";
import { publicSourceUrl } from "@/data/public-source-links";
// PR4b batch 1: fire previously carried its own state vocabulary
// ("Observations returned" / "No observation" / "Source failure"); it now
// uses the same shared labels as every other hazard.
import {
  confidenceLevelLabel,
  dataModeLabel,
  evidenceStateLabel,
  freshnessStatusLabel,
} from "@/lib/ui/evidence-labels";
import {
  formatUtcTimestamp,
  publicErrorMessage,
  publicNarrativeText,
  publicObservationValue,
  publicSourceName,
  publicUnitName,
} from "@/lib/ui/public-presentation";

const INTERNAL_DISPLAY_VALUE = /(?:\b(?:obs|evd|intent|lim|src)-[a-z0-9_-]+\b|\b(?:analysis|place)-[a-z0-9_-]{8,}\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b[0-9a-f]{32,}\b|[a-z]:\\|\\\\[^\\\s]+\\|(?:^|\s)\/(?:[^/\s]+\/)+[^/\s]+|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\.(?:csv|json|geojson|png|tiff?|kml|xml|psv|txt|zip|gz|pdf|nc|grib2?|hdf5?|parquet)\b)/iu;

function sourceDetail(value: string): string {
  const safeValue = publicNarrativeText(value);
  return INTERNAL_DISPLAY_VALUE.test(safeValue) ? "Source details unavailable" : safeValue;
}

function rejectionMessage(result: FireQueryResult): string {
  const fallback = "The check could not be completed. No evidence was returned.";
  if (!result.rejectionReason) return fallback;
  if (result.kind === "source_failure" || INTERNAL_DISPLAY_VALUE.test(result.rejectionReason)) {
    return publicErrorMessage(result.rejectionReason);
  }
  return result.rejectionReason;
}

// ---------------------------------------------------------------------------
// Badge — evidence-driven mode / historical label (WP-05-004)
// ---------------------------------------------------------------------------

function evidenceModeText(dataMode: string): string {
  if (dataMode === "live") return "LIVE RETRIEVAL · HISTORICAL OBSERVATION";
  if (dataMode === "fixture") return "FIXTURE · HISTORICAL";
  if (dataMode === "failed") return "FAILED RETRIEVAL";
  return "DATA MODE UNAVAILABLE";
}

function EvidenceModeBadge({ dataMode }: { dataMode: string }) {
  const text = evidenceModeText(dataMode);
  return (
    <span
      data-testid="evidence-mode-badge"
      aria-label={`data mode: ${text}`}
      style={{
        display: "inline-block",
        fontSize: "14px",
        fontWeight: 700,
        letterSpacing: "0.05em",
        padding: "2px 6px",
        borderRadius: "3px",
        background: "var(--surface-3)",
        color: "var(--text-secondary)",
        border: "1px solid var(--border-default)",
        marginRight: "6px",
        textTransform: "uppercase",
      }}
    >
      {text}
    </span>
  );
}

function coverageStatusLabel(status: FireTemporalCoverage["status"]): string {
  if (status === "complete") return "All selected dates were checked";
  if (status === "partial") return "Some selected dates could not be checked";
  if (status === "unsupported") return "The selected date is not available";
  return "The selected dates could not be checked";
}

function coverageDayStatusLabel(status: FireTemporalCoverage["days"][number]["status"]): string {
  if (status === "complete") return "Checked";
  if (status === "unsupported") return "Not available";
  return "Could not be checked";
}

function coverageSourceStatusLabel(
  status: FireTemporalCoverage["days"][number]["fireStatus"]
): string {
  if (status === "complete") return "checked";
  if (status === "missing") return "no matching information";
  if (status === "incomplete") return "some information missing";
  if (status === "failed") return "could not be checked";
  return "not checked";
}

function TemporalCoverageSummary({ coverage }: { coverage?: FireTemporalCoverage }) {
  if (!coverage) return null;
  const resolved = coverage.resolvedStartDate
    ? coverage.resolvedStartDate === coverage.resolvedEndDate
      ? coverage.resolvedStartDate
      : `${coverage.resolvedStartDate} – ${coverage.resolvedEndDate}`
    : "none";
  return (
    <div
      data-testid="fire-temporal-coverage"
      role={coverage.status === "partial" || coverage.status === "failed" ? "alert" : "status"}
      style={{
        marginBottom: "8px",
        padding: "7px 9px",
        border: "1px solid var(--border-default)",
        borderRadius: "4px",
        background: coverage.status === "partial"
          ? "var(--status-warning-bg)"
          : "var(--surface-2)",
        fontSize: "14px",
      }}
    >
      <div>
        <strong>UTC date coverage:</strong>{" "}
        <span data-testid="fire-coverage-status">{coverageStatusLabel(coverage.status)}</span>
        {" · "}resolved {resolved}
      </div>
      {coverage.days.length > 0 && (
        <div style={{ marginTop: "6px" }}>
          <ProgressiveDisclosure
            testId="fire-coverage-details"
            collapsedLabel={`Show ${coverage.days.length} daily coverage record${coverage.days.length === 1 ? "" : "s"}`}
            expandedLabel="Hide daily coverage"
          >
            <ul style={{ margin: 0, paddingLeft: "18px" }}>
              {coverage.days.map((day) => (
                <li key={day.date} data-testid={`fire-coverage-day-${day.date}`}>
                  {day.date}: {coverageDayStatusLabel(day.status)} (Fire {coverageSourceStatusLabel(day.fireStatus)}; Smoke {coverageSourceStatusLabel(day.smokeStatus)})
                </li>
              ))}
            </ul>
          </ProgressiveDisclosure>
        </div>
      )}
      {coverage.status === "partial" && (
        <div style={{ marginTop: "4px", fontWeight: 600 }}>
          Partial coverage is inconclusive. Missing dates are not zero danger.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Required limitations block
// ---------------------------------------------------------------------------

function RequiredLimitations({ evidence }: { evidence: EvidenceObject }) {
  const required = evidence.limitations.filter((l) => l.required);
  if (required.length === 0) return null;
  return (
    <div
      data-testid="required-limitations"
      role="note"
      aria-label="Required limitations"
      style={{
        background: "var(--status-warning-bg)",
        border: "1px solid var(--status-warning-border)",
        borderRadius: "4px",
        padding: "8px 10px",
        fontSize: "14px",
        color: "var(--text-primary)",
        marginBottom: "10px",
      }}
    >
      <strong style={{ display: "block", marginBottom: "4px", fontSize: "14px" }}>
        Required limitations:
      </strong>
      <ul style={{ margin: 0, paddingLeft: "16px" }}>
        {required.map((l) => (
          <li key={l.limitationId} style={{ marginBottom: "2px" }}>
            {publicNarrativeText(l.description)}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// No-data safety warning (for no_observation and source_failure)
// ---------------------------------------------------------------------------

function NoDataSafetyWarning({ state }: { state: "no_observation" | "source_failure" }) {
  return (
    <div
      data-testid="no-data-safety-warning"
      role="alert"
      style={{
        background: "var(--status-error-bg)",
        border: "1px solid var(--status-error-border)",
        borderRadius: "4px",
        padding: "8px 10px",
        fontSize: "14px",
        color: "var(--text-primary)",
        marginBottom: "10px",
        fontWeight: 600,
      }}
    >
      {state === "no_observation"
        ? "⚠ No observation is NOT proof of no fire and NOT proof of no danger."
        : "⚠ Source failure. No data retrieved. Source failure is NOT proof of no fire or no danger."}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meaning panel
// ---------------------------------------------------------------------------

function MeaningPanel({ result }: { result: FireQueryResult }) {
  const evidence = result.evidence!;
  const explanation = result.explanation;
  const isNoData =
    evidence.evidenceState === "no_observation" ||
    evidence.evidenceState === "source_failure";

  if (!explanation) {
    return (
      <div data-testid="fire-meaning-panel">
        <EvidenceModeBadge dataMode={evidence.dataMode} />
        {isNoData && (
          <NoDataSafetyWarning state={evidence.evidenceState as "no_observation" | "source_failure"} />
        )}
        <div role="alert" data-testid="explanation-unavailable">
          A validated explanation is unavailable. Review the Evidence and required limitations.
        </div>
        <p data-testid="explanation-provider-status" style={{ color: "var(--text-muted)" }}>
          No AI was used, and no validated explanation is available.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="fire-meaning-panel">
      <div style={{ display: "flex", alignItems: "center", marginBottom: "8px" }}>
        <EvidenceModeBadge dataMode={evidence.dataMode} />
        <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
          Fire &amp; Smoke — {evidenceStateLabel(evidence.evidenceState)}
        </span>
      </div>

      {/* PR4b (owner request): the UTC coverage audit block lives in the
          Evidence and Missions tabs; Meaning stays answer-first. */}

      <AdaptiveMeaningPanel
        explanation={explanation}
        explanationStatus={result.explanationStatus}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence panel
// ---------------------------------------------------------------------------

function EvidencePanel({
  evidence,
  coverage,
  missionSelection,
  onMissionSelectionChange,
}: {
  evidence: EvidenceObject;
  coverage?: FireTemporalCoverage;
} & MissionSelectionIntegrationProps) {
  const isNoData =
    evidence.evidenceState === "no_observation" ||
    evidence.evidenceState === "source_failure";

  return (
    <div data-testid="fire-evidence-panel">
      <div style={{ display: "flex", alignItems: "center", marginBottom: "8px" }}>
        <EvidenceModeBadge dataMode={evidence.dataMode} />
        <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
          Fire &amp; Smoke Evidence
        </span>
      </div>

      <TemporalCoverageSummary coverage={coverage} />

      {isNoData && (
        <NoDataSafetyWarning state={evidence.evidenceState as "no_observation" | "source_failure"} />
      )}

      <p data-testid="fire-evidence-summary" style={{ margin: "0 0 10px", fontSize: "14px", lineHeight: 1.55 }}>
        {evidence.observations.length} validated observations are available for this result. Open details for daily coverage, exact provenance, values, and required limitations.
      </p>
      <ProgressiveDisclosure
        testId="fire-evidence-details"
        collapsedLabel="Show evidence details and audit trail"
        expandedLabel="Hide evidence details"
      >
      <RequiredLimitations evidence={evidence} />
      <ExplanationAudit explanation={evidence.explanations[0]} />

      {/* Public result details. Stable internal IDs stay in the data model. */}
      <div style={{ marginBottom: "8px", fontSize: "14px" }}>
        <strong>Evidence state:</strong>{" "}
        <span data-testid="evidence-state">{evidenceStateLabel(evidence.evidenceState)}</span>
        <br />
        <strong>Data mode:</strong>{" "}
        <span data-testid="evidence-data-mode">{dataModeLabel(evidence.dataMode)}</span>
        <br />
        <strong>Confidence:</strong>{" "}
        <span data-testid="evidence-confidence">{confidenceLevelLabel(evidence.confidence.level)}</span>
        {" — "}
        <span style={{ color: "var(--text-muted)" }}>{publicNarrativeText(evidence.confidence.rationale)}</span>
        <br />
        <strong>Freshness:</strong>{" "}
        <span data-testid="evidence-freshness">{freshnessStatusLabel(evidence.freshness.status)}</span>
        {" — "}
        <span style={{ color: "var(--text-muted)" }}>{publicNarrativeText(evidence.freshness.note)}</span>
        <br />
        <strong>Assembled at:</strong>{" "}
        <span data-testid="evidence-assembled-at">{formatUtcTimestamp(evidence.assembledAt)}</span>
      </div>

      {/* Observations */}
      {evidence.observations.length > 0 && (
        <div style={{ marginBottom: "8px" }}>
          <strong style={{ fontSize: "14px" }}>Observations ({evidence.observations.length}):</strong>
          {evidence.observations.map((obs) => (
            <div
              key={obs.observationId}
              data-testid={`observation-${obs.observationId}`}
              style={{
                marginTop: "6px",
                padding: "6px 8px",
                background: "var(--surface-2)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "4px",
                fontSize: "14px",
              }}
            >
              <ObservationSelectionButton
                evidence={evidence}
                observationId={obs.observationId}
                missionSelection={missionSelection}
                onMissionSelectionChange={onMissionSelectionChange}
              />
              <div><strong>Source:</strong> {publicSourceName(obs.provenance.sourceId)}</div>
              <div><strong>Product:</strong> {sourceDetail(obs.provenance.product)}</div>
              {publicSourceUrl(obs.provenance.sourceId) && (
                <div>
                  <strong>Public source:</strong>{" "}
                  <a
                    href={publicSourceUrl(obs.provenance.sourceId)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`obs-source-url-${obs.observationId}`}
                    style={{ color: "var(--text-link)" }}
                  >
                    Official dataset/product page ↗
                  </a>
                </div>
              )}
              <div><strong>Observed at:</strong> {formatUtcTimestamp(obs.provenance.observedAt)}</div>
              <div><strong>Retrieved at:</strong> {formatUtcTimestamp(obs.provenance.retrievedAt)}</div>
              {obs.value !== undefined && (
                <div>
                  <strong>Value:</strong> {publicObservationValue(obs.value, obs.unit)}
                </div>
              )}
              {obs.metadata && (
                <div>
                  <strong>Daily counts:</strong>{" "}
                  {String(obs.metadata["inBoxCount"] ?? obs.value ?? "unknown")} in box /{" "}
                  {String(obs.metadata["totalCount"] ?? "unknown")} total ({publicUnitName(String(obs.metadata["countUnit"] ?? obs.unit ?? "count"))})
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* source_failure: explicit zero-observation statement */}
      {evidence.evidenceState === "source_failure" && (
        <div
          data-testid="source-failure-zero-obs"
          style={{ fontSize: "14px", color: "var(--status-error-fg)", marginBottom: "8px" }}
        >
          Zero observations returned. The source failed, and no stale or fallback result was substituted.
        </div>
      )}
      </ProgressiveDisclosure>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Missions panel
// ---------------------------------------------------------------------------

function MissionsPanel({
  evidence,
  coverage,
  missionSelection,
  onMissionSelectionChange,
}: {
  evidence: EvidenceObject;
  coverage?: FireTemporalCoverage;
} & MissionSelectionIntegrationProps) {
  const isNoData =
    evidence.evidenceState === "no_observation" ||
    evidence.evidenceState === "source_failure";

  return (
    <div data-testid="fire-missions-panel">
      <div style={{ display: "flex", alignItems: "center", marginBottom: "8px" }}>
        <EvidenceModeBadge dataMode={evidence.dataMode} />
        <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
          Fire &amp; Smoke Missions
        </span>
      </div>

      <TemporalCoverageSummary coverage={coverage} />

      {isNoData && (
        <NoDataSafetyWarning state={evidence.evidenceState as "no_observation" | "source_failure"} />
      )}

      <MissionContextNote />

      <p data-testid="fire-missions-summary" style={{ margin: "0 0 10px", fontSize: "14px", lineHeight: 1.55 }}>
        {evidence.missionAttributions.length} contributing mission or data source{evidence.missionAttributions.length === 1 ? " is" : "s are"} shown. Select one to trace its observations in the Evidence tab.
      </p>
      <MissionDashboard
        evidence={evidence}
        missionSelection={missionSelection}
        onMissionSelectionChange={onMissionSelectionChange}
      />
      <ProgressiveDisclosure
        testId="fire-missions-details"
        collapsedLabel="Show official background references"
        expandedLabel="Hide official background references"
      >
      {evidence.missionAttributions.map((ma, index) => (
        <div
          key={`${ma.missionName}-${ma.datasetId}-${index}`}
          data-testid={`mission-${ma.missionName.replace(/\s+/g, "-").toLowerCase()}`}
          style={{ marginBottom: "8px", fontSize: "14px" }}
        >
          <div style={{ fontWeight: 600, marginBottom: "2px" }}>{publicNarrativeText(ma.missionName)}</div>
          <MissionReferenceDetails datasetId={ma.datasetId} missionName={ma.missionName} />
        </div>
      ))}
      </ProgressiveDisclosure>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unsupported / rejection panel
// ---------------------------------------------------------------------------

function RejectionPanel({ result }: { result: FireQueryResult }) {
  return (
    <div
      data-testid="fire-rejection-panel"
      role="alert"
      style={{
        background: "var(--status-error-bg)",
        border: "1px solid var(--status-error-border)",
        borderRadius: "4px",
        padding: "10px 12px",
        fontSize: "14px",
        color: "var(--text-primary)",
      }}
    >
      <strong style={{ display: "block", marginBottom: "4px" }}>
        {result.kind === "unsupported_place"
          ? "Unsupported location"
          : result.kind === "source_failure"
            ? "Source failure"
            : "Unsupported date"}
      </strong>
      <p style={{ margin: 0 }}>
        {rejectionMessage(result)}
      </p>
      <p data-testid="explanation-provider-status" style={{ margin: "6px 0 0", color: "var(--text-muted)" }}>
        No AI was used because there was no validated evidence to explain.
      </p>
      <div style={{ marginTop: "8px" }}>
        <TemporalCoverageSummary coverage={result.temporalCoverage} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public: FireEvidenceInsightPanel — renders Meaning, Evidence, or Missions
// ---------------------------------------------------------------------------

interface FireEvidenceInsightPanelProps extends MissionSelectionIntegrationProps {
  result: FireQueryResult;
  tab: "meaning" | "evidence" | "missions";
}

export function FireEvidenceInsightPanel({
  result,
  tab,
  missionSelection,
  onMissionSelectionChange,
}: FireEvidenceInsightPanelProps) {
  // Rejection states have no EvidenceObject
  if (result.kind === "unsupported_place" || result.kind === "unsupported_date") {
    return <RejectionPanel result={result} />;
  }

  const evidence = result.evidence;
  if (!evidence) {
    return result.kind === "source_failure"
      ? <RejectionPanel result={result} />
      : (
          <div data-testid="fire-no-evidence" style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
            No verified evidence is available.
          </div>
        );
  }

  if (tab === "meaning") return <MeaningPanel result={result} />;
  if (tab === "evidence") {
    return (
      <EvidencePanel
        evidence={evidence}
        coverage={result.temporalCoverage}
        missionSelection={missionSelection}
        onMissionSelectionChange={onMissionSelectionChange}
      />
    );
  }
  return (
    <MissionsPanel
      evidence={evidence}
      coverage={result.temporalCoverage}
      missionSelection={missionSelection}
      onMissionSelectionChange={onMissionSelectionChange}
    />
  );
}
