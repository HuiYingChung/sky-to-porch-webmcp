import { describe, expect, it } from "vitest";
import { queryDroughtFixture } from "@/lib/drought/fixture-adapter";
import { finalizeDroughtQueryResult } from "@/lib/drought/service";
import type { DroughtQueryResult } from "@/lib/drought/types";

describe("finalizeDroughtQueryResult", () => {
  it("deep-copies and explains an evidence-bearing result", async () => {
    const input = queryDroughtFixture({
      placeId: "demo-tucson",
      date: "2024-06-04",
      mode: "fixture",
    });

    const result = await finalizeDroughtQueryResult(input, "home", null);

    expect(result).not.toBe(input);
    expect(result.sourceOutcomes).not.toBe(input.sourceOutcomes);
    expect(result.evidence).not.toBe(input.evidence);
    expect(result.evidence?.observations).not.toBe(input.evidence?.observations);
    expect(result.evidence?.limitations).not.toBe(input.evidence?.limitations);
    expect(result.explanationStatus).toEqual({ mode: "deterministic", reason: "ai_unavailable" });
    expect(result.explanation?.plainSummary).toBeTruthy();
    expect(result.evidence?.explanations).toEqual([result.explanation]);
  });

  it("copies a result without evidence instead of returning the caller object", async () => {
    const input: DroughtQueryResult = {
      kind: "unsupported_place",
      sourceOutcomes: { gibs: "not_attempted", usdm: "not_attempted" },
      rejectionReason: "unsupported",
    };

    const result = await finalizeDroughtQueryResult(input, "home", null);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.sourceOutcomes).not.toBe(input.sourceOutcomes);
  });
});
