"use client";

import type { EvidenceObject } from "@/contracts/evidence";
import { MissionDashboardCore } from "@/components/missions/mission-dashboard-core";
import {
  observationIdsForMission,
  selectionForEvidence,
  selectionFromMission,
  selectionFromObservation,
  type MissionSelectionIntegrationProps,
} from "@/components/missions/mission-selection";

interface MissionDashboardProps extends MissionSelectionIntegrationProps {
  evidence: EvidenceObject;
}

export function MissionDashboard({
  evidence,
  missionSelection,
  onMissionSelectionChange,
}: MissionDashboardProps) {
  const activeSelection = selectionForEvidence(evidence, missionSelection);

  return (
    <MissionDashboardCore
      evidence={evidence}
      selectedMissionKey={activeSelection.missionKey}
      selectedObservationId={activeSelection.observationId}
      onSelectMission={(missionKey) =>
        onMissionSelectionChange?.(selectionFromMission(evidence, missionKey))
      }
      onSelectObservation={(observationId) =>
        onMissionSelectionChange?.(
          selectionFromObservation(evidence, observationId)
        )
      }
    />
  );
}

interface ObservationSelectionButtonProps
  extends MissionSelectionIntegrationProps {
  evidence: EvidenceObject;
  observationId: string;
}

export function ObservationSelectionButton({
  evidence,
  observationId,
  missionSelection,
  onMissionSelectionChange,
}: ObservationSelectionButtonProps) {
  const activeSelection = selectionForEvidence(evidence, missionSelection);
  const selected = activeSelection.observationId === observationId;
  const related = observationIdsForMission(
    evidence,
    activeSelection.missionKey
  ).includes(observationId);

  return (
    <>
      <button
        type="button"
        aria-pressed={selected}
        data-testid={`select-observation-${observationId}`}
        data-related-to-selected-mission={String(related)}
        onClick={() =>
          onMissionSelectionChange?.(
            selectionFromObservation(evidence, observationId)
          )
        }
        style={{
          display: "block",
          margin: "0 0 6px",
          padding: "4px 8px",
          border: `1px solid ${
            selected || related ? "var(--focus-ring)" : "var(--border-default)"
          }`,
          borderRadius: "4px",
          background: selected ? "var(--surface-3)" : "var(--surface-1)",
          color: "var(--text-primary)",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: selected || related ? 600 : 400,
        }}
      >
        {selected
          ? "Selected observation"
          : related
            ? "Related to selected mission"
            : "Trace to its satellite"}
      </button>
      {/* ADR-0045: the cross-highlight used to happen invisibly in another
          tab; this in-place line is the only immediate confirmation. An
          observation without a contributing mission (e.g. a ground AQI row
          beside a satellite-only mission entry) must say so truthfully
          instead of claiming a highlight that does not exist. */}
      {selected ? (
        <p
          role="status"
          data-testid={`observation-trace-feedback-${observationId}`}
          style={{
            margin: "0 0 6px",
            fontSize: "13px",
            color: "var(--text-secondary)",
          }}
        >
          {activeSelection.missionKey
            ? "Its source mission is now highlighted in the Missions tab."
            : "No satellite mission contributed this observation, so nothing is highlighted in the Missions tab."}
        </p>
      ) : null}
    </>
  );
}
