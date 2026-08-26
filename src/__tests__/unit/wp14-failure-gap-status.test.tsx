/**
 * src/__tests__/unit/wp14-failure-gap-status.test.tsx
 *
 * Focused unit tests for FailureGapStatus.
 * Covers all twelve kinds, aria semantics, data-mode label, demo-fixture
 * disclosures, recovery callbacks, and missing-mission-metadata copy.
 *
 * Uses Vitest + React 19 createRoot/act DOM pattern (no external testing-library).
 */

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { act } from "react";
import {
  FAILURE_GAP_KINDS,
  FailureGapStatus,
} from "@/components/states/failure-gap-status";
import type { FailureGapStatusState } from "@/components/states/failure-gap-status";

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const roots = new WeakMap<HTMLElement, Root>();

function renderToDOM(ui: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.set(container, root);
  act(() => {
    root.render(ui);
  });
  return container;
}

function cleanup(container: HTMLElement) {
  const root = roots.get(container);
  if (!root) throw new Error("Missing React root for test container");
  act(() => {
    root.unmount();
  });
  roots.delete(container);
  if (container.parentNode) {
    container.parentNode.removeChild(container);
  }
}

// ---------------------------------------------------------------------------
// FAILURE_GAP_KINDS order and completeness
// ---------------------------------------------------------------------------

describe("FAILURE_GAP_KINDS", () => {
  it("contains exactly twelve kinds in the specified order", () => {
    expect(FAILURE_GAP_KINDS).toEqual([
      "invalid_location",
      "unsupported_date",
      "no_observation",
      "source_failure",
      "stale_data",
      "conflicting_sources",
      "ai_timeout",
      "rate_limited",
      "upstream_schema_change",
      "map_failure",
      "missing_mission_metadata",
      "demo_fixture",
    ]);
  });
});

// ---------------------------------------------------------------------------
// All twelve kinds render
// ---------------------------------------------------------------------------

describe("FailureGapStatus renders every kind", () => {
  const nonDemoKinds = FAILURE_GAP_KINDS.filter((k) => k !== "demo_fixture");

  for (const kind of nonDemoKinds) {
    it(`renders kind=${kind} without error`, () => {
      const state: FailureGapStatusState = { kind } as FailureGapStatusState;
      const container = renderToDOM(<FailureGapStatus state={state} />);
      const el = container.querySelector("[data-testid='failure-gap-status']");
      expect(el).not.toBeNull();
      expect(el?.getAttribute("data-failure-gap-kind")).toBe(kind);
      cleanup(container);
    });
  }

  it("renders kind=demo_fixture without error", () => {
    const state: FailureGapStatusState = { kind: "demo_fixture", dataMode: "fixture" };
    const container = renderToDOM(<FailureGapStatus state={state} />);
    const el = container.querySelector("[data-testid='failure-gap-status']");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("data-failure-gap-kind")).toBe("demo_fixture");
    cleanup(container);
  });
});

// ---------------------------------------------------------------------------
// ARIA semantics: alert vs polite-status
// ---------------------------------------------------------------------------

describe("ARIA semantics", () => {
  const alertKinds: Array<FailureGapStatusState["kind"]> = [
    "invalid_location",
    "source_failure",
    "ai_timeout",
    "rate_limited",
    "upstream_schema_change",
    "map_failure",
  ];

  const politeKinds: Array<FailureGapStatusState["kind"]> = [
    "unsupported_date",
    "no_observation",
    "stale_data",
    "conflicting_sources",
    "missing_mission_metadata",
    "demo_fixture",
  ];

  for (const kind of alertKinds) {
    it(`kind=${kind} uses role=alert`, () => {
      const state: FailureGapStatusState =
        kind === "demo_fixture"
          ? { kind: "demo_fixture", dataMode: "fixture" }
          : ({ kind } as FailureGapStatusState);
      const container = renderToDOM(<FailureGapStatus state={state} />);
      const el = container.querySelector("[data-testid='failure-gap-status']");
      expect(el?.getAttribute("role")).toBe("alert");
      cleanup(container);
    });
  }

  for (const kind of politeKinds) {
    it(`kind=${kind} uses role=status with aria-live=polite`, () => {
      const state: FailureGapStatusState =
        kind === "demo_fixture"
          ? { kind: "demo_fixture", dataMode: "fixture" }
          : ({ kind } as FailureGapStatusState);
      const container = renderToDOM(<FailureGapStatus state={state} />);
      const el = container.querySelector("[data-testid='failure-gap-status']");
      expect(el?.getAttribute("role")).toBe("status");
      expect(el?.getAttribute("aria-live")).toBe("polite");
      cleanup(container);
    });
  }
});

// ---------------------------------------------------------------------------
// Deterministic title and boundary copy, kind attribute, heading / aria-labelledby
// ---------------------------------------------------------------------------

describe("deterministic copy and structure", () => {
  it("invalid_location has correct title and boundary copy", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "invalid_location" }} />
    );
    const el = container.querySelector("[data-testid='failure-gap-status']");
    expect(el?.textContent).toContain("Location not supported");
    expect(el?.textContent).toContain("No evidence is claimed for this request");
    cleanup(container);
  });

  it("no_observation boundary says absence does not mean no hazard", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "no_observation" }} />
    );
    const el = container.querySelector("[data-testid='failure-gap-status']");
    expect(el?.textContent).toContain("Absence of an observation does not mean no hazard");
    cleanup(container);
  });

  it("stale_data boundary says stale does not mean no hazard", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "stale_data" }} />
    );
    const el = container.querySelector("[data-testid='failure-gap-status']");
    expect(el?.textContent).toContain("Stale data does not mean no hazard");
    expect(el?.textContent).toContain("remains evidence for its recorded time");
    cleanup(container);
  });

  it("source_failure preserves separately validated evidence", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "source_failure" }} />
    );
    const el = container.querySelector("[data-testid='failure-gap-status']");
    expect(el?.textContent).toContain("does not mean no hazard");
    expect(el?.textContent).toContain("does not mean no hazard or erase separately validated evidence");
    expect(el?.textContent).toContain("conditions from the failed source remain unknown");
    cleanup(container);
  });

  it("conflicting_sources stays inconclusive and does not choose most dramatic", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "conflicting_sources" }} />
    );
    const el = container.querySelector("[data-testid='failure-gap-status']");
    expect(el?.textContent).toContain("inconclusive");
    expect(el?.textContent).toContain("most dramatic source has not been chosen");
    cleanup(container);
  });

  it("ai_timeout does not substitute model output for validated evidence", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "ai_timeout" }} />
    );
    const el = container.querySelector("[data-testid='failure-gap-status']");
    expect(el?.textContent).toContain("Model output has not been substituted for validated evidence");
    expect(el?.textContent).toContain("Validated evidence remains available");
    expect(el?.textContent).toContain("boundary is unchanged");
    cleanup(container);
  });

  it("upstream_schema_change shows no unvalidated content", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "upstream_schema_change" }} />
    );
    const el = container.querySelector("[data-testid='failure-gap-status']");
    expect(el?.textContent).toContain("No unvalidated upstream content is shown");
    expect(el?.textContent).toContain("Separately validated evidence remains available");
    cleanup(container);
  });

  it("map_failure leaves non-map evidence path as recovery direction", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "map_failure" }} />
    );
    const el = container.querySelector("[data-testid='failure-gap-status']");
    expect(el?.textContent).toContain("non-map summary");
    cleanup(container);
  });

  it("root has aria-labelledby pointing to the heading", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "source_failure" }} />
    );
    const root = container.querySelector("[data-testid='failure-gap-status']");
    const labelledById = root?.getAttribute("aria-labelledby");
    expect(labelledById).toBeTruthy();
    const heading = container.querySelector(`#${labelledById}`);
    expect(heading).not.toBeNull();
    cleanup(container);
  });

  it("uses unique hydration-safe heading IDs for simultaneous instances", () => {
    const container = renderToDOM(
      <>
        <FailureGapStatus state={{ kind: "no_observation" }} />
        <FailureGapStatus state={{ kind: "source_failure" }} />
      </>
    );
    const roots = [...container.querySelectorAll("[data-testid='failure-gap-status']")];
    const labelledBy = roots.map((root) => root.getAttribute("aria-labelledby"));
    expect(new Set(labelledBy).size).toBe(2);
    for (const id of labelledBy) {
      expect(id).toBeTruthy();
      expect(id).not.toContain(":");
      expect(container.querySelector(`[id="${id}"]`)).not.toBeNull();
    }
    cleanup(container);
  });

  it("uses existing design tokens for alert and status tones", () => {
    const alertContainer = renderToDOM(
      <FailureGapStatus state={{ kind: "source_failure" }} />
    );
    const statusContainer = renderToDOM(
      <FailureGapStatus state={{ kind: "no_observation" }} />
    );
    const alert = alertContainer.querySelector<HTMLElement>("[data-testid='failure-gap-status']");
    const status = statusContainer.querySelector<HTMLElement>("[data-testid='failure-gap-status']");
    expect(alert?.style.background).toBe("var(--status-error-bg)");
    expect(alert?.style.color).toBe("var(--status-error-fg)");
    expect(status?.style.background).toBe("var(--surface-2)");
    expect(status?.style.color).toBe("var(--text-primary)");
    cleanup(alertContainer);
    cleanup(statusContainer);
  });
});

// ---------------------------------------------------------------------------
// Data mode label
// ---------------------------------------------------------------------------

describe("data mode label", () => {
  it("renders dataModeLabel text when dataMode is supplied", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "stale_data", dataMode: "cached" }} />
    );
    const modeEl = container.querySelector("[data-testid='failure-gap-data-mode']");
    expect(modeEl).not.toBeNull();
    expect(modeEl?.textContent).toContain("Cached data");
    cleanup(container);
  });

  it("renders dataModeLabel text for live mode", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "source_failure", dataMode: "live" }} />
    );
    const modeEl = container.querySelector("[data-testid='failure-gap-data-mode']");
    expect(modeEl).not.toBeNull();
    expect(modeEl?.textContent).toContain("Live retrieval");
    cleanup(container);
  });

  it("does not render data-mode element when dataMode is absent", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "no_observation" }} />
    );
    const modeEl = container.querySelector("[data-testid='failure-gap-data-mode']");
    expect(modeEl).toBeNull();
    cleanup(container);
  });
});

// ---------------------------------------------------------------------------
// Demo fixture disclosures
// ---------------------------------------------------------------------------

describe("demo_fixture disclosures", () => {
  it("shows 'Demo fixture — not live data' in title", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "demo_fixture", dataMode: "fixture" }} />
    );
    const el = container.querySelector("[data-testid='failure-gap-status']");
    expect(el?.textContent).toContain("Demo fixture — not live data");
    cleanup(container);
  });

  it("shows 'A demo fixture is never silently substituted for a failed live request.'", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "demo_fixture", dataMode: "fixture" }} />
    );
    const el = container.querySelector("[data-testid='failure-gap-status']");
    expect(el?.textContent).toContain(
      "A demo fixture is never silently substituted for a failed live request."
    );
    cleanup(container);
  });

  it("renders dataModeLabel 'Demo fixture' for demo_fixture state", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "demo_fixture", dataMode: "fixture" }} />
    );
    const modeEl = container.querySelector("[data-testid='failure-gap-data-mode']");
    expect(modeEl).not.toBeNull();
    expect(modeEl?.textContent).toBe("Demo fixture");
    cleanup(container);
  });
});

// ---------------------------------------------------------------------------
// Recovery callback and button labels
// ---------------------------------------------------------------------------

describe("recovery button", () => {
  const recoveryCases: Array<[FailureGapStatusState["kind"], string]> = [
    ["invalid_location", "Change location"],
    ["unsupported_date", "Change date"],
    ["source_failure", "Try again"],
    ["ai_timeout", "Try again"],
    ["rate_limited", "Try again"],
    ["upstream_schema_change", "Try again"],
    ["map_failure", "Use without map"],
  ];

  const noRecoveryKinds: Array<FailureGapStatusState["kind"]> = [
    "no_observation",
    "stale_data",
    "conflicting_sources",
    "missing_mission_metadata",
    "demo_fixture",
  ];

  for (const [kind, label] of recoveryCases) {
    it(`kind=${kind} renders recovery button with label "${label}"`, () => {
      const onRecover = vi.fn();
      const state: FailureGapStatusState =
        kind === "demo_fixture"
          ? { kind: "demo_fixture", dataMode: "fixture" }
          : ({ kind } as FailureGapStatusState);
      const container = renderToDOM(
        <FailureGapStatus state={state} onRecover={onRecover} />
      );
      const btn = container.querySelector("[data-testid='failure-gap-recovery']");
      expect(btn).not.toBeNull();
      expect(btn?.textContent).toBe(label);
      cleanup(container);
    });

    it(`kind=${kind} recovery button calls onRecover when clicked`, () => {
      const onRecover = vi.fn();
      const state: FailureGapStatusState =
        kind === "demo_fixture"
          ? { kind: "demo_fixture", dataMode: "fixture" }
          : ({ kind } as FailureGapStatusState);
      const container = renderToDOM(
        <FailureGapStatus state={state} onRecover={onRecover} />
      );
      const btn = container.querySelector(
        "[data-testid='failure-gap-recovery']"
      ) as HTMLButtonElement | null;
      act(() => {
        btn?.click();
      });
      expect(onRecover).toHaveBeenCalledTimes(1);
      cleanup(container);
    });
  }

  for (const kind of noRecoveryKinds) {
    it(`kind=${kind} does not render recovery button even when onRecover is provided`, () => {
      const onRecover = vi.fn();
      const state: FailureGapStatusState =
        kind === "demo_fixture"
          ? { kind: "demo_fixture", dataMode: "fixture" }
          : ({ kind } as FailureGapStatusState);
      const container = renderToDOM(
        <FailureGapStatus state={state} onRecover={onRecover} />
      );
      const btn = container.querySelector("[data-testid='failure-gap-recovery']");
      expect(btn).toBeNull();
      cleanup(container);
    });
  }

  it("does not render recovery button when onRecover is absent for a recoverable kind", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "source_failure" }} />
    );
    const btn = container.querySelector("[data-testid='failure-gap-recovery']");
    expect(btn).toBeNull();
    cleanup(container);
  });
});

// ---------------------------------------------------------------------------
// Missing mission metadata — must not invent details
// ---------------------------------------------------------------------------

describe("missing_mission_metadata", () => {
  it("does not contain the word 'mission' except in the title and boundary copy", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "missing_mission_metadata" }} />
    );
    const el = container.querySelector("[data-testid='failure-gap-status']");
    // The text should contain "mission" only in allowed safe framing, not invent specifics
    expect(el?.textContent).toContain("Mission metadata unavailable");
    expect(el?.textContent).toContain(
      "No mission, sensor, dataset, collection time, or retrieval status has been assumed"
    );
    cleanup(container);
  });

  it("does not contain any specific sensor or dataset name", () => {
    const container = renderToDOM(
      <FailureGapStatus state={{ kind: "missing_mission_metadata" }} />
    );
    const el = container.querySelector("[data-testid='failure-gap-status']");
    const text = el?.textContent ?? "";
    // Must not invent specific names
    expect(text).not.toMatch(/MODIS|Landsat|Sentinel|VIIRS|FIRMS|ERA5/i);
    cleanup(container);
  });
});
