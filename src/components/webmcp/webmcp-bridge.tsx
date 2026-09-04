"use client";

/// <reference types="webmcp-types" />

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { ActiveAnalysis, AnalysisRequest } from "@/lib/analysis/types";
import {
  createAnalyzeHazardTool,
  createCompareHazardTool,
} from "@/lib/webmcp/analyze-tool";
import {
  createStateBackedInspectEvidenceTool,
  createStateBackedStormClaimDiscussionTool,
  type ContextualToolState,
} from "@/lib/webmcp/context-tools";
import {
  createGetEnvironmentalSourceCoverageTool,
  createEnvironmentalCapabilitiesTool,
} from "@/lib/webmcp/discovery-tools";
import { createLookUpPlaceLocationTool } from "@/lib/webmcp/place-tool";
import {
  createSetEnvironmentalMapLayersTool,
  type EnvironmentalMapToolSnapshot,
  type EnvironmentalMapToolUpdate,
  type EnvironmentalMapToolUpdateResult,
} from "@/lib/webmcp/map-tool";
import type { PlaceSelection } from "@/lib/location/selection";
import {
  createInitialEnvironmentalMapState,
  type EnvironmentalMapState,
} from "@/lib/map/environmental-map-state";

interface WebMcpBridgeProps {
  runAnalysis: (
    request: AnalysisRequest,
    origin?: "agent",
    signal?: AbortSignal
  ) => Promise<ActiveAnalysis | null>;
  runAnalysisBundle?: (
    requests: AnalysisRequest[],
    origin?: "agent",
    signal?: AbortSignal
  ) => Promise<ActiveAnalysis[] | null>;
  activeAnalysis?: ActiveAnalysis | null;
  relatedAnalyses?: ActiveAnalysis[];
  placeSelection?: PlaceSelection | null;
  environmentalMapState?: EnvironmentalMapState;
  readEnvironmentalMapSnapshot?: () => EnvironmentalMapToolSnapshot;
  applyEnvironmentalMapUpdate?: (
    update: EnvironmentalMapToolUpdate
  ) => EnvironmentalMapToolUpdateResult;
  beginContextMutationInvocation?: () => () => boolean;
  onOpenStormClaimDiscussion?: () => void;
  onStatusChange?: (status: WebMcpStatus) => void;
}

interface WebMcpRuntimeState extends ContextualToolState {
  runAnalysis: WebMcpBridgeProps["runAnalysis"];
  runAnalysisBundle: WebMcpBridgeProps["runAnalysisBundle"];
  placeSelection: PlaceSelection | null;
  environmentalMapState: EnvironmentalMapState;
  readEnvironmentalMapSnapshot: () => EnvironmentalMapToolSnapshot;
  applyEnvironmentalMapUpdate: NonNullable<
    WebMcpBridgeProps["applyEnvironmentalMapUpdate"]
  >;
  beginContextMutationInvocation?: WebMcpBridgeProps[
    "beginContextMutationInvocation"
  ];
  onStatusChange: WebMcpBridgeProps["onStatusChange"];
}

export type WebMcpStatus =
  | "checking"
  | "unsupported"
  | "registering"
  | "ready"
  | "error";

const EMPTY_RELATED_ANALYSES: ActiveAnalysis[] = [];
const EMPTY_ENVIRONMENTAL_MAP_STATE = createInitialEnvironmentalMapState();
const NOOP_ENVIRONMENTAL_MAP_UPDATE = (): EnvironmentalMapToolUpdateResult => ({
  mapState: EMPTY_ENVIRONMENTAL_MAP_STATE,
  analysisCleared: false,
});

/** Registers browser-native WebMCP against the same application service as the UI. */
export function WebMcpBridge({
  runAnalysis,
  runAnalysisBundle,
  activeAnalysis = null,
  relatedAnalyses = EMPTY_RELATED_ANALYSES,
  placeSelection = null,
  environmentalMapState = EMPTY_ENVIRONMENTAL_MAP_STATE,
  readEnvironmentalMapSnapshot,
  applyEnvironmentalMapUpdate = NOOP_ENVIRONMENTAL_MAP_UPDATE,
  beginContextMutationInvocation,
  onOpenStormClaimDiscussion = () => {},
  onStatusChange,
}: WebMcpBridgeProps) {
  const runtimeStateRef = useRef<WebMcpRuntimeState>({
    runAnalysis,
    runAnalysisBundle,
    activeAnalysis,
    relatedAnalyses,
    placeSelection,
    environmentalMapState,
    readEnvironmentalMapSnapshot: readEnvironmentalMapSnapshot ?? (() => ({
      placeSelection,
      mapState: environmentalMapState,
    })),
    applyEnvironmentalMapUpdate,
    beginContextMutationInvocation,
    onOpenStormClaimDiscussion,
    onStatusChange,
  });

  useLayoutEffect(() => {
    runtimeStateRef.current = {
      runAnalysis,
      runAnalysisBundle,
      activeAnalysis,
      relatedAnalyses,
      placeSelection,
      environmentalMapState,
      readEnvironmentalMapSnapshot: readEnvironmentalMapSnapshot ?? (() => ({
        placeSelection,
        mapState: environmentalMapState,
      })),
      applyEnvironmentalMapUpdate,
      beginContextMutationInvocation,
      onOpenStormClaimDiscussion,
      onStatusChange,
    };
  }, [
    activeAnalysis,
    applyEnvironmentalMapUpdate,
    environmentalMapState,
    onOpenStormClaimDiscussion,
    onStatusChange,
    relatedAnalyses,
    runAnalysis,
    runAnalysisBundle,
    placeSelection,
    readEnvironmentalMapSnapshot,
    beginContextMutationInvocation,
  ]);

  const registeredTools = useMemo(
    () => {
      const runCurrentAnalysis: WebMcpBridgeProps["runAnalysis"] = (
        request,
        origin,
        signal
      ) => runtimeStateRef.current.runAnalysis(request, origin, signal);
      const runCurrentAnalysisBundle: NonNullable<WebMcpBridgeProps["runAnalysisBundle"]> = async (
        requests,
        origin,
        signal
      ) => {
        const current = runtimeStateRef.current;
        if (current.runAnalysisBundle) {
          return current.runAnalysisBundle(requests, origin, signal);
        }
        const analyses: ActiveAnalysis[] = [];
        for (const request of requests) {
          const analysis = await current.runAnalysis(request, origin, signal);
          if (analysis === null) return null;
          analyses.push(analysis);
        }
        return analyses;
      };
      let fallbackInvocation = 0;
      const beginCurrentContextMutation = () => {
        const current = runtimeStateRef.current.beginContextMutationInvocation;
        if (current) return current();
        const invocation = ++fallbackInvocation;
        return () => invocation === fallbackInvocation;
      };
      const analysisDependencies = {
        runAnalysis: runCurrentAnalysis,
        runAnalysisBundle: runCurrentAnalysisBundle,
        beginInvocation: beginCurrentContextMutation,
      };
      return [
        createAnalyzeHazardTool(analysisDependencies),
        createCompareHazardTool(analysisDependencies),
        createEnvironmentalCapabilitiesTool(),
        createGetEnvironmentalSourceCoverageTool(),
        createLookUpPlaceLocationTool(),
        createSetEnvironmentalMapLayersTool({
          readState: () =>
            runtimeStateRef.current.readEnvironmentalMapSnapshot(),
          applyUpdate: (update) =>
            runtimeStateRef.current.applyEnvironmentalMapUpdate(update),
          beginContextInvocation: beginCurrentContextMutation,
        }),
        createStateBackedInspectEvidenceTool(() => runtimeStateRef.current),
        createStateBackedStormClaimDiscussionTool(() => runtimeStateRef.current),
      ];
    },
    []
  );

  useEffect(() => {
    if (!document.modelContext) {
      runtimeStateRef.current.onStatusChange?.("unsupported");
      return;
    }
    const controller = new AbortController();
    runtimeStateRef.current.onStatusChange?.("registering");
    void Promise.all(
      registeredTools.map((tool) =>
        document.modelContext!.registerTool(tool, { signal: controller.signal })
      )
    )
      .then(() => {
        if (!controller.signal.aborted) runtimeStateRef.current.onStatusChange?.("ready");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          runtimeStateRef.current.onStatusChange?.("error");
          console.error("WebMCP tool registration failed", error);
          controller.abort(error);
        }
      });
    return () => controller.abort();
  }, [registeredTools]);

  return null;
}
