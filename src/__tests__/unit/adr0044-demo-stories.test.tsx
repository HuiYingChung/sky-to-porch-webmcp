/**
 * ADR-0044: curated demo stories. Data integrity of the story catalog, and
 * the gallery flow: one tap pre-fills place, radius, hazard, live mode, and
 * dates — leaving exactly the concern and optional question to the user.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { HAZARD_IDS } from "@/contracts/common";
import { QueryProvider, useQueryDraft } from "@/components/query/query-provider";
import { GuidedQuery } from "@/components/query/guided-query";
import {
  DEMO_STORIES,
  demoStoryPlace,
  resolveDemoStoryDates,
} from "@/data/places/demo-stories";
import { FLOOD_MAX_RANGE_DAYS } from "@/lib/flood/types";
import { latestCompletedUtcDate } from "@/lib/ui/date-input";

// ---------------------------------------------------------------------------
// Story catalog integrity
// ---------------------------------------------------------------------------

describe("ADR-0044 demo-story catalog", () => {
  it("covers six stories over six distinct places and all six hazard lines", () => {
    expect(DEMO_STORIES).toHaveLength(6);
    const placeIds = DEMO_STORIES.map((story) => story.placeId);
    expect(new Set(placeIds).size).toBe(6);
    const hazardIds = new Set(DEMO_STORIES.flatMap((s) => s.hazards.map((h) => h.hazardId)));
    for (const hazardId of HAZARD_IDS) expect(hazardIds).toContain(hazardId);
  });

  it("every story resolves to a registered place and valid hazard presets", () => {
    for (const story of DEMO_STORIES) {
      expect(() => demoStoryPlace(story)).not.toThrow();
      expect(story.hazards.length).toBeGreaterThanOrEqual(1);
      expect(story.hazards.length).toBeLessThanOrEqual(2);
      expect(story.radiusKm).toBeGreaterThanOrEqual(1);
      expect(story.radiusKm).toBeLessThanOrEqual(250);
      for (const hazard of story.hazards) {
        expect(HAZARD_IDS).toContain(hazard.hazardId);
        expect(hazard.timeLabel.length).toBeGreaterThan(2);
        const dates = resolveDemoStoryDates(hazard.preset, new Date("2026-08-21T12:00:00Z"));
        expect(dates.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(dates.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(dates.startDate <= dates.endDate).toBe(true);
        // Ranged hazards stay within their live caps; single-date hazards
        // must be one day.
        const spanDays =
          (Date.parse(`${dates.endDate}T00:00:00Z`) - Date.parse(`${dates.startDate}T00:00:00Z`)) /
            86_400_000 + 1;
        if (hazard.hazardId === "flood_storm" || hazard.hazardId === "fire_smoke") {
          expect(spanDays).toBeLessThanOrEqual(FLOOD_MAX_RANGE_DAYS);
        } else {
          expect(spanDays).toBe(1);
        }
        // Every fixed date is a completed historical UTC date.
        expect(dates.endDate < latestCompletedUtcDate(new Date("2026-08-21T12:00:00Z"))
          || hazard.preset.kind === "latest_completed").toBe(true);
      }
    }
  });

  it("latest_completed presets resolve to yesterday UTC", () => {
    const dates = resolveDemoStoryDates(
      { kind: "latest_completed" },
      new Date("2026-08-21T03:00:00Z")
    );
    expect(dates).toEqual({ startDate: "2026-08-20", endDate: "2026-08-20" });
  });
});

// ---------------------------------------------------------------------------
// Gallery flow (React DOM, no network)
// ---------------------------------------------------------------------------

let container: HTMLElement;
let root: Root;

function CanonicalSelectionProbe() {
  const { placeSelection, draft } = useQueryDraft();
  return (
    <output
      data-testid="canonical-selection-probe"
      data-hazard={draft.hazardId ?? ""}
      data-radius-km={placeSelection?.analysisArea.radiusKm ?? ""}
      data-demo-place-id={placeSelection?.demoPlaceId ?? ""}
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

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

const recordedCalls: Array<{ url: string; body: Record<string, unknown> }> = [];

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

describe("ADR-0044 demo gallery flow", () => {
  it("one tap pre-fills place, radius, hazard, and dates — only concern stays open", async () => {
    renderGuidedQuery();
    click(byTestId("t-gq-place-demo-houston"));
    await flush();

    const probe = byTestId("canonical-selection-probe");
    expect(probe.getAttribute("data-hazard")).toBe("flood_storm");
    expect(probe.getAttribute("data-demo-place-id")).toBe("demo-houston");
    expect(probe.getAttribute("data-radius-km")).toBe("50");
    expect(probe.getAttribute("data-start-ts")).toBe("2024-07-08T00:00:00Z");
    expect(probe.getAttribute("data-end-ts")).toBe("2024-07-09T23:59:59Z");

    // The one remaining decision is the concern; submit says so.
    expect((byTestId("find-evidence-btn") as HTMLButtonElement).disabled).toBe(true);
    expect(byTestId("submit-hint").textContent).toMatch(/concern/i);

    setSelectValue(byTestId("concern-select") as HTMLSelectElement, "home");
    await flush();
    click(byTestId("find-evidence-btn"));
    await flush();
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].url).toBe("/api/flood/query");
    expect(recordedCalls[0].body).toMatchObject({
      placeId: "custom-area",
      mode: "live",
      startDate: "2024-07-08",
      endDate: "2024-07-09",
    });
  });

  it("a second hazard chip switches the lens and its dates on the same card", async () => {
    renderGuidedQuery();
    click(byTestId("t-gq-place-demo-tucson"));
    await flush();
    const probe = byTestId("canonical-selection-probe");
    expect(probe.getAttribute("data-hazard")).toBe("extreme_heat");
    expect(probe.getAttribute("data-start-ts")).toBe("2025-07-10T00:00:00Z");

    click(byTestId("t-gq-place-demo-tucson-drought_land"));
    await flush();
    expect(probe.getAttribute("data-hazard")).toBe("drought_land");
    const latest = latestCompletedUtcDate();
    expect(probe.getAttribute("data-start-ts")).toBe(`${latest}T00:00:00Z`);
    expect(probe.getAttribute("data-end-ts")).toBe(`${latest}T23:59:59Z`);
  });

  it("the LA card offers the fire and air lenses of the same event", async () => {
    renderGuidedQuery();
    click(byTestId("t-gq-place-demo-los-angeles"));
    await flush();
    const probe = byTestId("canonical-selection-probe");
    expect(probe.getAttribute("data-hazard")).toBe("fire_smoke");
    expect(probe.getAttribute("data-start-ts")).toBe("2025-01-08T00:00:00Z");
    expect(probe.getAttribute("data-end-ts")).toBe("2025-01-10T23:59:59Z");

    click(byTestId("t-gq-place-demo-los-angeles-air_quality"));
    await flush();
    expect(probe.getAttribute("data-hazard")).toBe("air_quality");
    expect(probe.getAttribute("data-start-ts")).toBe("2025-01-09T00:00:00Z");
  });

  it("hides dev test scenarios outside dev mode", async () => {
    renderGuidedQuery();
    await flush();
    expect(queryTestId("t-gq-place-demo-lake-michigan")).toBeNull();
    expect(queryTestId("t-gq-place-demo-source-failure")).toBeNull();
    // The in-form demo shortcut list is gone; the gallery owns demo entry.
    expect(queryTestId("t-gq-place-results")).toBeNull();
  });
});
