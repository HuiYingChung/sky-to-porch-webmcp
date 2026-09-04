"use client";

import type { InsightTab } from "@/components/navigation/insight-navigation";
import type { Observation } from "@/contracts/evidence";
import type { CoverageGapQueryResult } from "@/lib/coverage-gap/types";
import { AdaptiveMeaningPanel } from "@/components/evidence/adaptive-meaning";
import { dataModeLabel, evidenceStateLabel } from "@/lib/ui/evidence-labels";
import { sourceOutcomeLabel } from "@/lib/ui/outcome-labels";
import {
  MissionDashboard,
  ObservationSelectionButton,
} from "@/components/missions/mission-dashboard";
import type { MissionSelectionIntegrationProps } from "@/components/missions/mission-selection";
import {
  formatUtcDate,
  formatUtcTimestamp,
  publicErrorMessage,
  publicNarrativeText,
  publicObservationValue,
  publicSourceName,
  publicVariableName,
} from "@/lib/ui/public-presentation";

const SOURCE_LABELS: Record<string, string> = {
  nasa_gibs_modis_aod: "NASA GIBS MODIS MAIAC aerosol optical depth",
  airnow: "U.S. EPA AirNow outdoor AQI",
  airnow_daily_data: "U.S. EPA AirNow daily outdoor AQI",
  nasa_gibs_omps_so2: "NASA GIBS NOAA-20 OMPS sulfur dioxide",
  usgs_volcano_hans: "USGS Volcano Hazards Notification System",
  usgs_earthquake_geojson: "USGS observed earthquake catalog events",
  earthquake_prediction: "Earthquake prediction",
};

const INTERNAL_DISPLAY_VALUE = /(?:\b(?:obs|evd|intent|lim|src)-[a-z0-9_-]+\b|\b(?:analysis|place)-[a-z0-9_-]{8,}\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b[0-9a-f]{32,}\b|[a-z]:\\|\\\\[^\\\s]+\\|(?:^|\s)\/(?:[^/\s]+\/)+[^/\s]+|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\.(?:csv|json|geojson|png|tiff?|kml|xml|psv|txt|zip|gz|pdf|nc|grib2?|hdf5?|parquet)\b)/iu;

function observationLabel(value: string): string {
  return INTERNAL_DISPLAY_VALUE.test(value) ? publicVariableName(value) : value;
}

function title(result: CoverageGapQueryResult): string {
  return result.hazardId === "air_quality" ? "Air Quality" : "Earth & Volcanoes";
}

function observationValue(observation: Observation): string {
  if (observation.value !== undefined) return publicObservationValue(observation.value, observation.unit);
  const value = observation.textValue ?? "value unavailable";
  if (!INTERNAL_DISPLAY_VALUE.test(value)) return value;
  const safeValue = publicNarrativeText(value);
  return INTERNAL_DISPLAY_VALUE.test(safeValue) ? "Details are not available." : safeValue;
}

function observationTime(observation: Observation): string {
  const validDate = observation.metadata?.validDate;
  if (observation.provenance.observedAt === "unknown" && typeof validDate === "string") {
    return `${formatUtcDate(validDate).replace(/ UTC$/u, "")} local daily date (UTC instant unavailable)`;
  }
  return formatUtcTimestamp(observation.provenance.observedAt);
}

function resultStatus(result: CoverageGapQueryResult): string {
  if (result.kind === "success") return "Live retrieval · evidence returned";
  if (result.kind === "inconclusive_evidence") return "Live retrieval · inconclusive evidence";
  if (result.kind === "no_observation") return "Live retrieval · no observation returned";
  if (result.kind === "unsupported_coverage") return "Live retrieval · requested coverage unavailable";
  if (result.kind === "unsupported_date") return "Live retrieval · requested date unavailable";
  return "Live retrieval · source unavailable";
}

function resultNote(result: CoverageGapQueryResult): string | null {
  const note = result.rejectionReason;
  if (!note) return null;
  if (note.startsWith("MAIAC source failure:")) {
    return "MAIAC source failure. Available outdoor AQI remains separate from satellite evidence.";
  }
  if (note.startsWith("AirNow daily source failure:")) {
    return "AirNow daily source failure. Satellite AOD is not AQI, and missing ground evidence is not clean air.";
  }
  if (note.startsWith("EPA AQS source failure:")) {
    return "EPA AQS source failure. Preliminary AirNow and satellite AOD remain separate from the missing validated historical check.";
  }
  return INTERNAL_DISPLAY_VALUE.test(note) ? publicErrorMessage(note) : note;
}

function Meaning({ result }: { result: CoverageGapQueryResult }) {
  return (
    <div data-testid="coverage-gap-meaning" style={{ display: "grid", gap: "8px", fontSize: "14px" }}>
      {/* PR4b batch 1: same vocabulary as the other hazards' mode lines. */}
      <strong>
        {result.retrievalAttempted && result.evidence
          ? `${dataModeLabel(result.evidence.dataMode)} · ${evidenceStateLabel(result.evidence.evidenceState)}`
          : result.retrievalAttempted
            ? resultStatus(result)
            : "No source check was attempted"}
      </strong>
      {/* ADR-0045: with a validated explanation, air/earth render the same
          adaptive Meaning as every other hazard. Results without evidence
          (unsupported_date, client-synthesized failures) keep the legacy
          deterministic template. */}
      {result.explanation ? (
        <AdaptiveMeaningPanel
          explanation={result.explanation}
          explanationStatus={result.explanationStatus}
        />
      ) : (
        <>
          <p style={{ margin: 0 }}>{result.meaning.summary}</p>
          <p data-testid="explanation-provider-status" style={{ margin: 0, color: "var(--text-muted)" }}>
            Rule-based response · no AI was called · your concern and question never change which sources are used.
          </p>
        </>
      )}
      {result.meaning.optionalQuestionAcknowledged && (
        <p style={{ margin: 0, color: "var(--text-muted)" }}>
          Your question shaped the wording of this answer. It never changes which sources are used.
        </p>
      )}
      <p style={{ margin: 0, color: "var(--status-warning-fg)" }}>
        {resultNote(result)}
      </p>
    </div>
  );
}

function Evidence({
  result,
  missionSelection,
  onMissionSelectionChange,
}: { result: CoverageGapQueryResult } & MissionSelectionIntegrationProps) {
  return (
    <div data-testid="coverage-gap-evidence" style={{ fontSize: "14px" }}>
      <p style={{ margin: "0 0 8px" }}>
        Your area and date were accepted. Retrieval attempted: <strong>{result.retrievalAttempted ? "yes" : "no"}</strong>.
      </p>
      <dl style={{ margin: 0 }}>
        {Object.entries(result.sourceOutcomes).map(([sourceId, outcome]) => (
          <div key={sourceId} style={{ marginBottom: "8px" }}>
            <dt style={{ fontWeight: 600 }}>{SOURCE_LABELS[sourceId] ?? publicSourceName(sourceId)}</dt>
            <dd style={{ margin: 0, color: "var(--text-secondary)" }}>{sourceOutcomeLabel(outcome)}</dd>
          </div>
        ))}
      </dl>
      {result.evidence && (
        <>
          <h3 style={{ fontSize: "15px", margin: "12px 0 6px" }}>Validated observations</h3>
          {result.evidence.observations.length === 0 ? (
            <p style={{ margin: 0 }}>No usable observation was returned. That does not mean no danger.</p>
          ) : (
            <ul style={{ paddingInlineStart: "20px", margin: 0 }}>
              {result.evidence.observations.map((observation) => (
                <li key={observation.observationId}>
                  <ObservationSelectionButton
                    evidence={result.evidence!}
                    observationId={observation.observationId}
                    missionSelection={missionSelection}
                    onMissionSelectionChange={onMissionSelectionChange}
                  />
                  {observationLabel(observation.variableName)} · {observationValue(observation)} · {publicSourceName(observation.provenance.sourceId)} · {observationTime(observation)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <h3 style={{ fontSize: "15px", margin: "12px 0 6px" }}>Required limitations</h3>
      <ul style={{ paddingInlineStart: "20px", margin: 0 }}>
        {result.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
      </ul>
    </div>
  );
}

function Missions({
  result,
  missionSelection,
  onMissionSelectionChange,
}: { result: CoverageGapQueryResult } & MissionSelectionIntegrationProps) {
  const air = result.hazardId === "air_quality";
  return (
    <div data-testid="coverage-gap-missions" style={{ fontSize: "14px" }}>
      <h3 style={{ fontSize: "15px", margin: "0 0 6px" }}>
        {air ? "Satellite and ground source roles" : "Satellite and official observed-event source roles"}
      </h3>
      {result.evidence ? (
        <MissionDashboard
          evidence={result.evidence}
          missionSelection={missionSelection}
          onMissionSelectionChange={onMissionSelectionChange}
        />
      ) : (
        <p style={{ margin: "0 0 8px", color: "var(--text-secondary)" }}>
          No verified evidence is available, so no relevant mission is shown.
        </p>
      )}
      <p style={{ margin: 0 }}>
        {air
          ? `MODIS MAIAC ${sourceOutcomeLabel(result.sourceOutcomes.nasa_gibs_modis_aod ?? "")}; AirNow daily outdoor AQI ${sourceOutcomeLabel(result.sourceOutcomes.airnow_daily_data ?? "")}. AOD is never rewritten as AQI.`
          : `NOAA-20 OMPS ${sourceOutcomeLabel(result.sourceOutcomes.nasa_gibs_omps_so2 ?? "")}; USGS HANS ${sourceOutcomeLabel(result.sourceOutcomes.usgs_volcano_hans ?? "")}; observed USGS earthquake events ${sourceOutcomeLabel(result.sourceOutcomes.usgs_earthquake_geojson ?? "")}. These roles stay separate and do not predict or prove causality.`}
      </p>
    </div>
  );
}

export function CoverageGapInsightPanel({
  result,
  tab,
  missionSelection,
  onMissionSelectionChange,
}: {
  result: CoverageGapQueryResult;
  tab: InsightTab;
} & MissionSelectionIntegrationProps) {
  return (
    <section aria-label={`${title(result)} evidence status`} data-testid="coverage-gap-panel">
      <h2 style={{ fontSize: "16px", margin: "0 0 10px" }}>{title(result)}</h2>
      {tab === "meaning" ? (
        <Meaning result={result} />
      ) : tab === "evidence" ? (
        <Evidence
          result={result}
          missionSelection={missionSelection}
          onMissionSelectionChange={onMissionSelectionChange}
        />
      ) : (
        <Missions
          result={result}
          missionSelection={missionSelection}
          onMissionSelectionChange={onMissionSelectionChange}
        />
      )}
    </section>
  );
}
