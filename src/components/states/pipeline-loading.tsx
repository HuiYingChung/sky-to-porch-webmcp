"use client";
/**
 * src/components/states/pipeline-loading.tsx
 *
 * Staged loading indicator for evidence queries. Shows the real pipeline
 * stages (coverage check, retrieval, validation, explanation) instead of a
 * single waiting sentence, so the 10–20 s a live query takes reads as the
 * system working through its checks rather than hanging.
 *
 * Honesty rule: stage advancement is a client-side time estimate, not
 * telemetry. The copy therefore names what the pipeline does, and never
 * claims a specific upstream call has completed. The whole element remains
 * one polite live region, like the sentence it replaces.
 */

import React, { useEffect, useState } from "react";

interface PipelineStage {
  label: string;
  /** Elapsed milliseconds at which this stage becomes the current one. */
  atMs: number;
}

const DEFAULT_STAGES: PipelineStage[] = [
  { label: "Checking area and source coverage", atMs: 0 },
  { label: "Fetching observations from source agencies", atMs: 2_500 },
  { label: "Validating evidence", atMs: 9_000 },
  { label: "Writing the plain-English answer", atMs: 14_000 },
];

const TICK_MS = 500;

interface PipelineLoadingProps {
  /** Test id preserved from the loading sentence this indicator replaces. */
  testId: string;
  stages?: PipelineStage[];
}

export function PipelineLoading({ testId, stages = DEFAULT_STAGES }: PipelineLoadingProps) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsedMs((ms) => ms + TICK_MS), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const currentIndex = stages.reduce(
    (current, stage, index) => (elapsedMs >= stage.atMs ? index : current),
    0
  );

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId}
      style={{ display: "grid", gap: "7px", fontSize: "14px" }}
    >
      {stages.map((stage, index) => {
        const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "pending";
        return (
          <div
            key={stage.label}
            data-stage-state={state}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              color:
                state === "current"
                  ? "var(--text-primary)"
                  : state === "done"
                    ? "var(--text-secondary)"
                    : "var(--text-muted)",
              fontWeight: state === "current" ? 600 : 400,
              transition: "color 300ms ease",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: "18px",
                height: "18px",
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "14px",
                lineHeight: 1,
                borderRadius: "50%",
                border:
                  state === "pending"
                    ? "1.5px solid var(--border-default)"
                    : "1.5px solid transparent",
                background:
                  state === "done"
                    ? "var(--surface-2)"
                    : state === "current"
                      ? "var(--text-link)"
                      : "transparent",
                color: state === "done" ? "var(--text-secondary)" : "#fff",
                // The current stage pulses; prefers-reduced-motion is
                // respected via the global CSS rule for [data-stage-state].
                animation: state === "current" ? "pipeline-pulse 1.4s ease-in-out infinite" : "none",
              }}
            >
              {state === "done" ? "✓" : ""}
            </span>
            <span>{stage.label}{state === "current" ? "…" : ""}</span>
          </div>
        );
      })}
    </div>
  );
}
