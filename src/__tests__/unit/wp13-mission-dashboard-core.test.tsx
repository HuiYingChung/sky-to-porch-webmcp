/**
 * src/__tests__/unit/wp13-mission-dashboard-core.test.tsx
 *
 * Focused acceptance tests for MissionDashboardCore (WP-13).
 * Uses inline typed data and the existing React createRoot/act DOM pattern.
 *
 * Covers:
 *  - exact current-evidence order and fields
 *  - latest/unknown/not-available times
 *  - no outside/decorative entry
 *  - click callback IDs
 *  - controlled selection and relationship marker
 *  - failed retrieval with zero observations
 *  - empty attribution
 *  - absence of orbit/next-pass copy
 */

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MissionDashboardCore } from "@/components/missions/mission-dashboard-core";
import type { MissionDashboardCoreProps } from "@/components/missions/mission-dashboard-core";
import {
  MissionDashboard,
  ObservationSelectionButton,
} from "@/components/missions/mission-dashboard";
import type { MissionSelectionState } from "@/components/missions/mission-selection";
import type { EvidenceObject } from "@/contracts/evidence";

// ---------------------------------------------------------------------------
// renderToDOM / cleanup helpers (same pattern as wp03-ui-states.test.tsx)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Minimal valid EvidenceObject factory
// ---------------------------------------------------------------------------

const BASE_EVIDENCE: EvidenceObject = {
  evidenceId: "ev-wp13-001",
  hazardId: "flood_storm",
  intentId: "intent-001",
  evidenceState: "observations_returned",
  dataMode: "live",
  observations: [
    {
      observationId: "obs-001",
      provenance: {
        sourceId: "nasa_gibs_imerg",
        sourceUrl: "https://example.test/gpm",
        retrievedAt: "2024-06-01T12:00:00Z",
        observedAt: "2024-06-01T06:00:00Z",
        product: "GPM_3IMERGHH_v07",
        payloadHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      variableName: "Precipitation rate",
      value: 15.2,
      unit: "mm/hr",
      dataMode: "live",
    },
    {
      observationId: "obs-002",
      provenance: {
        sourceId: "nasa_lance_flood_extent",
        sourceUrl: "https://example.test/goes",
        retrievedAt: "2024-06-01T11:00:00Z",
        observedAt: "2024-06-01T10:30:00Z",
        product: "GOES-18_ABI_L2",
        payloadHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      variableName: "Cloud-top temperature",
      value: -45,
      unit: "°C",
      dataMode: "live",
    },
    {
      observationId: "obs-unknown",
      provenance: {
        sourceId: "usgs_instantaneous_values",
        sourceUrl: "https://example.test/x",
        retrievedAt: "2024-06-01T08:00:00Z",
        observedAt: "unknown",
        product: "unknown",
        payloadHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      },
      variableName: "Soil moisture index",
      value: 0.7,
      unit: "m³/m³",
      dataMode: "live",
    },
  ],
  derivedMetrics: [],
  missionAttributions: [
    {
      missionName: "GPM",
      agency: "NASA/JAXA",
      purpose: "Global precipitation measurement via dual-frequency radar",
      selectionReason: "Provides quantitative precipitation estimates for the hazard area",
      contributedObservationIds: ["obs-001"],
      retrievalStatus: "success",
      keyLimitation: "30-minute latency; 65°N–65°S coverage only",
      datasetId: "GPM_3IMERGHH_v07",
    },
    {
      missionName: "GOES-West",
      agency: "NOAA/NASA",
      purpose: "Geostationary visible and infrared imagery for weather monitoring",
      selectionReason: "Provides cloud-top temperature for convective cell detection",
      contributedObservationIds: ["obs-002"],
      retrievalStatus: "success",
      keyLimitation: "Fixed view geometry; parallax error at high latitudes",
    },
  ],
  freshness: {
    status: "current",
    classificationBasis: "age_thresholds",
    mostRecentObservationAt: "2024-06-01T10:30:00Z",
    evaluatedAt: "2024-06-01T12:00:00Z",
    ageSeconds: 3600,
    note: "Data is current",
  },
  confidence: {
    level: "moderate",
    rationale: "Two concordant real-time sources",
  },
  limitations: [],
  explanations: [],
  assembledAt: "2024-06-01T12:00:00Z",
};

// ---------------------------------------------------------------------------
// Helper: default no-op props
// ---------------------------------------------------------------------------

function defaultProps(
  overrides: Partial<MissionDashboardCoreProps> = {}
): MissionDashboardCoreProps {
  return {
    evidence: BASE_EVIDENCE,
    onSelectMission: vi.fn(),
    onSelectObservation: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MissionDashboardCore", () => {
  // --- Section heading and disclaimer ----------------------------------------

  it("renders a Relevant missions section", () => {
    const container = renderToDOM(<MissionDashboardCore {...defaultProps()} />);
    const section = container.querySelector("section[aria-labelledby]");
    expect(section).not.toBeNull();
    const headingId = section?.getAttribute("aria-labelledby");
    const heading = Array.from(container.querySelectorAll("h2")).find(
      (element) => element.id === headingId
    );
    expect(heading?.textContent).toBe("Relevant missions");
    cleanup(container);
  });

  it("uses unique heading IDs across concurrent dashboard instances", () => {
    const container = renderToDOM(
      <>
        <MissionDashboardCore {...defaultProps()} />
        <MissionDashboardCore {...defaultProps()} />
      </>
    );
    const labelledBy = Array.from(
      container.querySelectorAll("section[aria-labelledby]")
    ).map((section) => section.getAttribute("aria-labelledby"));
    expect(labelledBy).toHaveLength(2);
    expect(new Set(labelledBy).size).toBe(2);
    cleanup(container);
  });

  it("shows only-current-attributions disclaimer", () => {
    const container = renderToDOM(<MissionDashboardCore {...defaultProps()} />);
    expect(container.textContent).toContain("current evidence result");
    cleanup(container);
  });

  // --- Order and field accuracy -----------------------------------------------

  it("renders entries in attribution order", () => {
    const container = renderToDOM(<MissionDashboardCore {...defaultProps()} />);
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      "[data-testid='mission-entry'] > div > button[type='button']"
    );
    expect(buttons[0]?.textContent?.trim()).toBe("GPM");
    expect(buttons[1]?.textContent?.trim()).toBe("GOES-West");
    cleanup(container);
  });

  it("shows mission name, agency, role, retrieval status, why selected, key limitation", () => {
    const container = renderToDOM(<MissionDashboardCore {...defaultProps()} />);
    const text = container.textContent ?? "";
    // Mission names
    expect(text).toContain("GPM");
    expect(text).toContain("GOES-West");
    // Agencies
    expect(text).toContain("NASA/JAXA");
    expect(text).toContain("NOAA/NASA");
    // Role (maps purpose)
    expect(text).toContain("Global precipitation measurement via dual-frequency radar");
    // Retrieval status (human-readable)
    expect(text).toContain("Success");
    // Why selected
    expect(text).toContain("Provides quantitative precipitation estimates for the hazard area");
    // Key limitation
    expect(text).toContain("30-minute latency; 65°N–65°S coverage only");
    cleanup(container);
  });

  it("keeps dataset IDs, source IDs, and payload hashes out of visible text", () => {
    const container = renderToDOM(<MissionDashboardCore {...defaultProps()} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("GPM_3IMERGHH_v07");
    expect(text).not.toContain("GOES-18_ABI_L2");
    expect(text).not.toContain("nasa_gibs_imerg");
    expect(text).not.toContain("nasa_lance_flood_extent");
    expect(text).not.toContain("a".repeat(64));
    expect(text).not.toContain("b".repeat(64));
    cleanup(container);
  });

  it("replaces ID-only mission names and filename-shaped agencies with non-empty public text", () => {
    const privateMissionName = "evd-private-mission";
    const privateAgency = "internal-agency-record.json";
    const evidence: EvidenceObject = {
      ...BASE_EVIDENCE,
      missionAttributions: [{
        ...BASE_EVIDENCE.missionAttributions[0],
        missionName: privateMissionName,
        agency: privateAgency,
      }],
    };
    const container = renderToDOM(
      <MissionDashboardCore {...defaultProps({ evidence })} />
    );
    const text = container.textContent ?? "";

    expect(text).toContain("Details are not available.");
    expect(text).toContain("Official source organization");
    expect(text).not.toContain(privateMissionName);
    expect(text).not.toContain(privateAgency);
    cleanup(container);
  });

  // --- Latest known observation time ------------------------------------------

  it("shows chronologically latest observedAt for GPM (obs-001: 06:00)", () => {
    const container = renderToDOM(<MissionDashboardCore {...defaultProps()} />);
    // GPM contributes obs-001 which has observedAt 2024-06-01T06:00:00Z
    const text = container.textContent ?? "";
    expect(text).toContain("Jun 1, 2024, 6:00 AM UTC");
    expect(text).not.toContain("2024-06-01T06:00:00Z");
    cleanup(container);
  });

  it("shows later of two timestamps when multiple known observations contributed", () => {
    const evidence: EvidenceObject = {
      ...BASE_EVIDENCE,
      missionAttributions: [
        {
          missionName: "TEST-MULTI",
          agency: "TEST-AGENCY",
          purpose: "Multi-obs test purpose",
          selectionReason: "Test",
          contributedObservationIds: ["obs-001", "obs-002"],
          retrievalStatus: "success",
          keyLimitation: "None",
        },
      ],
    };
    const container = renderToDOM(
      <MissionDashboardCore {...defaultProps({ evidence })} />
    );
    // obs-002 has 2024-06-01T10:30:00Z (later than obs-001 2024-06-01T06:00:00Z)
    expect(container.textContent).toContain("Jun 1, 2024, 10:30 AM UTC");
    expect(container.textContent).not.toContain("2024-06-01T10:30:00Z");
    cleanup(container);
  });

  it("compares offset timestamps by instant rather than source string order", () => {
    const evidence: EvidenceObject = {
      ...BASE_EVIDENCE,
      observations: [
        {
          ...BASE_EVIDENCE.observations[0],
          observationId: "obs-offset",
          provenance: {
            ...BASE_EVIDENCE.observations[0].provenance,
            observedAt: "2024-06-01T10:30:00+02:00",
          },
        },
        {
          ...BASE_EVIDENCE.observations[1],
          observationId: "obs-zulu",
          provenance: {
            ...BASE_EVIDENCE.observations[1].provenance,
            observedAt: "2024-06-01T09:00:00Z",
          },
        },
      ],
      missionAttributions: [
        {
          missionName: "OFFSET-MISSION",
          agency: "TEST",
          purpose: "Offset comparison",
          selectionReason: "Regression coverage",
          contributedObservationIds: ["obs-offset", "obs-zulu"],
          retrievalStatus: "success",
          keyLimitation: "None",
        },
      ],
    };
    const container = renderToDOM(
      <MissionDashboardCore {...defaultProps({ evidence })} />
    );
    const latestLabel = Array.from(container.querySelectorAll("dt")).find(
      (element) => element.textContent === "Latest known observation"
    );
    expect(latestLabel?.nextElementSibling?.textContent).toBe(
      "Jun 1, 2024, 9:00 AM UTC"
    );
    cleanup(container);
  });

  it("shows Unknown when contributed observations exist but all times are unknown", () => {
    const evidence: EvidenceObject = {
      ...BASE_EVIDENCE,
      missionAttributions: [
        {
          missionName: "UNKNOWN-TIME-MISSION",
          agency: "TEST",
          purpose: "Unknown time test",
          selectionReason: "Test",
          contributedObservationIds: ["obs-unknown"],
          retrievalStatus: "success",
          keyLimitation: "None",
        },
      ],
    };
    const container = renderToDOM(
      <MissionDashboardCore {...defaultProps({ evidence })} />
    );
    // The only contributed obs has observedAt: "unknown"
    expect(container.textContent).toContain("Unknown");
    cleanup(container);
  });

  it("shows Not available when no observation IDs were contributed (failed retrieval)", () => {
    const evidence: EvidenceObject = {
      ...BASE_EVIDENCE,
      missionAttributions: [
        {
          missionName: "Unavailable weather source",
          agency: "TEST",
          purpose: "Failed retrieval test",
          selectionReason: "Test",
          contributedObservationIds: [],
          retrievalStatus: "failed",
          keyLimitation: "Data feed offline",
        },
      ],
    };
    const container = renderToDOM(
      <MissionDashboardCore {...defaultProps({ evidence })} />
    );
    expect(container.textContent).toContain("Not available");
    // Also verify Failed retrieval status is shown
    expect(container.textContent).toContain("Failed");
    cleanup(container);
  });

  // --- No outside / decorative entries ----------------------------------------

  it("renders exactly two list items for the two BASE_EVIDENCE attributions", () => {
    const container = renderToDOM(<MissionDashboardCore {...defaultProps()} />);
    const items = container.querySelectorAll("[data-testid='mission-entry']");
    expect(items.length).toBe(2);
    cleanup(container);
  });

  // --- Contributed observation variable and time -------------------------------

  // PR4b (owner rule): internal observation ids are developer identifiers and
  // must never render in user-facing text; the trace link carries the id.
  it("shows variable name and observedAt but never the internal observationId", () => {
    const container = renderToDOM(<MissionDashboardCore {...defaultProps()} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Precipitation rate");
    expect(text).toContain("Cloud-top temperature");
    expect(text).not.toContain("obs-001");
    expect(text).not.toContain("obs-002");
    expect(text).not.toContain("GPM_3IMERGHH_v07");
    expect(text).not.toContain("a".repeat(64));
    cleanup(container);
  });

  it("preserves official fire product names while hiding internal dataset identifiers", () => {
    const fireObservations = [
      {
        ...BASE_EVIDENCE.observations[0],
        observationId: "obs-fire",
        provenance: {
          ...BASE_EVIDENCE.observations[0].provenance,
          sourceId: "noaa_hms_fire_points" as const,
        },
      },
      {
        ...BASE_EVIDENCE.observations[1],
        observationId: "obs-perimeter",
        provenance: {
          ...BASE_EVIDENCE.observations[1].provenance,
          sourceId: "nifc_wfigs_fire_perimeters" as const,
        },
      },
    ];
    const evidence: EvidenceObject = {
      ...BASE_EVIDENCE,
      hazardId: "fire_smoke",
      observations: fireObservations,
      missionAttributions: [
        {
          ...BASE_EVIDENCE.missionAttributions[0],
          missionName: "NOAA HMS Fire Detection Points",
          agency: "NOAA",
          contributedObservationIds: ["obs-fire"],
        },
        {
          ...BASE_EVIDENCE.missionAttributions[1],
          missionName: "NIFC WFIGS Interagency Fire Perimeters",
          agency: "NIFC",
          contributedObservationIds: ["obs-perimeter"],
        },
        {
          missionName: "NOAA HMS (Live Retrieval — Failed)",
          agency: "NOAA",
          purpose: "Check daily fire and smoke information",
          selectionReason: "Requested fire and smoke information",
          contributedObservationIds: [],
          retrievalStatus: "failed",
          keyLimitation: "The source could not be checked",
        },
      ],
    };

    const container = renderToDOM(<MissionDashboardCore {...defaultProps({ evidence })} />);
    const text = container.textContent ?? "";
    expect(text).toContain("NOAA HMS Fire Detection Points");
    expect(text).toContain("NIFC WFIGS Interagency Fire Perimeters");
    expect(text).toContain("NOAA HMS (Live Retrieval — Failed)");
    for (const attribution of evidence.missionAttributions) {
      if (attribution.datasetId) expect(text).not.toContain(attribution.datasetId);
    }
    cleanup(container);
  });

  // --- Click callbacks --------------------------------------------------------

  it("calls onSelectMission with the entry key when mission button is clicked", () => {
    const onSelectMission = vi.fn();
    const container = renderToDOM(
      <MissionDashboardCore {...defaultProps({ onSelectMission })} />
    );
    const missionButtons = container.querySelectorAll<HTMLButtonElement>(
      "[data-testid='mission-entry'] > div > button[type='button']"
    );
    act(() => {
      missionButtons[0].click();
    });
    expect(onSelectMission).toHaveBeenCalledOnce();
    // Key contains mission name and agency
    const calledKey: string = onSelectMission.mock.calls[0][0];
    expect(calledKey).toContain("GPM");
    expect(calledKey).toContain("NASA_JAXA");
    cleanup(container);
  });

  it("calls onSelectObservation with the exact observationId when observation button is clicked", () => {
    const onSelectObservation = vi.fn();
    const container = renderToDOM(
      <MissionDashboardCore {...defaultProps({ onSelectObservation })} />
    );
    const obsButtons = container.querySelectorAll<HTMLButtonElement>(
      "li ul li button[type='button']"
    );
    act(() => {
      obsButtons[0].click();
    });
    expect(onSelectObservation).toHaveBeenCalledWith("obs-001");
    cleanup(container);
  });

  // --- Controlled selection and aria-pressed ----------------------------------

  it("sets aria-pressed=true on the selected mission button", () => {
    // Build the mission key the same deterministic way the component does:
    // missionName="GPM", agency="NASA/JAXA", datasetId="GPM_3IMERGHH_v07", idx=0
    // key = "GPM__NASA_JAXA__GPM_3IMERGHH_v07__0"
    const selectedMissionKey = "GPM__NASA_JAXA__GPM_3IMERGHH_v07__0";
    const container = renderToDOM(
      <MissionDashboardCore {...defaultProps({ selectedMissionKey })} />
    );
    const missionButtons = container.querySelectorAll<HTMLButtonElement>(
      "[data-testid='mission-entry'] > div > button[type='button']"
    );
    expect(missionButtons[0].getAttribute("aria-pressed")).toBe("true");
    expect(missionButtons[1].getAttribute("aria-pressed")).toBe("false");
    cleanup(container);
  });

  it("sets aria-pressed=true on the selected observation button", () => {
    const container = renderToDOM(
      <MissionDashboardCore {...defaultProps({ selectedObservationId: "obs-001" })} />
    );
    const obsButtons = container.querySelectorAll<HTMLButtonElement>(
      "li ul li button[type='button']"
    );
    expect(obsButtons[0].getAttribute("aria-pressed")).toBe("true");
    expect(obsButtons[1].getAttribute("aria-pressed")).toBe("false");
    cleanup(container);
  });

  // --- data-related-to-selected-observation -----------------------------------

  it("sets data-related-to-selected-observation=true on entries containing selectedObservationId", () => {
    const container = renderToDOM(
      <MissionDashboardCore {...defaultProps({ selectedObservationId: "obs-002" })} />
    );
    const items = container.querySelectorAll<HTMLLIElement>("[data-testid='mission-entry']");
    // obs-002 is in GOES-West (index 1)
    expect(items[0].getAttribute("data-related-to-selected-observation")).toBe("false");
    expect(items[1].getAttribute("data-related-to-selected-observation")).toBe("true");
    cleanup(container);
  });

  it("sets data-related-to-selected-observation=false on all entries when none selected", () => {
    const container = renderToDOM(
      <MissionDashboardCore {...defaultProps()} />
    );
    const items = container.querySelectorAll<HTMLLIElement>("[data-testid='mission-entry']");
    for (const item of items) {
      expect(item.getAttribute("data-related-to-selected-observation")).toBe("false");
    }
    cleanup(container);
  });

  // --- Empty attribution state -----------------------------------------------

  it("renders empty-attribution state when missionAttributions is empty", () => {
    const evidence: EvidenceObject = {
      ...BASE_EVIDENCE,
      missionAttributions: [],
    };
    const container = renderToDOM(
      <MissionDashboardCore {...defaultProps({ evidence })} />
    );
    const emptyEl = container.querySelector("[data-testid='empty-attribution-state']");
    expect(emptyEl).not.toBeNull();
    // No list items
    const items = container.querySelectorAll("ul > li");
    expect(items.length).toBe(0);
    cleanup(container);
  });

  // --- Absence of orbit/next-pass copy ----------------------------------------

  it("does not contain orbit or next-pass text", () => {
    const container = renderToDOM(<MissionDashboardCore {...defaultProps()} />);
    const text = (container.textContent ?? "").toLowerCase();
    expect(text).not.toContain("orbit");
    expect(text).not.toContain("next pass");
    expect(text).not.toContain("next-pass");
    cleanup(container);
  });
});

function MissionSelectionHarness() {
  const [selection, setSelection] = React.useState<MissionSelectionState>({});
  return (
    <>
      <MissionDashboard
        evidence={BASE_EVIDENCE}
        missionSelection={selection}
        onMissionSelectionChange={setSelection}
      />
      <ObservationSelectionButton
        evidence={BASE_EVIDENCE}
        observationId="obs-001"
        missionSelection={selection}
        onMissionSelectionChange={setSelection}
      />
      <ObservationSelectionButton
        evidence={BASE_EVIDENCE}
        observationId="obs-002"
        missionSelection={selection}
        onMissionSelectionChange={setSelection}
      />
    </>
  );
}

describe("Mission Dashboard selection integration", () => {
  it("projects a mission selection onto its Evidence observation", () => {
    const container = renderToDOM(<MissionSelectionHarness />);
    const missionButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='mission-entry'] > div > button[type='button']"
    );
    act(() => missionButton?.click());

    const relatedObservation = container.querySelector(
      "[data-testid='select-observation-obs-001']"
    );
    expect(
      relatedObservation?.getAttribute("data-related-to-selected-mission")
    ).toBe("true");
    expect(relatedObservation?.textContent).toBe("Related to selected mission");
    cleanup(container);
  });

  it("projects an Evidence observation selection back onto its mission", () => {
    const container = renderToDOM(<MissionSelectionHarness />);
    const observationButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='select-observation-obs-002']"
    );
    act(() => observationButton?.click());

    const missionEntries = container.querySelectorAll<HTMLLIElement>(
      "[data-testid='mission-entry']"
    );
    const missionButtons = container.querySelectorAll<HTMLButtonElement>(
      "[data-testid='mission-entry'] > div > button[type='button']"
    );
    expect(missionEntries[1].dataset.relatedToSelectedObservation).toBe("true");
    expect(missionButtons[1].getAttribute("aria-pressed")).toBe("true");
    expect(observationButton?.getAttribute("aria-pressed")).toBe("true");
    cleanup(container);
  });

  // ADR-0045: the idle label names what selecting does, and selecting answers
  // in place instead of only cross-highlighting in a hidden tab.
  it("names the trace affordance and confirms the cross-highlight in place", () => {
    const container = renderToDOM(<MissionSelectionHarness />);
    const observationButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='select-observation-obs-002']"
    );
    expect(observationButton?.textContent).toBe("Trace to its satellite");
    expect(
      container.querySelector("[data-testid='observation-trace-feedback-obs-002']")
    ).toBeNull();

    act(() => observationButton?.click());
    expect(observationButton?.textContent).toBe("Selected observation");
    const feedback = container.querySelector(
      "[data-testid='observation-trace-feedback-obs-002']"
    );
    expect(feedback?.textContent).toContain("highlighted in the Missions tab");
    expect(feedback?.getAttribute("role")).toBe("status");
    cleanup(container);
  });
});
