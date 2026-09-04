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
  onOpenStormClaimDiscussion?: () => void;
  onStatusChange?: (status: WebMcpStatus) => void;
}

interface WebMcpRuntimeState extends ContextualToolState {
  runAnalysis: WebMcpBridgeProps["runAnalysis"];
  runAnalysisBundle: WebMcpBridgeProps["runAnalysisBundle"];
  onStatusChange: WebMcpBridgeProps["onStatusChange"];
}

export type WebMcpStatus =
  | "checking"
  | "unsupported"
  | "registering"
  | "ready"
  | "error";

const EMPTY_RELATED_ANALYSES: ActiveAnalysis[] = [];

/** Registers browser-native WebMCP against the same application service as the UI. */
export function WebMcpBridge({
  runAnalysis,
  runAnalysisBundle,
  activeAnalysis = null,
  relatedAnalyses = EMPTY_RELATED_ANALYSES,
  onOpenStormClaimDiscussion = () => {},
  onStatusChange,
}: WebMcpBridgeProps) {
  const runtimeStateRef = useRef<WebMcpRuntimeState>({
    runAnalysis,
    runAnalysisBundle,
    activeAnalysis,
    relatedAnalyses,
    onOpenStormClaimDiscussion,
    onStatusChange,
  });

  useLayoutEffect(() => {
    runtimeStateRef.current = {
      runAnalysis,
      runAnalysisBundle,
      activeAnalysis,
      relatedAnalyses,
      onOpenStormClaimDiscussion,
      onStatusChange,
    };
  }, [
    activeAnalysis,
    onOpenStormClaimDiscussion,
    onStatusChange,
    relatedAnalyses,
    runAnalysis,
    runAnalysisBundle,
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
      const analysisDependencies = {
        runAnalysis: runCurrentAnalysis,
        runAnalysisBundle: runCurrentAnalysisBundle,
      };
      return [
        createAnalyzeHazardTool(analysisDependencies),
        createCompareHazardTool(analysisDependencies),
        createEnvironmentalCapabilitiesTool(),
        createGetEnvironmentalSourceCoverageTool(),
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
