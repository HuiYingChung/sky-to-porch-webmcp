"use client";
/**
 * src/components/selection/selection-summary.tsx
 *
 * Canonical selection summary displayed identically in Query, Map,
 * Evidence, and Missions surfaces.
 *
 * Shows place label, coordinate, radius, derived bounds, and time.
 * When there is no selection, shows an explicit empty state (not a
 * false positive or implied safety claim).
 *
 * Time coverage limitation is always shown when a selection is present,
 * because time choices are requests until a later adapter proves source coverage.
 */

import React from "react";
import type { PlaceSelection } from "@/lib/location/selection";
import { TIME_RANGE_DISPLAY_LABELS } from "@/lib/location/time";

interface SelectionSummaryProps {
  selection: PlaceSelection | null;
  /** Optional compact mode — shorter layout for tight spaces (e.g. map overlay). */
  compact?: boolean;
  /** Hide date/time when this is used as the map's textual alternative. */
  includeTime?: boolean;
  /** Include selection method, resolution, and spatial limitations. */
  showMethodDetails?: boolean;
}

const METHOD_LABELS = {
  demo_place: "Registered place selection",
  place_search: "Place search result",
  map_click: "Direct map click",
  agent_coordinate: "Agent-supplied coordinate",
} as const;

export function SelectionSummary({
  selection,
  compact = false,
  includeTime = true,
  showMethodDetails = false,
}: SelectionSummaryProps) {
  if (!selection) {
    return (
      <p
        data-testid="selection-summary-empty"
        style={{
          fontSize: "14px",
          color: "var(--text-muted)",
          margin: 0,
        }}
      >
        No place selected. Use the query form or map to select a location.
      </p>
    );
  }

  const { label, selectionMethod, coordinate, analysisArea, timeSelection } = selection;
  const { radiusKm, boundingBox } = analysisArea;
  const timeLabel = TIME_RANGE_DISPLAY_LABELS[timeSelection.type];

  const timeDisplay =
    timeSelection.type === "custom" && timeSelection.startTs && timeSelection.endTs
      ? `${timeSelection.startTs} – ${timeSelection.endTs}`
      : timeLabel;
  const canonicalAttributes = {
    "data-selection-label": label,
    "data-selection-coordinate": `${coordinate.lon.toFixed(5)},${coordinate.lat.toFixed(5)}`,
    "data-selection-radius-km": String(radiusKm),
    "data-selection-bounds": [
      boundingBox.west,
      boundingBox.south,
      boundingBox.east,
      boundingBox.north,
    ].map((value) => value.toFixed(3)).join(","),
    ...(includeTime ? { "data-selection-time": timeDisplay } : {}),
    "data-selection-method": selectionMethod,
  };

  if (compact) {
    return (
      <div
        data-testid="selection-summary"
        aria-label={`Selection: ${label}`}
        {...canonicalAttributes}
        style={{
          fontSize: "14px",
          color: "var(--text-secondary)",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
        }}
      >
        {/*
          ADR-0052: no "(coordinate selection)" note here. A map click now
          reads "Map point" and a search pick already carries "(OSM search)",
          so the note only repeated the label. The detailed view keeps its
          badge, where the distinction from a registered place still earns
          its space.
        */}
        <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
          {label}
        </span>
        <span>
          {radiusKm} km radius
          {includeTime && <> · {timeDisplay}</>}
        </span>
        {/*
          PR: ui-polish — five-decimal coordinates and a bounds array are
          analyst detail, not first-glance information for the audience the
          README promises "no jargon required". They stay one click away;
          the canonical data-selection-* attributes above are unchanged.
        */}
        <details style={{ marginTop: "2px" }}>
          <summary
            style={{
              cursor: "pointer",
              fontSize: "14px",
              color: "var(--text-muted)",
            }}
          >
            Coordinates and bounds
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "4px" }}>
            <span>
              {coordinate.lon.toFixed(5)}° lon, {coordinate.lat.toFixed(5)}° lat
            </span>
            <span style={{ color: "var(--text-muted)" }}>
              Bounds: [{boundingBox.west.toFixed(3)}, {boundingBox.south.toFixed(3)},{" "}
              {boundingBox.east.toFixed(3)}, {boundingBox.north.toFixed(3)}]
            </span>
          </div>
        </details>
      </div>
    );
  }

  return (
    <div
      data-testid="selection-summary"
      aria-label={`Selection: ${label}`}
      {...canonicalAttributes}
      style={{
        fontSize: "14px",
        color: "var(--text-secondary)",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
      }}
    >
      <div>
        {/*
          ADR-0052: the "coordinate selection" badge stood two lines above a
          "Selection method: Direct map click" row that says the same thing
          with more precision, so the label, the badge, and the row all
          repeated one another. The row is the one that survives.
        */}
        <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
          {label}
        </span>
      </div>

      <div>
        <span style={{ color: "var(--text-muted)" }}>Coordinates: </span>
        {coordinate.lon.toFixed(5)}° lon, {coordinate.lat.toFixed(5)}° lat
      </div>

      <div>
        <span style={{ color: "var(--text-muted)" }}>Analysis area: </span>
        {radiusKm} km radius
      </div>

      <div style={{ fontSize: "14px", color: "var(--text-muted)" }}>
        Bounds: [{boundingBox.west.toFixed(3)}, {boundingBox.south.toFixed(3)},{" "}
        {boundingBox.east.toFixed(3)}, {boundingBox.north.toFixed(3)}]
      </div>

      {showMethodDetails && (
        <>
          <div>
            <span style={{ color: "var(--text-muted)" }}>Selection method: </span>
            {METHOD_LABELS[selectionMethod]}
          </div>
          <div>
            <span style={{ color: "var(--text-muted)" }}>Area model / resolution: </span>
            Point-centred circular analysis area represented by the bounding box above.
          </div>
          <div role="note" style={{ color: "var(--text-muted)" }}>
            This area is an analysis approximation, not an administrative, property, evacuation,
            flood, or incident boundary. Place-search labels depend on the search provider.
          </div>
        </>
      )}

      {includeTime && (
        <div>
          <span style={{ color: "var(--text-muted)" }}>Time: </span>
          {timeDisplay}
        </div>
      )}

      {includeTime && <div
        role="note"
        style={{
          fontSize: "14px",
          color: "var(--text-muted)",
          borderLeft: "2px solid var(--border-default)",
          paddingLeft: "6px",
          marginTop: "2px",
        }}
      >
        {timeSelection.coverageLimitation}
      </div>}
    </div>
  );
}
