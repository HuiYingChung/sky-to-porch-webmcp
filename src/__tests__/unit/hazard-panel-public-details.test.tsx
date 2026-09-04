import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DroughtEvidenceInsightPanel } from "@/components/drought/drought-evidence-panel";
import { FireEvidenceInsightPanel } from "@/components/fire/fire-evidence-panel";
import { FireMapCoverageLabel } from "@/components/fire/fire-map-info";
import { FloodEvidenceInsightPanel } from "@/components/flood/flood-evidence-panel";
import { FloodMapCoverageLabel } from "@/components/flood/flood-map-info";
import { HeatEvidenceInsightPanel } from "@/components/heat/heat-evidence-panel";
import { StormEvidenceInsightPanel } from "@/components/storm/storm-evidence-panel";
import type { EvidenceObject } from "@/contracts/evidence";
import { queryDroughtFixture } from "@/lib/drought/fixture-adapter";
import { DROUGHT_PINNED_FIXTURE_DATE, type DroughtQueryResult } from "@/lib/drought/types";
import { queryFireEvidence } from "@/lib/fire/fixture-adapter";
import { PINNED_FIXTURE_DATE, type FireQueryResult } from "@/lib/fire/types";
import { queryFloodFixture } from "@/lib/flood/fixture-adapter";
import { FLOOD_PINNED_FIXTURE_DATE, type FloodQueryResult } from "@/lib/flood/types";
import { queryHeatFixture } from "@/lib/heat/fixture-adapter";
import { HEAT_PINNED_FIXTURE_DATE, type HeatQueryResult } from "@/lib/heat/types";
import type { StormQueryResult } from "@/lib/storm/types";

function visibleText(element: React.ReactElement): string {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(element);
  return container.textContent ?? "";
}

function expectInternalDetailsHidden(text: string, evidence: EvidenceObject): void {
  expect(text).not.toContain(evidence.evidenceId);
  expect(text).not.toContain(evidence.assembledAt);
  for (const observation of evidence.observations) {
    expect(text).not.toContain(observation.observationId);
    expect(text).not.toContain(observation.provenance.sourceId);
    expect(text).not.toContain(observation.provenance.payloadHash);
    expect(text).not.toContain(observation.provenance.observedAt);
    expect(text).not.toContain(observation.provenance.retrievedAt);
  }
}

describe("hazard Evidence panels public details", () => {
  it("keeps the original professional copy while hiding IDs, hashes, and ISO timestamps", () => {
    const fire = queryFireEvidence({
      placeId: "demo-los-angeles",
      date: PINNED_FIXTURE_DATE,
      mode: "fixture",
    });
    const flood = queryFloodFixture({
      placeId: "demo-houston",
      date: FLOOD_PINNED_FIXTURE_DATE,
      mode: "fixture",
    });
    const heat = queryHeatFixture({
      placeId: "demo-tucson",
      date: HEAT_PINNED_FIXTURE_DATE,
      mode: "fixture",
    });
    const drought = queryDroughtFixture({
      placeId: "demo-tucson",
      date: DROUGHT_PINNED_FIXTURE_DATE,
      mode: "fixture",
    });
    if (!fire.evidence || !flood.evidence || !heat.evidence || !drought.evidence) {
      throw new Error("Expected successful fixture evidence");
    }

    const rendered = [
      {
        text: visibleText(<FireEvidenceInsightPanel result={fire} tab="evidence" />),
        evidence: fire.evidence,
      },
      {
        text: visibleText(<FloodEvidenceInsightPanel result={flood} tab="evidence" />),
        evidence: flood.evidence,
      },
      {
        text: visibleText(<HeatEvidenceInsightPanel result={heat} tab="evidence" />),
        evidence: heat.evidence,
      },
      {
        text: visibleText(<DroughtEvidenceInsightPanel result={drought} tab="evidence" />),
        evidence: drought.evidence,
      },
    ];

    for (const { text, evidence } of rendered) {
      expect(text).toMatch(/Validated observations|Observations \(\d+\)/u);
      expect(text).toContain("Required limitations");
      expect(text).toContain("UTC");
      expectInternalDetailsHidden(text, evidence);
    }

    expect(rendered[0].text).toContain("NOAA HMS Fire Detection Points");
    expect(rendered[1].text).toContain("Separated Flood claims");
    expect(rendered[1].text).not.toContain("GPM_3IMERGHH");
    expect(rendered[2].text).toContain("Separated Extreme Heat claims");
    expect(rendered[2].text).not.toContain("MODIS_Terra_Land_Surface_Temp_Day");
    expect(rendered[3].text).toContain("Drought evidence audit trail");
    expect(rendered[3].text).toContain("NASA GIBS MODIS Terra L3 NDVI 16-Day v6.1 Standard visualization");
  });

  it("does not present an unqueried U.S. source as contributing to a Canadian drought result", () => {
    const fixture = queryDroughtFixture({
      placeId: "demo-tucson",
      date: DROUGHT_PINNED_FIXTURE_DATE,
      mode: "fixture",
    });
    if (!fixture.evidence) throw new Error("Expected successful fixture evidence");
    const evidence = structuredClone(fixture.evidence);
    evidence.missionAttributions = evidence.missionAttributions.filter((mission) =>
      !mission.missionName.includes("U.S. Drought Monitor")
    );
    const result: DroughtQueryResult = {
      ...fixture,
      evidence,
      sourceOutcomes: { gibs: "success", usdm: "not_attempted" },
    };

    const missionsText = visibleText(
      <DroughtEvidenceInsightPanel result={result} tab="missions" />
    );
    const evidenceText = visibleText(
      <DroughtEvidenceInsightPanel result={result} tab="evidence" />
    );

    expect(missionsText).toContain("1 contributing mission or data source is shown");
    expect(missionsText).toContain("Terra");
    expect(missionsText).not.toContain("U.S. Drought Monitor");
    expect(evidenceText).toContain("U.S. Drought Monitor");
  });

  it("preserves ordinary slashes in professional names and formats storm timestamps", () => {
    const fire = queryFireEvidence({
      placeId: "demo-los-angeles",
      date: PINNED_FIXTURE_DATE,
      mode: "fixture",
    });
    if (!fire.evidence) throw new Error("Expected successful fixture evidence");
    const evidence = structuredClone(fire.evidence);
    evidence.observations[0].variableName = "NASA/JAXA wind observation";
    evidence.observations[0].provenance.product = "NASA/JAXA wind product";
    const result: StormQueryResult = {
      kind: "success",
      evidence,
      sourceOutcomes: {
        ghcnhWind: "success",
        localStormReports: "success",
        nceiStormEvents: "success",
        hurdat2: "success",
        officialEventContext: "success",
      },
    };

    const text = visibleText(
      <StormEvidenceInsightPanel
        result={result}
        tab="evidence"
        claimDiscussionOpen={false}
        onClaimDiscussionOpenChange={() => undefined}
      />
    );

    expect(text).toContain("NASA/JAXA wind observation");
    expect(text).toContain("NASA/JAXA wind product");
    expect(text).toContain("Jan 8, 2025, 12:00 AM UTC");
    expectInternalDetailsHidden(text, evidence);
  });

  it("keeps map evidence labels while formatting their observation timestamps", () => {
    const fire = queryFireEvidence({
      placeId: "demo-los-angeles",
      date: PINNED_FIXTURE_DATE,
      mode: "fixture",
    });
    const flood = queryFloodFixture({
      placeId: "demo-houston",
      date: FLOOD_PINNED_FIXTURE_DATE,
      mode: "fixture",
    });
    if (!fire.evidence || !flood.evidence) throw new Error("Expected successful fixture evidence");

    const fireText = visibleText(<FireMapCoverageLabel evidence={fire.evidence} />);
    const floodText = visibleText(<FloodMapCoverageLabel result={flood} />);

    expect(fireText).toContain("Coverage:");
    expect(fireText).toContain("Observed: Jan 8, 2025, 12:00 AM UTC");
    expect(fireText).not.toContain("2025-01-08T00:00:00Z");
    expect(floodText).toContain("Regional Flood evidence area");
    expect(floodText).toContain("GIBS: Jul 8, 2024, 12:00 AM UTC");
    expect(floodText).not.toContain("2024-07-08T00:00:00Z");
  });

  it("uses a plain-language fallback when a failed check has no public reason", () => {
    const expected = "The check could not be completed. No evidence was returned.";
    const panels = [
      visibleText(
        <FireEvidenceInsightPanel
          result={{ kind: "source_failure" } satisfies FireQueryResult}
          tab="meaning"
        />
      ),
      visibleText(
        <FloodEvidenceInsightPanel
          result={{ kind: "source_failure" } satisfies FloodQueryResult}
          tab="meaning"
        />
      ),
      visibleText(
        <HeatEvidenceInsightPanel
          result={{ kind: "source_failure" } satisfies HeatQueryResult}
          tab="meaning"
        />
      ),
      visibleText(
        <DroughtEvidenceInsightPanel
          result={{
            kind: "source_failure",
            sourceOutcomes: { gibs: "failed", usdm: "failed" },
          } satisfies DroughtQueryResult}
          tab="meaning"
        />
      ),
      visibleText(
        <StormEvidenceInsightPanel
          result={{ kind: "source_failure" } satisfies StormQueryResult}
          tab="meaning"
          claimDiscussionOpen={false}
          onClaimDiscussionOpenChange={() => undefined}
        />
      ),
    ];

    for (const text of panels) {
      expect(text).toContain(expected);
      expect(text).not.toContain("failed closed");
    }
  });

  it("keeps a reviewed storm failure explanation but hides internal-formatted details", () => {
    const reviewedReason =
      "The NOAA GHCNh, NWS Local Storm Report, NCEI Storm Events, and NHC HURDAT2 checks all failed. No rain, flood, example, or out-of-area information was substituted.";
    const reviewedText = visibleText(
      <StormEvidenceInsightPanel
        result={{ kind: "source_failure", rejectionReason: reviewedReason }}
        tab="meaning"
        claimDiscussionOpen={false}
        onClaimDiscussionOpenChange={() => undefined}
      />
    );
    const internalText = visibleText(
      <StormEvidenceInsightPanel
        result={{
          kind: "source_failure",
          rejectionReason: "The source failed while reading obs-private-detail.",
        }}
        tab="meaning"
        claimDiscussionOpen={false}
        onClaimDiscussionOpenChange={() => undefined}
      />
    );

    expect(reviewedText).toContain(reviewedReason);
    expect(internalText).toContain("We couldn't complete this check. Please try again.");
    expect(internalText).not.toContain("obs-private-detail");
  });
});
