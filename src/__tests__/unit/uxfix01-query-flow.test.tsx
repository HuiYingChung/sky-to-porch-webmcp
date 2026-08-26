/**
 * src/__tests__/unit/uxfix01-query-flow.test.tsx
 *
 * UXFIX-01 regression tests for the guided query flow (ADR-0021).
 *
 * Covers the exact failure the product review reproduced: after querying one
 * place/hazard (Houston flood), switching to another place/hazard (LA fire)
 * left the form stuck until a full page reload, because
 *   (a) selecting a place with an incomplete custom time draft threw and the
 *       selection never updated, and
 *   (b) forced time-type effects changed the local editor state without
 *       updating the canonical PlaceSelection.
 *
 * Also covers the UXFIX-01 product defaults:
 *   - "live" is the pre-selected evidence mode,
 *   - the fixture selector is hidden outside dev mode,
 *   - the single evidence-answer button explains why it is disabled,
 *   - custom dates are calendar dates bounded by source coverage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { QueryProvider, useQueryDraft } from "@/components/query/query-provider";
import { GuidedQuery } from "@/components/query/guided-query";
import {
  allowedTimeTypesForHazard,
  customDateBounds,
  latestCompletedUtcDate,
  tsToDateInput,
} from "@/lib/ui/date-input";
import { PINNED_FIXTURE_DATE, HMS_COMMON_START_DATE } from "@/lib/fire/types";

// ---------------------------------------------------------------------------
// DOM helpers (React 19 createRoot + act, no external testing library)
// ---------------------------------------------------------------------------

let container: HTMLElement;
let root: Root;

function CanonicalSelectionProbe() {
  const { placeSelection } = useQueryDraft();
  return (
    <output
      data-testid="canonical-selection-probe"
      data-radius-km={placeSelection?.analysisArea.radiusKm ?? ""}
      data-time-type={placeSelection?.timeSelection.type ?? ""}
      data-start-ts={placeSelection?.timeSelection.startTs ?? ""}
      data-end-ts={placeSelection?.timeSelection.endTs ?? ""}
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

function queryTestId(testId: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${testId}"]`);
}

function setSelectValue(el: HTMLSelectElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value"
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setInputValue(el: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// Fetch mock — the component only reads { ok, result }
// ---------------------------------------------------------------------------

interface RecordedCall {
  url: string;
  body: Record<string, unknown>;
}

const recordedCalls: RecordedCall[] = [];

beforeEach(() => {
  recordedCalls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      recordedCalls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return {
        json: async () => ({
          ok: true,
          result: { kind: "unsupported_place", rejectionReason: "test stub" },
        }),
      } as unknown as Response;
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (container?.parentNode) {
    act(() => root.unmount());
    container.remove();
  }
});

// ---------------------------------------------------------------------------
// Pure helper behavior
// ---------------------------------------------------------------------------

describe("UXFIX-01 date helpers", () => {
  it("latestCompletedUtcDate returns yesterday in UTC", () => {
    const now = new Date("2026-08-12T03:00:00Z");
    expect(latestCompletedUtcDate(now)).toBe("2026-08-11");
  });

  it("fire live bounds span the verified HMS archive to yesterday", () => {
    const now = new Date("2026-08-12T03:00:00Z");
    const bounds = customDateBounds("fire_smoke", "live", now);
    expect(bounds.minDate).toBe(HMS_COMMON_START_DATE);
    expect(bounds.maxDate).toBe("2026-08-11");
    expect(bounds.defaultDate).toBe("2026-08-11");
  });

  it("fixture bounds pin the calendar to the deterministic fixture date", () => {
    const bounds = customDateBounds("fire_smoke", "fixture");
    expect(bounds).toEqual({
      minDate: PINNED_FIXTURE_DATE,
      maxDate: PINNED_FIXTURE_DATE,
      defaultDate: PINNED_FIXTURE_DATE,
    });
  });

  it("all one-date hazard routes remain custom-only on every surface", () => {
    expect(allowedTimeTypesForHazard("flood_storm", "live")).toEqual(["custom"]);
    expect(allowedTimeTypesForHazard("extreme_heat", "live")).toEqual(["custom"]);
    expect(allowedTimeTypesForHazard("drought_land", "live")).toEqual(["custom"]);
    expect(allowedTimeTypesForHazard("air_quality", "live")).toEqual(["custom"]);
    expect(allowedTimeTypesForHazard("earth_volcanoes", "live")).toEqual(["custom"]);
  });

  it("tsToDateInput extracts the UTC date for the calendar editor", () => {
    expect(tsToDateInput("2024-07-08T23:59:59Z")).toBe("2024-07-08");
    expect(tsToDateInput(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Component behavior
// ---------------------------------------------------------------------------

describe("UXFIX-01 guided query flow", () => {
  it("uses one primary CTA and sends the trimmed question with the evidence query", async () => {
    renderGuidedQuery();
    click(byTestId("t-gq-place-demo-houston"));
    setSelectValue(byTestId("hazard-select") as HTMLSelectElement, "flood_storm");
    setSelectValue(byTestId("concern-select") as HTMLSelectElement, "power_internet");
    setTextareaValue(
      byTestId("optional-question") as HTMLTextAreaElement,
      "  Is there any power outage?  "
    );
    await flush();

    expect(queryTestId("interpret-question-btn")).toBeNull();
    expect(queryTestId("interpret-apply-btn")).toBeNull();
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    const button = byTestId("find-evidence-btn") as HTMLButtonElement;
    expect(button.textContent).toBe("Get evidence-based answer");

    click(button);
    await flush();
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0]).toMatchObject({
      url: "/api/flood/query",
      body: { optionalQuestion: "Is there any power outage?" },
    });
  });

  it("shows the required loading semantics on the same primary CTA", async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    }));
    renderGuidedQuery();
    click(byTestId("t-gq-place-demo-houston"));
    setSelectValue(byTestId("hazard-select") as HTMLSelectElement, "flood_storm");
    setSelectValue(byTestId("concern-select") as HTMLSelectElement, "home");
    await flush();

    const button = byTestId("find-evidence-btn") as HTMLButtonElement;
    click(button);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toBe("Finding and explaining evidence…");

    resolveRequest?.(new Response(JSON.stringify({
      ok: true,
      result: { kind: "unsupported_place", rejectionReason: "test stub" },
    }), { headers: { "Content-Type": "application/json" } }));
    await flush();
    await flush();
    expect(button.textContent).toBe("Get evidence-based answer");
  });

  it("pre-selects live mode and hides the fixture selector outside dev mode", async () => {
    renderGuidedQuery();
    click(byTestId("t-gq-place-demo-los-angeles"));
    setSelectValue(byTestId("hazard-select") as HTMLSelectElement, "fire_smoke");
    setSelectValue(byTestId("concern-select") as HTMLSelectElement, "home");
    await flush();

    // Product Query contains no implementation/data-mode control or disclosure.
    expect(queryTestId("fire-mode-select")).toBeNull();
    expect(queryTestId("data-mode-static")).toBeNull();

    // Live is pre-selected, so the query is submittable without a mode choice.
    const btn = byTestId("find-evidence-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("explains why the evidence-answer CTA is disabled instead of staying silently dead", async () => {
    renderGuidedQuery();
    setSelectValue(byTestId("hazard-select") as HTMLSelectElement, "fire_smoke");
    setSelectValue(byTestId("concern-select") as HTMLSelectElement, "home");
    await flush();

    const btn = byTestId("find-evidence-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(byTestId("submit-hint").textContent).toContain("Select a location");
  });

  it("switching flood_storm forces custom dates on the canonical selection, not just the editor", async () => {
    renderGuidedQuery();
    click(byTestId("t-gq-place-demo-houston"));
    setSelectValue(byTestId("hazard-select") as HTMLSelectElement, "flood_storm");
    setSelectValue(byTestId("concern-select") as HTMLSelectElement, "home");
    await flush();

    // The calendar editor shows auto-filled dates…
    const start = byTestId("t-gq-custom-start") as HTMLInputElement;
    const end = byTestId("t-gq-custom-end") as HTMLInputElement;
    expect(start.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(end.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // …and submitting actually sends those dates (canonical state agrees).
    click(byTestId("find-evidence-btn"));
    await flush();
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].url).toBe("/api/flood/query");
    expect(recordedCalls[0].body).toMatchObject({
      placeId: "custom-area",
      mode: "live",
      area: {
        west: expect.any(Number),
        south: expect.any(Number),
        east: expect.any(Number),
        north: expect.any(Number),
      },
    });
    const submittedArea = recordedCalls[0].body.area as {
      west: number;
      south: number;
      east: number;
      north: number;
    };
    expect((submittedArea.west + submittedArea.east) / 2).toBeCloseTo(-95.5, 5);
    expect((submittedArea.south + submittedArea.north) / 2).toBeCloseTo(29.5, 5);
    expect(recordedCalls[0].body).toMatchObject({
      placeId: "custom-area",
      mode: "live",
      startDate: start.value,
      endDate: end.value,
    });
  });

  it("Houston flood → LA fire switch submits again without a page reload", async () => {
    renderGuidedQuery();

    // First query: Houston flood (live).
    click(byTestId("t-gq-place-demo-houston"));
    setSelectValue(byTestId("hazard-select") as HTMLSelectElement, "flood_storm");
    setSelectValue(byTestId("concern-select") as HTMLSelectElement, "home");
    await flush();
    click(byTestId("find-evidence-btn"));
    await flush();
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].url).toBe("/api/flood/query");

    // Switch place while the time draft is a custom range: previously this
    // threw inside selectDemoPlace and the selection never changed.
    click(byTestId("t-gq-place-demo-los-angeles"));
    setSelectValue(byTestId("hazard-select") as HTMLSelectElement, "fire_smoke");
    await flush();

    // No selection error is shown and the button is usable again.
    expect(queryTestId("guided-query-selection-error")).toBeNull();
    const btn = byTestId("find-evidence-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    // Second query goes to the fire route for the new place.
    click(btn);
    await flush();
    expect(recordedCalls).toHaveLength(2);
    expect(recordedCalls[1].url).toBe("/api/fire/query");
    expect(recordedCalls[1].body).toMatchObject({
      placeId: "custom-area",
      mode: "live",
      area: {
        west: expect.any(Number),
        south: expect.any(Number),
        east: expect.any(Number),
        north: expect.any(Number),
      },
    });
    const time = recordedCalls[1].body.time as { kind: string };
    expect(time.kind).toBe("range");
  });

  it("shows one hazard-aware time editor instead of replacing a generic time choice", async () => {
    renderGuidedQuery();

    expect(queryTestId("t-gq-time-control")).toBeNull();
    expect(queryTestId("t-gq-time-type")).toBeNull();

    setSelectValue(byTestId("hazard-select") as HTMLSelectElement, "fire_smoke");
    await flush();
    expect(container.querySelectorAll('[data-testid="t-gq-time-control"]')).toHaveLength(1);
    expect(queryTestId("t-gq-time-type")).not.toBeNull();
    expect(queryTestId("t-gq-custom-date")).toBeNull();

    setSelectValue(byTestId("hazard-select") as HTMLSelectElement, "extreme_heat");
    await flush();
    expect(container.querySelectorAll('[data-testid="t-gq-time-control"]')).toHaveLength(1);
    expect(queryTestId("t-gq-time-type")).toBeNull();
    expect(queryTestId("t-gq-custom-date")).not.toBeNull();
    expect(queryTestId("t-gq-custom-start")).toBeNull();
    expect(queryTestId("t-gq-custom-end")).toBeNull();
  });

  it("preserves rapid radius and time edits in the canonical selection", async () => {
    renderGuidedQuery();
    // ADR-0044: the LA story card selects the Fire hazard, whose live mode
    // still offers the latest/past_7d time types this test exercises.
    click(byTestId("t-gq-place-demo-los-angeles"));
    setSelectValue(byTestId("t-gq-time-type") as HTMLSelectElement, "latest");
    await flush();

    const radius = byTestId("t-gq-radius-input") as HTMLInputElement;
    const timeType = byTestId("t-gq-time-type") as HTMLSelectElement;

    // Dispatch both controlled edits in one React batch. This reproduces the
    // browser race where each handler previously rebuilt from the same stale
    // PlaceSelection and the later edit discarded the earlier one.
    act(() => {
      const inputSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )!.set!;
      inputSetter.call(radius, "100");
      radius.dispatchEvent(new Event("input", { bubbles: true }));

      const selectSetter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value"
      )!.set!;
      selectSetter.call(timeType, "past_7d");
      timeType.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    const probe = byTestId("canonical-selection-probe");
    expect(probe.getAttribute("data-radius-km")).toBe("100");
    expect(probe.getAttribute("data-time-type")).toBe("past_7d");
    expect(queryTestId("selection-summary")).toBeNull();
  });

  it("switching hazards clears prior results for every hazard path (heat included)", async () => {
    renderGuidedQuery();
    click(byTestId("t-gq-place-demo-tucson"));
    setSelectValue(byTestId("hazard-select") as HTMLSelectElement, "extreme_heat");
    setSelectValue(byTestId("concern-select") as HTMLSelectElement, "health");
    await flush();
    click(byTestId("find-evidence-btn"));
    await flush();
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].url).toBe("/api/heat/query");
    expect(recordedCalls[0].body).toMatchObject({
      placeId: "custom-area",
      mode: "live",
      area: {
        west: expect.any(Number),
        south: expect.any(Number),
        east: expect.any(Number),
        north: expect.any(Number),
      },
    });

    // Change the one visible observation date: heat results must be invalidated
    // like fire/flood, and the canonical range mirrors the date at both ends.
    const date = byTestId("t-gq-custom-date") as HTMLInputElement;
    setInputValue(date, "2024-07-11");
    await flush();
    const probe = byTestId("canonical-selection-probe");
    expect(probe.getAttribute("data-start-ts")).toBe("2024-07-11T00:00:00Z");
    expect(probe.getAttribute("data-end-ts")).toBe("2024-07-11T23:59:59Z");
    // The submit button remains usable for a fresh query.
    expect((byTestId("find-evidence-btn") as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits the newly selected place geometry instead of reusing the prior location", async () => {
    renderGuidedQuery();
    click(byTestId("t-gq-place-demo-tucson"));
    setSelectValue(byTestId("concern-select") as HTMLSelectElement, "travel");
    await flush();
    click(byTestId("find-evidence-btn"));
    await flush();

    // ADR-0044: the Houston card switches to its own hazard (Flood) and
    // geometry; the second submit must carry the new place, not Tucson.
    click(byTestId("t-gq-place-demo-houston"));
    await flush();
    click(byTestId("find-evidence-btn"));
    await flush();

    expect(recordedCalls).toHaveLength(2);
    expect(recordedCalls.map((call) => call.url)).toEqual([
      "/api/heat/query",
      "/api/flood/query",
    ]);
    const centers = recordedCalls.map((call) => {
      const area = call.body.area as { west: number; south: number; east: number; north: number };
      return {
        lon: (area.west + area.east) / 2,
        lat: (area.south + area.north) / 2,
      };
    });
    expect(centers[0].lon).toBeCloseTo(-111.17, 5);
    expect(centers[0].lat).toBeCloseTo(32.24, 5);
    expect(centers[1].lon).toBeCloseTo(-95.5, 5);
    expect(centers[1].lat).toBeCloseTo(29.5, 5);
  });

  it("connects Drought to the same single CTA with a concern-aware request", async () => {
    renderGuidedQuery();
    click(byTestId("t-gq-place-demo-tucson"));
    setSelectValue(byTestId("hazard-select") as HTMLSelectElement, "drought_land");
    setSelectValue(byTestId("concern-select") as HTMLSelectElement, "pets");
    await flush();

    const question = byTestId("optional-question") as HTMLTextAreaElement;
    expect(question.maxLength).toBe(800);
    expect(container.querySelectorAll('[data-testid="find-evidence-btn"]')).toHaveLength(1);
    click(byTestId("find-evidence-btn"));
    await flush();

    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].url).toBe("/api/drought/query");
    expect(recordedCalls[0].body).toMatchObject({
      placeId: "custom-area",
      mode: "live",
      concern: "pets",
      area: {
        west: expect.any(Number),
        south: expect.any(Number),
        east: expect.any(Number),
        north: expect.any(Number),
      },
    });
  });

  it("connects Air Quality and volcano-only source-gap routes to the same canonical area", async () => {
    renderGuidedQuery();
    click(byTestId("t-gq-place-demo-tucson"));
    setSelectValue(byTestId("hazard-select") as HTMLSelectElement, "air_quality");
    setSelectValue(byTestId("concern-select") as HTMLSelectElement, "health");
    await flush();
    click(byTestId("find-evidence-btn"));
    await flush();

    expect(recordedCalls[0]).toMatchObject({
      url: "/api/air/query",
      body: {
        placeId: "custom-area",
        concern: "health",
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        area: {
          west: expect.any(Number),
          south: expect.any(Number),
          east: expect.any(Number),
          north: expect.any(Number),
        },
      },
    });
    expect(recordedCalls[0].body).not.toHaveProperty("mode");

    setSelectValue(byTestId("hazard-select") as HTMLSelectElement, "earth_volcanoes");
    setSelectValue(byTestId("concern-select") as HTMLSelectElement, "community");
    await flush();
    click(byTestId("find-evidence-btn"));
    await flush();

    expect(recordedCalls[1]).toMatchObject({
      url: "/api/volcano/query",
      body: {
        placeId: "custom-area",
        concern: "community",
        area: recordedCalls[0].body.area,
      },
    });
    expect(recordedCalls[1].body).not.toHaveProperty("mode");
  });
});

// ---------------------------------------------------------------------------
// ADR-0043: flood time-selection integrity
// ---------------------------------------------------------------------------

describe("ADR-0043 flood time-selection integrity", () => {
  async function setupFloodSelection() {
    renderGuidedQuery();
    click(byTestId("t-gq-place-demo-houston"));
    setSelectValue(byTestId("hazard-select") as HTMLSelectElement, "flood_storm");
    setSelectValue(byTestId("concern-select") as HTMLSelectElement, "home");
    await flush();
  }

  it("pulls the start date along on an inverted end edit — display equals canonical (B1/B2)", async () => {
    await setupFloodSelection();
    expect((byTestId("t-gq-custom-start") as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // End moved far before start: the start follows the edited field
    // visibly (no silent swap, no stale canonical range).
    setInputValue(byTestId("t-gq-custom-end") as HTMLInputElement, "2020-01-01");
    await flush();
    expect((byTestId("t-gq-custom-start") as HTMLInputElement).value).toBe("2020-01-01");
    expect((byTestId("t-gq-custom-end") as HTMLInputElement).value).toBe("2020-01-01");
    const probe = byTestId("canonical-selection-probe");
    expect(probe.getAttribute("data-start-ts")).toBe("2020-01-01T00:00:00Z");
    expect(probe.getAttribute("data-end-ts")).toBe("2020-01-01T23:59:59Z");

    // Submitting sends exactly what is displayed.
    click(byTestId("find-evidence-btn"));
    await flush();
    expect(recordedCalls.at(-1)?.body).toMatchObject({
      startDate: "2020-01-01",
      endDate: "2020-01-01",
    });
  });

  it("shortens an over-cap flood range from the edited side instead of dead-ending (B4)", async () => {
    await setupFloodSelection();
    // ADR-0044: the Houston story preset is Jul 8-9, 2024. Moving end a
    // month later pulls start to a 7-day window ending there, so distant
    // ranges stay reachable in either edit order.
    setInputValue(byTestId("t-gq-custom-end") as HTMLInputElement, "2024-08-09");
    await flush();
    expect((byTestId("t-gq-custom-start") as HTMLInputElement).value).toBe("2024-08-03");
    expect((byTestId("t-gq-custom-end") as HTMLInputElement).value).toBe("2024-08-09");
    const probe = byTestId("canonical-selection-probe");
    expect(probe.getAttribute("data-start-ts")).toBe("2024-08-03T00:00:00Z");
    expect(probe.getAttribute("data-end-ts")).toBe("2024-08-09T23:59:59Z");

    // Narrowing start afterwards keeps the exact chosen day.
    setInputValue(byTestId("t-gq-custom-start") as HTMLInputElement, "2024-08-09");
    await flush();
    expect(probe.getAttribute("data-start-ts")).toBe("2024-08-09T00:00:00Z");
  });

  it("never fabricates a swapped range via a radius edit (B2)", async () => {
    await setupFloodSelection();
    setInputValue(byTestId("t-gq-custom-end") as HTMLInputElement, "2020-01-01");
    await flush();
    setInputValue(byTestId("t-gq-radius-input") as HTMLInputElement, "30");
    await flush();
    const probe = byTestId("canonical-selection-probe");
    // The canonical range stays the visible one-day range — never a
    // silently swapped multi-year range.
    expect(probe.getAttribute("data-start-ts")).toBe("2020-01-01T00:00:00Z");
    expect(probe.getAttribute("data-end-ts")).toBe("2020-01-01T23:59:59Z");
    expect(probe.getAttribute("data-radius-km")).toBe("30");
  });
});
