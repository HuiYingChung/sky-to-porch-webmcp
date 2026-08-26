/**
 * ADR-0045: deterministic Air Quality and Earth & Volcanoes interpretation
 * tests. Pure functions over validated-shaped observations; no network or
 * provider is involved.
 */

import { describe, expect, it } from "vitest";
import type { EvidenceObject } from "@/contracts/evidence";
import {
  AIR_SEVERITY_LABELS,
  airSeverityForAqi,
  interpretAirEvidence,
} from "@/lib/air/interpretation";
import { interpretEarthEvidence } from "@/lib/earth/interpretation";

function evidenceWith(observations: unknown[]): EvidenceObject {
  return { observations } as unknown as EvidenceObject;
}

function aqiRow(
  observationId: string,
  value: number,
  parameter = "PM2.5-24HR",
  siteName?: string
) {
  return {
    observationId,
    provenance: { sourceId: "airnow_daily_data", observedAt: "unknown" },
    variableName: `${parameter} outdoor daily AQI`,
    value,
    unit: "AQI",
    metadata: siteName ? { siteName } : {},
  };
}

function satelliteAod(observationId = "obs-aod") {
  return {
    observationId,
    provenance: { sourceId: "nasa_gibs_modis_aod", observedAt: "2026-08-12T00:00:00Z" },
    variableName: "MAIAC aerosol optical depth visualization",
    textValue: "regional_aerosol_visualization",
  };
}

describe("airSeverityForAqi official EPA category boundaries", () => {
  it.each([
    [0, "good"],
    [50, "good"],
    [51, "moderate"],
    [100, "moderate"],
    [101, "unhealthy_for_sensitive_groups"],
    [150, "unhealthy_for_sensitive_groups"],
    [151, "unhealthy"],
    [185, "unhealthy"],
    [200, "unhealthy"],
    [201, "very_unhealthy"],
    [300, "very_unhealthy"],
    [301, "hazardous"],
    [500, "hazardous"],
  ] as const)("classifies AQI %s as %s", (aqi, severity) => {
    expect(airSeverityForAqi(aqi)).toBe(severity);
  });

  it("uses the official EPA category names verbatim", () => {
    expect(AIR_SEVERITY_LABELS.unhealthy).toBe("Unhealthy");
    expect(AIR_SEVERITY_LABELS.unhealthy_for_sensitive_groups)
      .toBe("Unhealthy for Sensitive Groups");
  });
});

describe("interpretAirEvidence", () => {
  it("finds the peak AQI row across pollutants and reports its site and pollutant", () => {
    const interpretation = interpretAirEvidence(evidenceWith([
      satelliteAod(),
      aqiRow("obs-1", 42, "OZONE-8HR", "Queens College"),
      aqiRow("obs-2", 185, "PM2.5-24HR", "Manhattan Midtown"),
      aqiRow("obs-3", 97, "PM10-24HR"),
    ]));
    expect(interpretation).toEqual({
      hasMonitorData: true,
      peakAqi: 185,
      peakPollutant: "PM2.5",
      peakSiteName: "Manhattan Midtown",
      monitorRowCount: 3,
      severity: "unhealthy",
    });
  });

  it("breaks value ties deterministically by observationId", () => {
    const interpretation = interpretAirEvidence(evidenceWith([
      aqiRow("obs-b", 60, "PM2.5-24HR", "Site B"),
      aqiRow("obs-a", 60, "OZONE-8HR", "Site A"),
    ]));
    expect(interpretation.peakSiteName).toBe("Site A");
    expect(interpretation.severity).toBe("moderate");
  });

  it("returns unknown severity for satellite-only evidence, never good", () => {
    expect(interpretAirEvidence(evidenceWith([satelliteAod()]))).toEqual({
      hasMonitorData: false,
      monitorRowCount: 0,
      severity: "unknown",
    });
  });

  it("ignores non-numeric or non-AQI rows instead of guessing", () => {
    const interpretation = interpretAirEvidence(evidenceWith([
      { ...aqiRow("obs-1", 12), unit: "UG/M3" },
      { ...aqiRow("obs-2", Number.NaN) },
    ]));
    expect(interpretation.hasMonitorData).toBe(false);
    expect(interpretation.severity).toBe("unknown");
  });
});

function quake(observationId: string, magnitude: number | undefined, place?: string) {
  return {
    observationId,
    provenance: { sourceId: "usgs_earthquake_geojson", observedAt: "2026-08-12T10:00:00Z" },
    variableName: "USGS observed earthquake event",
    ...(magnitude !== undefined ? { value: magnitude, unit: "magnitude" } : {
      textValue: "observed_earthquake_event_without_reported_magnitude",
    }),
    metadata: place ? { place } : {},
  };
}

function volcanoNotice(observationId: string) {
  return {
    observationId,
    provenance: { sourceId: "usgs_volcano_hans", observedAt: "2026-08-12T09:00:00Z" },
    variableName: "USGS volcano activity notice",
    textValue: "ORANGE/WATCH",
  };
}

describe("interpretEarthEvidence", () => {
  it("counts events and notices and surfaces the largest reported magnitude verbatim", () => {
    const interpretation = interpretEarthEvidence(evidenceWith([
      quake("obs-q1", 2.1, "5 km SW of Pāhala, Hawaii"),
      quake("obs-q2", 4.6, "Kīlauea summit region"),
      quake("obs-q3", undefined),
      volcanoNotice("obs-n1"),
    ]));
    expect(interpretation).toEqual({
      hasEventData: true,
      earthquakeCount: 3,
      maxMagnitude: 4.6,
      maxMagnitudePlace: "Kīlauea summit region",
      volcanoNoticeCount: 1,
    });
  });

  it("counts magnitude-free events without inventing a magnitude", () => {
    const interpretation = interpretEarthEvidence(evidenceWith([quake("obs-q1", undefined)]));
    expect(interpretation.earthquakeCount).toBe(1);
    expect(interpretation.maxMagnitude).toBeUndefined();
    expect(interpretation.hasEventData).toBe(true);
  });

  it("reports no event data for satellite-only evidence", () => {
    const interpretation = interpretEarthEvidence(evidenceWith([
      {
        observationId: "obs-so2",
        provenance: { sourceId: "nasa_gibs_omps_so2", observedAt: "2026-08-12T00:00:00Z" },
        variableName: "OMPS sulfur-dioxide visualization",
        textValue: "regional_so2_visualization",
      },
    ]));
    expect(interpretation).toEqual({
      hasEventData: false,
      earthquakeCount: 0,
      volcanoNoticeCount: 0,
    });
  });
});
