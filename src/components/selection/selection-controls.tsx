"use client";
/**
 * src/components/selection/selection-controls.tsx
 *
 * Reusable controls for demo place search, radius, time type, and custom
 * dates. Shared by GuidedQuery and NonMapSelection.
 *
 * Behaviour contract:
 *   - Selecting a demo place always creates a new PlaceSelection immediately.
 *     If the current time type is "custom" and dates are missing, sensible
 *     default dates are auto-filled first — place selection never dead-ends
 *     on an incomplete time draft (UXFIX-01).
 *   - Changing radius or time type (when a selection already exists) calls
 *     updateSelectionParams() and applies the change without re-selecting a
 *     place. Switching to "custom" auto-fills default dates when empty.
 *   - Invalid radius or time inputs are reported via onError; the last valid
 *     selection is left unchanged.
 *
 * UXFIX-01: Custom dates are collected through native calendar date inputs
 * (YYYY-MM-DD, UTC). The canonical selection still stores full ISO-8601
 * timestamps; conversion happens only via lib/ui/date-input helpers. Optional
 * minDate/maxDate props constrain the calendar to evidenced source coverage.
 *
 * Manual coordinate entry is NOT included here; it stays in NonMapSelection
 * because it is specific to that surface.
 */

import React, { useRef, useState } from "react";
import { DEMO_PLACES, type DemoPlace } from "@/data/places/wp04-demo-places";
import {
  buildDemoPlaceSelection,
  buildGeocodedPlaceSelection,
  updateSelectionParams,
  AREA_RADIUS_MIN_KM,
  AREA_RADIUS_MAX_KM,
} from "@/lib/location/selection";
import type { PlaceSelection } from "@/lib/location/selection";
import { TIME_RANGE_TYPES } from "@/contracts/common";
import type { TimeRangeType } from "@/contracts/common";
import { TIME_RANGE_DISPLAY_LABELS } from "@/lib/location/time";
import {
  dateInputToStartTs,
  dateInputToEndTs,
  isDateInputValue,
  latestCompletedUtcDate,
  tsToDateInput,
} from "@/lib/ui/date-input";

export interface SelectionControlsProps {
  /** idPrefix — keeps form element IDs unique across instances. */
  idPrefix: string;
  /** Optional stable test-id prefix when DOM IDs need an instance-specific prefix. */
  testIdPrefix?: string;
  /** Current search query (controlled by parent). */
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  /**
   * ADR-0044: demo places offered as in-form shortcuts. Defaults to the full
   * registry; pass [] when a separate gallery (GuidedQuery) owns demo entry.
   */
  demoPlaces?: readonly DemoPlace[];
  /** Current radius input string (controlled by parent). */
  radiusInput: string;
  onRadiusInputChange: (v: string) => void;
  /** Current time type (controlled by parent). */
  timeType: TimeRangeType;
  onTimeTypeChange: (t: TimeRangeType) => void;
  /** Optional source-supported subset. Unsupported choices are not rendered. */
  allowedTimeTypes?: readonly TimeRangeType[];
  /** Hide the time editor until its governing hazard has been selected. */
  showTimeControls?: boolean;
  /** Render one UTC date and mirror it to both canonical range boundaries. */
  customDateMode?: "range" | "single";
  /** Custom date inputs, YYYY-MM-DD UTC (controlled by parent). */
  customStart: string;
  onCustomStartChange: (v: string) => void;
  customEnd: string;
  onCustomEndChange: (v: string) => void;
  /** Optional earliest selectable custom date (inclusive, YYYY-MM-DD). */
  minDate?: string;
  /** Optional latest selectable custom date (inclusive, YYYY-MM-DD). */
  maxDate?: string;
  /**
   * ADR-0043: optional inclusive cap on the custom range length in UTC days.
   * A longer pair is rejected at the input with the last applied range
   * restored, instead of surviving until a server-side rejection.
   */
  maxRangeDays?: number;
  /** Current selection (used to detect active place and drive immediate updates). */
  currentSelection: PlaceSelection | null;
  /** Called on any validation error (invalid radius, time, etc.). */
  onError: (message: string) => void;
  /** Called when a validated selection is created or updated. */
  onSelection: (sel: PlaceSelection) => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 7px",
  fontSize: "14px",
  border: "1px solid var(--border-default)",
  borderRadius: "4px",
  background: "var(--surface-2)",
  color: "var(--text-primary)",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "14px",
  color: "var(--text-secondary)",
  marginBottom: "3px",
};

export function SelectionControls({
  idPrefix,
  testIdPrefix = idPrefix,
  searchQuery,
  onSearchQueryChange,
  demoPlaces = DEMO_PLACES,
  radiusInput,
  onRadiusInputChange,
  timeType,
  onTimeTypeChange,
  allowedTimeTypes = TIME_RANGE_TYPES,
  showTimeControls = true,
  customDateMode = "range",
  customStart,
  onCustomStartChange,
  customEnd,
  onCustomEndChange,
  minDate,
  maxDate,
  maxRangeDays,
  currentSelection,
  onError,
  onSelection,
}: SelectionControlsProps) {
  const demoQuery = searchQuery.trim().toLowerCase();
  const searchResults = demoQuery.length === 0
    ? demoPlaces
    : demoPlaces.filter((place) => place.label.toLowerCase().includes(demoQuery));
  const customOnly = allowedTimeTypes.length === 1 && allowedTimeTypes[0] === "custom";
  const showCustomDates = timeType === "custom" || customOnly;

  // Keep an event-synchronous copy of the controlled drafts and canonical
  // selection. React may batch consecutive input/select events before the
  // parent re-renders this component. Without these refs, a fast radius edit
  // followed by a time edit can rebuild from stale props and silently discard
  // the first change even though both controls display the new values.
  const selectionRef = useRef(currentSelection);
  const radiusInputRef = useRef(radiusInput);
  const timeTypeRef = useRef(timeType);
  const customStartRef = useRef(customStart);
  const customEndRef = useRef(customEnd);
  const lastSelectionPropRef = useRef(currentSelection);
  const lastRadiusPropRef = useRef(radiusInput);
  const lastTimeTypePropRef = useRef(timeType);
  const lastCustomStartPropRef = useRef(customStart);
  const lastCustomEndPropRef = useRef(customEnd);

  // A sibling controlled prop can re-render before the context-backed
  // PlaceSelection arrives. Only consume a prop when that prop itself changed;
  // otherwise an intermediate render would overwrite a newer event-synchronous
  // value with the same stale object/string that the previous render supplied.
  if (currentSelection !== lastSelectionPropRef.current) {
    lastSelectionPropRef.current = currentSelection;
    selectionRef.current = currentSelection;
  }
  if (radiusInput !== lastRadiusPropRef.current) {
    lastRadiusPropRef.current = radiusInput;
    radiusInputRef.current = radiusInput;
  }
  if (timeType !== lastTimeTypePropRef.current) {
    lastTimeTypePropRef.current = timeType;
    timeTypeRef.current = timeType;
  }
  if (customStart !== lastCustomStartPropRef.current) {
    lastCustomStartPropRef.current = customStart;
    customStartRef.current = customStart;
  }
  if (customEnd !== lastCustomEndPropRef.current) {
    lastCustomEndPropRef.current = customEnd;
    customEndRef.current = customEnd;
  }

  function commitSelection(selection: PlaceSelection) {
    selectionRef.current = selection;
    onSelection(selection);
  }

  // UXFIX-02 (W8): optional world-wide place search via the server-side
  // geocode proxy. Failure never blocks demo places or map selection.
  interface GeoResult {
    label: string;
    lon: number;
    lat: number;
    boundingBox?: { west: number; south: number; east: number; north: number } | null;
  }
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoResults, setGeoResults] = useState<GeoResult[] | null>(null);

  function searchWorld() {
    const query = searchQuery.trim();
    if (query.length < 2) return;
    setGeoLoading(true);
    setGeoError(null);
    setGeoResults(null);
    fetch("/api/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    })
      .then(async (response) => {
        if (!response.ok) {
          setGeoError(
            response.status === 429
              ? "Search is briefly rate-limited — try again in a moment."
              : "Place search is temporarily unavailable. Demo places and map clicks still work."
          );
          return;
        }
        const json = (await response.json()) as { ok: boolean; results?: GeoResult[] };
        if (!json.ok || !json.results) {
          setGeoError("Place search is temporarily unavailable. Demo places and map clicks still work.");
          return;
        }
        setGeoResults(json.results);
        if (json.results.length === 0) setGeoError("No places matched that search.");
      })
      .catch(() => {
        setGeoError("Place search is temporarily unavailable. Demo places and map clicks still work.");
      })
      .finally(() => setGeoLoading(false));
  }

  function selectGeocoded(result: GeoResult) {
    try {
      const radiusKm = parseFloat(radiusInputRef.current);
      const currentTimeType = timeTypeRef.current;
      const dates = currentTimeType === "custom" ? resolveCustomDates() : null;
      const sel = buildGeocodedPlaceSelection(
        result.label,
        { lon: result.lon, lat: result.lat },
        radiusKm,
        currentTimeType,
        dates ? dateInputToStartTs(dates.start) : undefined,
        dates ? dateInputToEndTs(dates.end) : undefined,
        result.boundingBox ?? undefined
      );
      commitSelection(sel);
      setGeoResults(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * ADR-0043 (B1): restore the visible date drafts to the last applied
   * canonical selection. After a rejected edit the inputs must show exactly
   * what would be queried — never a pair the canonical state does not hold.
   */
  function revertDateDraftsToSelection(): boolean {
    const selection = selectionRef.current;
    if (!selection) return false;
    const start = tsToDateInput(selection.timeSelection.startTs);
    const end = tsToDateInput(selection.timeSelection.endTs);
    customStartRef.current = start;
    onCustomStartChange(start);
    customEndRef.current = end;
    onCustomEndChange(end);
    return true;
  }

  /** Inclusive length of a YYYY-MM-DD range in UTC days. */
  function rangeLengthDays(start: string, end: string): number {
    return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
  }

  function addDaysUtc(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
      .toISOString()
      .slice(0, 10);
  }

  /**
   * ADR-0043 (B2/B4): keep a complete pair valid by following the field the
   * user just edited — the partner date is pulled along visibly (both inputs
   * update) instead of silently swapping the pair, and an over-cap range is
   * shortened from the anchored side instead of dead-ending distant edits.
   */
  function normalizePair(
    start: string,
    end: string,
    anchor: "start" | "end"
  ): { start: string; end: string } {
    let s = start;
    let e = end;
    if (anchor === "start") {
      if (e < s) e = s;
      if (maxRangeDays !== undefined && rangeLengthDays(s, e) > maxRangeDays) {
        e = addDaysUtc(s, maxRangeDays - 1);
      }
    } else {
      if (s > e) s = e;
      if (maxRangeDays !== undefined && rangeLengthDays(s, e) > maxRangeDays) {
        s = addDaysUtc(e, -(maxRangeDays - 1));
      }
    }
    return { start: s, end: e };
  }

  function syncDateDrafts(pair: { start: string; end: string }): void {
    if (pair.start !== customStartRef.current) {
      customStartRef.current = pair.start;
      onCustomStartChange(pair.start);
    }
    if (pair.end !== customEndRef.current) {
      customEndRef.current = pair.end;
      onCustomEndChange(pair.end);
    }
  }

  /**
   * Resolves complete custom dates, auto-filling missing values with the
   * latest allowed date so custom time never dead-ends on an empty draft.
   * Notifies the parent so the visible inputs match what was applied.
   */
  function resolveCustomDates(): { start: string; end: string } {
    const fallback = maxDate ?? latestCompletedUtcDate();
    const start = isDateInputValue(customStartRef.current) ? customStartRef.current : fallback;
    const end = isDateInputValue(customEndRef.current) ? customEndRef.current : fallback;
    const pair = normalizePair(start, end, "end");
    syncDateDrafts(pair);
    return pair;
  }

  const ids = {
    search: `${idPrefix}place-search`,
    radius: `${idPrefix}radius`,
    timeType: `${idPrefix}time-type`,
    customStart: `${idPrefix}custom-start`,
    customEnd: `${idPrefix}custom-end`,
  };

  /** Select a demo place, applying the current radius/time. */
  function selectDemoPlace(placeId: string) {
    const place = demoPlaces.find((p) => p.id === placeId);
    if (!place) return;
    try {
      const radiusKm = parseFloat(radiusInputRef.current);
      const currentTimeType = timeTypeRef.current;
      // UXFIX-01: auto-fill missing custom dates instead of throwing, so
      // switching places never fails on an incomplete time draft.
      const dates = currentTimeType === "custom" ? resolveCustomDates() : null;
      const sel = buildDemoPlaceSelection(
        place,
        radiusKm,
        currentTimeType,
        dates ? dateInputToStartTs(dates.start) : undefined,
        dates ? dateInputToEndTs(dates.end) : undefined
      );
      commitSelection(sel);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Apply radius change immediately when a selection already exists.
   * Only updates the area/time on the existing selection — no place reselection.
   */
  function handleRadiusChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    radiusInputRef.current = v;
    onRadiusInputChange(v);
    const current = selectionRef.current;
    if (!current) return;
    try {
      const currentTimeType = timeTypeRef.current;
      const dates = currentTimeType === "custom" ? resolveCustomDates() : null;
      const updated = updateSelectionParams(
        current,
        parseFloat(v),
        currentTimeType,
        dates ? dateInputToStartTs(dates.start) : undefined,
        dates ? dateInputToEndTs(dates.end) : undefined
      );
      commitSelection(updated);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Apply time type change immediately when a selection already exists.
   * UXFIX-01: switching to "custom" auto-fills default dates when the draft
   * is incomplete, then applies immediately — no unapplied dead-end state.
   */
  function handleTimeTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const t = e.target.value as TimeRangeType;
    timeTypeRef.current = t;
    onTimeTypeChange(t);
    const current = selectionRef.current;
    if (!current) return;
    try {
      const dates = t === "custom" ? resolveCustomDates() : null;
      const updated = updateSelectionParams(
        current,
        parseFloat(radiusInputRef.current),
        t,
        dates ? dateInputToStartTs(dates.start) : undefined,
        dates ? dateInputToEndTs(dates.end) : undefined
      );
      commitSelection(updated);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleCustomStartChange(value: string) {
    customStartRef.current = value;
    onCustomStartChange(value);
    applyCustomDatesIfComplete(value, customEndRef.current, "start");
  }

  function handleCustomEndChange(value: string) {
    customEndRef.current = value;
    onCustomEndChange(value);
    applyCustomDatesIfComplete(customStartRef.current, value, "end");
  }

  function handleSingleDateChange(value: string) {
    if (timeTypeRef.current !== "custom") {
      timeTypeRef.current = "custom";
      onTimeTypeChange("custom");
    }
    customStartRef.current = value;
    customEndRef.current = value;
    onCustomStartChange(value);
    onCustomEndChange(value);
    applyCustomDatesIfComplete(value, value, "end");
  }

  function applyCustomDatesIfComplete(start: string, end: string, anchor: "start" | "end") {
    const current = selectionRef.current;
    if (!current) return;
    // A date input mid-edit (cleared or partially typed) is not an error;
    // the last valid canonical selection simply remains active until both
    // dates are complete.
    if (!isDateInputValue(start) || !isDateInputValue(end)) return;
    // ADR-0043 (B2/B4): keep the pair valid by visibly following the edited
    // field, then apply — the canonical selection always matches the screen.
    const pair = normalizePair(start, end, anchor);
    syncDateDrafts(pair);
    try {
      const updated = updateSelectionParams(
        current,
        parseFloat(radiusInputRef.current),
        "custom",
        dateInputToStartTs(pair.start),
        dateInputToEndTs(pair.end)
      );
      commitSelection(updated);
    } catch (err) {
      // ADR-0043 (B1): a rejected pair must not stay on screen while the
      // previous canonical range would be submitted.
      revertDateDraftsToSelection();
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      {/* World place search with deterministic demo shortcuts. */}
      <div>
        <label htmlFor={ids.search} style={labelStyle}>
          Location or place
        </label>
        <input
          id={ids.search}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder={demoPlaces.length > 0
            ? "Search any place or choose a demo…"
            : "Search any place, or click the map…"}
          data-testid={`${testIdPrefix}place-search`}
          style={inputStyle}
        />
        <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: "4px 0 0" }}>
          Search any place or click the map. We check what data covers it after you ask.
        </p>
        {/*
          ADR-0049: a map click or search pick was only visible on the map's
          own card, so the left column looked unchanged and the selection read
          as lost. This is a one-line confirmation, deliberately NOT the full
          selection-summary component: WP-04 keeps exactly one canonical
          summary, in the map/non-map surface.
        */}
        {currentSelection && (
          <p
            data-testid={`${testIdPrefix}selected-place`}
            style={{ fontSize: "14px", color: "var(--text-primary)", margin: "6px 0 0" }}
          >
            <span style={{ color: "var(--text-muted)" }}>Selected:</span>{" "}
            <strong>
              {currentSelection.selectionMethod === "map_click"
                // A map click's label is the generic "Map point",
                // which would not tell the user *where* they clicked.
                ? `Map point ${currentSelection.coordinate.lon.toFixed(3)}°, ${currentSelection.coordinate.lat.toFixed(3)}°`
                : currentSelection.label}
            </strong>
          </p>
        )}
        {searchQuery.trim().length >= 2 && (
          <div style={{ marginTop: "4px" }}>
            <button
              type="button"
              onClick={searchWorld}
              disabled={geoLoading}
              data-testid={`${testIdPrefix}world-search-btn`}
              style={{
                padding: "4px 8px",
                fontSize: "14px",
                border: "1px solid var(--border-default)",
                borderRadius: "4px",
                background: "var(--surface-3)",
                color: "var(--text-primary)",
                cursor: geoLoading ? "wait" : "pointer",
              }}
            >
              {geoLoading ? "Searching…" : `Search the world for "${searchQuery.trim()}"`}
            </button>
            {geoError && (
              <p role="status" data-testid={`${testIdPrefix}world-search-error`} style={{ fontSize: "14px", color: "var(--text-muted)", margin: "3px 0 0" }}>
                {geoError}
              </p>
            )}
            {geoResults && geoResults.length > 0 && (
              <>
                <ul
                  aria-label="World search results"
                  data-testid={`${testIdPrefix}world-search-results`}
                  style={{ listStyle: "none", margin: "4px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "3px" }}
                >
                  {geoResults.map((result) => (
                    <li key={`${result.label}-${result.lon}-${result.lat}`}>
                      <button
                        type="button"
                        onClick={() => selectGeocoded(result)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "5px 8px",
                          fontSize: "14px",
                          border: "1px solid var(--border-default)",
                          borderRadius: "4px",
                          background: "var(--surface-2)",
                          color: "var(--text-primary)",
                          cursor: "pointer",
                        }}
                      >
                        {result.label}
                        <span style={{ fontSize: "13px", color: "var(--text-muted)", marginLeft: "6px" }}>
                          {result.lon.toFixed(2)}°, {result.lat.toFixed(2)}°
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: "3px 0 0" }}>
                  Search © OpenStreetMap contributors, via Photon
                </p>
              </>
            )}
          </div>
        )}
        {searchResults.length > 0 && (
          <ul
            aria-label="Demo place results"
            data-testid={`${testIdPrefix}place-results`}
            style={{ listStyle: "none", margin: "4px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "3px" }}
          >
            {searchResults.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  onClick={() => selectDemoPlace(place.id)}
                  data-testid={`${testIdPrefix}place-${place.id}`}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "5px 8px",
                    fontSize: "14px",
                    border: "1px solid var(--border-default)",
                    borderRadius: "4px",
                    background: currentSelection?.label === place.label
                      ? "var(--surface-3)"
                      : "var(--surface-2)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >
                  {place.label}
                  <span style={{ fontSize: "14px", color: "var(--text-muted)", marginLeft: "6px" }}>
                    {place.center.lon.toFixed(2)}°, {place.center.lat.toFixed(2)}°
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Radius */}
      <div>
        <label htmlFor={ids.radius} style={labelStyle}>
          Analysis radius (km, {AREA_RADIUS_MIN_KM}–{AREA_RADIUS_MAX_KM})
        </label>
        <input
          id={ids.radius}
          type="number"
          min={AREA_RADIUS_MIN_KM}
          max={AREA_RADIUS_MAX_KM}
          step={1}
          value={radiusInput}
          onChange={handleRadiusChange}
          data-testid={`${testIdPrefix}radius-input`}
          style={{ ...inputStyle, width: "120px" }}
        />
      </div>

      {/* One hazard-aware time editor. A custom-only hazard does not render a
          redundant one-option range select above its calendar control. */}
      {showTimeControls && (
        <div
          data-testid={`${testIdPrefix}time-control`}
          style={{ display: "flex", flexDirection: "column", gap: "6px" }}
        >
          {!customOnly && (
            <div>
              <label htmlFor={ids.timeType} style={labelStyle}>Time range</label>
              <select
                id={ids.timeType}
                value={timeType}
                onChange={handleTimeTypeChange}
                data-testid={`${testIdPrefix}time-type`}
                style={inputStyle}
              >
                {allowedTimeTypes.map((t) => (
                  <option key={t} value={t}>{TIME_RANGE_DISPLAY_LABELS[t]}</option>
                ))}
              </select>
            </div>
          )}

          {showCustomDates && (
            customDateMode === "single" ? (
              <div>
                <label htmlFor={ids.customStart} style={labelStyle}>Observation date (UTC)</label>
                <input
                  id={ids.customStart}
                  type="date"
                  value={customStart}
                  min={minDate}
                  max={maxDate}
                  onChange={(e) => handleSingleDateChange(e.target.value)}
                  data-testid={`${testIdPrefix}custom-date`}
                  style={inputStyle}
                />
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor={ids.customStart} style={labelStyle}>Start date (UTC)</label>
                  <input
                    id={ids.customStart}
                    type="date"
                    value={customStart}
                    min={minDate}
                    max={maxDate}
                    onChange={(e) => handleCustomStartChange(e.target.value)}
                    data-testid={`${testIdPrefix}custom-start`}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label htmlFor={ids.customEnd} style={labelStyle}>End date (UTC)</label>
                  <input
                    id={ids.customEnd}
                    type="date"
                    value={customEnd}
                    min={minDate}
                    max={maxDate}
                    onChange={(e) => handleCustomEndChange(e.target.value)}
                    data-testid={`${testIdPrefix}custom-end`}
                    style={inputStyle}
                  />
                </div>
              </>
            )
          )}
          {showCustomDates && (minDate || maxDate) && (
            <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: 0 }} data-testid={`${testIdPrefix}date-bounds-hint`}>
              Available dates: {minDate ?? "…"} to {maxDate ?? "…"} (UTC). Actual availability
              is confirmed when you ask.
            </p>
          )}
        </div>
      )}
    </>
  );
}
