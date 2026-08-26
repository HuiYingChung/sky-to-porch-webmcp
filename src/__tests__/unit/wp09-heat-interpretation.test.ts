/**
 * P0-B: deterministic Extreme Heat interpretation tests. Pure functions over
 * validated fixture-shaped evidence; no network or provider is involved.
 */

import { describe, expect, it } from "vitest";
import type { EvidenceObject } from "@/contracts/evidence";
import {
  heatSeverityForCelsius,
  interpretHeatEvidence,
} from "@/lib/heat/interpretation";
import { queryHeatFixture } from "@/lib/heat/fixture-adapter";
import { HEAT_PINNED_FIXTURE_DATE } from "@/lib/heat/types";

function fixtureEvidence(): EvidenceObject {
  const result = queryHeatFixture({
    placeId: "demo-tucson",
    date: HEAT_PINNED_FIXTURE_DATE,
    mode: "fixture",
  });
  if (!result.evidence) throw new Error("heat fixture did not return evidence");
  return structuredClone(result.evidence);
}

function stationValues(evidence: EvidenceObject, airC: number, indexC: number): EvidenceObject {
  for (const observation of evidence.observations) {
    if (observation.variableName === "Hourly air temperature") observation.value = airC;
    if (observation.variableName === "Hourly heat index") observation.value = indexC;
  }
  return evidence;
}

describe("heatSeverityForCelsius NWS category boundaries", () => {
  it.each([
    [25, "none"],
    [26.6, "none"],
    [26.7, "caution"],
    [32.1, "caution"],
    [32.2, "extreme_caution"],
    [39.3, "extreme_caution"],
    [39.4, "danger"],
    [51, "danger"],
    [51.1, "extreme_danger"],
    [60, "extreme_danger"],
  ] as const)("classifies %s degC as %s", (valueC, severity) => {
    expect(heatSeverityForCelsius(valueC)).toBe(severity);
  });
});

describe("interpretHeatEvidence", () => {
  it("reads the validated Tucson fixture peaks, station, hour, and severity", () => {
    const interpretation = interpretHeatEvidence(fixtureEvidence());
    expect(interpretation).toEqual({
      hasStationData: true,
      peakAirTempC: 41.7,
      peakHeatIndexC: 38.9,
      peakHourUtc: "2024-07-11T00:00:00Z",
      stationName: "AZ Tucson 11 W",
      severity: "extreme_caution",
    });
  });

  it("uses the heat index for severity and falls back to air temperature", () => {
    expect(interpretHeatEvidence(stationValues(fixtureEvidence(), 45.2, 30.1)).severity)
      .toBe("caution");

    const airOnly = fixtureEvidence();
    airOnly.observations = airOnly.observations.filter(
      (observation) => observation.variableName !== "Hourly heat index"
    );
    const interpretation = interpretHeatEvidence(airOnly);
    expect(interpretation.peakHeatIndexC).toBeUndefined();
    expect(interpretation.peakAirTempC).toBe(41.7);
    expect(interpretation.severity).toBe("danger");
  });

  it("classifies below-threshold station readings as none, never as unknown", () => {
    const interpretation = interpretHeatEvidence(stationValues(fixtureEvidence(), 24.3, 22.8));
    expect(interpretation.hasStationData).toBe(true);
    expect(interpretation.severity).toBe("none");
  });

  it("rounds derived station values to one decimal so cited forms match the whitelist (ADR-0048)", () => {
    // The Phoenix live rejection case: a computed heat index with 14 decimals
    // forced every naturally rounded model citation out of the whitelist.
    const interpretation = interpretHeatEvidence(
      stationValues(fixtureEvidence(), 44, 44.26911953571667)
    );
    expect(interpretation.peakAirTempC).toBe(44);
    expect(interpretation.peakHeatIndexC).toBe(44.3);
    expect(interpretation.severity).toBe("danger");
  });

  it("classifies severity from the rounded value the user sees (ADR-0048)", () => {
    // Raw 39.35 displays as 39.4; the NWS scale reads 39.4 as danger, and the
    // displayed number must never contradict its stated category.
    const interpretation = interpretHeatEvidence(stationValues(fixtureEvidence(), 30, 39.35));
    expect(interpretation.peakHeatIndexC).toBe(39.4);
    expect(interpretation.severity).toBe("danger");
  });

  it("returns unknown severity for satellite-only evidence without inventing values", () => {
    const satelliteOnly = fixtureEvidence();
    satelliteOnly.observations = satelliteOnly.observations.filter(
      (observation) => observation.provenance.sourceId === "nasa_gibs_modis_lst_day"
    );
    expect(interpretHeatEvidence(satelliteOnly)).toEqual({
      hasStationData: false,
      severity: "unknown",
    });
  });
});
