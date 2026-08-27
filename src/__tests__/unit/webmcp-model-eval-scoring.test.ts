import { describe, expect, it } from "vitest";
import {
  asksUserToChooseHazard,
  normalizeEvalPlace,
  preservesNoObservationBoundary,
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
});
