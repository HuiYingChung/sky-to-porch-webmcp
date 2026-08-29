import { describe, expect, it } from "vitest";
import {
  asksUserToChooseHazard,
  normalizeEvalPlace,
  preservesNoObservationBoundary,
  scoreMultiChainPlainEnglishSummary,
} from "../../../scripts/webmcp-model-eval-scoring";

describe("WebMCP model-eval semantic scoring", () => {
  it.each([
    "Which hazard do you want to investigate?",
    "Do you mean a specific hazard around Denver? Pick one: heat or air quality.",
    "Which specific environmental concern do you mean: fire, flood, heat, or air quality?",
  ])("recognizes a real hazard clarification question: %s", (text) => {
    expect(asksUserToChooseHazard(text)).toBe(true);
  });

  it("does not treat a hazard assertion as a clarification question", () => {
    expect(asksUserToChooseHazard("The hazard is air quality.")).toBe(false);
  });

  it.each([
    "No observations were returned. This doesn't guarantee no danger.",
    "No supported observations were found; that doesn’t guarantee safety.",
    "No evidence was returned — not that there’s definitely no danger.",
    "This absence of data isn’t proof there’s no danger.",
    "The lack of observations does not mean the area is safe.",
    "I couldn't find any supported smoke observations. That doesn't prove there's no danger.",
    "No recent observations were returned. This doesn't guarantee there's no wildfire risk.",
    "No observations returned for wind or flood—insufficient evidence to assess roof risk.",
    "No official observations were found. Confidence: insufficient.",
    "No observations were returned, so I cannot determine whether the area is safe.",
    "No observations found for Houston. Coverage is insufficient to assess hazard impact on the roof.",
    "The sources returned no observations. That does not prove there's no hazard.",
  ])("accepts a truthful no-observation boundary: %s", (text) => {
    expect(preservesNoObservationBoundary(text)).toBe(true);
  });

  it.each([
    "No observations were returned, so there is no danger.",
    "No danger was found.",
    "The source failed.",
  ])("rejects an absent or unsafe no-observation boundary: %s", (text) => {
    expect(preservesNoObservationBoundary(text)).toBe(false);
  });

  it("treats near/around as harmless place qualifiers", () => {
    expect(normalizeEvalPlace("Near Hilo")).toBe("hilo");
    expect(normalizeEvalPlace("around Hilo")).toBe("hilo");
  });

  it("accepts an overall plain-English summary that reports both storm chains", () => {
    expect(scoreMultiChainPlainEnglishSummary(
      "Overall, precipitation evidence was available for Houston, but the wind sources returned no matching observation.\n\nFlood & Heavy Rain: NASA IMERG showed regional precipitation on August 28, 2026; the image does not establish street flooding.\n\nWind & Storm: No validated wind observation was returned for the same place and time; that does not mean conditions were safe.",
      ["wind_storm", "flood_storm"],
      {
        requiredTime: "August 28, 2026",
        sourceTermGroups: [["NASA", "IMERG"]],
        requireLimitation: true,
      }
    )).toEqual({
      reportsEveryChain: true,
      usesPlainEnglish: true,
      leadsWithOverallSummary: true,
      includesEvidenceDetails: true,
    });
  });

  it("rejects a response that hides one chain", () => {
    expect(scoreMultiChainPlainEnglishSummary(
      "Overall, no wind observation was returned for Houston.",
      ["wind_storm", "flood_storm"]
    )).toMatchObject({
      reportsEveryChain: false,
      leadsWithOverallSummary: false,
    });
  });

  it("rejects internal result-field language instead of plain English", () => {
    expect(scoreMultiChainPlainEnglishSummary(
      "Overall, wind evidence was unavailable and flood evidence was observed. The related_context included_chains were wind_storm and flood_storm.",
      ["wind_storm", "flood_storm"]
    ).usesPlainEnglish).toBe(false);
  });

  it("requires the overall summary before chain details", () => {
    expect(scoreMultiChainPlainEnglishSummary(
      "Wind & Storm: No observation was returned. Flood & Heavy Rain: Precipitation evidence was available.",
      ["wind_storm", "flood_storm"]
    )).toMatchObject({
      reportsEveryChain: true,
      leadsWithOverallSummary: false,
    });
  });

  it("accepts a short request lead-in before the overall summary", () => {
    expect(scoreMultiChainPlainEnglishSummary(
      "Request: Greater Houston storm information — summary: Wind & Storm returned no observation; Flood & Heavy Rain returned precipitation evidence. Wind source: NOAA. Flood source: NASA IMERG. Time: 2026-08-28T00:00:00Z. Limitation: imagery does not establish street flooding.",
      ["wind_storm", "flood_storm"],
      {
        requiredTime: "2026-08-28",
        sourceTermGroups: [["NASA", "IMERG"], ["NOAA", "IEM"]],
        requireLimitation: true,
      }
    )).toEqual({
      reportsEveryChain: true,
      usesPlainEnglish: true,
      leadsWithOverallSummary: true,
      includesEvidenceDetails: true,
    });
  });
});
