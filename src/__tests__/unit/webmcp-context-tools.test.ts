import { describe, expect, it, vi } from "vitest";
import type { EvidenceObject } from "@/contracts/evidence";
import type { ActiveAnalysis } from "@/lib/analysis/types";
import { buildAgentCoordinateSelection } from "@/lib/location/selection";
import {
  claimDiscussionForAnalysis,
  createInspectEvidenceTool,
  createStormClaimDiscussionTool,
  MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS,
} from "@/lib/webmcp/context-tools";

function analysis(hazardId: "wind_storm" | "flood_storm", concern: "home" | "travel"): ActiveAnalysis {
  const commonResult = {
    kind: "success" as const,
    evidence: {
      evidenceId: "evd-test",
      hazardId,
      intentId: "intent-test",
      evidenceState: "observations_returned" as const,
      dataMode: "historical" as const,
      observations: [{
        observationId: `obs-${hazardId}`,
        variableName: hazardId === "wind_storm" ? "Peak wind gust" : "Gage height",
        value: hazardId === "wind_storm" ? 39.6 : 4.2,
        unit: hazardId === "wind_storm" ? "m/s" : "m",
        dataMode: "historical" as const,
        provenance: {
          sourceId: hazardId === "wind_storm"
            ? "noaa_ncei_global_hourly" as const
            : "usgs_instantaneous_values" as const,
          sourceUrl: `https://example.test/${hazardId}`,
          retrievedAt: "2026-08-26T11:00:00.000Z",
          observedAt: "2024-07-08T14:35:00.000Z",
          product: hazardId === "wind_storm" ? "NOAA GHCNh" : "USGS IV",
          payloadHash: "a".repeat(64),
        },
      }],
      derivedMetrics: [],
      missionAttributions: [],
      freshness: {
        status: "unknown" as const,
        classificationBasis: "age_thresholds" as const,
        mostRecentObservationAt: "2024-07-08T14:35:00.000Z",
        ageSeconds: 67200000,
        currentAgeLimitSeconds: 86400,
        recentAgeLimitSeconds: 172800,
        evaluatedAt: "2026-08-26T12:00:00.000Z",
        note: "test",
      },
      confidence: { level: "moderate" as const, rationale: "test" },
      limitations: [],
      explanations: [],
      assembledAt: "2026-08-26T12:00:00.000Z",
    },
  };
  const result = hazardId === "wind_storm"
    ? {
        ...commonResult,
        claimDiscussion: {
          title: "Storm claim discussion preparation",
          assessmentSummary: "Official regional wind evidence makes wind contribution plausible.",
          assessmentConfidence: "moderate" as const,
          supportedStatements: ["Regional wind context is present."],
          notEstablished: ["Property damage is not established."],
          documentationChecklist: ["Photograph observed damage."],
          officialGuidance: [{ label: "TDI", url: "https://www.tdi.texas.gov/" }],
        },
      }
    : commonResult;
  return {
    analysisId: `analysis-${hazardId}`,
    origin: "agent",
    request: {
      hazardId,
      concern,
      placeSelection: buildAgentCoordinateSelection(
        "Houston",
        { lon: -95.36, lat: 29.76 },
        25,
        "custom",
        "2024-07-08T00:00:00.000Z",
        "2024-07-08T23:59:59.000Z"
      ),
    },
    outcome: { hazardId, result } as ActiveAnalysis["outcome"],
    completedAt: "2026-08-26T12:00:00.000Z",
  };
}

function evidenceFor(value: ActiveAnalysis): EvidenceObject {
  const result = value.outcome.result as { evidence?: EvidenceObject };
  if (!result.evidence) throw new Error("test analysis must include evidence");
  return result.evidence;
}

const RAW_ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/u;
const INTERNAL_EVIDENCE_KEY_RE = /"(?:analysis_id|source_id|observation_id|evidence_id|dataset_id|payloadHash|payload_hash|observed_at|retrieved_at)"\s*:/u;

function expectNoInternalEvidenceDetails(output: unknown): void {
  const serialized = JSON.stringify(output);
  expect(serialized).not.toMatch(INTERNAL_EVIDENCE_KEY_RE);
  expect(serialized).not.toMatch(RAW_ISO_TIMESTAMP_RE);
  expect(serialized).not.toContain("analysis-wind_storm");
  expect(serialized).not.toContain("analysis-flood_storm");
  expect(serialized).not.toContain("evd-test");
  expect(serialized).not.toContain("intent-test");
  expect(serialized).not.toContain("obs-wind_storm");
  expect(serialized).not.toContain("obs-flood_storm");
  expect(serialized).not.toContain("noaa_ncei_global_hourly");
  expect(serialized).not.toContain("usgs_instantaneous_values");
  expect(serialized).not.toContain("nasa_gibs_imerg");
  expect(serialized).not.toContain("https://example.test/");
  expect(serialized).not.toContain("a".repeat(64));
}

describe("contextual WebMCP tools", () => {
  const options = { signal: new AbortController().signal } as WebMCP.ToolExecuteCallbackOptions;

  it("reports non-overlapping wind and water scopes", async () => {
    const wind = await createInspectEvidenceTool(analysis("wind_storm", "home")).execute({}, options);
    const flood = await createInspectEvidenceTool(analysis("flood_storm", "travel")).execute({}, options);
    expect(wind).toMatchObject({ evidence_scope: "regional_wind_observations" });
    expect(flood).toMatchObject({ evidence_scope: "regional_water_and_rain_observations" });
  });

  it("inspects related context as separate non-causal chains", async () => {
    const output = await createInspectEvidenceTool(
      analysis("wind_storm", "home"),
      [analysis("flood_storm", "home")]
    ).execute({}, options);
    expect(output).toMatchObject({
      hazard: "wind_storm",
      relationship: "related_evidence_for_assessment",
      inference_guidance: "state_strongest_supported_inference_and_confidence",
      answer_order: [
        "strongest_supported_assessment",
        "observation_values_times_and_official_citations",
        "direct_observation_then_labelled_inference",
        "confidence_and_evidence_that_would_change_it",
      ],
      support: {
        level: "official_observations_in_every_chain",
        chains_with_observations: 2,
      },
      related_chains: [
        {
          hazard: "flood_storm",
          evidence_scope: "regional_water_and_rain_observations",
          strongest_observation: { name: "Gage height", value: 4.2 },
        },
      ],
    });
    expect(output).toMatchObject({
      citations: [
        {
          hazard: "wind_storm",
          source_name: "NOAA NCEI Global Historical Climatology Network-hourly (GHCNh)",
          product: "NOAA GHCNh",
          observed: "Jul 8, 2024, 2:35 PM UTC",
          retrieved: "Aug 26, 2026, 11:00 AM UTC",
          url: "https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly",
        },
        {
          hazard: "flood_storm",
          source_name: "USGS Water Data Continuous Values",
          product: "USGS IV",
          observed: "Jul 8, 2024, 2:35 PM UTC",
          retrieved: "Aug 26, 2026, 11:00 AM UTC",
          url: "https://waterdata.usgs.gov/nwis",
        },
      ],
    });
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS);
    expectNoInternalEvidenceDetails(output);
  });

  it("keeps production-sized related citations inside the contextual output limit", async () => {
    const wind = analysis("wind_storm", "home");
    const flood = analysis("flood_storm", "home");
    const windEvidence = evidenceFor(wind);
    const floodEvidence = evidenceFor(flood);

    windEvidence.observations[0].provenance.sourceUrl =
      "https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year/2024/psv/GHCNh_USW00000188_2024.psv";
    windEvidence.observations[0].provenance.product =
      "NOAA NCEI GHCNh Version 1 station-by-year PSV";
    windEvidence.observations.push({
      ...windEvidence.observations[0],
      observationId: "obs-wind-report",
      variableName: "Official regional wind-storm event context",
      provenance: {
        ...windEvidence.observations[0].provenance,
        sourceId: "nws_tropical_cyclone_report",
        sourceUrl:
          "https://www.weather.gov/media/hgx/TropicalEventSummary/PSHHGX_2024AL02_Beryl_Summary.pdf",
        product: "NWS Houston/Galveston Post-Tropical Cyclone Report for Hurricane Beryl",
      },
    });
    windEvidence.limitations = [{
      limitationId: "lim-wind-property",
      source: "noaa_ncei_global_hourly",
      description:
        "The selected in-area station is an outdoor point observation. It does not establish roof-level wind, wind at an address, property damage, or causation.",
      required: true,
    }];

    floodEvidence.observations[0].provenance.sourceUrl =
      "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=IMERG_Precipitation_Rate&SRS=EPSG%3A4326&STYLES=&WIDTH=512&HEIGHT=512&TIME=2024-07-08&BBOX=-95.62849777141066%2C29.535822206252245%2C-95.11110222858933%2C29.984977793747756";
    floodEvidence.observations[0].provenance.sourceId = "nasa_gibs_imerg";
    floodEvidence.observations[0].provenance.product =
      "NASA GIBS best-service layer IMERG_Precipitation_Rate; GetMap does not expose a numeric rainfall value";
    floodEvidence.limitations = [{
      limitationId: "lim-flood-visual",
      source: "nasa_gibs_imerg",
      description:
        "GIBS imagery is visualization evidence only. Numeric rainfall, surface-water extent, route status, and property impact are not inferred from image colors.",
      required: true,
    }];

    const output = await createInspectEvidenceTool(wind, [flood]).execute({}, options);
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS);
    expect(output).toMatchObject({
      relationship: "related_evidence_for_assessment",
      observations: [{ name: "Peak wind gust", value: 39.6 }],
      related_chains: [{ hazard: "flood_storm" }],
    });
    expect((output as { citations: Array<{ hazard: string }> }).citations.map(
      (citation) => citation.hazard
    )).toEqual(["wind_storm", "flood_storm"]);
    const serialized = JSON.stringify(output);
    expect(serialized).toContain("NOAA NCEI Global Historical Climatology Network-hourly (GHCNh)");
    expect(serialized).toContain("NASA GIBS IMERG Precipitation Rate Visualization");
    expect(serialized).not.toMatch(/GHCNh_USW00000188_2024\.psv|PSHHGX_2024AL02_Beryl_Summary\.pdf|SERVICE=WMS|IMERG_Precipitation_Rate/u);
    expectNoInternalEvidenceDetails(output);
  });

  it("keeps inspection bounded when internal identifiers are unexpectedly long", async () => {
    const wind = analysis("wind_storm", "home");
    wind.analysisId = `analysis-${"a".repeat(5_000)}`;
    const windEvidence = evidenceFor(wind);
    windEvidence.observations[0].observationId = `obs-${"b".repeat(5_000)}`;
    windEvidence.observations[0].unit = `unit-${"c".repeat(5_000)}`;
    windEvidence.observations[0].provenance.sourceUrl =
      `https://example.test/${"d".repeat(5_000)}`;

    const output = await createInspectEvidenceTool(wind).execute({}, options);
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS);
    expect(output).toMatchObject({
      status: "ok",
      observations: [{ name: "Peak wind gust", value: 39.6 }],
    });
    expectNoInternalEvidenceDetails(output);
  });

  it("answers natural source-failure and evidence-needed follow-ups without re-querying", async () => {
    const wind = analysis("wind_storm", "home");
    const evidence = evidenceFor(wind);
    evidence.missionAttributions = [{
      missionName: "NWS Preliminary Local Storm Reports",
      agency: "NOAA / National Weather Service",
      purpose: "Recent event reports",
      selectionReason: "Selected-area event check",
      contributedObservationIds: [],
      retrievalStatus: "failed",
      keyLimitation: "The request failed and missing data is not evidence of no storm.",
      datasetId: "NWS LSR",
    }];
    evidence.limitations = [{
      limitationId: "lim-lsr-failure",
      source: "nws_local_storm_reports",
      description: "The recent NWS report request failed; returned station evidence does not replace it.",
      required: true,
    }];
    const tool = createInspectEvidenceTool(wind);
    const sources = await tool.execute({ focus: "sources" }, options);
    const needed = await tool.execute({ focus: "evidence_needed" }, options);

    expect(sources).toMatchObject({
      focus: "sources",
      hazard: "wind_storm",
      source_checks: expect.arrayContaining([
        expect.objectContaining({
          source: "NWS Preliminary Local Storm Reports",
          status: "failed",
        }),
      ]),
      agent_response_contract: { style: "plain_english", answer_the_follow_up_directly: true },
    });
    expect(needed).toMatchObject({
      focus: "evidence_needed",
      what_would_change_conclusion: expect.arrayContaining([
        expect.stringMatching(/successful retry/iu),
      ]),
    });
    expect(JSON.stringify(sources).length).toBeLessThanOrEqual(MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS);
    expect(JSON.stringify(needed).length).toBeLessThanOrEqual(MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS);
    expect(JSON.stringify(sources)).not.toContain("NWS LSR");
    expect(JSON.stringify(sources)).not.toContain("lim-lsr-failure");
    expectNoInternalEvidenceDetails(sources);
    expectNoInternalEvidenceDetails(needed);
  });

  it("can inspect only one chain from the current multi-chain result", async () => {
    const output = await createInspectEvidenceTool(
      analysis("wind_storm", "home"),
      [analysis("flood_storm", "home")]
    ).execute({ focus: "direct_observations", hazard: "flood_storm" }, options);

    expect(output).toMatchObject({
      status_label: "Information available",
      display_summary: expect.stringContaining("Flood & Heavy Rain"),
      focus: "direct_observations",
      hazard: "flood_storm",
      hazard_label: "Flood & Heavy Rain",
      direct_observations: [{
        name: "Gage height",
        value: 4.2,
        source_name: "USGS Water Data Continuous Values",
        observed: "Jul 8, 2024, 2:35 PM UTC",
      }],
    });
    const directObservation = (output as {
      direct_observations: Array<Record<string, unknown>>;
    }).direct_observations[0];
    expect(directObservation).not.toHaveProperty("id");
    expect(directObservation).not.toHaveProperty("source");
    expect(directObservation).not.toHaveProperty("observed_at");
    expectNoInternalEvidenceDetails(output);
  });

  it("does not echo an unexpected internal field name in a rejected request", async () => {
    const output = await createInspectEvidenceTool(
      analysis("wind_storm", "home")
    ).execute({ internal_debug_code: true }, options);

    expect(output).toMatchObject({
      status: "invalid_input",
      status_label: "Request could not be used",
      display_summary: "The evidence request could not be used.",
    });
    expect(JSON.stringify(output)).not.toContain("internal_debug_code");
  });

  it("registers claim preparation only for a Home + Wind result and only updates local UI", async () => {
    const open = vi.fn();
    const windHome = analysis("wind_storm", "home");
    const tool = createStormClaimDiscussionTool(windHome, open);
    expect(tool).not.toBeNull();
    expect(claimDiscussionForAnalysis(analysis("wind_storm", "travel"))).toBeNull();
    expect(createStormClaimDiscussionTool(analysis("flood_storm", "home"), open)).toBeNull();
    const rejected = await tool!.execute({ internal_debug_code: true }, options);
    expect(rejected).toMatchObject({
      status: "invalid_input",
      message: "Open this discussion without adding extra details, then try again.",
    });
    expect(JSON.stringify(rejected)).not.toMatch(/internal_debug_code|This tool takes no input/u);
    expect(open).not.toHaveBeenCalled();
    const output = await tool!.execute({}, options);
    expect(open).toHaveBeenCalledOnce();
    expect(output).toMatchObject({
      status: "ready_for_discussion",
      ui_updated: true,
      evidence_scope: "regional_wind_observations",
      assessment: "Official regional wind evidence makes wind contribution plausible.",
      confidence: "moderate",
      no_claim_decision: true,
    });
    expect(output).not.toHaveProperty("analysis_id");
    expectNoInternalEvidenceDetails(output);
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS);
  });

  it("keeps implementation details out of storm-claim display text", async () => {
    const wind = analysis("wind_storm", "home");
    const discussion = claimDiscussionForAnalysis(wind);
    if (!discussion) throw new Error("test analysis must include a claim discussion");
    discussion.assessmentSummary =
      "NOAA GHCNh supports this assessment; obs-secret and station-data.psv are internal references.";
    discussion.supportedStatements = [
      "The nasa_gibs_imerg check also carried evd-secret and aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.",
    ];

    const output = await createStormClaimDiscussionTool(wind, vi.fn())!.execute({}, options) as {
      display_summary: string;
      assessment: string;
      supported_by_evidence: string[];
    };
    const displayText = [
      output.display_summary,
      output.assessment,
      ...output.supported_by_evidence,
    ].join(" ");
    expect(displayText).not.toMatch(/nasa_gibs_imerg|obs-secret|evd-secret|station-data\.psv|a{64}/u);
    expect(displayText).toContain("NOAA GHCNh");
    expectNoInternalEvidenceDetails(output);
  });

  it("keeps the claim discussion bounded when source fields are unexpectedly long", async () => {
    const wind = analysis("wind_storm", "home");
    wind.analysisId = `analysis-${"a".repeat(5_000)}`;
    const discussion = claimDiscussionForAnalysis(wind);
    if (!discussion) throw new Error("test analysis must include a claim discussion");
    discussion.assessmentSummary = "assessment ".repeat(1_000);
    discussion.supportedStatements = ["supported ".repeat(1_000)];
    discussion.notEstablished = ["question ".repeat(1_000)];
    discussion.documentationChecklist = ["document ".repeat(1_000)];
    discussion.officialGuidance = [{
      label: "Long fixture URL",
      url: `https://example.test/${"z".repeat(5_000)}`,
    }];

    const output = await createStormClaimDiscussionTool(wind, vi.fn())!.execute({}, options);
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS);
    expect(output).toMatchObject({
      status: "ready_for_discussion",
      ui_updated: true,
      no_claim_decision: true,
    });
    expect(output).not.toHaveProperty("analysis_id");
  });
});
