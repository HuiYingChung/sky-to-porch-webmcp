"use client";
/**
 * src/components/query/guided-query.tsx
 *
 * Guided query form — hazard, concern, optional question, and place selection.
 * Place, radius, and time are edited via the shared SelectionControls.
 * Detailed canonical-selection output belongs to the middle Map/non-map
 * surface and is deliberately not duplicated in this left Query column.
 *
 * Uses the shared QueryDraft and placeSelection from QueryProvider.
 *
 * Fire, Flood, Extreme Heat, and Drought submit to evidence adapters. Air
 * Quality and Earth & Volcanoes submit to coverage-gap routes that, since
 * ADR-0045, participate in the same guarded explanation chain (deterministic
 * fallback when no provider is configured). Fixture mode remains pinned to the
 * immutable 2025-01-08 regression; live mode supports Latest completed day,
 * Past 7 days, and custom inclusive ranges of 1–7 UTC dates. Los Angeles data
 * is never substituted for other places or dates.
 *
 * WP-05-C01 corrections:
 *   1. All fire queries now go through the server-only /api/fire/query route
 *      (which calls validateEvidenceObject and validateExplanation before
 *      returning anything displayable). The client-side cast path is removed.
 *   2. Only a custom range whose start and end are both exactly "2025-01-08"
 *      is accepted. Non-custom modes and every mismatched or malformed range
 *      return a visible unsupported_date rejection.
 *   3. The fire result is cleared synchronously on every material query input
 *      change (place, hazard, time). A generation counter prevents an older
 *      async response from repopulating stale state after a newer change.
 *
 * WP-05-004 additions:
 *   4. An explicit mode choice (Live / Fixture) is required before a fire
 *      query can be submitted. Neither mode is pre-selected. Changing the
 *      mode invalidates any current result. The mode is sent to the server
 *      with every fire query.
 *   5. demo-source-failure is labelled as a fixture test case and is rejected
 *      in live mode without an external request.
 *
 * `idPrefix` — required prop to keep form element IDs unique when multiple
 * instances exist in the DOM (desktop and mobile). Pass "desktop-" or "mobile-".
 */

import React, { useEffect, useRef, useState } from "react";
import { useQueryDraft } from "./query-provider";
import {
  HAZARD_IDS,
  CONCERN_TYPES,
} from "@/contracts/common";
import type { HazardId, ConcernType, TimeRangeType } from "@/contracts/common";
import {
  HAZARD_LABELS,
  CONCERN_LABELS,
  isDraftSubmittable,
} from "@/lib/ui/query-draft";
import { buildDemoPlaceSelection, updateSelectionParams } from "@/lib/location/selection";
import type { PlaceSelection } from "@/lib/location/selection";
import { SelectionControls } from "@/components/selection/selection-controls";
import { DemoGallery } from "@/components/query/demo-gallery";
import {
  demoStoryPlace,
  resolveDemoStoryDates,
  type DemoStory,
  type DemoStoryHazard,
} from "@/data/places/demo-stories";
import { DEMO_PLACES, type DemoPlace } from "@/data/places/wp04-demo-places";
import {
  allowedTimeTypesForHazard,
  customDateBounds,
  dateInputToStartTs,
  dateInputToEndTs,
  isDateInputValue,
  tsToDateInput,
} from "@/lib/ui/date-input";
import { useDevMode, useDevUrlMode } from "@/lib/ui/dev-mode";
import { normalizeOptionalQuestion } from "@/lib/ai/optional-question";
import type { FireEvidenceMode } from "@/lib/fire/types";
import {
  FLOOD_MAX_RANGE_DAYS,
  FLOOD_PINNED_FIXTURE_DATE,
  FLOOD_UNSUPPORTED_FIXTURE_DATE,
} from "@/lib/flood/types";
import type { FloodEvidenceMode } from "@/lib/flood/types";
import {
  HEAT_PINNED_FIXTURE_DATE,
  HEAT_UNSUPPORTED_FIXTURE_DATE,
} from "@/lib/heat/types";
import type { HeatEvidenceMode } from "@/lib/heat/types";
import type { DroughtEvidenceMode } from "@/lib/drought/types";

interface GuidedQueryProps {
  /** Prefix for all element IDs; keeps IDs unique across desktop/mobile instances. */
  idPrefix: string;
}

// ADR-0045: shared look for the sticky quick-nav chips. 14px is the readability
// floor enforced by the wp03-ui-readability E2E minimum-font-size sweep.
const quickNavChipStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: "14px",
  border: "1px solid var(--border-default)",
  borderRadius: "999px",
  background: "var(--surface-2)",
  color: "var(--text-primary)",
  cursor: "pointer",
};

export function GuidedQuery({ idPrefix }: GuidedQueryProps) {
  const {
    draft,
    dispatch,
    placeSelection,
    setPlaceSelection,
    clearPlaceSelection,
    fireEvidenceMode,
    setFireEvidenceMode,
    floodEvidenceMode,
    setFloodEvidenceMode,
    heatEvidenceMode,
    setHeatEvidenceMode,
    droughtEvidenceMode,
    setDroughtEvidenceMode,
    clearAnalysis,
    analysisLoading,
    runAnalysis,
  } = useQueryDraft();
  // UXFIX-01: fixture mode is a dev/test harness — its selector renders only
  // in development or with ?dev=1. Live is the pre-selected product default.
  const devMode = useDevMode();
  // ADR-0045: the "Dev test scenarios" shortcuts need an explicit ?dev=1;
  // plain `next dev` no longer shows them (they are E2E entry points, not a
  // daily development affordance).
  const devUrlMode = useDevUrlMode();

  // SelectionControls controlled state
  const [searchQuery, setSearchQuery] = useState("");
  const [radiusInput, setRadiusInput] = useState("25");
  const [timeType, setTimeType] = useState<TimeRangeType>("latest");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const [questionError, setQuestionError] = useState<string | null>(null);

  // Input drafts may be temporarily invalid, but every accepted canonical
  // selection re-synchronizes both mounted desktop/mobile editors.
  // UXFIX-01: local date drafts hold YYYY-MM-DD values derived from the
  // canonical ISO timestamps.
  useEffect(() => {
    if (!placeSelection) return;
    setRadiusInput(String(placeSelection.analysisArea.radiusKm));
    setTimeType(placeSelection.timeSelection.type);
    setCustomStart(tsToDateInput(placeSelection.timeSelection.startTs));
    setCustomEnd(tsToDateInput(placeSelection.timeSelection.endTs));
  }, [placeSelection]);

  const dateBounds = customDateBounds(
    draft.hazardId,
    draft.hazardId === "fire_smoke"
      ? fireEvidenceMode
      : draft.hazardId === "flood_storm"
        ? floodEvidenceMode
        : draft.hazardId === "extreme_heat"
          ? heatEvidenceMode
          : draft.hazardId === "drought_land"
            ? droughtEvidenceMode
            : null
  );

  // UXFIX-01: One reconciliation effect replaces the previous per-hazard
  // effects. When the hazard or evidence mode makes the current time type
  // unsupported, BOTH the local editor state AND the canonical PlaceSelection
  // are updated together, so the editor never displays a time selection that
  // differs from what will actually be submitted.
  useEffect(() => {
    const allowed = allowedTimeTypesForHazard(
      draft.hazardId,
      fireEvidenceMode,
      floodEvidenceMode,
      heatEvidenceMode,
      droughtEvidenceMode
    );
    if (!allowed || allowed.includes(timeType)) return;

    const targetType: TimeRangeType = allowed.includes("latest") ? "latest" : "custom";
    let nextStart = customStart;
    let nextEnd = customEnd;
    if (targetType === "custom") {
      if (!isDateInputValue(nextStart)) nextStart = dateBounds.defaultDate;
      if (!isDateInputValue(nextEnd)) nextEnd = dateBounds.defaultDate;
      setCustomStart(nextStart);
      setCustomEnd(nextEnd);
    }
    setTimeType(targetType);

    if (placeSelection && placeSelection.timeSelection.type !== targetType) {
      try {
        setPlaceSelection(updateSelectionParams(
          placeSelection,
          placeSelection.analysisArea.radiusKm,
          targetType,
          targetType === "custom" ? dateInputToStartTs(nextStart) : undefined,
          targetType === "custom" ? dateInputToEndTs(nextEnd) : undefined
        ));
      } catch {
        setSelectionError("That time range couldn't be applied. Pick the place and time again.");
      }
    }
  }, [
    draft.hazardId,
    fireEvidenceMode,
    floodEvidenceMode,
    heatEvidenceMode,
    droughtEvidenceMode,
    timeType,
    customStart,
    customEnd,
    dateBounds.defaultDate,
    placeSelection,
    setPlaceSelection,
  ]);

  const ids = {
    heading:          `${idPrefix}query-heading`,
    hazardSelect:     `${idPrefix}hazard-select`,
    concernSelect:    `${idPrefix}concern-select`,
    optionalQuestion: `${idPrefix}optional-question`,
    modeSelect:       `${idPrefix}evidence-mode-select`,
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.hazardId || !draft.concern || !placeSelection) return;

    let optionalQuestion: string | undefined;
    try {
      optionalQuestion = normalizeOptionalQuestion(draft.optionalQuestion);
      setQuestionError(null);
    } catch {
      setQuestionError(
        "Keep your question under 800 characters and remove any unusual characters."
      );
      return;
    }

    const evidenceMode =
      draft.hazardId === "fire_smoke"
        ? fireEvidenceMode
        : draft.hazardId === "flood_storm"
          ? floodEvidenceMode
          : draft.hazardId === "extreme_heat"
            ? heatEvidenceMode
            : draft.hazardId === "drought_land"
              ? droughtEvidenceMode
              : null;

    try {
      await runAnalysis(
        {
          hazardId: draft.hazardId,
          concern: draft.concern,
          placeSelection,
          ...(optionalQuestion ? { optionalQuestion } : {}),
          ...(evidenceMode ? { evidenceMode } : {}),
        },
        "human"
      );
    } catch {
      setQuestionError(
        "The analysis could not be completed. No stale or fixture evidence was substituted."
      );
    }
  }
  function handleSelection(sel: PlaceSelection) {
    setSelectionError(null);
    // Keep the editor draft and canonical selection in the same event update.
    // Relying only on the passive placeSelection effect leaves one painted
    // frame where a fast follow-up edit can still read the previous radius or
    // time and overwrite the user's first change.
    setRadiusInput(String(sel.analysisArea.radiusKm));
    setTimeType(sel.timeSelection.type);
    setCustomStart(tsToDateInput(sel.timeSelection.startTs));
    setCustomEnd(tsToDateInput(sel.timeSelection.endTs));
    setPlaceSelection(sel);
  }

  function handleSelectionError(message: string) {
    setSelectionError(message);
  }

  function clearAllResults() {
    clearAnalysis();
  }

  // ADR-0045: quick-nav targets inside the left column's own scrollport.
  const demoSectionRef = useRef<HTMLDivElement | null>(null);
  const buildSectionRef = useRef<HTMLParagraphElement | null>(null);

  function scrollToSection(ref: React.RefObject<HTMLElement | null>) {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /**
   * ADR-0045: one-tap return to the untouched state. Resets the shared draft,
   * the canonical place selection (both invalidate every hazard result), and
   * this instance's local editor drafts. Dev-only fixture-mode selectors are
   * deliberately left alone — they are a test harness, not query state.
   */
  function handleStartOver() {
    dispatch({ type: "RESET" });
    clearPlaceSelection();
    setSearchQuery("");
    setRadiusInput("25");
    setTimeType("latest");
    setCustomStart("");
    setCustomEnd("");
    setSelectionError(null);
    setQuestionError(null);
  }

  /**
   * ADR-0044: a demo-story choice pre-fills everything except the concern
   * and optional question — place, radius, hazard, live mode (the product
   * default), and the hazard's own date range — then moves focus to the
   * concern, the one decision that stays with the user.
   */
  function handleDemoStorySelect(story: DemoStory, hazard: DemoStoryHazard) {
    clearAllResults();
    try {
      const dates = resolveDemoStoryDates(hazard.preset);
      const sel = buildDemoPlaceSelection(
        demoStoryPlace(story),
        story.radiusKm,
        "custom",
        dateInputToStartTs(dates.startDate),
        dateInputToEndTs(dates.endDate)
      );
      dispatch({ type: "SET_HAZARD", value: hazard.hazardId });
      handleSelection(sel);
      setSearchQuery("");
      setTimeout(() => document.getElementById(ids.concernSelect)?.focus(), 0);
    } catch (e) {
      handleSelectionError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Dev-only test scenarios keep the old place-only shortcut behavior. */
  function handleDemoPlaceOnly(place: DemoPlace) {
    clearAllResults();
    try {
      let sel: PlaceSelection;
      if (timeType === "custom") {
        const fallbackDate = dateBounds.defaultDate;
        let start = isDateInputValue(customStart) ? customStart : fallbackDate;
        const end = isDateInputValue(customEnd) ? customEnd : fallbackDate;
        if (start > end) start = end;
        sel = buildDemoPlaceSelection(
          place,
          parseFloat(radiusInput),
          "custom",
          dateInputToStartTs(start),
          dateInputToEndTs(end)
        );
      } else {
        sel = buildDemoPlaceSelection(place, parseFloat(radiusInput), timeType);
      }
      handleSelection(sel);
    } catch (e) {
      handleSelectionError(e instanceof Error ? e.message : String(e));
    }
  }

  // Mode gating retained from WP-05-004; UXFIX-01 pre-selects "live" so this
  // only blocks if a mode were ever cleared programmatically.
  const submittable =
    isDraftSubmittable(draft, placeSelection) &&
    (draft.hazardId !== "fire_smoke" || fireEvidenceMode !== null) &&
    (draft.hazardId !== "flood_storm" || floodEvidenceMode !== null) &&
    (draft.hazardId !== "extreme_heat" || heatEvidenceMode !== null) &&
    (draft.hazardId !== "drought_land" || droughtEvidenceMode !== null);
  const evidenceLoading = analysisLoading;
  const submitEnabled = submittable && !evidenceLoading;
  // UXFIX-01: tell the user WHY the button is disabled instead of leaving a
  // silently dead control.
  const disabledReason = submittable
    ? null
    : !placeSelection
      ? "Select a location first — search for a place here or click the map."
      : !draft.hazardId
        ? "Choose a hazard (What is happening?)."
        : !draft.concern
          ? "Choose a concern (What matters to you?)."
          : "Choose a data mode.";
  const allowedTimeTypes = allowedTimeTypesForHazard(
    draft.hazardId,
    fireEvidenceMode,
    floodEvidenceMode,
    heatEvidenceMode,
    droughtEvidenceMode
  );
  const usesSingleObservationDate =
    draft.hazardId === "extreme_heat" ||
    draft.hazardId === "drought_land" ||
    draft.hazardId === "air_quality" ||
    draft.hazardId === "earth_volcanoes";

  return (
    <section
      aria-labelledby={ids.heading}
      data-testid="guided-query"
      style={{
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.9rem",
      }}
    >
      <h2
        id={ids.heading}
        style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-secondary)", margin: 0 }}
      >
        What matters?
      </h2>

      {/* ADR-0045: sticky quick-nav — the column is tall enough that the
          two entry points (stories vs. custom form) scroll out of sight.
          Negative margins let the bar span the section's 1rem padding so
          content scrolling underneath is fully covered. */}
      <nav
        aria-label="Query panel sections"
        data-testid={`${idPrefix}gq-quick-nav`}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          margin: "0 -1rem",
          padding: "0.5rem 1rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          background: "var(--surface-1)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <button
          type="button"
          data-testid={`${idPrefix}gq-nav-demo`}
          onClick={() => scrollToSection(demoSectionRef)}
          style={quickNavChipStyle}
        >
          Real events
        </button>
        <button
          type="button"
          data-testid={`${idPrefix}gq-nav-build`}
          onClick={() => scrollToSection(buildSectionRef)}
          style={quickNavChipStyle}
        >
          Ask your own
        </button>
        <button
          type="button"
          data-testid={`${idPrefix}gq-start-over`}
          onClick={handleStartOver}
          style={{
            ...quickNavChipStyle,
            marginLeft: "auto",
            color: "var(--text-secondary)",
          }}
        >
          Start over
        </button>
      </nav>

      {/* ADR-0044: the story gallery sits apart from the custom form; both
          feed the same canonical selection flow. */}
      <div ref={demoSectionRef} style={{ scrollMarginTop: "2.5rem" }}>
        <DemoGallery
          testIdPrefix={`${idPrefix}gq-`}
          activePlaceId={placeSelection?.demoPlaceId}
          devPlaces={devUrlMode
            ? DEMO_PLACES.filter((place) =>
                place.id === "demo-lake-michigan" || place.id === "demo-source-failure")
            : []}
          onSelectStory={handleDemoStorySelect}
          onSelectPlaceOnly={handleDemoPlaceOnly}
        />
      </div>

      <p
        ref={buildSectionRef}
        style={{ fontSize: "14px", color: "var(--text-muted)", margin: 0, scrollMarginTop: "2.5rem" }}
      >
        Or ask your own question:
      </p>

      <form
        onSubmit={handleSubmit}
        noValidate
        onKeyDown={(event) => {
          /*
           * ADR-0049 (owner decision): Enter must never submit this form.
           * Every text input here is inside the form, so implicit submission
           * meant a keystroke in the place, radius, or date field could start
           * a provider call the user never asked for. The CTA is the only way
           * to submit.
           *
           * Scoped to input and select on purpose: Enter in the optional
           * question must still insert a newline, and Enter on a focused
           * button must still activate it (keyboard operability).
           */
          if (event.key !== "Enter") return;
          const target = event.target as HTMLElement;
          if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
            event.preventDefault();
          }
        }}
        style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}
      >
        {/* 1. Hazard */}
        <div>
          <label
            htmlFor={ids.hazardSelect}
            style={{ display: "block", fontSize: "14px", color: "var(--text-secondary)", marginBottom: "4px" }}
          >
            What is happening?
          </label>
          <select
            id={ids.hazardSelect}
            value={draft.hazardId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              dispatch({ type: "SET_HAZARD", value: v ? (v as HazardId) : null });
            }}
            data-testid="hazard-select"
            style={{
              width: "100%",
              padding: "7px 10px",
              fontSize: "14px",
              border: "1px solid var(--border-default)",
              borderRadius: "4px",
              background: "var(--surface-2)",
              color: "var(--text-primary)",
              boxSizing: "border-box",
            }}
          >
            <option value="">Select a hazard…</option>
            {HAZARD_IDS.map((id) => (
              <option key={id} value={id}>
                {HAZARD_LABELS[id]}
              </option>
            ))}
          </select>
        </div>

        {/* Location and one hazard-aware time editor. Time stays hidden until
            the hazard is known, so a generic choice is never replaced by a
            second source-specific date control. */}
        <div style={{ borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px" }}>
          <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: "0 0 6px" }}>
            Select a location{draft.hazardId ? " & time" : ""}:
          </p>
          <SelectionControls
            idPrefix={`${idPrefix}gq-`}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            demoPlaces={[]}
            radiusInput={radiusInput}
            onRadiusInputChange={setRadiusInput}
            timeType={timeType}
            allowedTimeTypes={allowedTimeTypes}
            showTimeControls={draft.hazardId !== null}
            customDateMode={usesSingleObservationDate ? "single" : "range"}
            minDate={dateBounds.minDate}
            maxDate={dateBounds.maxDate}
            maxRangeDays={draft.hazardId === "flood_storm" ? FLOOD_MAX_RANGE_DAYS : undefined}
            onTimeTypeChange={(value) => {
              clearAnalysis();
              setTimeType(value);
            }}
            customStart={customStart}
            onCustomStartChange={(value) => {
              clearAnalysis();
              setCustomStart(value);
            }}
            customEnd={customEnd}
            onCustomEndChange={(value) => {
              clearAnalysis();
              setCustomEnd(value);
            }}
            currentSelection={placeSelection}
            onError={handleSelectionError}
            onSelection={handleSelection}
          />
          {selectionError && (
            <div
              role="alert"
              data-testid="guided-query-selection-error"
              style={{
                fontSize: "14px",
                color: "var(--status-error-fg)",
                background: "var(--status-error-bg)",
                border: "1px solid var(--status-error-border)",
                borderRadius: "4px",
                padding: "7px 10px",
                marginTop: "6px",
              }}
            >
              {selectionError}
            </div>
          )}
        </div>

        {/* 2. Concern */}
        <div>
          <label
            htmlFor={ids.concernSelect}
            style={{ display: "block", fontSize: "14px", color: "var(--text-secondary)", marginBottom: "4px" }}
          >
            What matters to you?
          </label>
          <select
            id={ids.concernSelect}
            value={draft.concern ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              dispatch({ type: "SET_CONCERN", value: v ? (v as ConcernType) : null });
            }}
            data-testid="concern-select"
            style={{
              width: "100%",
              padding: "7px 10px",
              fontSize: "14px",
              border: "1px solid var(--border-default)",
              borderRadius: "4px",
              background: "var(--surface-2)",
              color: "var(--text-primary)",
              boxSizing: "border-box",
            }}
          >
            <option value="">Select a concern…</option>
            {CONCERN_TYPES.map((c) => (
              <option key={c} value={c}>
                {CONCERN_LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        {/* 3. Optional question */}
        <div>
          <label
            htmlFor={ids.optionalQuestion}
            style={{ display: "block", fontSize: "14px", color: "var(--text-secondary)", marginBottom: "4px" }}
          >
            Question (optional)
          </label>
          <textarea
            id={ids.optionalQuestion}
            rows={2}
            maxLength={800}
            placeholder="e.g. Could recent wildfire smoke affect my dog's outdoor activity?"
            value={draft.optionalQuestion}
            onChange={(e) => {
              setQuestionError(null);
              dispatch({ type: "SET_OPTIONAL_QUESTION", value: e.target.value });
            }}
            aria-invalid={questionError !== null}
            aria-describedby={questionError ? `${idPrefix}question-error` : undefined}
            data-testid="optional-question"
            style={{
              width: "100%",
              padding: "7px 10px",
              fontSize: "14px",
              border: "1px solid var(--border-default)",
              borderRadius: "4px",
              background: "var(--surface-2)",
              color: "var(--text-primary)",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          {questionError && (
            <p
              id={`${idPrefix}question-error`}
              role="alert"
              data-testid="optional-question-error"
              style={{ fontSize: "14px", color: "var(--status-error-fg, #dc2626)", margin: "4px 0 0" }}
            >
              {questionError}
            </p>
          )}
        </div>

        {/* 4. Evidence mode — live is the product default (UXFIX-01).
            The fixture test harness selector renders only in dev mode. */}
        {devMode && draft.hazardId === "fire_smoke" && (
          <div>
            <label
              htmlFor={ids.modeSelect}
              style={{ display: "block", fontSize: "14px", color: "var(--text-secondary)", marginBottom: "4px" }}
            >
              Data mode <span style={{ color: "var(--status-error-fg, #dc2626)" }}>*</span>
            </label>
            <select
              id={ids.modeSelect}
              value={fireEvidenceMode ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "live" || v === "fixture") {
                  setFireEvidenceMode(v as FireEvidenceMode);
                }
              }}
              data-testid="fire-mode-select"
              aria-required="true"
              style={{
                width: "100%",
                padding: "7px 10px",
                fontSize: "14px",
                border: "1px solid var(--border-default)",
                borderRadius: "4px",
                background: "var(--surface-2)",
                color: "var(--text-primary)",
                boxSizing: "border-box",
              }}
            >
              <option value="">Choose a data mode…</option>
              <option value="live">
                Live retrieval — source-supported fire history
              </option>
              <option value="fixture">
                Fixture — deterministic test data (2025-01-08)
              </option>
            </select>
            <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: "3px 0 0" }}>
              Live mode supports Latest completed day, Past 7 days, and custom 1–7 UTC-day ranges.
              Fixture mode remains pinned to 2025-01-08. Incomplete today is never presented as a completed observation.
            </p>
          </div>
        )}

        {devMode && draft.hazardId === "flood_storm" && (
          <div>
            <label
              htmlFor={ids.modeSelect}
              style={{ display: "block", fontSize: "14px", color: "var(--text-secondary)", marginBottom: "4px" }}
            >
              Data mode <span style={{ color: "var(--status-error-fg, #dc2626)" }}>*</span>
            </label>
            <select
              id={ids.modeSelect}
              value={floodEvidenceMode ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "live" || value === "fixture") {
                  setFloodEvidenceMode(value as FloodEvidenceMode);
                }
              }}
              data-testid="flood-mode-select"
              aria-required="true"
              style={{
                width: "100%",
                padding: "7px 10px",
                fontSize: "14px",
                border: "1px solid var(--border-default)",
                borderRadius: "4px",
                background: "var(--surface-2)",
                color: "var(--text-primary)",
                boxSizing: "border-box",
              }}
            >
              <option value="">Choose a data mode...</option>
              <option value="live">Live retrieval - NASA GIBS and USGS Water Data</option>
              <option value="fixture">Fixture - deterministic Houston cases</option>
            </select>
            <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: "3px 0 0" }}>
              Live mode accepts custom 1-7 completed UTC dates. Fixture mode accepts the
              pinned Houston case on {FLOOD_PINNED_FIXTURE_DATE} and an explicit unsupported
              coverage case on {FLOOD_UNSUPPORTED_FIXTURE_DATE}. No missing data is treated as safety.
            </p>
          </div>
        )}

        {devMode && draft.hazardId === "extreme_heat" && (
          <div>
            <label
              htmlFor={ids.modeSelect}
              style={{ display: "block", fontSize: "14px", color: "var(--text-secondary)", marginBottom: "4px" }}
            >
              Data mode <span style={{ color: "var(--status-error-fg, #dc2626)" }}>*</span>
            </label>
            <select
              id={ids.modeSelect}
              value={heatEvidenceMode ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "live" || value === "fixture") {
                  setHeatEvidenceMode(value as HeatEvidenceMode);
                }
              }}
              data-testid="heat-mode-select"
              aria-required="true"
              style={{
                width: "100%",
                padding: "7px 10px",
                fontSize: "14px",
                border: "1px solid var(--border-default)",
                borderRadius: "4px",
                background: "var(--surface-2)",
                color: "var(--text-primary)",
                boxSizing: "border-box",
              }}
            >
              <option value="">Choose a data mode...</option>
              <option value="live">Live retrieval - NASA GIBS and NOAA USCRN</option>
              <option value="fixture">Fixture - deterministic Tucson cases</option>
            </select>
            <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: "3px 0 0" }}>
              One completed UTC date only. Fixture success is pinned to {HEAT_PINNED_FIXTURE_DATE};
              {" "}the unsupported-coverage case is {HEAT_UNSUPPORTED_FIXTURE_DATE}. Satellite surface
              visualization, outdoor air temperature, and heat index remain separate.
            </p>
          </div>
        )}

        {devMode && draft.hazardId === "drought_land" && (
          <div>
            <label
              htmlFor={ids.modeSelect}
              style={{ display: "block", fontSize: "14px", color: "var(--text-secondary)", marginBottom: "4px" }}
            >
              Data mode <span style={{ color: "var(--status-error-fg, #dc2626)" }}>*</span>
            </label>
            <select
              id={ids.modeSelect}
              value={droughtEvidenceMode ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "live" || value === "fixture") {
                  setDroughtEvidenceMode(value as DroughtEvidenceMode);
                }
              }}
              data-testid="drought-mode-select"
              aria-required="true"
              style={{
                width: "100%",
                padding: "7px 10px",
                fontSize: "14px",
                border: "1px solid var(--border-default)",
                borderRadius: "4px",
                background: "var(--surface-2)",
                color: "var(--text-primary)",
                boxSizing: "border-box",
              }}
            >
              <option value="">Choose a data mode...</option>
              <option value="live">Live retrieval - NASA GIBS and U.S. Drought Monitor</option>
              <option value="fixture">Fixture - deterministic Tucson/Arizona case</option>
            </select>
            <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: "3px 0 0" }}>
              One completed UTC date only. Every selection uses its validated area. MODIS vegetation
              imagery is available more broadly; regional drought confirmation still has visible gaps.
            </p>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={!submitEnabled}
          aria-disabled={!submitEnabled}
          aria-busy={evidenceLoading}
          aria-live="polite"
          data-testid="find-evidence-btn"
          style={{
            padding: "8px 16px",
            fontSize: "14px",
            fontWeight: 600,
            border: "1px solid var(--border-default)",
            borderRadius: "4px",
            background: submitEnabled
              ? "var(--focus-ring)"
              : "var(--surface-3)",
            color: submitEnabled ? "#ffffff" : "var(--text-muted)",
            cursor: submitEnabled ? "pointer" : evidenceLoading ? "wait" : "not-allowed",
          }}
        >
          {evidenceLoading ? "Finding and explaining evidence…" : "Get evidence-based answer"}
        </button>

        {/* UXFIX-01: explain a disabled button instead of leaving it dead. */}
        {!evidenceLoading && !submittable && disabledReason && (
          <p
            data-testid="submit-hint"
            role="status"
            style={{ fontSize: "14px", color: "var(--text-muted)", margin: "2px 0 0" }}
          >
            {disabledReason}
          </p>
        )}
      </form>

    </section>
  );
}
