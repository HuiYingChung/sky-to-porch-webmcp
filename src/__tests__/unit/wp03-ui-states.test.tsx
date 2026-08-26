/**
 * src/__tests__/unit/wp03-ui-states.test.tsx
 *
 * Deterministic unit tests for base UI state components.
 * Covers: LoadingState, EmptyState, ErrorState semantics and accessibility.
 *
 * Uses Vitest + React 19's built-in renderToString for server-side rendering
 * checks, plus jsdom-based DOM tests via ReactDOM for client rendering.
 * No external testing-library dependency required.
 */

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { LoadingState, EmptyState, ErrorState } from "@/components/states/base-states";

function renderToDOM(ui: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(ui);
  });
  return container;
}

function cleanup(container: HTMLElement) {
  document.body.removeChild(container);
}

describe("LoadingState", () => {
  it("renders with role=status", () => {
    const container = renderToDOM(<LoadingState />);
    const el = container.querySelector("[role='status']");
    expect(el).not.toBeNull();
    cleanup(container);
  });

  it("uses default label via aria-label", () => {
    const container = renderToDOM(<LoadingState />);
    const el = container.querySelector("[role='status']");
    expect(el?.getAttribute("aria-label")).toBe("Loading…");
    cleanup(container);
  });

  it("accepts a custom label", () => {
    const container = renderToDOM(<LoadingState label="Fetching satellite data…" />);
    const el = container.querySelector("[role='status']");
    expect(el?.getAttribute("aria-label")).toBe("Fetching satellite data…");
    expect(el?.textContent).toContain("Fetching satellite data…");
    cleanup(container);
  });

  it("has aria-live=polite", () => {
    const container = renderToDOM(<LoadingState />);
    const el = container.querySelector("[role='status']");
    expect(el?.getAttribute("aria-live")).toBe("polite");
    cleanup(container);
  });

  it("has data-testid=loading-state", () => {
    const container = renderToDOM(<LoadingState />);
    const el = container.querySelector("[data-testid='loading-state']");
    expect(el).not.toBeNull();
    cleanup(container);
  });
});

describe("EmptyState", () => {
  it("renders with role=status", () => {
    const container = renderToDOM(<EmptyState message="No evidence available." />);
    const el = container.querySelector("[role='status']");
    expect(el).not.toBeNull();
    cleanup(container);
  });

  it("displays the message without implying safety", () => {
    const container = renderToDOM(<EmptyState message="No observations were found for this location." />);
    const el = container.querySelector("[role='status']");
    const text = el?.textContent ?? "";
    expect(text).toContain("No observations were found for this location.");
    // Must NOT include falsely reassuring language
    expect(text.toLowerCase()).not.toContain("no danger");
    expect(text.toLowerCase()).not.toContain("safe");
    cleanup(container);
  });

  it("renders an optional hint", () => {
    const container = renderToDOM(
      <EmptyState
        message="No data for selected range."
        hint="Try selecting a wider time range."
      />
    );
    expect(container.textContent).toContain("Try selecting a wider time range.");
    cleanup(container);
  });

  it("has data-testid=empty-state", () => {
    const container = renderToDOM(<EmptyState message="Nothing yet." />);
    const el = container.querySelector("[data-testid='empty-state']");
    expect(el).not.toBeNull();
    cleanup(container);
  });
});

describe("ErrorState", () => {
  it("renders with role=alert", () => {
    const container = renderToDOM(<ErrorState />);
    const el = container.querySelector("[role='alert']");
    expect(el).not.toBeNull();
    cleanup(container);
  });

  it("shows a safe default message without provider details", () => {
    const container = renderToDOM(<ErrorState />);
    const el = container.querySelector("[role='alert']");
    const text = el?.textContent ?? "";
    expect(text).not.toContain("http");
    expect(text).not.toContain("API");
    expect(text).not.toContain("credentials");
    expect(text).toContain("Something went wrong");
    cleanup(container);
  });

  it("accepts a custom safe message", () => {
    const container = renderToDOM(
      <ErrorState message="Could not reach the data service. Please try again." />
    );
    const el = container.querySelector("[role='alert']");
    const text = el?.textContent ?? "";
    expect(text).toContain("Could not reach the data service");
    expect(text).not.toContain("http");
    cleanup(container);
  });

  it("renders recovery button when both recoveryLabel and onRecover provided", () => {
    const onRecover = vi.fn();
    const container = renderToDOM(
      <ErrorState
        message="Something went wrong."
        recoveryLabel="Try again"
        onRecover={onRecover}
      />
    );
    const btn = container.querySelector("[data-testid='error-recovery-btn']") as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    act(() => { btn?.click(); });
    expect(onRecover).toHaveBeenCalledTimes(1);
    cleanup(container);
  });

  it("does not render recovery button without onRecover", () => {
    const container = renderToDOM(
      <ErrorState message="Something went wrong." recoveryLabel="Try again" />
    );
    const btn = container.querySelector("[data-testid='error-recovery-btn']");
    expect(btn).toBeNull();
    cleanup(container);
  });

  it("has data-testid=error-state", () => {
    const container = renderToDOM(<ErrorState />);
    const el = container.querySelector("[data-testid='error-state']");
    expect(el).not.toBeNull();
    cleanup(container);
  });
});
