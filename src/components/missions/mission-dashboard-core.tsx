/**
 * src/components/missions/mission-dashboard-core.tsx
 *
 * WP-13 Mission Dashboard core component.
 * Renders missions/products from a single validated EvidenceObject.
 * Exposes selection hooks for later integration.
 *
 * Only the prop interface and component are exported.
 * No external dependencies, no global CSS, no catalog/registry/fixture.
 */

import React from "react";
import type { EvidenceObject, Observation } from "@/contracts/evidence";
import { missionAttributionKey } from "@/components/missions/mission-selection";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MissionDashboardCoreProps {
  evidence: EvidenceObject;
  selectedMissionKey?: string;
  selectedObservationId?: string;
  onSelectMission: (missionKey: string) => void;
  onSelectObservation: (observationId: string) => void;
}

export function MissionDashboardCore(
  props: MissionDashboardCoreProps
): React.ReactElement {
  const {
    evidence,
    selectedMissionKey,
    selectedObservationId,
    onSelectMission,
    onSelectObservation,
  } = props;
  const headingId = React.useId();

  // Build a fast lookup from observationId → Observation
  const obsMap = React.useMemo(() => {
    const m = new Map<string, Observation>();
    for (const obs of evidence.observations) {
      m.set(obs.observationId, obs);
    }
    return m;
  }, [evidence.observations]);

  const attributions = evidence.missionAttributions;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Relevant missions</h2>
      <p style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
        Only missions contributing to the current evidence result are shown.
      </p>

      {attributions.length === 0 ? (
        <p data-testid="empty-attribution-state">
          No mission attributions available for this evidence result.
        </p>
      ) : (
        <ul
          data-testid="mission-list"
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
          }}
        >
          {attributions.map((attr, idx) => {
            const missionKey = missionAttributionKey(attr, idx);
            const isSelectedMission = missionKey === selectedMissionKey;

            // Contributed observations resolved from the EvidenceObject
            const contributedObs: Observation[] = attr.contributedObservationIds
              .map((id) => obsMap.get(id))
              .filter((o): o is Observation => o !== undefined);

            // Latest known observedAt
            const latestTime = resolveLatestObservedAt(contributedObs, attr.contributedObservationIds);

            // Whether this entry is related to the currently selected observation
            const relatedToSelected =
              selectedObservationId !== undefined &&
              attr.contributedObservationIds.includes(selectedObservationId);

            return (
              <li
                key={missionKey}
                data-testid="mission-entry"
                data-related-to-selected-observation={String(relatedToSelected)}
                style={{
                  padding: "0.75rem",
                  marginBottom: "0.75rem",
                  border: `1px solid ${
                    isSelectedMission || relatedToSelected
                      ? "var(--focus-ring)"
                      : "var(--border-default)"
                  }`,
                  borderRadius: "4px",
                  backgroundColor: isSelectedMission
                    ? "var(--surface-3)"
                    : "var(--surface-1)",
                }}
              >
                {/* Mission header */}
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
                  <button
                    type="button"
                    aria-pressed={isSelectedMission}
                    onClick={() => onSelectMission(missionKey)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "1rem",
                      color: "var(--text-primary)",
                      textAlign: "left",
                    }}
                  >
                    {attr.missionName}
                  </button>
                  <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                    — {attr.agency}
                  </span>
                </div>

                {(isSelectedMission || relatedToSelected) && (
                  <p
                    data-testid="mission-selection-status"
                    style={{
                      margin: "0.35rem 0 0",
                      color: "var(--text-secondary)",
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                    }}
                  >
                    {isSelectedMission
                      ? "Selected mission"
                      : "Contains the selected observation"}
                  </p>
                )}

                {/* Fields */}
                <dl
                  style={{
                    display: "grid",
                    gridTemplateColumns: "max-content 1fr",
                    gap: "0.25rem 0.75rem",
                    margin: "0.5rem 0 0",
                    fontSize: "0.875rem",
                  }}
                >
                  <dt style={{ color: "var(--text-muted)" }}>Role</dt>
                  <dd style={{ margin: 0 }}>{attr.purpose}</dd>

                  <dt style={{ color: "var(--text-muted)" }}>Retrieval status</dt>
                  <dd style={{ margin: 0 }}>{formatRetrievalStatus(attr.retrievalStatus)}</dd>

                  <dt style={{ color: "var(--text-muted)" }}>Latest known observation</dt>
                  <dd style={{ margin: 0 }}>{latestTime}</dd>

                  <dt style={{ color: "var(--text-muted)" }}>Why selected</dt>
                  <dd style={{ margin: 0 }}>{attr.selectionReason}</dd>

                  <dt style={{ color: "var(--text-muted)" }}>Key limitation</dt>
                  <dd style={{ margin: 0 }}>{attr.keyLimitation}</dd>

                  {attr.datasetId !== undefined && (
                    <>
                      <dt style={{ color: "var(--text-muted)" }}>Dataset</dt>
                      <dd style={{ margin: 0 }}>{attr.datasetId}</dd>
                    </>
                  )}
                </dl>

                {/* Contributed observations */}
                {contributedObs.length > 0 && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <p
                      style={{
                        margin: "0 0 0.25rem",
                        fontSize: "0.8125rem",
                        color: "var(--text-muted)",
                        fontWeight: 600,
                      }}
                    >
                      Contributed observations
                    </p>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {contributedObs.map((obs) => {
                        const isSelectedObs = obs.observationId === selectedObservationId;
                        return (
                          <li
                            key={obs.observationId}
                            style={{ marginBottom: "0.25rem", fontSize: "0.8125rem" }}
                          >
                            <button
                              type="button"
                              aria-pressed={isSelectedObs}
                              onClick={() => onSelectObservation(obs.observationId)}
                              style={{
                                background: "none",
                                border: "none",
                                padding: 0,
                                cursor: "pointer",
                                textAlign: "left",
                                color: "var(--text-link)",
                                textDecoration: "underline",
                              }}
                            >
                              {obs.variableName}
                            </button>
                            {/* PR4b (owner rule): internal observation ids
                                (obs-wp10-…) are developer identifiers, never
                                official ones, and stay out of user-facing
                                text. Tracing works through the link itself. */}
                            {" — "}
                            {obs.provenance.observedAt === "unknown"
                              ? "Unknown"
                              : obs.provenance.observedAt}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the chronologically latest known observedAt from contributed observations.
 *
 * - Returns the latest ISO-8601 string when at least one non-"unknown" time exists.
 * - Returns "Unknown" when contributed IDs exist but all times are "unknown".
 * - Returns "Not available" when no observation IDs were contributed.
 */
function resolveLatestObservedAt(
  contributedObs: Observation[],
  contributedIds: string[]
): string {
  if (contributedIds.length === 0) {
    return "Not available";
  }
  // Filter to those with a real timestamp
  const known = contributedObs
    .map((o) => o.provenance.observedAt)
    .filter((t): t is string => t !== "unknown");

  if (known.length === 0) {
    return "Unknown";
  }
  return known.reduce((latest, timestamp) =>
    Date.parse(timestamp) > Date.parse(latest) ? timestamp : latest
  );
}

/**
 * Convert a MissionAttribution retrievalStatus to a human-readable string.
 */
function formatRetrievalStatus(
  status: "success" | "partial" | "failed" | "not_attempted"
): string {
  switch (status) {
    case "success":
      return "Success";
    case "partial":
      return "Partial";
    case "failed":
      return "Failed";
    case "not_attempted":
      return "Not attempted";
  }
}
