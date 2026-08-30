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

import React, { useEffect, useMemo, useState, useRef } from "react";
import { useQueryDraft } from "@/components/query/query-provider";
import { FireEvidenceInsightPanel } from "@/components/fire/fire-evidence-panel";
import { FloodEvidenceInsightPanel } from "@/components/flood/flood-evidence-panel";
import { StormEvidenceInsightPanel } from "@/components/storm/storm-evidence-panel";
import { HeatEvidenceInsightPanel } from "@/components/heat/heat-evidence-panel";
import { DroughtEvidenceInsightPanel } from "@/components/drought/drought-evidence-panel";
import { CoverageGapInsightPanel } from "@/components/coverage-gap/coverage-gap-panel";
import { ResultFailureGapBoundary } from "@/components/states/result-failure-gap-boundary";
import { PipelineLoading } from "@/components/states/pipeline-loading";
import { RadiusScopeNote } from "@/components/states/radius-scope-note";
import type { MissionSelectionState } from "@/components/missions/mission-selection";
import { HAZARD_LABELS } from "@/lib/ui/query-draft";
import {
  formatAnalysisPlace,
  formatAnalysisTime,
  summarizeAnalysisTrust,
} from "@/lib/analysis/presentation";
import type { ActiveAnalysis } from "@/lib/analysis/types";

export type InsightTab = "meaning" | "evidence" | "missions";

const TABS: { id: InsightTab; label: string }[] = [
  { id: "meaning", label: "Meaning" },
  { id: "evidence", label: "Evidence" },
  { id: "missions", label: "Missions" },
];

const KEEP_CLOSED = () => undefined;

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
  const [pendingChainTarget, setPendingChainTarget] = useState<string | null>(null);
  useEffect(() => {
    setVisited((current) =>
      current.has(active) ? current : new Set(current).add(active)
    );
  }, [active]);

  useEffect(() => {
    if (
      active !== "evidence" ||
      pendingChainTarget === null ||
      !visited.has("evidence")
    ) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = document.getElementById(`${idPrefix}panel-evidence`);
      const target = panel?.querySelector<HTMLElement>(
        `[data-testid="${pendingChainTarget}"]`
      );
      if (!target) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      setPendingChainTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, idPrefix, pendingChainTarget, visited]);

  // A new query result must reset the panels (old expansion positions are
  // meaningless against new content). The per-hazard generation counters in
  // QueryProvider are non-reactive refs, so the epoch is derived from the
  // result references instead and used as a remount key.
  const {
    fireResult,
    floodResult,
    windResult,
    heatResult,
    droughtResult,
    coverageGapResult,
    placeSelection,
    activeAnalysis,
    relatedAnalyses,
    previousAnalysis,
    agentInvestigation,
    restorePreviousAnalysis,
  } = useQueryDraft();
  const trustSummary = useMemo(
    () => activeAnalysis ? summarizeAnalysisTrust(activeAnalysis) : null,
    [activeAnalysis]
  );
  const results = useMemo(
    () => [fireResult, floodResult, windResult, heatResult, droughtResult, coverageGapResult],
    [
      fireResult,
      floodResult,
      windResult,
      heatResult,
      droughtResult,
      coverageGapResult,
    ]
  );
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
  }, [results]);

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

  function handleRestorePreviousView() {
    if (restorePreviousAnalysis()) handleTabClick("meaning");
  }

  const agentBundleAnalyses = activeAnalysis?.request.evidenceBundle?.role === "primary"
    ? [activeAnalysis, ...relatedAnalyses].sort((left, right) =>
        (left.request.evidenceBundle?.scenarioOrder ?? 0) -
          (right.request.evidenceBundle?.scenarioOrder ?? 0) ||
        left.analysisId.localeCompare(right.analysisId)
      )
    : [];
  const isComparison = activeAnalysis?.request.evidenceBundle?.investigationKind === "comparison";

  function chainTargetTestId(analysis: ActiveAnalysis, isPrimary: boolean): string {
    if (analysis.request.evidenceBundle?.investigationKind === "comparison") {
      return `agent-chain-${analysis.analysisId}`;
    }
    return isPrimary
      ? `primary-${analysis.outcome.hazardId}-evidence-chain`
      : activeAnalysis?.outcome.hazardId === "wind_storm" &&
          analysis.outcome.hazardId === "flood_storm"
        ? "related-flood-evidence-chain"
        : `related-${analysis.outcome.hazardId}-evidence-chain`;
  }

  function handleAgentChainResult(analysis: ActiveAnalysis) {
    const isPrimary = analysis.analysisId === activeAnalysis?.analysisId;
    const targetTestId = chainTargetTestId(analysis, isPrimary);
    setPendingChainTarget(targetTestId);
    handleTabClick("evidence");
  }

  return (
    <div data-testid="insight-navigation">
      {(activeAnalysis?.origin === "agent" || agentInvestigation !== null) && (
        <section
          aria-label="Agent action"
          data-testid="agent-analysis-notice"
          style={{
            margin: "10px 12px 0",
            padding: "9px 10px",
            border: "1px solid var(--border-default)",
            borderRadius: "8px",
            background: "var(--surface-2)",
            color: "var(--text-secondary)",
            fontSize: "13px",
            lineHeight: 1.45,
          }}
        >
          <p role="status" style={{ margin: 0 }}>
            <strong style={{ color: "var(--text-primary)" }}>
              {agentInvestigation?.phase === "complete"
                ? "Agent made this view more useful"
                : "Agent is investigating for you"}
            </strong>
          </p>
          {agentInvestigation && agentInvestigation.phase !== "complete" && (
            <div data-testid="agent-investigation-progress" style={{ marginTop: "6px" }}>
              <p style={{ margin: "0 0 4px" }}>
                {agentInvestigation.phase === "planning"
                  ? `Planning ${agentInvestigation.totalChains} evidence checks…`
                  : agentInvestigation.phase === "synthesizing"
                    ? "Comparing direct observations, source gaps, and limitations…"
                    : `Checking official sources · ${agentInvestigation.completedChains}/${agentInvestigation.totalChains} evidence chains complete`}
              </p>
              <progress
                aria-label="Agent investigation progress"
                value={agentInvestigation.completedChains}
                max={agentInvestigation.totalChains}
                style={{ width: "100%" }}
              />
            </div>
          )}
          {activeAnalysis && (
            <p
              data-testid="agent-analysis-receipt"
              style={{ margin: "3px 0 0", color: "var(--text-primary)" }}
            >
              {isComparison
                ? `Compared ${agentInvestigation?.scenarioLabels.length || 2} scenarios across ${agentBundleAnalyses.length} separate evidence chains`
                : `${HAZARD_LABELS[activeAnalysis.request.hazardId]} · ${formatAnalysisPlace(activeAnalysis)} · ${formatAnalysisTime(activeAnalysis)}`}
            </p>
          )}
          {activeAnalysis?.request.evidenceBundle?.role === "primary" && !isComparison && (
            <p data-testid="agent-related-context-receipt" style={{ margin: "3px 0 0" }}>
              Related context also checked: {activeAnalysis.request.evidenceBundle.includedHazardIds
                .filter((hazardId) => hazardId !== activeAnalysis.request.hazardId)
                .map((hazardId) => HAZARD_LABELS[hazardId])
                .join(", ")}. Compare their timing, strength, and confidence to see how much they reinforce the concern.
            </p>
          )}
          {agentBundleAnalyses.length > 0 ? (
            <div data-testid="agent-chain-result-summary" style={{ marginTop: "8px" }}>
              <p style={{ margin: "0 0 7px" }}>
                With Agent help, this interface checked {agentBundleAnalyses.length} separate evidence chains
                together, summarized the complete investigation, and kept every result available for review.
              </p>
              <ul style={{ display: "grid", gap: "7px", margin: 0, padding: 0, listStyle: "none" }}>
                {agentBundleAnalyses.map((analysis) => {
                  const summary = summarizeAnalysisTrust(analysis);
                  return (
                    <li
                      key={analysis.analysisId}
                      data-testid={isComparison
                        ? `agent-${analysis.request.evidenceBundle?.scenarioId}-${analysis.outcome.hazardId}-result-summary`
                        : `agent-${analysis.outcome.hazardId}-result-summary`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: "6px",
                        padding: "7px 8px",
                        border: "1px solid var(--border-default)",
                        borderRadius: "6px",
                        background: "var(--surface-1)",
                      }}
                    >
                      <span>
                        {isComparison && (
                          <small style={{ display: "block", color: "var(--text-secondary)" }}>
                            {analysis.request.evidenceBundle?.scenarioLabel}
                          </small>
                        )}
                        <strong style={{ color: "var(--text-primary)" }}>
                          {HAZARD_LABELS[analysis.outcome.hazardId]}
                        </strong>{" "}
                        · {summary.stateLabel} · {summary.sourceCount}{" "}
                        {summary.sourceCount === 1 ? "source" : "sources"}
                      </span>
                      <button
                        type="button"
                        data-testid={isComparison
                          ? `agent-view-${analysis.request.evidenceBundle?.scenarioId}-${analysis.outcome.hazardId}-result`
                          : `agent-view-${analysis.outcome.hazardId}-result`}
                        onClick={() => handleAgentChainResult(analysis)}
                        style={{
                          padding: "5px 8px",
                          border: "1px solid var(--border-default)",
                          borderRadius: "6px",
                          background: "var(--surface-2)",
                          color: "var(--text-link)",
                          cursor: "pointer",
                        }}
                      >
                        View {HAZARD_LABELS[analysis.outcome.hazardId]} result
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : activeAnalysis ? (
            <p style={{ margin: "3px 0 0" }}>
              The map and Insight now share this result. The strongest evidence and citations are ready to review.
            </p>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginTop: "8px" }}>
            {activeAnalysis && agentBundleAnalyses.length === 0 && (
              <button
                type="button"
                data-testid="agent-view-evidence"
                onClick={() => handleTabClick("evidence")}
                style={{
                  padding: "5px 8px",
                  border: "1px solid var(--border-default)",
                  borderRadius: "6px",
                  background: "var(--surface-1)",
                  color: "var(--text-link)",
                  cursor: "pointer",
                }}
              >
                View evidence
              </button>
            )}
            {previousAnalysis && (
              <button
                type="button"
                data-testid="agent-restore-previous"
                onClick={handleRestorePreviousView}
                style={{
                  padding: "5px 8px",
                  border: "1px solid var(--border-default)",
                  borderRadius: "6px",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                }}
              >
                Restore previous view
              </button>
            )}
          </div>
        </section>
      )}
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
              {tab.id === "meaning" && trustSummary && (
                <section
                  aria-label="Evidence status"
                  data-testid="analysis-trust-strip"
                  style={{
                    display: "grid",
                    gap: "5px",
                    marginBottom: "12px",
                    padding: "9px 10px",
                    border: "1px solid var(--border-default)",
                    borderRadius: "8px",
                    background: "var(--surface-2)",
                    color: "var(--text-secondary)",
                    fontSize: "13px",
                    lineHeight: 1.45,
                  }}
                >
                  <p style={{ margin: 0 }}>
                    <strong style={{ color: "var(--text-primary)" }}>
                      {trustSummary.stateLabel}
                    </strong>{" "}
                    · {trustSummary.sourceCount}{" "}
                    {trustSummary.sourceCount === 1 ? "source" : "sources"} ·{" "}
                    {trustSummary.limitationCount}{" "}
                    {trustSummary.limitationCount === 1 ? "limitation" : "limitations"}
                  </p>
                  {trustSummary.showNoDangerReminder && (
                    <p data-testid="analysis-no-danger-reminder" style={{ margin: 0 }}>
                      Missing, incomplete, or quiet evidence does not mean no danger.
                    </p>
                  )}
                  <button
                    type="button"
                    data-testid="trust-strip-view-evidence"
                    onClick={() => handleTabClick("evidence")}
                    style={{
                      justifySelf: "start",
                      padding: 0,
                      border: 0,
                      background: "transparent",
                      color: "var(--text-link)",
                      textDecoration: "underline",
                      cursor: "pointer",
                    }}
                  >
                    View complete evidence
                  </button>
                </section>
              )}
              <div
                data-testid={activeAnalysis
                  ? chainTargetTestId(activeAnalysis, true)
                  : undefined}
                tabIndex={activeAnalysis ? -1 : undefined}
              >
                <InsightPanelContent
                  key={resultEpoch}
                  tab={tab.id}
                  missionSelection={missionSelection}
                  onMissionSelectionChange={setMissionSelection}
                />
              </div>
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
    relatedStormFloodResult,
    relatedAnalyses,
    windResult,
    windLoading,
    stormClaimDiscussionOpen,
    setStormClaimDiscussionOpen,
    heatResult,
    heatLoading,
    droughtResult,
    droughtLoading,
    coverageGapResult,
    coverageGapLoading,
  } = useQueryDraft();

  const relatedPanels = (
    <RelatedEvidenceChains
      analyses={relatedAnalyses.filter(
        (analysis) =>
          analysis.request.evidenceBundle?.investigationKind === "comparison" ||
          !(windResult !== null && analysis.outcome.hazardId === "flood_storm")
      )}
      tab={tab}
      missionSelection={missionSelection}
      onMissionSelectionChange={onMissionSelectionChange}
    />
  );

  if (
    (draft.hazardId === "air_quality" || draft.hazardId === "earth_volcanoes") &&
    coverageGapLoading
  ) {
    return <PipelineLoading testId="coverage-gap-panel-loading" />;
  }

  if (coverageGapResult !== null) {
    return (
      <>
        <ResultFailureGapBoundary result={coverageGapResult} tab={tab}>
          <CoverageGapInsightPanel
            result={coverageGapResult}
            tab={tab}
            missionSelection={missionSelection}
            onMissionSelectionChange={onMissionSelectionChange}
          />
        </ResultFailureGapBoundary>
        {relatedPanels}
      </>
    );
  }

  if (draft.hazardId === "drought_land" && droughtLoading) {
    return <PipelineLoading testId="drought-panel-loading" />;
  }

  if (droughtResult !== null) {
    return (
      <>
        <ResultFailureGapBoundary result={droughtResult} tab={tab}>
          <DroughtEvidenceInsightPanel
            result={droughtResult}
            tab={tab}
            missionSelection={missionSelection}
            onMissionSelectionChange={onMissionSelectionChange}
          />
        </ResultFailureGapBoundary>
        {relatedPanels}
      </>
    );
  }

  if (draft.hazardId === "extreme_heat" && heatLoading) {
    return <PipelineLoading testId="heat-panel-loading" />;
  }

  if (heatResult !== null) {
    return (
      <>
        <ResultFailureGapBoundary result={heatResult} tab={tab}>
          <HeatEvidenceInsightPanel
            result={heatResult}
            tab={tab}
            missionSelection={missionSelection}
            onMissionSelectionChange={onMissionSelectionChange}
          />
        </ResultFailureGapBoundary>
        {relatedPanels}
      </>
    );
  }

  if (draft.hazardId === "flood_storm" && floodLoading) {
    return <PipelineLoading testId="flood-panel-loading" />;
  }

  if (draft.hazardId === "wind_storm" && windLoading) {
    return <PipelineLoading testId="wind-panel-loading" />;
  }

  if (windResult !== null) {
    return (
      <>
        <ResultFailureGapBoundary result={windResult} tab={tab}>
          <StormEvidenceInsightPanel
            result={windResult}
            tab={tab}
            claimDiscussionOpen={stormClaimDiscussionOpen}
            onClaimDiscussionOpenChange={setStormClaimDiscussionOpen}
            relatedFloodResult={relatedStormFloodResult}
            missionSelection={missionSelection}
            onMissionSelectionChange={onMissionSelectionChange}
          />
        </ResultFailureGapBoundary>
        {relatedPanels}
      </>
    );
  }

  if (floodResult !== null) {
    return (
      <>
        <ResultFailureGapBoundary result={floodResult} tab={tab}>
          <FloodEvidenceInsightPanel
            result={floodResult}
            tab={tab}
            missionSelection={missionSelection}
            onMissionSelectionChange={onMissionSelectionChange}
          />
        </ResultFailureGapBoundary>
        {relatedPanels}
      </>
    );
  }

  if (draft.hazardId === "fire_smoke" && fireLoading) {
    return <PipelineLoading testId="fire-panel-loading" />;
  }

  // WP-05: show fire evidence panels when a result is available
  if (fireResult !== null) {
    return (
      <>
        <ResultFailureGapBoundary result={fireResult} tab={tab}>
          <FireEvidenceInsightPanel
            result={fireResult}
            tab={tab}
            missionSelection={missionSelection}
            onMissionSelectionChange={onMissionSelectionChange}
          />
        </ResultFailureGapBoundary>
        {relatedPanels}
      </>
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

function RelatedEvidenceChains({
  analyses,
  tab,
  missionSelection,
  onMissionSelectionChange,
}: {
  analyses: ActiveAnalysis[];
  tab: InsightTab;
  missionSelection: MissionSelectionState;
  onMissionSelectionChange: (selection: MissionSelectionState) => void;
}) {
  if (analyses.length === 0) return null;
  return (
    <div data-testid="related-evidence-chains">
      {analyses.map((analysis) => {
        const outcome = analysis.outcome;
        return (
          <section
            key={analysis.analysisId}
            aria-label={`Related ${HAZARD_LABELS[outcome.hazardId]} evidence chain`}
            data-testid={analysis.request.evidenceBundle?.investigationKind === "comparison"
              ? `agent-chain-${analysis.analysisId}`
              : `related-${outcome.hazardId}-evidence-chain`}
            tabIndex={-1}
            style={{
              marginTop: "18px",
              paddingTop: "14px",
              borderTop: "2px solid var(--border-default)",
            }}
          >
            <h3 style={{ margin: "0 0 5px", fontSize: "16px" }}>
              {analysis.request.evidenceBundle?.scenarioLabel
                ? `${analysis.request.evidenceBundle.scenarioLabel} — `
                : "Related "}
              {HAZARD_LABELS[outcome.hazardId]} evidence
            </h3>
            <p style={{ margin: "0 0 12px", color: "var(--text-secondary)", fontSize: "14px" }}>
              {analysis.request.evidenceBundle?.investigationKind === "comparison"
                ? "Kept as a separate scenario and hazard chain. Compare direct observations, source status, confidence, and limitations."
                : "Collected automatically for the same place and time. Compare its direct observations, confidence, and citations with the primary result to judge how strongly it reinforces the concern."}
            </p>
            <ResultFailureGapBoundary result={outcome.result} tab={tab}>
              {outcome.hazardId === "fire_smoke" ? (
                <FireEvidenceInsightPanel
                  result={outcome.result}
                  tab={tab}
                  missionSelection={missionSelection}
                  onMissionSelectionChange={onMissionSelectionChange}
                />
              ) : outcome.hazardId === "flood_storm" ? (
                <FloodEvidenceInsightPanel
                  result={outcome.result}
                  tab={tab}
                  missionSelection={missionSelection}
                  onMissionSelectionChange={onMissionSelectionChange}
                />
              ) : outcome.hazardId === "wind_storm" ? (
                <StormEvidenceInsightPanel
                  result={outcome.result}
                  tab={tab}
                  claimDiscussionOpen={false}
                  onClaimDiscussionOpenChange={KEEP_CLOSED}
                  missionSelection={missionSelection}
                  onMissionSelectionChange={onMissionSelectionChange}
                />
              ) : outcome.hazardId === "extreme_heat" ? (
                <HeatEvidenceInsightPanel
                  result={outcome.result}
                  tab={tab}
                  missionSelection={missionSelection}
                  onMissionSelectionChange={onMissionSelectionChange}
                />
              ) : outcome.hazardId === "drought_land" ? (
                <DroughtEvidenceInsightPanel
                  result={outcome.result}
                  tab={tab}
                  missionSelection={missionSelection}
                  onMissionSelectionChange={onMissionSelectionChange}
                />
              ) : (
                <CoverageGapInsightPanel
                  result={outcome.result}
                  tab={tab}
                  missionSelection={missionSelection}
                  onMissionSelectionChange={onMissionSelectionChange}
                />
              )}
            </ResultFailureGapBoundary>
          </section>
        );
      })}
    </div>
  );
}
