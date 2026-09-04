"use client";
/**
 * src/components/states/failure-gap-status.tsx
 *
 * Controlled, accessible React status component for WP-14 failure, gap,
 * conflict, and demo-fallback states.
 *
 * Safety rules (enforced in copy):
 * - No failure/gap state implies a safe condition or absence of hazard.
 * - Conflicting sources stay inconclusive; the UI never chooses the most
 *   dramatic source.
 * - AI timeout never substitutes model output for validated evidence.
 * - Upstream schema change shows no unvalidated upstream content.
 * - Demo fixture is always visibly non-live and never acts as fallback.
 * - Missing mission metadata never invents mission, sensor, dataset, time,
 *   or retrieval status.
 *
 * Accepts only a trusted internal state already mapped by deterministic code.
 * Does not accept arbitrary messages, HTML, provider details, URLs, or error
 * objects through props.
 */

import React from "react";
import type { DataMode } from "@/contracts/common";
import { dataModeLabel } from "@/lib/ui/evidence-labels";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const FAILURE_GAP_KINDS = [
  "invalid_location",
  "unsupported_date",
  "no_observation",
  "source_failure",
  "stale_data",
  "conflicting_sources",
  "ai_timeout",
  "rate_limited",
  "upstream_schema_change",
  "map_failure",
  "missing_mission_metadata",
  "demo_fixture",
] as const;

export type FailureGapKind = (typeof FAILURE_GAP_KINDS)[number];

export type FailureGapStatusState =
  | {
      kind: Exclude<FailureGapKind, "demo_fixture">;
      dataMode?: DataMode;
    }
  | {
      kind: "demo_fixture";
      dataMode: "fixture";
    };

export interface FailureGapStatusProps {
  state: FailureGapStatusState;
  onRecover?: () => void;
}

// ---------------------------------------------------------------------------
// Private presentation table
// ---------------------------------------------------------------------------

interface KindMeta {
  title: string;
  explanation: string;
  boundary: string;
  tone: "alert" | "status";
  recoveryLabel?: string;
}

const KIND_META: Record<FailureGapKind, KindMeta> = {
  invalid_location: {
    title: "Location not supported",
    explanation:
      "The requested location falls outside the area covered by this service.",
    boundary:
      "No evidence is claimed for this request. Conditions at this location are unknown.",
    tone: "alert",
    recoveryLabel: "Change location",
  },
  unsupported_date: {
    title: "Date not supported",
    explanation:
      "The requested date is outside the range available from the underlying sources.",
    boundary:
      "No evidence is claimed for this request. Conditions on this date are unknown.",
    tone: "status",
    recoveryLabel: "Change date",
  },
  no_observation: {
    title: "No matching observation",
    explanation:
      "No observation matching this location and time was found in the available sources.",
    boundary:
      "Absence of an observation does not mean no hazard. Conditions remain unknown.",
    tone: "status",
  },
  source_failure: {
    title: "Source unavailable",
    explanation: "One or more data sources could not be reached or did not respond.",
    boundary:
      "A source failure does not mean no hazard or erase separately validated evidence. Review any available evidence; conditions from the failed source remain unknown.",
    tone: "alert",
    recoveryLabel: "Try again",
  },
  stale_data: {
    title: "Data may be stale",
    explanation: "The available data is older than the freshness threshold.",
    boundary:
      "Stale data does not mean no hazard. The dated observation remains evidence for its recorded time, not current conditions, which may have changed.",
    tone: "status",
  },
  conflicting_sources: {
    title: "Conflicting sources",
    explanation: "Multiple sources returned results that could not be reconciled.",
    boundary:
      "Each validated source remains available, but the combined evidence is inconclusive. The most dramatic source has not been chosen; the disagreement remains explicit.",
    tone: "status",
  },
  ai_timeout: {
    title: "AI interpretation timed out",
    explanation: "The AI interpretation step did not complete within the allowed time.",
    boundary:
      "Model output has not been substituted for validated evidence. Validated evidence remains available and its boundary is unchanged.",
    tone: "alert",
    recoveryLabel: "Try again",
  },
  rate_limited: {
    title: "Rate limit reached",
    explanation: "A supporting service or data source has temporarily limited requests.",
    boundary:
      "A rate limit does not mean no hazard or erase separately validated evidence. Review any available evidence; the limited step remains unresolved.",
    tone: "alert",
    recoveryLabel: "Try again",
  },
  upstream_schema_change: {
    title: "Source format changed",
    explanation:
      "A data source returned information in a format this app cannot read.",
    boundary:
      "Information that could not be verified is not shown. Other verified evidence remains available; conditions from the affected source remain unknown until it can be checked again.",
    tone: "alert",
    recoveryLabel: "Try again",
  },
  map_failure: {
    title: "Map display unavailable",
    explanation: "The map layer could not be loaded.",
    boundary:
      "A map failure does not affect the underlying evidence. Use the non-map summary as the recovery path.",
    tone: "alert",
    recoveryLabel: "Use without map",
  },
  missing_mission_metadata: {
    title: "Mission metadata unavailable",
    explanation: "Required metadata about the observing mission could not be retrieved.",
    boundary:
      "No mission, sensor, dataset, collection time, or retrieval status has been assumed. The affected evidence is not attributed to a mission; other fully attributed evidence remains available.",
    tone: "status",
  },
  demo_fixture: {
    title: "Demo fixture — not live data",
    explanation:
      "This result is drawn from a pre-loaded demo fixture, not a live data request.",
    boundary:
      "A demo fixture is never silently substituted for a failed live request.",
    tone: "status",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FailureGapStatus({
  state,
  onRecover,
}: FailureGapStatusProps): React.ReactElement {
  const { kind } = state;
  const meta = KIND_META[kind];
  const isAlert = meta.tone === "alert";
  const reactId = React.useId();
  const headingId = `failure-gap-heading-${reactId.replaceAll(":", "")}`;

  const roleProps = isAlert
    ? { role: "alert" as const }
    : { role: "status" as const, "aria-live": "polite" as const };

  const showRecovery = !!onRecover && !!meta.recoveryLabel;

  return (
    <div
      {...roleProps}
      data-testid="failure-gap-status"
      data-failure-gap-kind={kind}
      aria-labelledby={headingId}
      style={{
        padding: "1rem",
        border: `1px solid ${isAlert ? "var(--status-error-border)" : "var(--border-subtle)"}`,
        borderRadius: "4px",
        background: isAlert
          ? "var(--status-error-bg)"
          : "var(--surface-2)",
        color: isAlert
          ? "var(--status-error-fg)"
          : "var(--text-primary)",
        fontSize: "14px",
      }}
    >
      <h3
        id={headingId}
        style={{ margin: "0 0 0.5rem", fontSize: "15px", fontWeight: 600 }}
      >
        {meta.title}
      </h3>

      <p style={{ margin: "0 0 0.25rem" }}>{meta.explanation}</p>

      <p
        style={{
          margin: "0 0 0.25rem",
          fontSize: "13px",
          color: "var(--text-muted)",
        }}
      >
        {meta.boundary}
      </p>

      {"dataMode" in state && state.dataMode !== undefined && (
        <p
          data-testid="failure-gap-data-mode"
          style={{
            margin: "0.5rem 0 0",
            fontSize: "12px",
            color: "var(--text-muted)",
          }}
        >
          {dataModeLabel(state.dataMode)}
        </p>
      )}

      {showRecovery && (
        <button
          type="button"
          onClick={onRecover}
          data-testid="failure-gap-recovery"
          style={{
            marginTop: "0.75rem",
            padding: "4px 12px",
            fontSize: "14px",
            border: `1px solid ${isAlert ? "var(--status-error-border)" : "var(--border-subtle)"}`,
            borderRadius: "4px",
            background: "transparent",
            color: isAlert
              ? "var(--status-error-fg)"
              : "var(--text-primary)",
            cursor: "pointer",
          }}
        >
          {meta.recoveryLabel}
        </button>
      )}
    </div>
  );
}
