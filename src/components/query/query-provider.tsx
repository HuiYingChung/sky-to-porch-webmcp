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

import React, { createContext, useContext, useReducer, useRef, useState } from "react";
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

interface QueryContextValue {
  draft: QueryDraft;
  dispatch: React.Dispatch<QueryDraftAction>;
  /** Current validated place selection, or null if not yet set. */
  placeSelection: PlaceSelection | null;
  setPlaceSelection: (selection: PlaceSelection) => void;
  clearPlaceSelection: () => void;
  /** WP-05: current fire evidence result, or null before first query. */
  fireResult: FireQueryResult | null;
  /**
   * Set the fire result only if `gen` matches the current generation.
   * Callers obtain the generation from `bumpFireQueryGen()` before they start
   * the async request; the result is ignored if a newer request has started.
   */
  setFireResultForGen: (result: FireQueryResult, gen: number) => void;
  clearFireResult: () => void;
  /** WP-05: true while a fire query is in progress. */
  fireLoading: boolean;
  /** Update loading only while `gen` is still the current query. */
  setFireLoadingForGen: (loading: boolean, gen: number) => void;
  /**
   * Increment the query generation counter synchronously and return the new
   * value. Call this immediately before starting an async fire query, and
   * also whenever a material query input changes (place, time, hazard) so
   * that any in-flight request for the prior generation is discarded.
   */
  bumpFireQueryGen: () => number;
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
  setFloodResultForGen: (result: FloodQueryResult, gen: number) => void;
  clearFloodResult: () => void;
  floodLoading: boolean;
  setFloodLoadingForGen: (loading: boolean, gen: number) => void;
  bumpFloodQueryGen: () => number;
  floodEvidenceMode: FloodEvidenceMode | null;
  setFloodEvidenceMode: (mode: FloodEvidenceMode) => void;
  /** WP-09: current Extreme Heat result and generation-guarded request state. */
  heatResult: HeatQueryResult | null;
  setHeatResultForGen: (result: HeatQueryResult, gen: number) => void;
  clearHeatResult: () => void;
  heatLoading: boolean;
  setHeatLoadingForGen: (loading: boolean, gen: number) => void;
  bumpHeatQueryGen: () => number;
  heatEvidenceMode: HeatEvidenceMode | null;
  setHeatEvidenceMode: (mode: HeatEvidenceMode) => void;
  /** WP-10: current Drought & Land result and generation-guarded request state. */
  droughtResult: DroughtQueryResult | null;
  setDroughtResultForGen: (result: DroughtQueryResult, gen: number) => void;
  clearDroughtResult: () => void;
  droughtLoading: boolean;
  setDroughtLoadingForGen: (loading: boolean, gen: number) => void;
  bumpDroughtQueryGen: () => number;
  droughtEvidenceMode: DroughtEvidenceMode | null;
  setDroughtEvidenceMode: (mode: DroughtEvidenceMode) => void;
  /** WP-10 fix 4: truthful live/source-gap result for Air and Volcano routes. */
  coverageGapResult: CoverageGapQueryResult | null;
  setCoverageGapResultForGen: (result: CoverageGapQueryResult, gen: number) => void;
  clearCoverageGapResult: () => void;
  coverageGapLoading: boolean;
  setCoverageGapLoadingForGen: (loading: boolean, gen: number) => void;
  bumpCoverageGapQueryGen: () => number;
}

const QueryContext = createContext<QueryContextValue | null>(null);

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [draft, dispatchState] = useReducer(queryDraftReducer, undefined, emptyDraft);
  const [placeSelection, setPlaceSelectionState] = useState<PlaceSelection | null>(null);
  const [fireResult, setFireResultState] = useState<FireQueryResult | null>(null);
  const [fireLoading, setFireLoadingState] = useState(false);
  // UXFIX-01: Live retrieval is the default evidence mode. Fixture remains a
  // deterministic dev/test harness selectable behind the dev-mode gate.
  const [fireEvidenceMode, setFireEvidenceModeState] = useState<FireEvidenceMode | null>("live");
  const [floodResult, setFloodResultState] = useState<FloodQueryResult | null>(null);
  const [floodLoading, setFloodLoadingState] = useState(false);
  const [floodEvidenceMode, setFloodEvidenceModeState] = useState<FloodEvidenceMode | null>("live");
  const [heatResult, setHeatResultState] = useState<HeatQueryResult | null>(null);
  const [heatLoading, setHeatLoadingState] = useState(false);
  const [heatEvidenceMode, setHeatEvidenceModeState] = useState<HeatEvidenceMode | null>("live");
  const [droughtResult, setDroughtResultState] = useState<DroughtQueryResult | null>(null);
  const [droughtLoading, setDroughtLoadingState] = useState(false);
  const [droughtEvidenceMode, setDroughtEvidenceModeState] = useState<DroughtEvidenceMode | null>("live");
  const [coverageGapResult, setCoverageGapResultState] = useState<CoverageGapQueryResult | null>(null);
  const [coverageGapLoading, setCoverageGapLoadingState] = useState(false);
  // Mutable ref for the current query generation (not state — never triggers render on its own).
  const fireQueryGenRef = useRef(0);
  const floodQueryGenRef = useRef(0);
  const heatQueryGenRef = useRef(0);
  const droughtQueryGenRef = useRef(0);
  const coverageGapQueryGenRef = useRef(0);

  function invalidateFireQuery() {
    fireQueryGenRef.current += 1;
    setFireResultState(null);
    setFireLoadingState(false);
  }

  function invalidateFloodQuery() {
    floodQueryGenRef.current += 1;
    setFloodResultState(null);
    setFloodLoadingState(false);
  }

  function invalidateHeatQuery() {
    heatQueryGenRef.current += 1;
    setHeatResultState(null);
    setHeatLoadingState(false);
  }

  function invalidateDroughtQuery() {
    droughtQueryGenRef.current += 1;
    setDroughtResultState(null);
    setDroughtLoadingState(false);
  }

  function invalidateCoverageGapQuery() {
    coverageGapQueryGenRef.current += 1;
    setCoverageGapResultState(null);
    setCoverageGapLoadingState(false);
  }

  function invalidateEvidenceQueries() {
    invalidateFireQuery();
    invalidateFloodQuery();
    invalidateHeatQuery();
    invalidateDroughtQuery();
    invalidateCoverageGapQuery();
  }

  function dispatch(action: QueryDraftAction) {
    invalidateEvidenceQueries();
    dispatchState(action);
  }

  function setPlaceSelection(selection: PlaceSelection) {
    invalidateEvidenceQueries();
    setPlaceSelectionState(selection);
  }

  function clearPlaceSelection() {
    invalidateEvidenceQueries();
    setPlaceSelectionState(null);
  }

  function bumpFireQueryGen(): number {
    fireQueryGenRef.current += 1;
    setFireResultState(null);
    return fireQueryGenRef.current;
  }

  function setFireResultForGen(result: FireQueryResult, gen: number) {
    if (gen === fireQueryGenRef.current) {
      setFireResultState(result);
    }
    // If gen < current generation, this result is stale — silently discard.
  }

  function clearFireResult() {
    invalidateFireQuery();
  }

  function setFireLoadingForGen(loading: boolean, gen: number) {
    if (gen === fireQueryGenRef.current) {
      setFireLoadingState(loading);
    }
  }

  function setFireEvidenceMode(mode: FireEvidenceMode) {
    invalidateFireQuery();
    setFireEvidenceModeState(mode);
  }

  function bumpFloodQueryGen(): number {
    floodQueryGenRef.current += 1;
    setFloodResultState(null);
    return floodQueryGenRef.current;
  }

  function setFloodResultForGen(result: FloodQueryResult, gen: number) {
    if (gen === floodQueryGenRef.current) setFloodResultState(result);
  }

  function clearFloodResult() {
    invalidateFloodQuery();
  }

  function setFloodLoadingForGen(loading: boolean, gen: number) {
    if (gen === floodQueryGenRef.current) setFloodLoadingState(loading);
  }

  function setFloodEvidenceMode(mode: FloodEvidenceMode) {
    invalidateFloodQuery();
    setFloodEvidenceModeState(mode);
  }

  function bumpHeatQueryGen(): number {
    heatQueryGenRef.current += 1;
    setHeatResultState(null);
    return heatQueryGenRef.current;
  }

  function setHeatResultForGen(result: HeatQueryResult, gen: number) {
    if (gen === heatQueryGenRef.current) setHeatResultState(result);
  }

  function clearHeatResult() {
    invalidateHeatQuery();
  }

  function setHeatLoadingForGen(loading: boolean, gen: number) {
    if (gen === heatQueryGenRef.current) setHeatLoadingState(loading);
  }

  function setHeatEvidenceMode(mode: HeatEvidenceMode) {
    invalidateHeatQuery();
    setHeatEvidenceModeState(mode);
  }

  function bumpDroughtQueryGen(): number {
    droughtQueryGenRef.current += 1;
    setDroughtResultState(null);
    return droughtQueryGenRef.current;
  }

  function setDroughtResultForGen(result: DroughtQueryResult, gen: number) {
    if (gen === droughtQueryGenRef.current) setDroughtResultState(result);
  }

  function clearDroughtResult() {
    invalidateDroughtQuery();
  }

  function setDroughtLoadingForGen(loading: boolean, gen: number) {
    if (gen === droughtQueryGenRef.current) setDroughtLoadingState(loading);
  }

  function setDroughtEvidenceMode(mode: DroughtEvidenceMode) {
    invalidateDroughtQuery();
    setDroughtEvidenceModeState(mode);
  }

  function bumpCoverageGapQueryGen(): number {
    coverageGapQueryGenRef.current += 1;
    setCoverageGapResultState(null);
    return coverageGapQueryGenRef.current;
  }

  function setCoverageGapResultForGen(result: CoverageGapQueryResult, gen: number) {
    if (gen === coverageGapQueryGenRef.current) setCoverageGapResultState(result);
  }

  function clearCoverageGapResult() {
    invalidateCoverageGapQuery();
  }

  function setCoverageGapLoadingForGen(loading: boolean, gen: number) {
    if (gen === coverageGapQueryGenRef.current) setCoverageGapLoadingState(loading);
  }

  return (
    <QueryContext.Provider
      value={{
        draft,
        dispatch,
        placeSelection,
        setPlaceSelection,
        clearPlaceSelection,
        fireResult,
        setFireResultForGen,
        clearFireResult,
        fireLoading,
        setFireLoadingForGen,
        bumpFireQueryGen,
        fireEvidenceMode,
        setFireEvidenceMode,
        floodResult,
        setFloodResultForGen,
        clearFloodResult,
        floodLoading,
        setFloodLoadingForGen,
        bumpFloodQueryGen,
        floodEvidenceMode,
        setFloodEvidenceMode,
        heatResult,
        setHeatResultForGen,
        clearHeatResult,
        heatLoading,
        setHeatLoadingForGen,
        bumpHeatQueryGen,
        heatEvidenceMode,
        setHeatEvidenceMode,
        droughtResult,
        setDroughtResultForGen,
        clearDroughtResult,
        droughtLoading,
        setDroughtLoadingForGen,
        bumpDroughtQueryGen,
        droughtEvidenceMode,
        setDroughtEvidenceMode,
        coverageGapResult,
        setCoverageGapResultForGen,
        clearCoverageGapResult,
        coverageGapLoading,
        setCoverageGapLoadingForGen,
        bumpCoverageGapQueryGen,
      }}
    >
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
