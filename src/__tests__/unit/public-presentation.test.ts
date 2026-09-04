import { describe, expect, it } from "vitest";
import { SOURCE_IDS } from "@/contracts/dataset-registry";
import {
  confidenceLevelLabel,
  dataModeLabel,
  evidenceStateLabel,
  freshnessStatusLabel,
} from "@/lib/ui/evidence-labels";
import { explanationStatusLabel } from "@/lib/ui/explanation-status";
import { sourceOutcomeLabel } from "@/lib/ui/outcome-labels";
import {
  formatUtcDate,
  formatUtcTimestamp,
  publicErrorMessage,
  publicNarrativeText,
  publicObservationValue,
  publicSourceName,
  publicUnitName,
  publicVariableName,
} from "@/lib/ui/public-presentation";

describe("public presentation boundary", () => {
  it("gives every registered source a reviewed public name", () => {
    for (const sourceId of SOURCE_IDS) {
      const label = publicSourceName(sourceId);
      expect(label).not.toBe(sourceId);
      expect(label).not.toContain("_");
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  it("does not expose unknown source or variable identifiers", () => {
    expect(publicSourceName("private_source_slug")).toBe("Official data source");
    expect(publicSourceName(undefined)).toBe("Official data source");
    expect(publicVariableName("private_variable_slug")).toBe("reported condition");
    expect(publicVariableName("Hourly air temperature")).toBe("Hourly air temperature");
    expect(publicVariableName("fire_detections")).toBe("fire detections");
    expect(publicVariableName("MAIAC aerosol optical depth visualization"))
      .toBe("MAIAC aerosol optical depth visualization");
    expect(publicVariableName("HMS smoke polygon coordinate pairs in Los Angeles area box"))
      .toBe("Smoke-boundary source map points");
    expect(publicVariableName("Cloud cover at observation time"))
      .toBe("Cloud cover at observation time");
    expect(publicUnitName("coordinate_pairs")).toBe("source map points");
    expect(publicUnitName("degC")).toBe("°C");
    expect(publicUnitName("mm/hr")).toBe("mm/hr");
    expect(publicUnitName("m³/m³")).toBe("m³/m³");
    expect(publicUnitName("private_unit_code")).toBe("reported units");
    expect(publicObservationValue(12, "percent")).toBe("12%");
    expect(publicObservationValue(4.5, "magnitude")).toBe("magnitude 4.5");
    expect(publicObservationValue(41.7, "degC")).toBe("41.7 °C");
  });

  it("formats valid instants in UTC and safely handles missing or invalid values", () => {
    expect(formatUtcTimestamp("2026-09-04T12:34:56Z"))
      .toBe("Sep 4, 2026, 12:34 PM UTC");
    expect(formatUtcDate("2026-09-04T23:34:56-05:00"))
      .toBe("Sep 5, 2026 UTC");
    expect(formatUtcTimestamp("unknown")).toBe("Time not available");
    expect(formatUtcTimestamp("internal_time_token")).toBe("Time not available");
    expect(formatUtcDate(undefined)).toBe("Date not available");
  });

  it("maps internal status values without deriving prose from unknown values", () => {
    expect(evidenceStateLabel("observations_returned")).toBe("Evidence found");
    expect(evidenceStateLabel("private_state")).toBe("Evidence state unavailable");
    expect(dataModeLabel("fixture")).toBe("Demo fixture");
    expect(dataModeLabel("private_mode")).toBe("Data mode unavailable");
    expect(confidenceLevelLabel("moderate")).toBe("Moderate");
    expect(confidenceLevelLabel("private_confidence")).toBe("Confidence unavailable");
    expect(freshnessStatusLabel("stale")).toBe("Stale");
    expect(freshnessStatusLabel("private_freshness")).toBe("Freshness unavailable");
    expect(sourceOutcomeLabel("no_observation")).toBe("returned nothing");
    expect(sourceOutcomeLabel("private_outcome")).toBe("status unavailable");
  });

  it("uses plain explanation labels", () => {
    expect(explanationStatusLabel({
      mode: "deterministic",
      reason: "validated_evidence",
    })).toBe("rule-based explanation · derived from validated evidence");
    expect(explanationStatusLabel({
      mode: "deterministic",
      reason: "insufficient_evidence",
    })).toBe("rule-based explanation · evidence is insufficient");
    expect(explanationStatusLabel(undefined)).toBe("Validated explanation unavailable");
    expect(explanationStatusLabel({ reason: "private_reason" }))
      .toBe("Explanation status unavailable");
  });

  it("maps errors to reviewed messages without echoing private details", () => {
    const privateDetail = "private_source_slug leaked secret";
    expect(publicErrorMessage(new Error(`schema mismatch: ${privateDetail}`)))
      .toBe("The returned information could not be verified. Please try again.");
    expect(publicErrorMessage("bbox.west must be less than bbox.east"))
      .toBe("We couldn't read the selected area. Please choose the place again.");
    expect(publicErrorMessage("HTTP 429 rate_limited"))
      .toBe("This data source is busy right now. Please try again shortly.");
    expect(publicErrorMessage(privateDetail)).toBe("We couldn't complete this check. Please try again.");
    expect(publicErrorMessage(privateDetail)).not.toContain(privateDetail);
  });

  it("removes internal references without rewriting professional prose", () => {
    const text = publicNarrativeText(
      "Validated evidence evd-fire-private used a bounded upstream schema retrieval from private_source_slug with payload 0123456789abcdef0123456789abcdef."
    );
    expect(text).toContain("Validated evidence");
    expect(text).toContain("source check");
    expect(text).not.toMatch(/upstream|schema|payload/iu);
    expect(text).not.toMatch(/evd-fire-private|private_source_slug|0123456789abcdef/iu);
    expect(publicNarrativeText("Wind evidence is not evidence that damage occurred."))
      .toBe("Wind evidence is not evidence that damage occurred.");
    const professionalNames = "NASA/JAXA GIBS NDVI, NOAA GHCNh, NHC HURDAT2, NCEI, MRMS QPE, and AOD";
    expect(publicNarrativeText(professionalNames)).toBe(professionalNames);
    expect(publicNarrativeText("NHC HURDAT2 best-track database"))
      .toBe("NHC HURDAT2 best-track database");
    expect(publicNarrativeText("USGS Water Data OGC API v0 continuous values"))
      .toBe("USGS Water Data Continuous Values");
    expect(publicNarrativeText("NWS HGX Preliminary Local Storm Report"))
      .toBe("NWS Preliminary Local Storm Report");
    expect(publicNarrativeText("MODIS_Terra_Land_Surface_Temp_Day"))
      .toBe("NASA GIBS MODIS Terra Daytime Land-Surface Temperature");
    expect(publicNarrativeText("VIIRS_SNPP_SP"))
      .toBe("NASA FIRMS VIIRS Fire Detections");
    expect(publicNarrativeText("NOAA HMS (Live Retrieval — Failed)"))
      .toBe("NOAA HMS (Live Retrieval — Failed)");
    expect(publicNarrativeText("regional_aod_visualization_available"))
      .toBe("Satellite haze imagery is available; no ground-level air-quality value was calculated.");
    expect(publicNarrativeText("evd-private-only"))
      .toBe("Details are not available.");
    expect(publicNarrativeText("123e4567-e89b-12d3-a456-426614174000"))
      .toBe("Details are not available.");
    expect(publicNarrativeText("analysis-bundle-1788537600000"))
      .toBe("Details are not available.");
    expect(publicNarrativeText("place-coordinate-private123"))
      .toBe("Details are not available.");
    expect(publicNarrativeText("Downloaded internal/wind-output.grib2 for review."))
      .toBe("Downloaded source file for review.");
    expect(publicNarrativeText("See C:\\private\\claim-record.parquet for details."))
      .toBe("See source file for details.");
  });
});
