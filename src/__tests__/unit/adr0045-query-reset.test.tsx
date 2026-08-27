/**
 * ADR-0045: sticky quick-nav chips and the Start over reset in the query
 * panel. React DOM only, no network: Start over must return the shared draft,
 * canonical selection, and local editor drafts to the untouched state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { QueryProvider, useQueryDraft } from "@/components/query/query-provider";
import { GuidedQuery } from "@/components/query/guided-query";

let container: HTMLElement;
let root: Root;

function CanonicalSelectionProbe() {
  const { placeSelection, draft } = useQueryDraft();
  return (
    <output
      data-testid="canonical-selection-probe"
      data-hazard={draft.hazardId ?? ""}
      data-concern={draft.concern ?? ""}
      data-demo-place-id={placeSelection?.demoPlaceId ?? ""}
    />
  );
}

function renderGuidedQuery() {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(
      <QueryProvider>
        <GuidedQuery idPrefix="t-" />
        <CanonicalSelectionProbe />
      </QueryProvider>
    );
  });
}

function byTestId(testId: string): HTMLElement {
  const el = container.querySelector(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`missing element [data-testid="${testId}"]`);
  return el as HTMLElement;
}

function click(el: HTMLElement) {
  act(() => {
    el.click();
  });
}

beforeEach(() => {
  // jsdom does not implement scrollIntoView; the chips only need it to exist.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("ADR-0045 sticky quick-nav", () => {
  it("renders both section chips and Start over inside one nav landmark", () => {
    renderGuidedQuery();
    const nav = byTestId("t-gq-quick-nav");
    expect(nav.tagName).toBe("NAV");
    expect(nav.getAttribute("aria-label")).toBe("Query panel sections");
    expect(byTestId("t-gq-nav-demo").textContent).toBe("Real events");
    // ADR-0047 owner review: "Build your own" paired with "Real events" read
    // as real-vs-fabricated; "Ask your own" matches the form's own heading.
    expect(byTestId("t-gq-nav-build").textContent).toBe("Ask your own");
    expect(byTestId("t-gq-start-over").textContent).toBe("Start over");
    // None of the nav buttons may submit the form.
    for (const id of ["t-gq-nav-demo", "t-gq-nav-build", "t-gq-start-over"]) {
      expect(byTestId(id).getAttribute("type")).toBe("button");
    }
  });

  it("scrolls to the demo gallery and the build-your-own form", () => {
    renderGuidedQuery();
    click(byTestId("t-gq-nav-demo"));
    click(byTestId("t-gq-nav-build"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });
});

describe("ADR-0045 Start over", () => {
  it("resets story prefill, draft fields, and local editor drafts", () => {
    renderGuidedQuery();
    // One-tap story prefill (ADR-0044) fills place, hazard, and dates.
    click(byTestId("t-gq-place-demo-houston"));
    const probe = byTestId("canonical-selection-probe");
    expect(probe.getAttribute("data-demo-place-id")).toBe("demo-houston");
    expect(probe.getAttribute("data-hazard")).toBe("wind_storm");

    const concernSelect = byTestId("concern-select") as HTMLSelectElement;
    act(() => {
      concernSelect.value = "health";
      concernSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(probe.getAttribute("data-concern")).toBe("health");

    click(byTestId("t-gq-start-over"));
    expect(probe.getAttribute("data-demo-place-id")).toBe("");
    expect(probe.getAttribute("data-hazard")).toBe("");
    expect(probe.getAttribute("data-concern")).toBe("");
    expect((byTestId("hazard-select") as HTMLSelectElement).value).toBe("");
    expect((byTestId("t-gq-place-search") as HTMLInputElement).value).toBe("");
    expect((byTestId("t-gq-radius-input") as HTMLInputElement).value).toBe("25");
    // The submit button returns to its disabled pre-selection state.
    expect((byTestId("find-evidence-btn") as HTMLButtonElement).disabled).toBe(true);
  });
});
