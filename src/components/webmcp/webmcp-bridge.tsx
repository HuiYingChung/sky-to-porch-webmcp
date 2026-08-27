"use client";

/// <reference types="webmcp-types" />

import { useEffect, useMemo } from "react";
import type { ActiveAnalysis, AnalysisRequest } from "@/lib/analysis/types";
import { createAnalyzeHazardTool } from "@/lib/webmcp/analyze-tool";
import {
  createInspectEvidenceTool,
  createStormClaimDiscussionTool,
} from "@/lib/webmcp/context-tools";

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
  const tool = useMemo(
    () => createAnalyzeHazardTool({
      runAnalysis,
      ...(runAnalysisBundle ? { runAnalysisBundle } : {}),
    }),
    [runAnalysis, runAnalysisBundle]
  );

  useEffect(() => {
    if (!document.modelContext) {
      onStatusChange?.("unsupported");
      return;
    }
    const controller = new AbortController();
    onStatusChange?.("registering");
    void document.modelContext
      .registerTool(tool, { signal: controller.signal })
      .then(() => {
        if (!controller.signal.aborted) onStatusChange?.("ready");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          onStatusChange?.("error");
          console.error("WebMCP tool registration failed", error);
        }
      });
    return () => controller.abort();
  }, [onStatusChange, tool]);

  useEffect(() => {
    if (!document.modelContext || !activeAnalysis) return;
    const controller = new AbortController();
    const contextualTools = [
      createInspectEvidenceTool(activeAnalysis, relatedAnalyses),
      createStormClaimDiscussionTool(activeAnalysis, onOpenStormClaimDiscussion),
    ].filter((item): item is WebMCP.ModelContextTool => item !== null);
    void Promise.all(
      contextualTools.map((contextualTool) =>
        document.modelContext!.registerTool(contextualTool, { signal: controller.signal })
      )
    ).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.error("WebMCP contextual tool registration failed", error);
      }
    });
    return () => controller.abort();
  }, [activeAnalysis, onOpenStormClaimDiscussion, relatedAnalyses]);

  return null;
}
