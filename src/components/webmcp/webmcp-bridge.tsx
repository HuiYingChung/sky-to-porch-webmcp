"use client";

/// <reference types="webmcp-types" />

import { useEffect, useMemo } from "react";
import type { ActiveAnalysis, AnalysisRequest } from "@/lib/analysis/types";
import { createAnalyzeHazardTool } from "@/lib/webmcp/analyze-tool";

interface WebMcpBridgeProps {
  runAnalysis: (
    request: AnalysisRequest,
    origin?: "agent",
    signal?: AbortSignal
  ) => Promise<ActiveAnalysis | null>;
  onStatusChange?: (status: WebMcpStatus) => void;
}

export type WebMcpStatus =
  | "checking"
  | "unsupported"
  | "registering"
  | "ready"
  | "error";

/** Registers browser-native WebMCP against the same application service as the UI. */
export function WebMcpBridge({ runAnalysis, onStatusChange }: WebMcpBridgeProps) {
  const tool = useMemo(() => createAnalyzeHazardTool({ runAnalysis }), [runAnalysis]);

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

  return null;
}
