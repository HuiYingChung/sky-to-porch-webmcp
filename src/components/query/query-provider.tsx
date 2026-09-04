"use client";
/**
 * src/components/query/query-provider.tsx
 *
 * Provides shared query-draft state, WP-04 place selection state, and WP-05
 * fire evidence state to all children via React context.
 *
 * A single instance backs all views (desktop and mobile) so navigating
 * between views or resizing between viewports never resets entered values.
 *
 * WP-04 additions:
 *   - placeSelection: validated canonical PlaceSelection | null
 *   - setPlaceSelection / clearPlaceSelection
 *
 * WP-05 additions:
 *   - fireResult: current FireQueryResult | null
 *   - setFireResult / clearFireResult
 *   - fireLoading: boolean
 *
 * WP-05-C01 additions:
 *   - fireQueryGen: monotonically increasing generation counter, incremented
 *     synchronously on every material query input change. Any async response
 *     that arrives for a stale generation is discarded, preventing stale-state
 *     repopulation.
 *   - place, time, hazard, and concern setters invalidate synchronously.
 *   - loading completion is generation-guarded as well as response writes.
 *
 * WP-05-004 additions (amended by UXFIX-01 / ADR-0021):
 *   - fireEvidenceMode: "live" | "fixture" | null — shared across desktop/mobile.
 *     UXFIX-01: "live" is pre-selected as the product default; fixture is a
 *     dev/test harness behind the dev-mode gate. Changing mode still calls
 *     invalidateFireQuery to discard any in-flight or displayed result.
 *   - setFireEvidenceMode: sets the mode and invalidates.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  type QueryDraft,
  type QueryDraftAction,
  emptyDraft,
  queryDraftReducer,
} from "@/lib/ui/query-draft";
import type { PlaceSelection } from "@/lib/location/selection";
import type { FireQueryResult, FireEvidenceMode } from "@/lib/fire/types";
import type { FloodQueryResult, FloodEvidenceMode } from "@/lib/flood/types";
import type { HeatQueryResult, HeatEvidenceMode } from "@/lib/heat/types";
import type { DroughtQueryResult, DroughtEvidenceMode } from "@/lib/drought/types";
import type { CoverageGapQueryResult } from "@/lib/coverage-gap/types";
import type { StormQueryResult } from "@/lib/storm/types";
import { executeAnalysisRequest } from "@/lib/analysis/client";
import type {
  ActiveAnalysis,
  AgentInvestigationState,
  AnalysisOrigin,
  AnalysisRequest,
} from "@/lib/analysis/types";
import {
  WebMcpBridge,
  type WebMcpStatus,
} from "@/components/webmcp/webmcp-bridge";
import {
  useEnvironmentalMapController,
  type FloodExtentLayerUiState,
  type WildfireLayerUiState,
} from "@/components/map/use-environmental-map-controller";
import {
  DEFAULT_ENVIRONMENTAL_LAYERS_BY_HAZARD,
  singleMapDateFromSelection,
  sameMapSelection,
  type EnvironmentalMapLayerId,
  type EnvironmentalMapState,
} from "@/lib/map/environmental-map-state";
import type {
  EnvironmentalMapToolSnapshot,
  EnvironmentalMapToolUpdate,
  EnvironmentalMapToolUpdateResult,
} from "@/lib/webmcp/map-tool";

interface QueryContextValue {
  draft: QueryDraft;
  dispatch: React.Dispatch<QueryDraftAction>;
  /** Current validated place selection, or null if not yet set. */
  placeSelection: PlaceSelection | null;
  setPlaceSelection: (selection: PlaceSelection) => void;
  clearPlaceSelection: () => void;
  /** WP-05: current fire evidence result, or null before first query. */
  fireResult: FireQueryResult | null;
  /** WP-05: true while a fire query is in progress. */
  fireLoading: boolean;
  /**
   * WP-05-004: Explicit evidence mode for Fire queries. Neither mode is
   * pre-selected; null means the user has not yet made a choice.
   * A Fire query cannot submit until this is set.
   */
  fireEvidenceMode: FireEvidenceMode | null;
  /**
   * Sets the evidence mode and invalidates any current fire result.
   * Changing mode must not show a stale result.
   */
  setFireEvidenceMode: (mode: FireEvidenceMode) => void;
  /** WP-08: current Flood evidence result and generation-guarded request state. */
  floodResult: FloodQueryResult | null;
  floodLoading: boolean;
  floodEvidenceMode: FloodEvidenceMode | null;
  setFloodEvidenceMode: (mode: FloodEvidenceMode) => void;
  /** Water evidence retained beside the active Wind result for a storm bundle. */
  relatedStormFloodResult: FloodQueryResult | null;
  /** Independently validated context chains retained beside a bundle's primary result. */
  relatedAnalyses: ActiveAnalysis[];
  /** Wind & Storm stays source-distinct from Flood & Heavy Rain. */
  windResult: StormQueryResult | null;
  windLoading: boolean;
  stormClaimDiscussionOpen: boolean;
  setStormClaimDiscussionOpen: (open: boolean) => void;
  /** WP-09: current Extreme Heat result and generation-guarded request state. */
  heatResult: HeatQueryResult | null;
  heatLoading: boolean;
  heatEvidenceMode: HeatEvidenceMode | null;
  setHeatEvidenceMode: (mode: HeatEvidenceMode) => void;
  /** WP-10: current Drought & Land result and generation-guarded request state. */
  droughtResult: DroughtQueryResult | null;
  droughtLoading: boolean;
  droughtEvidenceMode: DroughtEvidenceMode | null;
  setDroughtEvidenceMode: (mode: DroughtEvidenceMode) => void;
  /** WP-10 fix 4: truthful live/source-gap result for Air and Volcano routes. */
  coverageGapResult: CoverageGapQueryResult | null;
  coverageGapLoading: boolean;
  /** One provider-neutral snapshot shared by human UI and WebMCP. */
  activeAnalysis: ActiveAnalysis | null;
  /** Single previous snapshot retained only for one-step Agent undo. */
  previousAnalysis: ActiveAnalysis | null;
  analysisLoading: boolean;
  /** Visible progress for an Agent-run single, related, or comparison investigation. */
  agentInvestigation: AgentInvestigationState | null;
  /** Current browser-native WebMCP discovery/registration state. */
  webMcpStatus: WebMcpStatus;
  /** Shared desired and runtime environmental-map state across desktop/mobile. */
  environmentalMapState: EnvironmentalMapState;
  wildfireLayerState: WildfireLayerUiState;
  floodExtentLayerState: FloodExtentLayerUiState;
  setEnvironmentalMapLayerVisible: (
    layerId: EnvironmentalMapLayerId,
    visible: boolean
  ) => void;
  reportMapOverlayStatus: (
    layerId: EnvironmentalMapLayerId,
    status: "ready" | "source_failure" | "detached",
    date: string,
    contextRevision: number
  ) => void;
  reportMapRendererStatus: (
    status: "attached" | "unavailable",
    date: string,
    contextRevision: number
  ) => void;
  /** Cancel any active request and clear all displayed analysis results. */
  clearAnalysis: () => void;
  /** Restore the snapshot that was visible immediately before the Agent update. */
  restorePreviousAnalysis: () => boolean;
  /**
   * Execute the shared analysis pipeline and synchronize the visible query,
   * map selection, and legacy result renderers.
   */
  runAnalysis: (
    request: AnalysisRequest,
    origin?: AnalysisOrigin,
    signal?: AbortSignal
  ) => Promise<ActiveAnalysis | null>;
}

const QueryContext = createContext<QueryContextValue | null>(null);

function sameEnvironmentalMapArea(
  first: PlaceSelection | null,
  second: PlaceSelection | null
): boolean {
  if (first === second) return true;
  if (!first || !second) return false;
  const firstArea = first.analysisArea.boundingBox;
  const secondArea = second.analysisArea.boundingBox;
  return firstArea.west === secondArea.west &&
    firstArea.south === secondArea.south &&
    firstArea.east === secondArea.east &&
    firstArea.north === secondArea.north;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [draft, dispatchState] = useReducer(queryDraftReducer, undefined, emptyDraft);
  const [placeSelection, setPlaceSelectionState] = useState<PlaceSelection | null>(null);
  const placeSelectionRef = useRef<PlaceSelection | null>(null);
  const environmentalMap = useEnvironmentalMapController(placeSelection);
  const applyEnvironmentalMapDesiredState = environmentalMap.applyDesiredState;
  const environmentalMapState = environmentalMap.mapState;
  const readEnvironmentalMapState = environmentalMap.readState;
  const [fireResult, setFireResultState] = useState<FireQueryResult | null>(null);
  const [fireLoading, setFireLoadingState] = useState(false);
  // UXFIX-01: Live retrieval is the default evidence mode. Fixture remains a
  // deterministic dev/test harness selectable behind the dev-mode gate.
  const [fireEvidenceMode, setFireEvidenceModeState] = useState<FireEvidenceMode | null>("live");
  const [floodResult, setFloodResultState] = useState<FloodQueryResult | null>(null);
  const [floodLoading, setFloodLoadingState] = useState(false);
  const [floodEvidenceMode, setFloodEvidenceModeState] = useState<FloodEvidenceMode | null>("live");
  const [relatedAnalyses, setRelatedAnalyses] = useState<ActiveAnalysis[]>([]);
  const [windResult, setWindResultState] = useState<StormQueryResult | null>(null);
  const [windLoading, setWindLoadingState] = useState(false);
  const [stormClaimDiscussionOpen, setStormClaimDiscussionOpen] = useState(false);
  const [heatResult, setHeatResultState] = useState<HeatQueryResult | null>(null);
  const [heatLoading, setHeatLoadingState] = useState(false);
  const [heatEvidenceMode, setHeatEvidenceModeState] = useState<HeatEvidenceMode | null>("live");
  const [droughtResult, setDroughtResultState] = useState<DroughtQueryResult | null>(null);
  const [droughtLoading, setDroughtLoadingState] = useState(false);
  const [droughtEvidenceMode, setDroughtEvidenceModeState] = useState<DroughtEvidenceMode | null>("live");
  const [coverageGapResult, setCoverageGapResultState] = useState<CoverageGapQueryResult | null>(null);
  const [coverageGapLoading, setCoverageGapLoadingState] = useState(false);
  const [activeAnalysis, setActiveAnalysis] = useState<ActiveAnalysis | null>(null);
  const [previousAnalysis, setPreviousAnalysis] = useState<ActiveAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [agentInvestigation, setAgentInvestigation] = useState<AgentInvestigationState | null>(null);
  const [webMcpStatus, setWebMcpStatus] = useState<WebMcpStatus>("checking");
  // Mutable ref for the unified query generation (never triggers render).
  const analysisQueryGenRef = useRef(0);
  // Intent generation starts before Agent geocoding and also advances for
  // every human invalidation, so a delayed lookup cannot reclaim newer UI.
  const analysisIntentGenRef = useRef(0);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const activeAnalysisRef = useRef<ActiveAnalysis | null>(null);
  const previousAnalysisRef = useRef<ActiveAnalysis | null>(null);
  const lastDefaultMapHazardRef = useRef<string | null>(null);
  const activeScenarioId = activeAnalysis?.request.evidenceBundle?.scenarioId;
  const relatedStormFloodResult = relatedAnalyses
    .find((analysis) =>
      analysis.outcome.hazardId === "flood_storm" &&
      (activeScenarioId === undefined || analysis.request.evidenceBundle?.scenarioId === activeScenarioId)
    )
    ?.outcome;
  const relatedStormFlood = relatedStormFloodResult?.hazardId === "flood_storm"
    ? relatedStormFloodResult.result
    : null;

  const commitActiveAnalysis = useCallback((analysis: ActiveAnalysis | null) => {
    activeAnalysisRef.current = analysis;
    setActiveAnalysis(analysis);
  }, []);

  const commitPreviousAnalysis = useCallback((analysis: ActiveAnalysis | null) => {
    previousAnalysisRef.current = analysis;
    setPreviousAnalysis(analysis);
  }, []);

  const commitPlaceSelection = useCallback((selection: PlaceSelection | null) => {
    placeSelectionRef.current = selection;
    setPlaceSelectionState(selection);
  }, []);

  const synchronizeEnvironmentalMapSelection = useCallback((
    selection: PlaceSelection | null,
    origin: "human" | "agent" = "human"
  ) => applyEnvironmentalMapDesiredState({}, {
    date: singleMapDateFromSelection(selection),
    // Source requests depend on UTC date + canonical analysis bounds. A label,
    // framing extent, or equivalent time normalization must not cancel an
    // otherwise identical source request and strand its layer in loading.
    contextChanged: !sameEnvironmentalMapArea(
      placeSelectionRef.current,
      selection
    ),
    origin,
  }), [applyEnvironmentalMapDesiredState]);

  const openStormClaimDiscussion = useCallback(() => {
    setStormClaimDiscussionOpen(true);
  }, []);

  const clearResultState = useCallback(() => {
    setFireResultState(null);
    setFloodResultState(null);
    setWindResultState(null);
    setHeatResultState(null);
    setDroughtResultState(null);
    setCoverageGapResultState(null);
  }, []);

  const commitOutcome = useCallback((analysis: ActiveAnalysis) => {
    clearResultState();
    const outcome = analysis.outcome;
    if (outcome.hazardId === "fire_smoke") {
      setFireResultState(outcome.result);
    } else if (outcome.hazardId === "flood_storm") {
      setFloodResultState(outcome.result);
    } else if (outcome.hazardId === "wind_storm") {
      setWindResultState(outcome.result);
    } else if (outcome.hazardId === "extreme_heat") {
      setHeatResultState(outcome.result);
    } else if (outcome.hazardId === "drought_land") {
      setDroughtResultState(outcome.result);
    } else {
      setCoverageGapResultState(outcome.result);
    }
  }, [clearResultState]);

  const synchronizeRequestState = useCallback((request: AnalysisRequest) => {
    synchronizeEnvironmentalMapSelection(request.placeSelection);
    commitPlaceSelection(request.placeSelection);
    dispatchState({ type: "SET_HAZARD", value: request.hazardId });
    dispatchState({ type: "SET_CONCERN", value: request.concern });
    dispatchState({
      type: "SET_OPTIONAL_QUESTION",
      value: request.optionalQuestion ?? "",
    });
    if (!request.evidenceMode) return;
    if (request.hazardId === "fire_smoke") {
      setFireEvidenceModeState(request.evidenceMode);
    } else if (request.hazardId === "flood_storm") {
      setFloodEvidenceModeState(request.evidenceMode);
    } else if (request.hazardId === "extreme_heat") {
      setHeatEvidenceModeState(request.evidenceMode);
    } else if (request.hazardId === "drought_land") {
      setDroughtEvidenceModeState(request.evidenceMode);
    }
  }, [commitPlaceSelection, synchronizeEnvironmentalMapSelection]);

  function invalidateEvidenceQueries() {
    analysisIntentGenRef.current += 1;
    analysisQueryGenRef.current += 1;
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    commitActiveAnalysis(null);
    commitPreviousAnalysis(null);
    setAnalysisLoading(false);
    setAgentInvestigation(null);
    clearResultState();
    setRelatedAnalyses([]);
    setFireLoadingState(false);
    setFloodLoadingState(false);
    setWindLoadingState(false);
    setStormClaimDiscussionOpen(false);
    setHeatLoadingState(false);
    setDroughtLoadingState(false);
    setCoverageGapLoadingState(false);
  }

  function dispatch(action: QueryDraftAction) {
    invalidateEvidenceQueries();
    dispatchState(action);
  }

  function setPlaceSelection(selection: PlaceSelection) {
    invalidateEvidenceQueries();
    synchronizeEnvironmentalMapSelection(selection);
    commitPlaceSelection(selection);
  }

  function clearPlaceSelection() {
    invalidateEvidenceQueries();
    synchronizeEnvironmentalMapSelection(null);
    commitPlaceSelection(null);
  }

  function setFireEvidenceMode(mode: FireEvidenceMode) {
    invalidateEvidenceQueries();
    setFireEvidenceModeState(mode);
  }

  function setFloodEvidenceMode(mode: FloodEvidenceMode) {
    invalidateEvidenceQueries();
    setFloodEvidenceModeState(mode);
  }

  function setHeatEvidenceMode(mode: HeatEvidenceMode) {
    invalidateEvidenceQueries();
    setHeatEvidenceModeState(mode);
  }

  function setDroughtEvidenceMode(mode: DroughtEvidenceMode) {
    invalidateEvidenceQueries();
    setDroughtEvidenceModeState(mode);
  }

  function setEnvironmentalMapLayerVisible(
    layerId: EnvironmentalMapLayerId,
    visible: boolean
  ) {
    applyEnvironmentalMapDesiredState({ [layerId]: visible }, {
      date: readEnvironmentalMapState().date,
      contextChanged: false,
      origin: "human",
    });
  }

  function applyEnvironmentalMapUpdate(
    update: EnvironmentalMapToolUpdate
  ): EnvironmentalMapToolUpdateResult {
    const selectionChanged = !sameMapSelection(
      placeSelectionRef.current,
      update.selection
    );
    const sourceAreaChanged = !sameEnvironmentalMapArea(
      placeSelectionRef.current,
      update.selection
    );
    if (selectionChanged) {
      invalidateEvidenceQueries();
      commitPlaceSelection(update.selection);
    }
    const nextMapState = applyEnvironmentalMapDesiredState(update.layers, {
      date: update.date,
      contextChanged: sourceAreaChanged,
      origin: update.origin,
    });
    return {
      mapState: nextMapState,
      analysisCleared: selectionChanged,
    };
  }

  // WebMCP calls may arrive back-to-back before React commits a render. Read
  // both halves of the shared snapshot from refs so the next call observes
  // the preceding transaction atomically instead of stale bridge props.
  const readEnvironmentalMapSnapshot = useCallback(
    (): EnvironmentalMapToolSnapshot => ({
      placeSelection: placeSelectionRef.current,
      mapState: readEnvironmentalMapState(),
    }),
    [readEnvironmentalMapState]
  );

  // Reserve a browser-tool intent before its optional geocoding awaits. Human
  // invalidation advances the same intent generation, so neither an older
  // Agent call nor an older human request can reclaim newer state.
  const beginContextMutationInvocation = useCallback(() => {
    const intentGeneration = ++analysisIntentGenRef.current;
    analysisQueryGenRef.current += 1;
    analysisAbortRef.current?.abort(
      new DOMException("Superseded by a newer Agent request", "AbortError")
    );
    analysisAbortRef.current = null;
    setAnalysisLoading(false);
    setAgentInvestigation(null);
    setFireLoadingState(false);
    setFloodLoadingState(false);
    setWindLoadingState(false);
    setHeatLoadingState(false);
    setDroughtLoadingState(false);
    setCoverageGapLoadingState(false);
    return () => intentGeneration === analysisIntentGenRef.current;
  }, []);

  useEffect(() => {
    if (draft.hazardId === lastDefaultMapHazardRef.current) return;
    lastDefaultMapHazardRef.current = draft.hazardId;
    if (!draft.hazardId) return;
    const defaults = DEFAULT_ENVIRONMENTAL_LAYERS_BY_HAZARD[draft.hazardId];
    if (defaults.length === 0) return;
    const patch = Object.fromEntries(
      defaults.map((layerId) => [layerId, true])
    );
    applyEnvironmentalMapDesiredState(patch, {
      date: environmentalMapState.date,
      contextChanged: false,
      origin: "human",
    });
  }, [
    draft.hazardId,
    applyEnvironmentalMapDesiredState,
    environmentalMapState.date,
  ]);

  const runAnalysis = useCallback(async (
    request: AnalysisRequest,
    origin: AnalysisOrigin = "human",
    externalSignal?: AbortSignal
  ): Promise<ActiveAnalysis | null> => {
    if (origin === "human") analysisIntentGenRef.current += 1;
    analysisQueryGenRef.current += 1;
    const generation = analysisQueryGenRef.current;
    analysisAbortRef.current?.abort();
    const bundleRole = request.evidenceBundle?.role;
    const bundleContinuation = bundleRole === "context" || bundleRole === "primary";
    if (origin === "agent" && !bundleContinuation) {
      commitPreviousAnalysis(activeAnalysisRef.current);
      setAgentInvestigation({
        investigationId: request.evidenceBundle?.investigationId ?? `analysis-${generation}`,
        kind: request.evidenceBundle?.investigationKind ?? "analysis",
        phase: "retrieving",
        totalChains: 1,
        completedChains: 0,
        scenarioLabels: request.evidenceBundle?.scenarioLabel
          ? [request.evidenceBundle.scenarioLabel]
          : [],
      });
    } else if (origin === "human") {
      commitPreviousAnalysis(null);
      setAgentInvestigation(null);
    }

    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const abortFromCaller = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort(externalSignal.reason);
      } else {
        externalSignal.addEventListener("abort", abortFromCaller, { once: true });
      }
    }

    clearResultState();
    if (!bundleContinuation) setRelatedAnalyses([]);
    setFireLoadingState(request.hazardId === "fire_smoke");
    setFloodLoadingState(request.hazardId === "flood_storm");
    setWindLoadingState(request.hazardId === "wind_storm");
    setStormClaimDiscussionOpen(false);
    setHeatLoadingState(request.hazardId === "extreme_heat");
    setDroughtLoadingState(request.hazardId === "drought_land");
    setCoverageGapLoadingState(
      request.hazardId === "air_quality" ||
      request.hazardId === "earth_volcanoes"
    );
    commitActiveAnalysis(null);
    setAnalysisLoading(true);

    synchronizeRequestState(request);

    try {
      const outcome = await executeAnalysisRequest(request, {
        signal: controller.signal,
      });
      if (generation !== analysisQueryGenRef.current) return null;

      const snapshot: ActiveAnalysis = {
        analysisId: `analysis-${generation}-${request.hazardId}`,
        origin,
        request,
        outcome,
        completedAt: new Date().toISOString(),
      };
      commitOutcome(snapshot);
      if (bundleRole === "start_context") {
        setRelatedAnalyses([snapshot]);
      } else if (bundleRole === "context") {
        setRelatedAnalyses((current) => [...current, snapshot]);
      }
      commitActiveAnalysis(snapshot);
      if (origin === "agent") {
        setAgentInvestigation((current) => current ? {
          ...current,
          phase: "complete",
          completedChains: 1,
        } : current);
      }
      return snapshot;
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        if (generation === analysisQueryGenRef.current) setAgentInvestigation(null);
        return null;
      }
      if (generation === analysisQueryGenRef.current) setAgentInvestigation(null);
      throw error;
    } finally {
      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortFromCaller);
      }
      if (generation === analysisQueryGenRef.current) {
        setFireLoadingState(false);
        setFloodLoadingState(false);
        setWindLoadingState(false);
        setHeatLoadingState(false);
        setDroughtLoadingState(false);
        setCoverageGapLoadingState(false);
        setAnalysisLoading(false);
        if (analysisAbortRef.current === controller) {
          analysisAbortRef.current = null;
        }
      }
    }
  }, [
    clearResultState,
    commitActiveAnalysis,
    commitOutcome,
    commitPreviousAnalysis,
    synchronizeRequestState,
  ]);

  const runAnalysisBundle = useCallback(async (
    requests: AnalysisRequest[],
    origin: "agent" = "agent",
    externalSignal?: AbortSignal
  ): Promise<ActiveAnalysis[] | null> => {
    if (requests.length === 0) return [];
    analysisQueryGenRef.current += 1;
    const generation = analysisQueryGenRef.current;
    analysisAbortRef.current?.abort();
    commitPreviousAnalysis(activeAnalysisRef.current);
    const bundle = requests[requests.length - 1].evidenceBundle;
    const scenarioLabels = [...new Set(requests.flatMap((request) =>
      request.evidenceBundle?.scenarioLabel ? [request.evidenceBundle.scenarioLabel] : []
    ))];
    setAgentInvestigation({
      investigationId: bundle?.investigationId ?? `bundle-${generation}`,
      kind: bundle?.investigationKind ?? "analysis",
      phase: "retrieving",
      totalChains: requests.length,
      completedChains: 0,
      scenarioLabels,
    });

    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const abortFromCaller = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort(externalSignal.reason);
      } else {
        externalSignal.addEventListener("abort", abortFromCaller, { once: true });
      }
    }

    clearResultState();
    setRelatedAnalyses([]);
    setFireLoadingState(requests.some((request) => request.hazardId === "fire_smoke"));
    setFloodLoadingState(requests.some((request) => request.hazardId === "flood_storm"));
    setWindLoadingState(requests.some((request) => request.hazardId === "wind_storm"));
    setStormClaimDiscussionOpen(false);
    setHeatLoadingState(requests.some((request) => request.hazardId === "extreme_heat"));
    setDroughtLoadingState(requests.some((request) => request.hazardId === "drought_land"));
    setCoverageGapLoadingState(requests.some(
      (request) => request.hazardId === "air_quality" || request.hazardId === "earth_volcanoes"
    ));
    commitActiveAnalysis(null);
    setAnalysisLoading(true);
    synchronizeRequestState(requests[requests.length - 1]);

    try {
      const outcomes = await Promise.all(requests.map(async (request) => {
        const outcome = await executeAnalysisRequest(request, { signal: controller.signal });
        if (generation === analysisQueryGenRef.current) {
          setAgentInvestigation((current) => current ? {
            ...current,
            completedChains: Math.min(current.completedChains + 1, current.totalChains),
          } : current);
        }
        return outcome;
      }));
      if (generation !== analysisQueryGenRef.current) return null;
      setAgentInvestigation((current) => current ? {
        ...current,
        phase: "synthesizing",
        completedChains: current.totalChains,
      } : current);

      const completedAt = new Date().toISOString();
      const snapshots = requests.map((request, index): ActiveAnalysis => ({
        analysisId: `analysis-${generation}-${index}-${request.hazardId}`,
        origin,
        request,
        outcome: outcomes[index],
        completedAt,
      }));
      const primary = snapshots[snapshots.length - 1];
      setRelatedAnalyses(snapshots.slice(0, -1));
      commitOutcome(primary);
      commitActiveAnalysis(primary);
      setAgentInvestigation((current) => current ? {
        ...current,
        phase: "complete",
        completedChains: current.totalChains,
      } : current);
      return snapshots;
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        if (generation === analysisQueryGenRef.current) setAgentInvestigation(null);
        return null;
      }
      if (generation === analysisQueryGenRef.current) setAgentInvestigation(null);
      throw error;
    } finally {
      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortFromCaller);
      }
      if (generation === analysisQueryGenRef.current) {
        setFireLoadingState(false);
        setFloodLoadingState(false);
        setWindLoadingState(false);
        setHeatLoadingState(false);
        setDroughtLoadingState(false);
        setCoverageGapLoadingState(false);
        setAnalysisLoading(false);
        if (analysisAbortRef.current === controller) {
          analysisAbortRef.current = null;
        }
      }
    }
  }, [
    clearResultState,
    commitActiveAnalysis,
    commitOutcome,
    commitPreviousAnalysis,
    synchronizeRequestState,
  ]);

  const restorePreviousAnalysis = useCallback(() => {
    const snapshot = previousAnalysisRef.current;
    if (!snapshot) return false;

    analysisIntentGenRef.current += 1;
    analysisQueryGenRef.current += 1;
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    setAnalysisLoading(false);
    setAgentInvestigation(null);
    setFireLoadingState(false);
    setFloodLoadingState(false);
    setWindLoadingState(false);
    setStormClaimDiscussionOpen(false);
    setHeatLoadingState(false);
    setDroughtLoadingState(false);
    setCoverageGapLoadingState(false);
    setRelatedAnalyses([]);
    synchronizeRequestState(snapshot.request);
    commitOutcome(snapshot);
    commitActiveAnalysis(snapshot);
    commitPreviousAnalysis(null);
    return true;
  }, [
    commitActiveAnalysis,
    commitOutcome,
    commitPreviousAnalysis,
    synchronizeRequestState,
  ]);

  return (
    <QueryContext.Provider
      value={{
        draft,
        dispatch,
        placeSelection,
        setPlaceSelection,
        clearPlaceSelection,
        fireResult,
        fireLoading,
        fireEvidenceMode,
        setFireEvidenceMode,
        floodResult,
        floodLoading,
        floodEvidenceMode,
        setFloodEvidenceMode,
        relatedStormFloodResult: relatedStormFlood,
        relatedAnalyses,
        windResult,
        windLoading,
        stormClaimDiscussionOpen,
        setStormClaimDiscussionOpen,
        heatResult,
        heatLoading,
        heatEvidenceMode,
        setHeatEvidenceMode,
        droughtResult,
        droughtLoading,
        droughtEvidenceMode,
        setDroughtEvidenceMode,
        coverageGapResult,
        coverageGapLoading,
        activeAnalysis,
        previousAnalysis,
        analysisLoading,
        agentInvestigation,
        webMcpStatus,
        environmentalMapState,
        wildfireLayerState: environmentalMap.wildfireState,
        floodExtentLayerState: environmentalMap.floodExtentState,
        setEnvironmentalMapLayerVisible,
        reportMapOverlayStatus: environmentalMap.reportMapOverlayStatus,
        reportMapRendererStatus: environmentalMap.reportMapRendererStatus,
        clearAnalysis: invalidateEvidenceQueries,
        restorePreviousAnalysis,
        runAnalysis,
      }}
    >
      <WebMcpBridge
        runAnalysis={runAnalysis}
        runAnalysisBundle={runAnalysisBundle}
        activeAnalysis={activeAnalysis}
        relatedAnalyses={relatedAnalyses}
        onOpenStormClaimDiscussion={openStormClaimDiscussion}
        placeSelection={placeSelection}
        environmentalMapState={environmentalMapState}
        readEnvironmentalMapSnapshot={readEnvironmentalMapSnapshot}
        applyEnvironmentalMapUpdate={applyEnvironmentalMapUpdate}
        beginContextMutationInvocation={beginContextMutationInvocation}
        onStatusChange={setWebMcpStatus}
      />
      {children}
    </QueryContext.Provider>
  );
}

/** Hook to access the shared query context. Throws if used outside QueryProvider. */
export function useQueryDraft(): QueryContextValue {
  const ctx = useContext(QueryContext);
  if (!ctx) {
    throw new Error("useQueryDraft must be used inside <QueryProvider>");
  }
  return ctx;
}
