import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Explanation } from "@/contracts/evidence";
import { AdaptiveMeaningPanel } from "@/components/evidence/adaptive-meaning";
import { SelectionSummary } from "@/components/selection/selection-summary";
import { buildMapCoordinateSelection } from "@/lib/location/selection";
import { boundedViewportArea } from "@/lib/location/viewport-area";
import { missionContextReference } from "@/data/mission-context";
import { publicSourceUrl } from "@/data/public-source-links";
import { deterministicPlainSummary } from "@/lib/ai/evidence-explainer";
import type { EvidenceEvaluationResult } from "@/lib/evidence/evaluator";
import { shouldSelectMapClick } from "@/lib/location/map-click";

const EXPLANATION: Explanation = {
  explanationId: "exp-test",
  sourceEvidenceIds: ["evidence-test"],
  observed: "Validated smoke context was returned for the selected region.",
  notSupported: ["Individual animal diagnosis"],
  plainSummary: "Regional smoke context may matter before walking a dog outdoors.",
  meaning: {
    answerMode: "direct_question",
    directAnswer: "The regional smoke evidence is relevant to your dog's outdoor walk, but use the current local AQI before deciding how long to stay outside.",
    sections: [{
      kind: "next_step",
      heading: "Check conditions at walk time",
      body: "Use the official local checker because satellite smoke and ground-level air quality answer different questions.",
    }],
    verificationSourceIds: ["epa_airnow"],
  },
  aiGenerated: false,
};

describe("adaptive Meaning and map-alternative UX", () => {
  it("renders a direct question answer with a fixed official checker URL and deterministic status", () => {
    const html = renderToStaticMarkup(
      <AdaptiveMeaningPanel
        explanation={EXPLANATION}
        explanationStatus={{ mode: "deterministic", reason: "validated_evidence" }}
      />
    );
    expect(html).toContain("your dog&#x27;s outdoor walk");
    expect(html).toContain("Check conditions at walk time");
    expect(html).toContain('href="https://www.airnow.gov/"');
    expect(html).toContain(
      "rule-based explanation · derived from validated evidence"
    );
  });

  it("renders the same canonical map selection as a text view without duplicating date controls", () => {
    const selection = buildMapCoordinateSelection({ lon: -95.5, lat: 29.5 }, 25, "past_7d");
    const html = renderToStaticMarkup(
      <SelectionSummary selection={selection} includeTime={false} showMethodDetails />
    );
    expect(html).toContain("Point chosen on the map");
    expect(html).toContain("29.50000");
    expect(html).toContain("25 km radius");
    expect(html).toContain("not a city, property");
    expect(html).not.toContain("Past 7 days");
  });

  it("clips a wide visible viewport to the registered source request cap without changing its centre", () => {
    const area = boundedViewportArea(
      { west: -130, south: 20, east: -60, north: 55 },
      { lon: -95, lat: 37.5 }
    );
    expect(area.east - area.west).toBe(12);
    expect(area.north - area.south).toBe(12);
    expect((area.east + area.west) / 2).toBe(-95);
    expect((area.north + area.south) / 2).toBe(37.5);
  });

  it("treats a hotspot click as inspection instead of a canonical location change", () => {
    expect(shouldSelectMapClick(true, 1)).toBe(false);
    expect(shouldSelectMapClick(false, 1)).toBe(false);
    expect(shouldSelectMapClick(false, 0)).toBe(true);
  });

  it("keeps observation URLs separate from registered mission/background URLs", () => {
    expect(publicSourceUrl("nasa_gibs_imerg")).toBe("https://worldview.earthdata.nasa.gov/");
    const mission = missionContextReference("GPM_3IMERGHH_v07", "GPM");
    expect(mission?.overviewUrl).toBe("https://gpm.nasa.gov/missions/GPM");
    expect(mission?.imageryUrl).toBe("https://gpm.nasa.gov/resources/images");
  });

  it("mentions the selected pets concern even when the optional question is blank and a source failed", () => {
    const evidence = {
      hazardId: "extreme_heat",
      evidenceState: "source_failure",
      observations: [],
    } as unknown as EvidenceEvaluationResult["evidence"];
    const summary = deterministicPlainSummary(
      { evidence, conflicts: [], inferenceAllowed: false },
      "pets",
      ""
    );
    expect(summary).toContain("For pets");
    expect(summary).toContain("failed lookup says nothing about actual conditions");
  });

  it.each([
    ["home", "conditions around a home"],
    ["health", "health planning"],
    ["pets", "pets"],
    ["travel", "travel plans"],
    ["power_internet", "power and internet"],
    ["community", "a community"],
  ] as const)("explains the selected %s concern when the optional question is blank", (concern, phrase) => {
    const evidence = {
      hazardId: "fire_smoke",
      evidenceState: "observations_returned",
      observations: [],
    } as unknown as EvidenceEvaluationResult["evidence"];
    const summary = deterministicPlainSummary(
      { evidence, conflicts: [], inferenceAllowed: false },
      concern,
      ""
    );
    expect(summary).toContain(phrase);
  });
});
