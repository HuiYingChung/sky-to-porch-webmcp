import type { EvidenceObject, MissionAttribution } from "@/contracts/evidence";

export interface MissionSelectionState {
  evidenceId?: string;
  missionKey?: string;
  observationId?: string;
}

export interface MissionSelectionIntegrationProps {
  missionSelection?: MissionSelectionState;
  onMissionSelectionChange?: (selection: MissionSelectionState) => void;
}

export function missionAttributionKey(
  attribution: MissionAttribution,
  index: number
): string {
  const parts = [attribution.missionName, attribution.agency];
  if (attribution.datasetId !== undefined) {
    parts.push(attribution.datasetId);
  }
  parts.push(String(index));
  return parts
    .map((part) => part.replace(/[^a-zA-Z0-9_-]/g, "_"))
    .join("__");
}

export function selectionForEvidence(
  evidence: EvidenceObject,
  selection: MissionSelectionState | undefined
): MissionSelectionState {
  return selection?.evidenceId === evidence.evidenceId ? selection : {};
}

export function observationIdsForMission(
  evidence: EvidenceObject,
  missionKey: string | undefined
): readonly string[] {
  if (missionKey === undefined) return [];
  const index = evidence.missionAttributions.findIndex(
    (attribution, attributionIndex) =>
      missionAttributionKey(attribution, attributionIndex) === missionKey
  );
  return index === -1
    ? []
    : evidence.missionAttributions[index].contributedObservationIds;
}

export function selectionFromMission(
  evidence: EvidenceObject,
  missionKey: string
): MissionSelectionState {
  return {
    evidenceId: evidence.evidenceId,
    missionKey,
  };
}

export function selectionFromObservation(
  evidence: EvidenceObject,
  observationId: string
): MissionSelectionState {
  const attributionIndex = evidence.missionAttributions.findIndex((attribution) =>
    attribution.contributedObservationIds.includes(observationId)
  );

  return {
    evidenceId: evidence.evidenceId,
    missionKey:
      attributionIndex === -1
        ? undefined
        : missionAttributionKey(
            evidence.missionAttributions[attributionIndex],
            attributionIndex
          ),
    observationId,
  };
}
