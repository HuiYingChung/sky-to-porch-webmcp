"use client";

import type { ReactNode } from "react";
import { FailureGapStatus } from "@/components/states/failure-gap-status";
import {
  mapFailureGapStates,
  type FailureGapMappableResult,
} from "@/lib/ui/failure-gap-mapping";

export function ResultFailureGapBoundary({
  result,
  tab,
  children,
}: {
  result: FailureGapMappableResult;
  tab: "meaning" | "evidence" | "missions";
  children: ReactNode;
}) {
  const mapping = mapFailureGapStates(result, tab);
  if (mapping.states.length === 0) return children;

  const statuses = (
    <div
      role="group"
      aria-label="Result limitations and recovery status"
      data-testid="result-failure-gap-statuses"
      style={{ display: "grid", gap: "8px", marginTop: "12px" }}
    >
      {mapping.states.map((state) => (
        <FailureGapStatus key={state.kind} state={state} />
      ))}
    </div>
  );

  return (
    <div data-testid="result-failure-gap-boundary">
      {mapping.hasPresentableEvidence ? (
        <>
          {children}
          {statuses}
        </>
      ) : (
        <>
          {statuses}
          {children}
        </>
      )}
    </div>
  );
}
