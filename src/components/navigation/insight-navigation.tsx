"use client";
/**
 * src/components/navigation/insight-navigation.tsx
 *
 * Meaning / Evidence / Missions tab navigation.
 *
 * - Implemented as a tab widget: role="tablist", role="tab", role="tabpanel".
 * - Arrow-key navigation (left/right) within the tab list.
 * - aria-selected and tabIndex managed correctly.
 * - Tab panels are labelled by their corresponding tab.
 * - `idPrefix` keeps tab/panel element IDs unique across desktop and mobile
 *   instances that coexist in the DOM.
 *
 * WP-05: When a fire evidence result is present in QueryProvider, the
 * Meaning, Evidence, and Missions panels render the validated fire evidence.
 * Other hazards retain the not-connected placeholder.
 */

import React, { useEffect, useState, useRef } from "react";
import { useQueryDraft } from "@/components/query/query-provider";
import { FireEvidenceInsightPanel } from "@/components/fire/fire-evidence-panel";
import { FloodEvidenceInsightPanel } from "@/components/flood/flood-evidence-panel";
import { HeatEvidenceInsightPanel } from "@/components/heat/heat-evidence-panel";
import { DroughtEvidenceInsightPanel } from "@/components/drought/drought-evidence-panel";
import { CoverageGapInsightPanel } from "@/components/coverage-gap/coverage-gap-panel";
import { ResultFailureGapBoundary } from "@/components/states/result-failure-gap-boundary";
import { PipelineLoading } from "@/components/states/pipeline-loading";
import { RadiusScopeNote } from "@/components/states/radius-scope-note";
import type { MissionSelectionState } from "@/components/missions/mission-selection";

export type InsightTab = "meaning" | "evidence" | "missions";

const TABS: { id: InsightTab; label: string }[] = [
  { id: "meaning", label: "Meaning" },
  { id: "evidence", label: "Evidence" },
  { id: "missions", label: "Missions" },
];

interface InsightNavigationProps {
  /** Prefix for tab/panel element IDs; keeps IDs unique in the DOM. */
  idPrefix: string;
  /** Optional controlled selected tab */
  selectedTab?: InsightTab;
  /** Called when tab changes */
  onTabChange?: (tab: InsightTab) => void;
}

export function InsightNavigation({ idPrefix, selectedTab, onTabChange }: InsightNavigationProps) {
  const [internalTab, setInternalTab] = useState<InsightTab>("meaning");
  const [missionSelection, setMissionSelection] = useState<MissionSelectionState>({});
  const active = selectedTab ?? internalTab;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // ADR-0047: switching tabs is navigation, not a reset. A panel mounts the
  // first time its tab is opened and then stays mounted (hidden via the
  // `hidden` attribute), so disclosure state survives tab switches. Panels
  // stay lazy before first visit because the Missions panel loads imagery.
  const [visited, setVisited] = useState<ReadonlySet<InsightTab>>(() => new Set([active]));
  useEffect(() => {
    setVisited((current) =>
      current.has(active) ? current : new Set(current).add(active)
    );
  }, [active]);

  // A new query result must reset the panels (old expansion positions are
  // meaningless against new content). The per-hazard generation counters in
  // QueryProvider are non-reactive refs, so the epoch is derived from the
  // result references instead and used as a remount key.
  const {
    fireResult,
    floodResult,
    heatResult,
    droughtResult,
    coverageGapResult,
    placeSelection,
  } = useQueryDraft();
  const results = [fireResult, floodResult, heatResult, droughtResult, coverageGapResult];
  // ADR-0049: the active result backs the Meaning-tab radius note. Only one
  // hazard result is ever populated for a given query.
  const activeResult = results.find((result) => result !== null) ?? undefined;
  const [resultEpoch, setResultEpoch] = useState(0);
  const prevResultsRef = useRef(results);
  useEffect(() => {
    if (results.some((result, i) => result !== prevResultsRef.current[i])) {
      prevResultsRef.current = results;
      setResultEpoch((epoch) => epoch + 1);
    }
  });

  function handleTabClick(id: InsightTab) {
    setInternalTab(id);
    onTabChange?.(id);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const currentIndex = TABS.findIndex((t) => t.id === active);
    if (e.key === "ArrowRight") {
      const next = TABS[(currentIndex + 1) % TABS.length];
      handleTabClick(next.id);
      tabRefs.current[(currentIndex + 1) % TABS.length]?.focus();
    } else if (e.key === "ArrowLeft") {
      const prev = TABS[(currentIndex - 1 + TABS.length) % TABS.length];
      handleTabClick(prev.id);
      tabRefs.current[(currentIndex - 1 + TABS.length) % TABS.length]?.focus();
    }
  }

  return (
    <div data-testid="insight-navigation">
      {/* Tab list */}
      <div
        role="tablist"
        aria-label="Insight navigation"
        onKeyDown={handleKeyDown}
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border-default)",
          gap: "0",
        }}
      >
        {TABS.map((tab, i) => (
          <button
            key={tab.id}
            role="tab"
            id={`${idPrefix}tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`${idPrefix}panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            ref={(el) => { tabRefs.current[i] = el; }}
            onClick={() => handleTabClick(tab.id)}
            data-testid={`tab-${tab.id}`}
            style={{
              padding: "9px 16px",
              fontSize: "14px",
              fontWeight: active === tab.id ? 600 : 400,
              border: "none",
              borderBottom: active === tab.id
                ? "2px solid var(--text-link)"
                : "2px solid transparent",
              background: "transparent",
              color: active === tab.id ? "var(--text-primary)" : "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {TABS.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${idPrefix}panel-${tab.id}`}
          aria-labelledby={`${idPrefix}tab-${tab.id}`}
          hidden={active !== tab.id}
          data-testid={`panel-${tab.id}`}
          style={{ padding: "1.1rem 1.2rem" }}
        >
          {visited.has(tab.id) && (
            <>
              <InsightPanelContent
                key={resultEpoch}
                tab={tab.id}
                missionSelection={missionSelection}
                onMissionSelectionChange={setMissionSelection}
              />
              {tab.id === "meaning" && (
                <RadiusScopeNote
                  evidence={activeResult?.evidence}
                  placeSelection={placeSelection}
                />
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function InsightPanelContent({
  tab,
  missionSelection,
  onMissionSelectionChange,
}: {
  tab: InsightTab;
  missionSelection: MissionSelectionState;
  onMissionSelectionChange: (selection: MissionSelectionState) => void;
}) {
  const {
    draft,
    fireResult,
    fireLoading,
    floodResult,
    floodLoading,
    heatResult,
    heatLoading,
    droughtResult,
    droughtLoading,
    coverageGapResult,
    coverageGapLoading,
  } = useQueryDraft();

  if (
    (draft.hazardId === "air_quality" || draft.hazardId === "earth_volcanoes") &&
    coverageGapLoading
  ) {
    return <PipelineLoading testId="coverage-gap-panel-loading" />;
  }

  if (coverageGapResult !== null) {
    return (
      <ResultFailureGapBoundary result={coverageGapResult} tab={tab}>
        <CoverageGapInsightPanel
          result={coverageGapResult}
          tab={tab}
          missionSelection={missionSelection}
          onMissionSelectionChange={onMissionSelectionChange}
        />
      </ResultFailureGapBoundary>
    );
  }

  if (draft.hazardId === "drought_land" && droughtLoading) {
    return <PipelineLoading testId="drought-panel-loading" />;
  }

  if (droughtResult !== null) {
    return (
      <ResultFailureGapBoundary result={droughtResult} tab={tab}>
        <DroughtEvidenceInsightPanel
          result={droughtResult}
          tab={tab}
          missionSelection={missionSelection}
          onMissionSelectionChange={onMissionSelectionChange}
        />
      </ResultFailureGapBoundary>
    );
  }

  if (draft.hazardId === "extreme_heat" && heatLoading) {
    return <PipelineLoading testId="heat-panel-loading" />;
  }

  if (heatResult !== null) {
    return (
      <ResultFailureGapBoundary result={heatResult} tab={tab}>
        <HeatEvidenceInsightPanel
          result={heatResult}
          tab={tab}
          missionSelection={missionSelection}
          onMissionSelectionChange={onMissionSelectionChange}
        />
      </ResultFailureGapBoundary>
    );
  }

  if (draft.hazardId === "flood_storm" && floodLoading) {
    return <PipelineLoading testId="flood-panel-loading" />;
  }

  if (floodResult !== null) {
    return (
      <ResultFailureGapBoundary result={floodResult} tab={tab}>
        <FloodEvidenceInsightPanel
          result={floodResult}
          tab={tab}
          missionSelection={missionSelection}
          onMissionSelectionChange={onMissionSelectionChange}
        />
      </ResultFailureGapBoundary>
    );
  }

  if (draft.hazardId === "fire_smoke" && fireLoading) {
    return <PipelineLoading testId="fire-panel-loading" />;
  }

  // WP-05: show fire evidence panels when a result is available
  if (fireResult !== null) {
    return (
      <ResultFailureGapBoundary result={fireResult} tab={tab}>
        <FireEvidenceInsightPanel
          result={fireResult}
          tab={tab}
          missionSelection={missionSelection}
          onMissionSelectionChange={onMissionSelectionChange}
        />
      </ResultFailureGapBoundary>
    );
  }

  if (tab === "meaning") {
    // PR: ui-polish — the empty state gives the first-visit eye a path to
    // follow instead of a paragraph. Keeps the testid and the literal
    // "Get evidence-based answer" phrase the shell e2e asserts on.
    const steps = [
      "Start from a real event, or pick any place on the map",
      "Choose what matters to you: home, health, pets, travel",
      "Select Get evidence-based answer",
    ];
    return (
      <div
        role="status"
        data-testid="meaning-empty-prompt"
        style={{ display: "grid", gap: "12px", fontSize: "14px", color: "var(--text-secondary)" }}
      >
        <p style={{ margin: 0, lineHeight: 1.55 }}>
          Meaning answers your question in plain English, grounded in validated
          observations, with clear limitations and useful next checks.
        </p>
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "8px" }}>
          {steps.map((step, index) => (
            <li key={step} style={{ display: "flex", alignItems: "flex-start", gap: "9px" }}>
              <span
                aria-hidden="true"
                style={{
                  width: "22px",
                  height: "22px",
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "14px",
                  fontWeight: 600,
                  borderRadius: "50%",
                  border: "1.5px solid var(--border-default)",
                  color: "var(--text-primary)",
                }}
              >
                {index + 1}
              </span>
              <span style={{ lineHeight: 1.45 }}>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (tab === "evidence") {
    return (
      <p
        role="status"
        data-testid="evidence-empty-prompt"
        style={{ color: "var(--text-secondary)", fontSize: "14px", margin: 0 }}
      >
        Evidence is the audit trail: the exact datasets, observation times,
        values, and limitations behind each answer, including any no-data
        state. Ask a question first to create a result.
      </p>
    );
  }
  return (
    <p
      role="status"
      data-testid="missions-empty-prompt"
      style={{ color: "var(--text-secondary)", fontSize: "14px", margin: 0 }}
      >
      Missions gives background on the satellites, sensors, and agencies behind
      the evidence, with clearly labelled example imagery. Ask a question first
      to create a result.
    </p>
  );
}
