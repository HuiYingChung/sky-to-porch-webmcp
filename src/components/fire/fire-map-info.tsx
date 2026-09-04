"use client";
/**
 * src/components/fire/fire-map-info.tsx
 *
 * WP-05: Provides map-relevant fire evidence metadata for the analysis map.
 *
 * WP-05-004: mode label is derived from evidence.dataMode:
 *   - dataMode="live"    → "LIVE RETRIEVAL · HISTORICAL OBSERVATION"
 *   - dataMode="fixture" → "FIXTURE · HISTORICAL"
 *   - dataMode="failed"  → "FAILED RETRIEVAL"
 *
 * This component does NOT render geometry itself — the map canvas is owned
 * by maplibre-map-canvas. Instead, it provides a coverage area label overlay
 * showing the source-backed bbox when evidence is present.
 *
 * Map geometry is limited to the source-backed bounding box (coverage area).
 * No fire perimeters or smoke shapes are invented.
 *
 * On no_observation or source_failure: coverage area label still shown so
 * the query area is visible, but no fire/smoke geometry is added.
 */

import React from "react";
import type { EvidenceObject } from "@/contracts/evidence";
import type { FireTemporalCoverage } from "@/lib/fire/types";
import { evidenceStateLabel } from "@/lib/ui/evidence-labels";
import { formatUtcTimestamp } from "@/lib/ui/public-presentation";

interface FireMapInfoProps {
  evidence: EvidenceObject;
  temporalCoverage?: FireTemporalCoverage;
}

function coverageStatusLabel(status: FireTemporalCoverage["status"]): string {
  if (status === "complete") return "All requested dates checked";
  if (status === "partial") return "Some requested dates checked";
  if (status === "unsupported") return "Dates not covered";
  return "Dates could not be checked";
}

function mapModeLabel(dataMode: string): string {
  if (dataMode === "live") return "LIVE RETRIEVAL · HISTORICAL OBSERVATION";
  if (dataMode === "fixture") return "FIXTURE · HISTORICAL";
  if (dataMode === "failed") return "FAILED RETRIEVAL";
  return "DATA MODE UNAVAILABLE";
}

/**
 * Returns a small coverage area label that appears on the map overlay.
 * Shows source attribution, mode label, timestamp, and the coverage box.
 */
export function FireMapCoverageLabel({ evidence, temporalCoverage }: FireMapInfoProps) {
  const fireObs = evidence.observations.find(
    (o) => o.provenance.sourceId === "noaa_hms_fire_points" || o.provenance.sourceId === "nasa_firms"
  );
  const sourceLabel = fireObs?.provenance.sourceId === "nasa_firms"
    ? "NASA FIRMS"
    : "NOAA HMS";
  const bboxStr =
    (fireObs?.metadata?.["boundingBox"] as string | undefined) ??
    fireObs?.provenance.requestParameters?.["area"] ??
    "coverage area";
  const observedAt =
    fireObs?.provenance.observedAt ?? evidence.freshness.mostRecentObservationAt ?? "unknown";
  const isNoData =
    evidence.evidenceState === "no_observation" ||
    evidence.evidenceState === "source_failure";
  const modeLabel = mapModeLabel(evidence.dataMode);

  return (
    <div
      data-testid="fire-map-coverage-label"
      style={{
        fontSize: "14px",
        color: "var(--text-primary)",
        background: "var(--surface-1)",
        border: "1px solid var(--border-default)",
        borderRadius: "4px",
        padding: "4px 8px",
        maxWidth: "260px",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "2px" }}>
        {sourceLabel}
        {" "}
        <span
          data-testid="fire-map-mode-label"
          style={{
            fontSize: "14px",
            textTransform: "uppercase",
            background: "var(--surface-3)",
            padding: "1px 4px",
            borderRadius: "2px",
            border: "1px solid var(--border-subtle)",
          }}
        >
          {modeLabel}
        </span>
      </div>
      <div>Coverage: {bboxStr}</div>
      <div>Observed: {formatUtcTimestamp(observedAt)}</div>
      {temporalCoverage && (
        <div data-testid="fire-map-temporal-coverage">
          UTC dates: {temporalCoverage.resolvedStartDate ?? "none"}
          {temporalCoverage.resolvedEndDate && temporalCoverage.resolvedEndDate !== temporalCoverage.resolvedStartDate
            ? ` – ${temporalCoverage.resolvedEndDate}`
            : ""}
          {" · "}{coverageStatusLabel(temporalCoverage.status)}
        </div>
      )}
      <div>
        State:{" "}
        <span data-testid="fire-map-state">{evidenceStateLabel(evidence.evidenceState)}</span>
      </div>
      {isNoData && (
        <div
          style={{ color: "var(--status-error-fg, #dc2626)", fontWeight: 600, marginTop: "2px" }}
          data-testid="fire-map-no-data-warning"
        >
          No data ≠ no danger
        </div>
      )}
    </div>
  );
}
