"use client";

import { useId, useState, type ReactNode } from "react";

interface ProgressiveDisclosureProps {
  children: ReactNode;
  collapsedLabel: string;
  expandedLabel?: string;
  testId: string;
}

/** Keyboard-operable disclosure for long result details. */
export function ProgressiveDisclosure({
  children,
  collapsedLabel,
  expandedLabel = "Hide details",
  testId,
}: ProgressiveDisclosureProps) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  return (
    <div data-testid={testId}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        data-testid={`${testId}-toggle`}
        onClick={() => setExpanded((current) => !current)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "7px",
          minHeight: "36px",
          padding: "7px 10px",
          border: "1px solid var(--border-default)",
          borderRadius: "6px",
          background: "var(--surface-2)",
          color: "var(--text-link)",
          font: "inherit",
          fontSize: "14px",
          fontWeight: 650,
          cursor: "pointer",
        }}
      >
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
        {expanded ? expandedLabel : collapsedLabel}
      </button>
      <div
        id={contentId}
        hidden={!expanded}
        data-testid={`${testId}-content`}
        style={{
          marginTop: "10px",
          paddingTop: "10px",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
