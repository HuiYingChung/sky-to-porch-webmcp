import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { StormEvidenceInsightPanel } from "@/components/storm/storm-evidence-panel";
import { queryFloodFixture } from "@/lib/flood/fixture-adapter";
import { FLOOD_PINNED_FIXTURE_DATE } from "@/lib/flood/types";
import type { StormQueryResult } from "@/lib/storm/types";

describe("storm-impact shared view", () => {
  it("shows automatically collected water evidence beside the separate wind chain", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const windResult: StormQueryResult = {
      kind: "unsupported_coverage",
      rejectionReason: "No usable in-area wind station was returned.",
    };
    const floodResult = queryFloodFixture({
      placeId: "demo-houston",
      date: FLOOD_PINNED_FIXTURE_DATE,
      mode: "fixture",
    });

    act(() => {
      root.render(
        <StormEvidenceInsightPanel
          result={windResult}
          relatedFloodResult={floodResult}
          tab="meaning"
          claimDiscussionOpen={false}
          onClaimDiscussionOpenChange={() => undefined}
          missionSelection={{}}
          onMissionSelectionChange={() => undefined}
        />
      );
    });

    expect(container.querySelector("[data-testid='storm-impact-bundle-panel']")).not.toBeNull();
    const water = container.querySelector("[data-testid='related-flood-evidence-chain']");
    expect(water?.textContent).toContain("Collected automatically");
    expect(water?.textContent).toContain("separate water-only chain");
    expect(water?.textContent).toContain("not wind or roof-causation evidence");
    for (const observation of floodResult.evidence?.observations ?? []) {
      expect(water?.textContent).not.toContain(observation.observationId);
      expect(water?.textContent).not.toContain(observation.provenance.sourceId);
      expect(water?.textContent).not.toContain(observation.provenance.payloadHash);
    }

    act(() => root.unmount());
    container.remove();
  });
});
